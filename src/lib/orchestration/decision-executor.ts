import { stateRead, stateWriter, appDecisionLogger, errorLogger } from "@/lib/db/utils";
import { insertPosition, openPositionsForCurrentMode } from "@/lib/db/queries/positions";
import { getExecutor } from "@/lib/execution";
import type { OrderExecutor } from "@/lib/execution/interface";
import { altSizing, btcCoreSizing } from "@/lib/risk/position-sizing";
import { checkAltCooldown, checkDailyLossCap, checkHardFloor } from "@/lib/risk/circuit-breakers";
import { STRATEGY_VERSION, MIN_POSITION_SIZE_USD } from "@/lib/strategy/constants";
import { log } from "@/lib/logger";
import type {
  AltEntryCandidateSchema,
  BtcCoreDecisionSchema,
  MorningBrief,
} from "@/lib/ai/schemas";
import type { z } from "zod";

/**
 * Decision executor — turns a freshly-produced morning brief into orders.
 *
 * Per BUILD_PLAN.md §4D + STRATEGY.md §3.4 / §3.5. This is the missing glue
 * between the AI's planning loop and the executor's order placement.
 *
 * Scope of this iteration:
 *   - Pre-flight gates (paused / halted / hard floor / loss cap / cooldown)
 *   - Alt cycle entries from `brief.alt_entry_candidates`
 *   - BTC core dca_in / hold / exit from `brief.btc_core_decision`
 *
 * NOT in this iteration (tracked as separate punch-list items):
 *   - 2-tranche laddered entries spread over 24h (we place tranche 1 at
 *     full size for now; STRATEGY.md §3.5 calls for splitting it 50/50)
 *   - Trailing stop ratcheting on existing alt positions (separate module)
 *   - Laddered cycle-high exits (1/3 + 1/3 + 1/3 over days)
 *   - alt_position actions (`trail_stop`, `partial_sell`, `exit`)
 *
 * Idempotency: each invocation checks `state.last_executed_brief_eval_id`.
 * If the same evaluation id has already been processed, the function
 * short-circuits. This makes Force Brief safe to click twice and survives
 * boot crashes mid-execution.
 */

type AltCandidate = z.infer<typeof AltEntryCandidateSchema>;
type BtcCoreDecision = z.infer<typeof BtcCoreDecisionSchema>;

export interface DecisionExecutorContext {
  /** Evaluation row id for the brief — used for idempotency + position linkage. */
  evaluationId: string;
  /** Total account value (cash + positions mark-to-market). */
  accountValueUsd: number;
  cashUsd: number;
  /** Current prices keyed by uppercase asset symbol. Must include every candidate's asset and BTC. */
  currentPrices: Record<string, number>;
  /** Sum of currently-open alt position notional value at current prices. */
  currentAltExposureUsd: number;
  /** Notional value held in BTC core (open BTC positions, mark-to-market). */
  currentBtcCoreUsd: number;
  /** Whether the soft drawdown breaker is currently active (halves alt sizes). */
  softBreakerActive: boolean;
}

export type DecisionOutcome =
  | { kind: "placed"; orderId: string; positionId?: string; sizeUsd: number; price: number }
  | { kind: "skipped"; reason: string };

export interface DecisionExecutorResult {
  /** True if a fresh run executed; false if the brief was already processed. */
  ran: boolean;
  /** When ran=false, the reason (idempotency, paused, halted, hard floor). */
  shortCircuitReason?: string;
  altResults: Array<{ asset: string; outcome: DecisionOutcome }>;
  btcCoreResult: DecisionOutcome | null;
  /** Aggregate notional placed (USD). For the Force Brief toast. */
  totalPlacedUsd: number;
  /** Aggregate count of placed orders (entry + stop). */
  ordersPlacedCount: number;
}

const NO_RESULT: DecisionExecutorResult = {
  ran: false,
  altResults: [],
  btcCoreResult: null,
  totalPlacedUsd: 0,
  ordersPlacedCount: 0,
};

// ---------------------------------------------------------------------------
// Pure pre-flight (testable, no I/O)
// ---------------------------------------------------------------------------

export interface PreflightInput {
  paused: boolean;
  phaseHalted: boolean;
  hardFloorBreached: boolean;
  dailyLossCapBlocked: boolean;
  altCooldownActive: boolean;
}

export interface PreflightDecision {
  /** Block ALL trading actions (entries + exits). */
  blockAll: boolean;
  /** Block new alt entries only (BTC core + exits still allowed). */
  blockAltEntries: boolean;
  reasons: string[];
}

export function evaluatePreflight(input: PreflightInput): PreflightDecision {
  const reasons: string[] = [];
  let blockAll = false;
  let blockAltEntries = false;

  if (input.paused) {
    reasons.push("trading_paused=true");
    blockAll = true;
  }
  if (input.phaseHalted) {
    reasons.push('phase="halted"');
    blockAll = true;
  }
  if (input.hardFloorBreached) {
    reasons.push("account at or below hard floor — halting");
    blockAll = true;
  }
  if (input.dailyLossCapBlocked) {
    reasons.push("daily loss cap reached — entries blocked");
    blockAltEntries = true;
  }
  if (input.altCooldownActive) {
    reasons.push("alt cooldown active (2 consecutive alt losses)");
    blockAltEntries = true;
  }

  return { blockAll, blockAltEntries, reasons };
}

// ---------------------------------------------------------------------------
// Pure sizing helpers (testable, no I/O)
// ---------------------------------------------------------------------------

/** Compute the buy quantity for an alt entry given USD size and price. */
export function quantityFor(sizeUsd: number, price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) return 0;
  return sizeUsd / price;
}

/** Initial stop price for an alt entry given the AI's stop_pct (4-20%). */
export function initialStopPrice(entryPrice: number, stopPct: number): number {
  return entryPrice * (1 - stopPct / 100);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const LAST_EXECUTED_KEY = "last_executed_brief_eval_id";

export async function executeBriefDecisions(
  brief: MorningBrief,
  ctx: DecisionExecutorContext,
): Promise<DecisionExecutorResult> {
  // Idempotency: if we already ran for this brief, no-op.
  const lastExecuted = await stateRead<string>(LAST_EXECUTED_KEY);
  if (lastExecuted === ctx.evaluationId) {
    log.info("Decision executor: brief already processed, short-circuiting", {
      evaluationId: ctx.evaluationId,
    });
    return { ...NO_RESULT, shortCircuitReason: "already_executed" };
  }

  // Pre-flight gates (read state + risk breakers).
  const [paused, phase, hardFloor, dailyLossCap, cooldown] = await Promise.all([
    stateRead<boolean>("trading_paused"),
    stateRead<string>("phase"),
    checkHardFloor(ctx.accountValueUsd),
    checkDailyLossCap(ctx.accountValueUsd),
    checkAltCooldown(),
  ]);

  const preflight = evaluatePreflight({
    paused: paused === true,
    phaseHalted: phase === "halted",
    hardFloorBreached: hardFloor.halted,
    dailyLossCapBlocked: dailyLossCap.blocked,
    altCooldownActive: cooldown.active,
  });

  if (preflight.blockAll) {
    await appDecisionLogger({
      decisionType: "phase_gate",
      inputs: {
        evaluationId: ctx.evaluationId,
        accountValueUsd: ctx.accountValueUsd,
      },
      outputs: { blocked: true, reasons: preflight.reasons },
      reasoning: `Decision executor refused to act: ${preflight.reasons.join("; ")}`,
      relatedEntity: ctx.evaluationId,
    });
    return { ...NO_RESULT, shortCircuitReason: preflight.reasons.join("; ") };
  }

  const executor = getExecutor();

  // Snapshot existing positions so we don't double-enter.
  const openPositions = await openPositionsForCurrentMode();
  const openByAsset = new Map<string, true>();
  for (const p of openPositions) openByAsset.set(p.asset.toUpperCase(), true);

  const altResults: Array<{ asset: string; outcome: DecisionOutcome }> = [];
  let totalPlacedUsd = 0;
  let ordersPlacedCount = 0;

  // ── Alt cycle entries ────────────────────────────────────────────────
  // Bear regime forbids alt entries entirely (REGIME_ALLOCATIONS.bear.maxAltPct=0).
  // Opus shouldn't propose any in a bear brief, but altSizing rejects them
  // defensively if it does.
  const briefRegime = brief.regime === "bear" ? "bear" : brief.regime;
  for (const candidate of brief.alt_entry_candidates) {
    const outcome = preflight.blockAltEntries
      ? ({ kind: "skipped", reason: preflight.reasons.join("; ") } as const)
      : await executeAltEntry(executor, candidate, briefRegime, ctx, openByAsset);
    altResults.push({ asset: candidate.asset, outcome });
    if (outcome.kind === "placed") {
      totalPlacedUsd += outcome.sizeUsd;
      // 1 entry order + 1 stop order placed per successful alt entry.
      ordersPlacedCount += 2;
    }
  }

  // ── BTC core ─────────────────────────────────────────────────────────
  const btcCoreResult = await executeBtcCoreAction(
    executor,
    brief.btc_core_decision,
    brief.regime,
    ctx,
  );
  if (btcCoreResult && btcCoreResult.kind === "placed") {
    totalPlacedUsd += btcCoreResult.sizeUsd;
    ordersPlacedCount += 1;
  }

  // Mark this brief processed BEFORE returning so a crash in the caller
  // doesn't cause us to re-execute on retry.
  await stateWriter({
    key: LAST_EXECUTED_KEY,
    value: ctx.evaluationId,
    changedBy: "orchestration.decision-executor",
    relatedEvalId: ctx.evaluationId,
  });

  return {
    ran: true,
    altResults,
    btcCoreResult,
    totalPlacedUsd,
    ordersPlacedCount,
  };
}

// ---------------------------------------------------------------------------
// Per-decision handlers
// ---------------------------------------------------------------------------

async function executeAltEntry(
  executor: OrderExecutor,
  candidate: AltCandidate,
  regime: "bull" | "chop" | "bear",
  ctx: DecisionExecutorContext,
  openByAsset: Map<string, true>,
): Promise<DecisionOutcome> {
  const asset = candidate.asset.toUpperCase();

  if (openByAsset.has(asset)) {
    return { kind: "skipped", reason: `already holds open ${asset} position` };
  }

  const price = ctx.currentPrices[asset];
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return { kind: "skipped", reason: `no current price for ${asset}` };
  }

  // Cycle low zone is a planning concern Opus already enforces — we trust the
  // brief here. The size+regime+headroom check is our defense in depth.
  const sizing = altSizing({
    regime,
    requestedSizePct: candidate.size_pct,
    accountValueUsd: ctx.accountValueUsd,
    currentAltExposureUsd: ctx.currentAltExposureUsd,
    softBreakerActive: ctx.softBreakerActive,
  });

  if (!sizing.allowed) {
    return {
      kind: "skipped",
      reason: sizing.rejectionReason ?? "sizing rejected",
    };
  }

  if (sizing.effectiveSizeUsd > ctx.cashUsd) {
    return {
      kind: "skipped",
      reason: `insufficient cash ($${ctx.cashUsd.toFixed(2)} < $${sizing.effectiveSizeUsd.toFixed(2)})`,
    };
  }

  const quantity = quantityFor(sizing.effectiveSizeUsd, price);
  if (quantity <= 0) {
    return { kind: "skipped", reason: "quantity computed as zero" };
  }

  try {
    // Insert the position row first so the order can reference it.
    const position = await insertPosition({
      asset,
      type: "alt_cycle",
      status: "open",
      direction: "long",
      entryPrice: price.toString(),
      quantity: quantity.toString(),
      stopPrice: initialStopPrice(price, candidate.stop_pct).toString(),
      targetPrice: null,
      convictionAtEntry: candidate.conviction,
      catalyst: candidate.momentum_signal,
      thesis: candidate.reasoning,
      entryTime: new Date(),
      strategyVersion: STRATEGY_VERSION,
      regimeAtEntry: regime,
      paperMode: executor.mode === "paper",
    });

    const entryOrder = await executor.placeLimitBuy(asset, price, quantity, {
      relatedPositionId: position.id,
    });

    // Best-effort initial stop. If this throws, position is already created;
    // reconciliation will detect the missing stop and place it on next boot.
    const stopPrice = initialStopPrice(price, candidate.stop_pct);
    const stopLimitPrice = stopPrice * 0.995; // a hair below trigger to ensure marketability
    try {
      await executor.placeStopLimit(asset, stopPrice, stopLimitPrice, quantity, {
        relatedPositionId: position.id,
      });
    } catch (err) {
      await errorLogger({
        severity: "warning",
        component: "orchestration.decision-executor",
        error: err instanceof Error ? err : new Error(String(err)),
        context: { asset, positionId: position.id, stopPrice, quantity },
        recovered: true,
        recoveryAction:
          "Position created and entry filled; reconciliation will place the missing stop on next boot.",
      });
    }

    await appDecisionLogger({
      decisionType: "order_routing",
      inputs: {
        evaluationId: ctx.evaluationId,
        candidate,
        accountValueUsd: ctx.accountValueUsd,
        currentAltExposureUsd: ctx.currentAltExposureUsd,
      },
      outputs: {
        positionId: position.id,
        orderId: entryOrder.coinbaseOrderId,
        effectiveSizeUsd: sizing.effectiveSizeUsd,
        effectiveSizePct: sizing.effectiveSizePct,
        entryPrice: price,
        stopPrice,
      },
      reasoning: `Alt cycle entry placed: ${asset} at $${price.toFixed(4)} for $${sizing.effectiveSizeUsd.toFixed(2)} (conviction ${candidate.conviction}). Initial stop at -${candidate.stop_pct.toFixed(1)}% = $${stopPrice.toFixed(4)}.`,
      relatedEntity: position.id,
    });

    log.info("Alt cycle entry placed", {
      asset,
      sizeUsd: sizing.effectiveSizeUsd,
      price,
      stopPrice,
      positionId: position.id,
    });

    return {
      kind: "placed",
      orderId: entryOrder.coinbaseOrderId,
      positionId: position.id,
      sizeUsd: sizing.effectiveSizeUsd,
      price,
    };
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "orchestration.decision-executor",
      error: err instanceof Error ? err : new Error(String(err)),
      context: { asset, candidate },
      recovered: false,
    });
    return {
      kind: "skipped",
      reason: `placement failed: ${(err as Error).message}`,
    };
  }
}

async function executeBtcCoreAction(
  executor: OrderExecutor,
  decision: BtcCoreDecision,
  regime: "bull" | "chop" | "bear",
  ctx: DecisionExecutorContext,
): Promise<DecisionOutcome | null> {
  if (decision.action === "hold") {
    return { kind: "skipped", reason: "btc_core_decision.action=hold" };
  }

  const btcPrice = ctx.currentPrices["BTC"];
  if (btcPrice == null || !Number.isFinite(btcPrice) || btcPrice <= 0) {
    return { kind: "skipped", reason: "no current BTC price" };
  }

  const sizing = btcCoreSizing(regime, ctx.accountValueUsd);
  const targetUsd = Math.min(
    sizing.maxUsd,
    ctx.accountValueUsd * (decision.target_alloc_pct / 100),
  );
  const deltaUsd = targetUsd - ctx.currentBtcCoreUsd;

  if (decision.action === "dca_in" || decision.action === "dca_out") {
    if (Math.abs(deltaUsd) < MIN_POSITION_SIZE_USD) {
      return {
        kind: "skipped",
        reason: `delta $${deltaUsd.toFixed(2)} below minimum tranche size`,
      };
    }
  }

  try {
    if (decision.action === "dca_in" && deltaUsd > 0) {
      // For MVP: place tranche 1 at full delta. STRATEGY.md §3.6 calls for
      // splitting across `tranches_planned` days; that's a follow-up.
      if (deltaUsd > ctx.cashUsd) {
        return {
          kind: "skipped",
          reason: `insufficient cash for dca_in ($${ctx.cashUsd.toFixed(2)} < $${deltaUsd.toFixed(2)})`,
        };
      }
      const qty = quantityFor(deltaUsd, btcPrice);
      const order = await executor.placeDcaLimitBuy("BTC", btcPrice, qty);
      await logBtcCoreDecision(ctx, decision, regime, {
        order: order.coinbaseOrderId,
        deltaUsd,
        btcPrice,
      });
      return {
        kind: "placed",
        orderId: order.coinbaseOrderId,
        sizeUsd: deltaUsd,
        price: btcPrice,
      };
    }

    if ((decision.action === "dca_out" || decision.action === "exit") && ctx.currentBtcCoreUsd > 0) {
      const sellUsd =
        decision.action === "exit"
          ? ctx.currentBtcCoreUsd
          : Math.min(ctx.currentBtcCoreUsd, -deltaUsd);
      if (sellUsd <= 0 || sellUsd < MIN_POSITION_SIZE_USD) {
        return {
          kind: "skipped",
          reason: `nothing meaningful to sell ($${sellUsd.toFixed(2)})`,
        };
      }
      const qty = quantityFor(sellUsd, btcPrice);
      const order = await executor.placeMarketExit("BTC", qty);
      await logBtcCoreDecision(ctx, decision, regime, {
        order: order.coinbaseOrderId,
        deltaUsd: -sellUsd,
        btcPrice,
      });
      return {
        kind: "placed",
        orderId: order.coinbaseOrderId,
        sizeUsd: sellUsd,
        price: btcPrice,
      };
    }

    return {
      kind: "skipped",
      reason: `no-op for action=${decision.action} (delta=$${deltaUsd.toFixed(2)})`,
    };
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "orchestration.decision-executor",
      error: err instanceof Error ? err : new Error(String(err)),
      context: { decision, regime, deltaUsd },
      recovered: false,
    });
    return {
      kind: "skipped",
      reason: `BTC core placement failed: ${(err as Error).message}`,
    };
  }
}

async function logBtcCoreDecision(
  ctx: DecisionExecutorContext,
  decision: BtcCoreDecision,
  regime: "bull" | "chop" | "bear",
  outputs: { order: string; deltaUsd: number; btcPrice: number },
): Promise<void> {
  await appDecisionLogger({
    decisionType: "order_routing",
    inputs: {
      evaluationId: ctx.evaluationId,
      decision,
      regime,
      currentBtcCoreUsd: ctx.currentBtcCoreUsd,
      accountValueUsd: ctx.accountValueUsd,
    },
    outputs,
    reasoning: `BTC core ${decision.action}: $${Math.abs(outputs.deltaUsd).toFixed(2)} at $${outputs.btcPrice.toFixed(2)} → target ${decision.target_alloc_pct}% of account.`,
    relatedEntity: ctx.evaluationId,
  });
}

