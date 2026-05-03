/**
 * Main evaluation orchestrator.
 *
 * Runs the full evaluation flow: assemble data, compute risk, call Claude,
 * parse response, validate trades, execute decisions, and log results.
 */

import type { EvaluationType } from '@/lib/types/strategy';
import type { EvaluationOutput } from '@/lib/types/evaluation';
import type { PortfolioState, PositionWithPrice } from '@/lib/types/portfolio';
import { getState, setState } from '@/lib/db/queries/system-state';
import { getTodaysEvaluations, insertEvaluation } from '@/lib/db/queries/evaluations';
import { getOpenPositions } from '@/lib/db/queries/positions';
import { createAlert } from '@/lib/db/queries/alerts';
import { insertSnapshot } from '@/lib/db/queries/equity';
import { getCurrentVersion, getStrategyParams } from '@/lib/db/queries/strategy';
import { assembleDataPackage } from '@/lib/engine/data-package';
import { computeRiskState, validateNewTrade, type RiskState } from '@/lib/engine/risk-manager';
import { processRegimeChange } from '@/lib/engine/regime-detector';
import { callClaude } from '@/lib/ai/client';
import { buildSystemPrompt } from '@/lib/ai/prompts/system';
import { buildDailyPrompt } from '@/lib/ai/prompts/daily-evaluation';
import { buildSwingPrompt } from '@/lib/ai/prompts/swing-evaluation';
import { buildEmergencyPrompt } from '@/lib/ai/prompts/emergency';
import { parseEvaluationResponse } from '@/lib/ai/response-parser';
import { getMidPrice, getAllBalances } from '@/lib/coinbase';
import { EVALUATION_TIMES, ALL_ASSETS } from '@/lib/constants';

import { executeDecisions } from '@/lib/engine/decision-executor';

// ─── Helpers ───────────────────────────────────────────────────────────────

function getNextEvaluationTime(): Date {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // Find the next evaluation time
  for (const evalHour of EVALUATION_TIMES) {
    if (utcHour < evalHour) {
      const next = new Date(now);
      next.setUTCHours(evalHour, 0, 0, 0);
      return next;
    }
  }

  // All today's evaluation times have passed; schedule for first one tomorrow
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(EVALUATION_TIMES[0], 0, 0, 0);
  return tomorrow;
}

async function buildPortfolioStateForRisk(isPaper: boolean): Promise<{
  portfolioState: PortfolioState;
  positionsWithPrice: PositionWithPrice[];
}> {
  const openPositions = await getOpenPositions(isPaper);
  const regime = ((await getState('current_regime')) ?? 'ranging') as PortfolioState['regime'];
  const peakStr = await getState('peak_portfolio_value');
  const peakValue = peakStr ? Number(peakStr) : 500;
  const versionStr = await getCurrentVersion();
  const balances = await getAllBalances(['USD', 'BTC', 'ETH', 'SOL']);
  const cashUsd = balances.USD?.available ?? 0;

  const REGIME_CAP: Record<string, number> = {
    strong_bull: 70,
    mild_bull: 50,
    ranging: 30,
    mild_bear: 15,
    strong_bear: 0,
  };

  let deployedUsd = 0;
  const positionsWithPrice: PositionWithPrice[] = [];

  for (const pos of openPositions) {
    let currentPrice = 0;
    try {
      currentPrice = await getMidPrice(`${pos.asset}-USD`);
    } catch {
      currentPrice = Number(pos.entryPrice); // Fallback to entry price
    }

    const quantity = Number(pos.quantity);
    const entryPrice = Number(pos.entryPrice);
    const positionValue = currentPrice * quantity;
    const costBasis = Number(pos.costBasis);
    const unrealizedPnlUsd = positionValue - costBasis;
    const unrealizedPnlPct = costBasis > 0 ? (unrealizedPnlUsd / costBasis) * 100 : 0;
    const daysHeld = (Date.now() - new Date(pos.entryTime).getTime()) / (1000 * 3600 * 24);

    deployedUsd += positionValue;

    positionsWithPrice.push({
      id: pos.id,
      asset: pos.asset,
      type: pos.type as 'swing' | 'core',
      direction: pos.direction,
      entry_price: entryPrice,
      current_price: currentPrice,
      quantity,
      cost_basis: costBasis,
      position_value_usd: positionValue,
      unrealized_pnl_usd: unrealizedPnlUsd,
      unrealized_pnl_pct: unrealizedPnlPct,
      stop_loss: Number(pos.stopLoss),
      take_profit_target: Number(pos.takeProfitTarget),
      stop_order_id: pos.stopOrderId,
      tp_order_id: pos.tpOrderId,
      entry_time: pos.entryTime.toISOString(),
      days_held: Math.round(daysHeld * 10) / 10,
      conviction_at_entry: pos.convictionAtEntry,
      current_conviction: pos.currentConviction,
      strategy_version: pos.strategyVersion,
      catalyst: pos.catalyst,
      thesis: pos.thesis,
    });
  }

  const totalValue = cashUsd + deployedUsd;
  const exposurePct = totalValue > 0 ? (deployedUsd / totalValue) * 100 : 0;
  const regimeCapPct = REGIME_CAP[regime] ?? 30;
  const maxDeployable = totalValue * (regimeCapPct / 100);
  const remainingDeployable = Math.max(0, maxDeployable - deployedUsd);
  const drawdownPct = peakValue > 0 ? ((peakValue - totalValue) / peakValue) * 100 : 0;

  const portfolioState: PortfolioState = {
    total_value_usd: totalValue,
    cash_usd: cashUsd,
    deployed_usd: deployedUsd,
    exposure_pct: exposurePct,
    regime,
    regime_exposure_cap_pct: regimeCapPct,
    remaining_deployable_usd: remainingDeployable,
    peak_value_usd: peakValue,
    drawdown_from_peak_pct: drawdownPct,
    soft_breaker_active: drawdownPct > 20,
    hard_breaker_active: totalValue <= 300,
    positions: positionsWithPrice,
    strategy_version: versionStr,
  };

  return { portfolioState, positionsWithPrice };
}

// ─── Main Evaluation ───────────────────────────────────────────────────────

export async function runEvaluation(
  type?: 'daily_l1l2' | 'swing_l2' | 'emergency',
  emergencyTrigger?: {
    asset: string;
    priceChange: number;
    direction: string;
  }
): Promise<void> {
  console.log(`[Evaluation] Starting evaluation (type: ${type ?? 'auto-detect'})...`);

  // Step 1: Check if trading is paused
  const tradingPaused = await getState('trading_paused');
  if (tradingPaused === 'true') {
    console.log('[Evaluation] Trading is paused. Skipping evaluation.');
    return;
  }

  // Step 2: Determine evaluation type
  let evalType: EvaluationType;
  if (type) {
    evalType = type;
  } else {
    // Auto-detect: if first eval of the day, it's daily; otherwise swing
    const todaysEvals = await getTodaysEvaluations();
    const hasDailyToday = todaysEvals.some((e) => e.type === 'daily_l1l2');
    evalType = hasDailyToday ? 'swing_l2' : 'daily_l1l2';
  }
  console.log(`[Evaluation] Evaluation type: ${evalType}`);

  // Step 3: Assemble data package
  let dataPackage;
  try {
    dataPackage = await assembleDataPackage(evalType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Evaluation] Failed to assemble data package: ${message}`);
    await createAlert({
      type: 'emergency_evaluation',
      severity: 'critical',
      message: `Evaluation failed: could not assemble data package. Error: ${message}`,
    });
    return;
  }

  // Step 4: Compute risk state
  let riskState: RiskState;
  try {
    riskState = await computeRiskState();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Evaluation] Failed to compute risk state: ${message}`);
    riskState = {
      dailyLossExceeded: false,
      dailyLoss: 0,
      inCooldown: false,
      consecutiveLosses: 0,
      softBreakerActive: false,
      hardBreakerActive: false,
      currentDrawdownPct: 0,
      peakValue: 500,
      currentValue: 500,
    };
  }

  // Check hard circuit breaker
  if (riskState.hardBreakerActive) {
    console.error('[Evaluation] HARD CIRCUIT BREAKER ACTIVE. Halting all trading.');
    await createAlert({
      type: 'circuit_breaker_hard',
      severity: 'critical',
      message: `Hard circuit breaker active. Account value at $${riskState.currentValue.toFixed(2)}. All trading halted.`,
    });
    await setState('trading_paused', 'true');
    return;
  }

  // Step 5: Build the appropriate prompt
  const strategyVersion = await getCurrentVersion();
  const strategyParamRows = await getStrategyParams();
  const modifiedParams: Record<string, { current_value: number; default_value: number }> = {};
  for (const p of strategyParamRows) {
    modifiedParams[p.paramName] = {
      current_value: Number(p.currentValue),
      default_value: Number(p.defaultValue),
    };
  }

  // Step 6: Build system prompt
  const systemPrompt = buildSystemPrompt({
    strategyVersion,
    modifiedParams,
  });

  // Step 5 continued: Build user prompt based on evaluation type
  let userPrompt: string;
  switch (evalType) {
    case 'daily_l1l2':
      userPrompt = buildDailyPrompt(dataPackage);
      break;
    case 'emergency':
      if (!emergencyTrigger) {
        console.error('[Evaluation] Emergency evaluation requested but no trigger provided');
        return;
      }
      userPrompt = buildEmergencyPrompt(dataPackage, emergencyTrigger);
      break;
    case 'swing_l2':
    default:
      userPrompt = buildSwingPrompt(dataPackage);
      break;
  }

  // Step 7: Call Claude
  let rawResponse: string;
  try {
    console.log('[Evaluation] Calling Claude...');
    rawResponse = await callClaude({
      systemPrompt,
      userMessage: userPrompt,
    });
    console.log(`[Evaluation] Claude responded (${rawResponse.length} chars)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Evaluation] Claude API call failed: ${message}`);
    await createAlert({
      type: 'emergency_evaluation',
      severity: 'critical',
      message: `Claude API call failed during ${evalType} evaluation: ${message}`,
    });
    return;
  }

  // Step 8: Parse response
  const parseResult = parseEvaluationResponse(rawResponse);
  if (!parseResult.success || !parseResult.data) {
    console.error(`[Evaluation] Failed to parse Claude response: ${parseResult.error}`);
    await createAlert({
      type: 'emergency_evaluation',
      severity: 'warning',
      message: `Claude response parse failed: ${parseResult.error}. No actions taken.`,
      data: { raw_response_preview: rawResponse.substring(0, 500) },
    });

    // Still log the evaluation even if parsing failed
    const paperModeForLog = (await getState('paper_trading_mode')) === 'true';
    await insertEvaluation({
      timestamp: new Date(),
      type: evalType,
      opusResponse: { raw: rawResponse, parse_error: parseResult.error },
      actionsTaken: { error: 'parse_failed' },
      strategyVersion,
      isPaper: paperModeForLog,
    });
    return;
  }

  const evaluationOutput = parseResult.data;

  // Step 10: Process Layer 1 output if present (regime changes)
  if (evaluationOutput.layer_1) {
    try {
      await processRegimeChange(evaluationOutput.layer_1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Evaluation] Failed to process regime change: ${message}`);
    }
  }

  // Read paper mode state (needed for risk assessment and execution)
  const paperMode = (await getState('paper_trading_mode')) === 'true';

  // Step 11: Validate proposed trades via risk manager
  const { portfolioState, positionsWithPrice } = await buildPortfolioStateForRisk(paperMode);

  const validatedTrades = [];
  const rejectedTrades = [];

  for (const trade of evaluationOutput.layer_2.new_trades) {
    try {
      const validation = await validateNewTrade(trade, portfolioState, positionsWithPrice);

      if (validation.approved) {
        // Apply any modifications
        const modifiedTrade = { ...trade };
        for (const mod of validation.modifications) {
          if (mod.field === 'position_size_usd') {
            modifiedTrade.position_size_usd = Number(mod.modified);
          }
          if (mod.field === 'position_size_pct') {
            modifiedTrade.position_size_pct = Number(mod.modified);
          }
        }
        validatedTrades.push(modifiedTrade);
        console.log(
          `[Evaluation] Trade approved: ${trade.asset} ${trade.type} (conviction: ${trade.conviction}, ` +
            `modifications: ${validation.modifications.length})`
        );
      } else {
        rejectedTrades.push({
          trade,
          reasons: validation.rejectionReasons,
        });
        console.log(
          `[Evaluation] Trade rejected: ${trade.asset} — ${validation.rejectionReasons.join('; ')}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Evaluation] Trade validation error for ${trade.asset}: ${message}`);
      rejectedTrades.push({
        trade,
        reasons: [`Validation error: ${message}`],
      });
    }
  }

  // Replace new_trades with only validated ones
  const executionOutput: EvaluationOutput = {
    ...evaluationOutput,
    layer_2: {
      ...evaluationOutput.layer_2,
      new_trades: validatedTrades,
    },
  };

  // Step 12: Execute approved decisions
  let actionsResult: Awaited<ReturnType<typeof executeDecisions>> = {
    tradesExecuted: [],
    positionsUpdated: [],
    errors: [],
  };

  try {
    actionsResult = await executeDecisions(executionOutput, paperMode);
    console.log(
      `[Evaluation] Execution complete: ${actionsResult.tradesExecuted.length} trades, ` +
        `${actionsResult.positionsUpdated.length} positions updated, ` +
        `${actionsResult.errors.length} errors`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Evaluation] Decision execution failed: ${message}`);
    actionsResult.errors.push(message);
  }

  // Step 13: Log the evaluation
  await insertEvaluation({
    timestamp: new Date(),
    type: evalType,
    opusResponse: evaluationOutput as unknown as Record<string, unknown>,
    actionsTaken: {
      validated_trades: validatedTrades.length,
      rejected_trades: rejectedTrades.map((r) => ({
        asset: r.trade.asset,
        reasons: r.reasons,
      })),
      trades_executed: actionsResult.tradesExecuted,
      positions_updated: actionsResult.positionsUpdated,
      errors: actionsResult.errors,
    },
    strategyVersion,
    isPaper: paperMode,
  });

  // Step 14: Update next_evaluation_at
  const nextEval = getNextEvaluationTime();
  await setState('next_evaluation_at', nextEval.toISOString());
  console.log(`[Evaluation] Next evaluation scheduled for ${nextEval.toISOString()}`);

  // Update last price at eval for emergency threshold checking
  for (const asset of ALL_ASSETS) {
    try {
      const price = await getMidPrice(`${asset}-USD`);
      await setState(`last_${asset.toLowerCase()}_price_at_eval`, String(price));
    } catch {
      // Non-critical
    }
  }

  // Step 15: Take equity snapshot
  try {
    const btcPrice = await getMidPrice('BTC-USD');
    const startingCapitalStr = await getState('starting_capital');
    const startingCapital = startingCapitalStr ? Number(startingCapitalStr) : 500;
    const btcPriceAtStart = await getState('btc_price_at_start');
    const btcStartPrice = btcPriceAtStart ? Number(btcPriceAtStart) : btcPrice;
    const btcHoldValue = startingCapital * (btcPrice / btcStartPrice);

    await insertSnapshot({
      total_value_usd: String(portfolioState.total_value_usd),
      cash_usd: String(portfolioState.cash_usd),
      deployed_usd: String(portfolioState.deployed_usd),
      btc_price: String(btcPrice),
      btc_hold_value: String(btcHoldValue),
    });

    // Update peak portfolio value if we have a new high
    if (portfolioState.total_value_usd > portfolioState.peak_value_usd) {
      await setState(
        'peak_portfolio_value',
        String(portfolioState.total_value_usd)
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Evaluation] Failed to take equity snapshot: ${message}`);
  }

  console.log(`[Evaluation] ${evalType} evaluation complete.`);
}
