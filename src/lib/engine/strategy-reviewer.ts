import { getState, setState } from '@/lib/db/queries/system-state';
import { getClosedPositions } from '@/lib/db/queries/positions';
import {
  getStrategyParams,
  updateParam,
  insertModification,
  getCurrentVersion,
} from '@/lib/db/queries/strategy';
import { getRegimeHistory } from '@/lib/db/queries/regime';
import { getSnapshots } from '@/lib/db/queries/equity';
import { createAlert } from '@/lib/db/queries/alerts';
import { callClaude } from '@/lib/ai/client';
import { buildSystemPrompt } from '@/lib/ai/prompts/system';
import {
  buildStrategyReviewPrompt,
  type StrategyReviewData,
} from '@/lib/ai/prompts/strategy-review';
import { parseStrategyReviewResponse, type ParameterChange } from '@/lib/ai/response-parser';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of completed trades between reviews */
const REVIEW_TRADE_INTERVAL = 5;

/** Days between reviews */
const REVIEW_DAY_INTERVAL = 30;

/** Parameters that CANNOT be adjusted (hard guardrails) */
const IMMUTABLE_GUARDRAILS = new Set([
  // These map to the "CANNOT adjust" list from Section 13
  'max_single_position_pct',
  'max_total_deployment_pct',
  'min_cash_reserve_pct',
  'hard_circuit_breaker',
  'soft_circuit_breaker_pct',
  'min_risk_reward_ratio',
  'catalyst_requirement',
  'min_conviction_entry',
  'max_positions',
  'min_position_size',
  'tradeable_assets',
  'correlation_rules',
  'daily_loss_limit_pct',
  'btc_benchmark_requirement',
]);

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function checkAndRunReview(): Promise<boolean> {
  // 1. Check if review is due
  const isDue = await isReviewDue();
  if (!isDue) {
    return false;
  }

  console.log('[StrategyReviewer] Review is due, assembling data...');

  try {
    // 2. Assemble review data
    const reviewData = await assembleReviewData();

    // 3. Call Claude with strategy review prompt
    const currentVersion = await getCurrentVersion();
    const strategyParams = await getStrategyParams();
    const modifiedParams: Record<string, { current_value: number; default_value: number }> = {};
    for (const p of strategyParams) {
      modifiedParams[p.paramName] = {
        current_value: Number(p.currentValue),
        default_value: Number(p.defaultValue),
      };
    }

    const systemPrompt = buildSystemPrompt({
      strategyVersion: currentVersion,
      modifiedParams,
    });
    const userPrompt = buildStrategyReviewPrompt(reviewData);

    const claudeResponse = await callClaude({
      systemPrompt,
      userMessage: userPrompt,
    });

    // 4. Parse response
    const parsed = parseStrategyReviewResponse(claudeResponse);

    if (!parsed.success || !parsed.changes) {
      console.error(`[StrategyReviewer] Failed to parse review response: ${parsed.error}`);
      await createAlert({
        type: 'strategy_modification',
        severity: 'warning',
        message: `Strategy review failed to parse: ${parsed.error}`,
      });
      // Still update the review timestamp so we don't retry immediately
      await setState('last_strategy_review_at', new Date().toISOString());
      return true;
    }

    // 5. Validate changes against guardrails
    const validChanges = validateChanges(parsed.changes, strategyParams);

    // 6. Apply valid changes
    if (validChanges.length > 0) {
      const newVersion = computeNewVersion(currentVersion, validChanges.length);

      for (const change of validChanges) {
        await updateParam(
          change.param_name,
          change.new_value,
          newVersion,
          change.reasoning,
        );
      }

      // 7. Insert strategy_modifications row
      const tradeCountStr = await getState('total_trade_count');
      const tradeCount = tradeCountStr ? parseInt(tradeCountStr, 10) : 0;

      await insertModification({
        fromVersion: currentVersion,
        toVersion: newVersion,
        timestamp: new Date(),
        paramsChanged: validChanges,
        reasoning: parsed.analysis ?? 'Strategy review adjustment',
        tradeCountAtModification: tradeCount,
        winRateAtModification: reviewData.winRate > 0 ? String(reviewData.winRate) : null,
        btcBenchmarkDeltaAtModification: String(reviewData.benchmarkDelta),
      });

      // 8. Update system state
      await setState('strategy_version', newVersion);
      await setState('last_strategy_review_at', new Date().toISOString());

      // 9. Create alert
      const changesSummary = validChanges
        .map((c) => `${c.param_name}: ${c.old_value} -> ${c.new_value}`)
        .join(', ');

      await createAlert({
        type: 'strategy_modification',
        severity: 'info',
        message: `Strategy updated ${currentVersion} -> ${newVersion}: ${changesSummary}`,
        data: {
          from_version: currentVersion,
          to_version: newVersion,
          changes: validChanges,
          analysis: parsed.analysis,
          overall_assessment: parsed.overallAssessment,
          btc_recommendation: parsed.btcBenchmarkRecommendation,
        },
      });

      console.log(
        `[StrategyReviewer] Strategy updated ${currentVersion} -> ${newVersion}, ` +
          `${validChanges.length} parameter(s) changed`,
      );
    } else {
      // No changes needed
      await setState('last_strategy_review_at', new Date().toISOString());

      await createAlert({
        type: 'strategy_modification',
        severity: 'info',
        message: `Strategy review completed - no changes needed. Assessment: ${parsed.overallAssessment ?? 'stable'}`,
        data: {
          analysis: parsed.analysis,
          overall_assessment: parsed.overallAssessment,
          btc_recommendation: parsed.btcBenchmarkRecommendation,
        },
      });

      console.log('[StrategyReviewer] Review completed, no parameter changes');
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[StrategyReviewer] Error during review: ${msg}`);
    await createAlert({
      type: 'strategy_modification',
      severity: 'critical',
      message: `Strategy review error: ${msg}`,
    });
    return true; // Still count as "ran" to avoid retry loops
  }
}

// ─── Review Due Check ─────────────────────────────────────────────────────────

async function isReviewDue(): Promise<boolean> {
  const [tradeCountStr, lastReviewAtStr] = await Promise.all([
    getState('total_trade_count'),
    getState('last_strategy_review_at'),
  ]);

  const tradeCount = tradeCountStr ? parseInt(tradeCountStr, 10) : 0;
  const lastReviewAt = lastReviewAtStr ? new Date(lastReviewAtStr) : null;

  // Check trade count threshold: every 5 completed trades
  // We need to track the trade count at last review
  const lastReviewTradeCountStr = await getState('trade_count_at_last_review');
  const lastReviewTradeCount = lastReviewTradeCountStr
    ? parseInt(lastReviewTradeCountStr, 10)
    : 0;

  const tradesSinceReview = tradeCount - lastReviewTradeCount;
  if (tradesSinceReview >= REVIEW_TRADE_INTERVAL) {
    console.log(
      `[StrategyReviewer] Review due: ${tradesSinceReview} trades since last review`,
    );
    return true;
  }

  // Check time threshold: every 30 days
  if (lastReviewAt) {
    const daysSinceReview =
      (Date.now() - lastReviewAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceReview >= REVIEW_DAY_INTERVAL) {
      console.log(
        `[StrategyReviewer] Review due: ${daysSinceReview.toFixed(1)} days since last review`,
      );
      return true;
    }
  } else if (tradeCount >= REVIEW_TRADE_INTERVAL) {
    // Never reviewed and we have enough trades
    console.log('[StrategyReviewer] Review due: first review');
    return true;
  }

  return false;
}

// ─── Data Assembly ────────────────────────────────────────────────────────────

async function assembleReviewData(): Promise<StrategyReviewData> {
  // Get closed live positions for analysis (strategy review only uses real trades)
  const closedPositions = await getClosedPositions({ limit: 50, isPaper: false });

  // Compute win rate
  const wins = closedPositions.filter((p) => p.netPnl && Number(p.netPnl) > 0);
  const losses = closedPositions.filter((p) => p.netPnl && Number(p.netPnl) <= 0);
  const winRate = closedPositions.length > 0 ? wins.length / closedPositions.length : 0;

  // Average win and loss sizes as percentage of entry
  const avgWin =
    wins.length > 0
      ? wins.reduce((sum, p) => {
          const entry = Number(p.entryPrice);
          const exit = Number(p.exitPrice ?? p.entryPrice);
          return sum + (entry > 0 ? ((exit - entry) / entry) * 100 : 0);
        }, 0) / wins.length
      : 0;

  const avgLoss =
    losses.length > 0
      ? losses.reduce((sum, p) => {
          const entry = Number(p.entryPrice);
          const exit = Number(p.exitPrice ?? p.entryPrice);
          return sum + (entry > 0 ? ((exit - entry) / entry) * 100 : 0);
        }, 0) / losses.length
      : 0;

  // Get strategy params
  const params = await getStrategyParams();
  const strategyParamsMap: StrategyReviewData['strategyParams'] = {};
  for (const p of params) {
    strategyParamsMap[p.paramName] = {
      current_value: Number(p.currentValue),
      default_value: Number(p.defaultValue),
      min_allowed: Number(p.minAllowed),
      max_allowed: Number(p.maxAllowed),
    };
  }

  // Regime accuracy
  const regimeHistory = await getRegimeHistory(30);
  const assessedRegimes = regimeHistory.filter((r) => r.wasCorrect !== null);
  const regimeAccuracy =
    assessedRegimes.length > 0
      ? assessedRegimes.filter((r) => r.wasCorrect === true).length /
        assessedRegimes.length
      : null;

  // BTC benchmark delta
  const snapshots = await getSnapshots(2);
  const startingCapitalStr = await getState('starting_capital');
  const startingCapital = startingCapitalStr ? Number(startingCapitalStr) : 500;

  let benchmarkDelta = 0;
  if (snapshots.length > 0) {
    const latestSnapshot = snapshots[0];
    const totalValue = Number(latestSnapshot.totalValueUsd);
    const btcHoldValue = Number(latestSnapshot.btcHoldValue);

    const systemReturn = ((totalValue - startingCapital) / startingCapital) * 100;
    const btcReturn = ((btcHoldValue - startingCapital) / startingCapital) * 100;
    benchmarkDelta = systemReturn - btcReturn;
  }

  // Build trade history for the prompt
  const tradeHistory: StrategyReviewData['tradeHistory'] = closedPositions.map(
    (p) => {
      const entryTime = p.entryTime ? new Date(p.entryTime) : new Date();
      const exitTime = p.exitTime ? new Date(p.exitTime) : new Date();
      const holdDays =
        (exitTime.getTime() - entryTime.getTime()) / (1000 * 60 * 60 * 24);

      return {
        id: p.id,
        asset: p.asset,
        type: p.type,
        direction: p.direction,
        entry_price: Number(p.entryPrice),
        exit_price: Number(p.exitPrice ?? 0),
        net_pnl: Number(p.netPnl ?? 0),
        fees_paid: Number(p.feesPaid ?? 0),
        conviction_at_entry: p.convictionAtEntry,
        exit_reason: p.exitReason ?? 'unknown',
        hold_duration_days: holdDays,
        strategy_version: p.strategyVersion,
        regime_at_entry: p.regimeAtEntry,
        catalyst: p.catalyst,
        post_trade_assessment: null, // Would be populated from evaluations if available
        closed_at: exitTime.toISOString(),
      };
    },
  );

  return {
    tradeHistory,
    winRate,
    avgWin,
    avgLoss,
    strategyParams: strategyParamsMap,
    regimeAccuracy,
    benchmarkDelta,
  };
}

// ─── Change Validation ────────────────────────────────────────────────────────

function validateChanges(
  changes: ParameterChange[],
  currentParams: Awaited<ReturnType<typeof getStrategyParams>>,
): ParameterChange[] {
  const validChanges: ParameterChange[] = [];

  for (const change of changes) {
    // Check if the parameter is on the immutable list
    if (IMMUTABLE_GUARDRAILS.has(change.param_name)) {
      console.warn(
        `[StrategyReviewer] Rejected change to immutable guardrail: ${change.param_name}`,
      );
      continue;
    }

    // Find the parameter in current params to validate bounds
    const param = currentParams.find((p) => p.paramName === change.param_name);
    if (!param) {
      console.warn(
        `[StrategyReviewer] Unknown parameter: ${change.param_name}, skipping`,
      );
      continue;
    }

    // Check within allowed range
    const minAllowed = Number(param.minAllowed);
    const maxAllowed = Number(param.maxAllowed);

    if (change.new_value < minAllowed || change.new_value > maxAllowed) {
      console.warn(
        `[StrategyReviewer] Change to ${change.param_name} out of range: ` +
          `${change.new_value} not in [${minAllowed}, ${maxAllowed}], clamping`,
      );
      // Clamp to allowed range rather than rejecting
      change.new_value = Math.max(minAllowed, Math.min(maxAllowed, change.new_value));
    }

    // Don't apply no-ops
    if (change.new_value === change.old_value) {
      continue;
    }

    validChanges.push(change);
  }

  return validChanges;
}

// ─── Version Computation ──────────────────────────────────────────────────────

function computeNewVersion(currentVersion: string, numChanges: number): string {
  const parts = currentVersion.split('.');
  const major = parseInt(parts[0], 10) || 1;
  const minor = parseInt(parts[1], 10) || 0;

  if (numChanges >= 3) {
    // Major version bump for 3+ changes
    return `${major + 1}.0`;
  } else {
    // Minor version bump for 1-2 changes
    return `${major}.${minor + 1}`;
  }
}
