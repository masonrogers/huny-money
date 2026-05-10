import { stateRead, stateWriter, appDecisionLogger, errorLogger } from "@/lib/db/utils";
import {
  insertPosition,
  openPositionsForCurrentMode,
  updatePosition,
} from "@/lib/db/queries/positions";
import { filledSellQtyByPositionForCurrentMode } from "@/lib/db/queries/orders";
import { getExecutor } from "@/lib/execution";
import type { OrderExecutor } from "@/lib/execution/interface";
import { altSizing, btcCoreSizing } from "@/lib/risk/position-sizing";
import { checkAltCooldown, checkDailyLossCap, checkHardFloor } from "@/lib/risk/circuit-breakers";
import {
  appendPendingLadder,
  scheduleTrancheTwo,
  trancheUsd as halfTrancheUsd,
} from "@/lib/orchestration/entry-ladder";
import {
  ALT_TRAILING_STOP_SCHEDULE,
  STRATEGY_VERSION,
  MIN_POSITION_SIZE_USD,
} from "@/lib/strategy/constants";
import { log } from "@/lib/logger";
import type {
  AltEntryCandidateSchema,
  AltPositionSchema,
  BtcCoreDecisionSchema,
  MorningBrief,
} from "@/lib/ai/schemas";
import type { Position } from "@/lib/db/schema";
import type { z } from "zod";

/**
 * Decision executor — turns a freshly-produced morning brief into orders.
 *
 * Per BUILD_PLAN.md §4D + STRATEGY.md §3.4 / §3.5. This is the missing glue
 * between the AI's planning loop and the executor's order placement.
 *
 * Scope:
 *   - Pre-flight gates (paused / halted / hard floor / loss cap / cooldown)
 *   - Alt cycle entries from `brief.alt_entry_candidates`
 *   - BTC core dca_in / hold / exit from `brief.btc_core_decision`
 *   - Alt position actions from `brief.alt_positions`:
 *       hold        — no-op
 *       trail_stop  — cancel old stop, place new one at the ratcheted level
 *                     per ALT_TRAILING_STOP_SCHEDULE. Only ratchets UP.
 *       partial_sell — sell min(remaining, originalQty/3) per §3.5 ladder
 *       exit        — market sell remaining qty, mark position closed
 *
 * NOT in this iteration:
 *   - 2-tranche laddered entries spread over 24h (we place tranche 1 at
 *     full size for now; STRATEGY.md §3.5 calls for splitting it 50/50)
 *
 * Idempotency: each invocation checks `state.last_executed_brief_eval_id`.
 * If the same evaluation id has already been processed, the function
 * short-circuits. This makes Force Brief safe to click twice and survives
 * boot crashes mid-execution.
 */

type AltCandidate = z.infer<typeof AltEntryCandidateSchema>;
type AltPositionAction = z.infer<typeof AltPositionSchema>;
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

export interface AltPositionActionResult {
  asset: string;
  action: "hold" | "trail_stop" | "partial_sell" | "exit";
  outcome: DecisionOutcome;
}

export interface DecisionExecutorResult {
  /** True if a fresh run executed; false if the brief was already processed. */
  ran: boolean;
  /** When ran=false, the reason (idempotency, paused, halted, hard floor). */
  shortCircuitReason?: string;
  altResults: Array<{ asset: string; outcome: DecisionOutcome }>;
  btcCoreResult: DecisionOutcome | null;
  /** Per STRATEGY.md §3.5 — actions on existing alt positions (manage / exit). */
  altPositionActions: AltPositionActionResult[];
  /** Aggregate notional placed (USD). For the Force Brief toast. */
  totalPlacedUsd: number;
  /** Aggregate count of placed orders (entry + stop + ratchets + exits). */
  ordersPlacedCount: number;
}

const NO_RESULT: DecisionExecutorResult = {
  ran: false,
  altResults: [],
  btcCoreResult: null,
  altPositionActions: [],
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

/**
 * Compute the next ratcheted trailing-stop price per ALT_TRAILING_STOP_SCHEDULE.
 *
 * STRATEGY.md §3.7:
 *   +25% profit → stop at breakeven (entry)
 *   +50% profit → stop at +20% (entry × 1.20)
 *   +75% profit → stop at +40% (entry × 1.40)
 *  +100% profit → stop at +65% (entry × 1.65)
 *
 * Returns the new stop only if it strictly improves on the current stop.
 * Stops never ratchet down — a price retracement does not loosen the stop.
 *
 * Returns null when no upgrade is appropriate (insufficient profit or the
 * existing stop already meets/exceeds the schedule).
 */
export function nextTrailingStopPrice(
  entryPrice: number,
  currentPrice: number,
  currentStopPrice: number | null,
): number | null {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  const profitPct = ((currentPrice - entryPrice) / entryPrice) * 100;

  // Find the highest schedule entry whose trigger we have already cleared.
  let scheduledStopPctFromEntry: number | null = null;
  for (const tier of ALT_TRAILING_STOP_SCHEDULE) {
    if (profitPct >= tier.triggerProfitPct) {
      scheduledStopPctFromEntry = tier.stopPctFromEntry;
    } else {
      break; // schedule is monotonically increasing
    }
  }

  if (scheduledStopPctFromEntry == null) return null;

  const newStop = entryPrice * (1 + scheduledStopPctFromEntry / 100);
  // Only improve. A current stop at or above the schedule's stop is good
  // enough (might have been ratcheted earlier, or set manually).
  if (currentStopPrice != null && currentStopPrice >= newStop) return null;
  return newStop;
}

/**
 * Quantity for a partial_sell tranche — 1/3 of the position's ORIGINAL
 * quantity, capped at what's still remaining. Three calls drain the position;
 * a fourth call sees 0 remaining and is a no-op.
 *
 * Per STRATEGY.md §3.5 the exit ladder is 1/3 + 1/3 + 1/3 across days.
 * Tying tranche size to original (not remaining) keeps each leg the same
 * size instead of shrinking geometrically.
 */
export function partialSellQuantity(
  originalQty: number,
  alreadySoldQty: number,
): number {
  if (!Number.isFinite(originalQty) || originalQty <= 0) return 0;
  if (!Number.isFinite(alreadySoldQty) || alreadySoldQty < 0) return 0;
  const remaining = originalQty - alreadySoldQty;
  if (remaining <= 0) return 0;
  const oneTranche = originalQty / 3;
  return Math.min(remaining, oneTranche);
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

  // Snapshot existing positions so we don't double-enter and so position
  // actions can find their target quickly.
  const [openPositions, soldByPosition] = await Promise.all([
    openPositionsForCurrentMode(),
    filledSellQtyByPositionForCurrentMode(),
  ]);
  const openByAsset = new Map<string, Position>();
  for (const p of openPositions) openByAsset.set(p.asset.toUpperCase(), p);

  const altResults: Array<{ asset: string; outcome: DecisionOutcome }> = [];
  const altPositionActions: AltPositionActionResult[] = [];
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

  // ── Alt position management (existing positions: hold / trail / sell) ──
  // Position management runs even if blockAltEntries is true — the loss cap
  // and cooldown only block NEW entries. Exits and stop ratchets stay live.
  for (const action of brief.alt_positions) {
    const outcome = await executeAltPositionAction(
      executor,
      action,
      ctx,
      openByAsset,
      soldByPosition,
    );
    altPositionActions.push({
      asset: action.asset.toUpperCase(),
      action: action.action,
      outcome,
    });
    if (outcome.kind === "placed") {
      totalPlacedUsd += outcome.sizeUsd;
      ordersPlacedCount += 1;
    }
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
    altPositionActions,
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
  openByAsset: Map<string, Position>,
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

  // Two-tranche ladder per STRATEGY.md §3.5 — split sizing across 24h.
  // Tranche 1 fills now; tranche 2 is queued for processing by the wake-up
  // cycle ~12h later. Each leg is sized at half the AI's intended USD.
  const tranche1Usd = halfTrancheUsd(sizing.effectiveSizeUsd);
  const tranche1Qty = quantityFor(tranche1Usd, price);
  if (tranche1Qty <= 0) {
    return { kind: "skipped", reason: "tranche-1 quantity computed as zero" };
  }

  // The position's quantity field reflects what we ACTUALLY hold — currently
  // just tranche 1. The ladder processor updates this to the combined qty
  // after tranche 2 lands.
  try {
    const position = await insertPosition({
      asset,
      type: "alt_cycle",
      status: "open",
      direction: "long",
      entryPrice: price.toString(),
      quantity: tranche1Qty.toString(),
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

    const entryOrder = await executor.placeLimitBuy(asset, price, tranche1Qty, {
      relatedPositionId: position.id,
    });

    // Best-effort initial stop on tranche-1 quantity. The ladder processor
    // re-places this on the combined quantity when tranche 2 lands. If this
    // throws, reconciliation will place the missing stop on next boot.
    const stopPrice = initialStopPrice(price, candidate.stop_pct);
    const stopLimitPrice = stopPrice * 0.995; // a hair below trigger to ensure marketability
    let stopOrderId: string | null = null;
    try {
      const stopOrder = await executor.placeStopLimit(
        asset,
        stopPrice,
        stopLimitPrice,
        tranche1Qty,
        { relatedPositionId: position.id },
      );
      stopOrderId = stopOrder.coinbaseOrderId;
      await updatePosition(position.id, { stopOrderId });
    } catch (err) {
      await errorLogger({
        severity: "warning",
        component: "orchestration.decision-executor",
        error: err instanceof Error ? err : new Error(String(err)),
        context: { asset, positionId: position.id, stopPrice, quantity: tranche1Qty },
        recovered: true,
        recoveryAction:
          "Position created and entry filled; reconciliation will place the missing stop on next boot.",
      });
    }

    // Queue tranche 2 for ~12h from now. Skipped only if the tranche size
    // would fall below the minimum-position-size — in that case the position
    // is just the single tranche.
    const tranche2Usd = sizing.effectiveSizeUsd - tranche1Usd;
    if (tranche2Usd >= MIN_POSITION_SIZE_USD) {
      await appendPendingLadder({
        positionId: position.id,
        asset,
        trancheUsd: tranche2Usd,
        originalEntryPrice: price,
        scheduledAt: scheduleTrancheTwo(new Date()).toISOString(),
        evaluationId: ctx.evaluationId,
      });
    }

    const ladderPlanned = tranche2Usd >= MIN_POSITION_SIZE_USD;
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
        tranche1Usd,
        tranche2Usd: ladderPlanned ? tranche2Usd : 0,
        ladderPlanned,
        entryPrice: price,
        stopPrice,
      },
      reasoning: ladderPlanned
        ? `Alt cycle entry — tranche 1 of 2: ${asset} at $${price.toFixed(4)} for $${tranche1Usd.toFixed(2)} (conviction ${candidate.conviction}). Initial stop at -${candidate.stop_pct.toFixed(1)}% = $${stopPrice.toFixed(4)}. Tranche 2 of $${tranche2Usd.toFixed(2)} queued for ~12h from now.`
        : `Alt cycle entry: ${asset} at $${price.toFixed(4)} for $${sizing.effectiveSizeUsd.toFixed(2)} (conviction ${candidate.conviction}). Initial stop at -${candidate.stop_pct.toFixed(1)}% = $${stopPrice.toFixed(4)}. Single tranche — half-size below minimum.`,
      relatedEntity: position.id,
    });

    log.info("Alt cycle entry tranche 1 placed", {
      asset,
      tranche1Usd,
      tranche2Usd: ladderPlanned ? tranche2Usd : null,
      price,
      stopPrice,
      positionId: position.id,
    });

    return {
      kind: "placed",
      orderId: entryOrder.coinbaseOrderId,
      positionId: position.id,
      sizeUsd: tranche1Usd,
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

  // BTC core uses ONE evergreen position (mirrors the alt pattern: one row,
  // updated as DCA tranches add/remove qty). Find or null.
  const openPositions = await openPositionsForCurrentMode();
  const existingBtcCore = openPositions.find((p) => p.type === "btc_core") ?? null;

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

      // Critical: update or insert the btc_core position record. Without this,
      // tomorrow's brief would read currentBtcCoreUsd=0 and DCA in again
      // forever (FINDINGS.md #11).
      let positionId: string;
      if (existingBtcCore) {
        const oldQty = parseFloat(existingBtcCore.quantity);
        const oldEntry = parseFloat(existingBtcCore.entryPrice);
        const newQty = oldQty + qty;
        // Weighted-average entry: (oldQty*oldEntry + newQty*newPrice) / totalQty.
        const newEntry = newQty > 0
          ? (oldQty * oldEntry + qty * btcPrice) / newQty
          : btcPrice;
        await updatePosition(existingBtcCore.id, {
          quantity: newQty.toString(),
          entryPrice: newEntry.toString(),
        });
        positionId = existingBtcCore.id;
      } else {
        const inserted = await insertPosition({
          asset: "BTC",
          type: "btc_core",
          status: "open",
          direction: "long",
          entryPrice: btcPrice.toString(),
          quantity: qty.toString(),
          stopPrice: null, // BTC core has NO trailing stop per STRATEGY.md §3.7
          targetPrice: null,
          convictionAtEntry: null,
          catalyst: `regime=${regime} dca_in`,
          thesis: decision.reasoning,
          entryTime: new Date(),
          strategyVersion: STRATEGY_VERSION,
          regimeAtEntry: regime,
          paperMode: executor.mode === "paper",
        });
        positionId = inserted.id;
      }

      await logBtcCoreDecision(ctx, decision, regime, {
        order: order.coinbaseOrderId,
        deltaUsd,
        btcPrice,
      });
      return {
        kind: "placed",
        orderId: order.coinbaseOrderId,
        positionId,
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

      // Update the btc_core position record. Decrement qty (or close on exit).
      // On close (exit OR dca_out drained), populate gross / net P&L so the
      // dashboard's closed-trade metrics aren't all-null.
      if (existingBtcCore) {
        const entryPrice = parseFloat(existingBtcCore.entryPrice);
        const exitFees = order.feesUsd ?? 0;
        if (decision.action === "exit") {
          const fullQty = parseFloat(existingBtcCore.quantity);
          const grossPnl = (btcPrice - entryPrice) * fullQty;
          await updatePosition(existingBtcCore.id, {
            status: "closed",
            exitPrice: btcPrice.toString(),
            exitTime: new Date(),
            exitReason: `regime=${regime} exit`,
            grossPnlUsd: grossPnl.toString(),
            feesUsd: exitFees.toString(),
            netPnlUsd: (grossPnl - exitFees).toString(),
          });
        } else {
          const oldQty = parseFloat(existingBtcCore.quantity);
          const newQty = Math.max(0, oldQty - qty);
          if (newQty <= 0) {
            const grossPnl = (btcPrice - entryPrice) * oldQty;
            await updatePosition(existingBtcCore.id, {
              status: "closed",
              quantity: "0",
              exitPrice: btcPrice.toString(),
              exitTime: new Date(),
              exitReason: `regime=${regime} dca_out drained`,
              grossPnlUsd: grossPnl.toString(),
              feesUsd: exitFees.toString(),
              netPnlUsd: (grossPnl - exitFees).toString(),
            });
          } else {
            // Entry price is unchanged on partial sell — represents the
            // weighted-average cost basis of remaining BTC.
            await updatePosition(existingBtcCore.id, {
              quantity: newQty.toString(),
            });
          }
        }
      }

      await logBtcCoreDecision(ctx, decision, regime, {
        order: order.coinbaseOrderId,
        deltaUsd: -sellUsd,
        btcPrice,
      });
      return {
        kind: "placed",
        orderId: order.coinbaseOrderId,
        positionId: existingBtcCore?.id,
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

// ---------------------------------------------------------------------------
// Alt position actions (existing positions: hold / trail_stop / partial_sell / exit)
// ---------------------------------------------------------------------------

async function executeAltPositionAction(
  executor: OrderExecutor,
  action: AltPositionAction,
  ctx: DecisionExecutorContext,
  openByAsset: Map<string, Position>,
  soldByPosition: Map<string, number>,
): Promise<DecisionOutcome> {
  const asset = action.asset.toUpperCase();
  const position = openByAsset.get(asset);

  if (!position) {
    return {
      kind: "skipped",
      reason: `no open ${asset} position to act on`,
    };
  }
  if (position.type !== "alt_cycle") {
    return {
      kind: "skipped",
      reason: `position ${asset} is ${position.type}, not alt_cycle`,
    };
  }

  if (action.action === "hold") {
    return { kind: "skipped", reason: "alt_position.action=hold" };
  }

  const price = ctx.currentPrices[asset];
  if (price == null || !Number.isFinite(price) || price <= 0) {
    return { kind: "skipped", reason: `no current price for ${asset}` };
  }

  const entryPrice = parseFloat(position.entryPrice);
  const originalQty = parseFloat(position.quantity);
  const alreadySoldQty = soldByPosition.get(position.id) ?? 0;
  const remainingQty = originalQty - alreadySoldQty;

  if (remainingQty <= 0) {
    return {
      kind: "skipped",
      reason: "position fully sold; awaiting reconciliation to close row",
    };
  }

  try {
    if (action.action === "exit") {
      return await handleExit(executor, asset, position, remainingQty, price, action, ctx);
    }
    if (action.action === "partial_sell") {
      return await handlePartialSell(
        executor,
        asset,
        position,
        originalQty,
        alreadySoldQty,
        price,
        action,
        ctx,
      );
    }
    if (action.action === "trail_stop") {
      return await handleTrailStop(
        executor,
        asset,
        position,
        entryPrice,
        remainingQty,
        price,
        action,
        ctx,
      );
    }
    return { kind: "skipped", reason: `unknown action ${action.action}` };
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "orchestration.decision-executor",
      error: err instanceof Error ? err : new Error(String(err)),
      context: { asset, action, positionId: position.id },
      recovered: false,
    });
    return {
      kind: "skipped",
      reason: `${action.action} failed: ${(err as Error).message}`,
    };
  }
}

async function handleExit(
  executor: OrderExecutor,
  asset: string,
  position: Position,
  remainingQty: number,
  price: number,
  action: AltPositionAction,
  ctx: DecisionExecutorContext,
): Promise<DecisionOutcome> {
  const order = await executor.placeMarketExit(asset, remainingQty, {
    relatedPositionId: position.id,
  });
  // Mark the position closed immediately so subsequent briefs don't re-act
  // on a "still open" row. Reconciliation will populate exit_price + P&L
  // when the fill lands.
  await updatePosition(position.id, {
    status: "closed",
    exitTime: new Date(),
    exitReason: `morning_brief_exit: ${action.reasoning.slice(0, 200)}`,
  });
  await logAltPositionAction(ctx, position, action, {
    order: order.coinbaseOrderId,
    sellQty: remainingQty,
    price,
  });
  log.info("Alt position exit placed", {
    asset,
    positionId: position.id,
    qty: remainingQty,
    price,
  });
  return {
    kind: "placed",
    orderId: order.coinbaseOrderId,
    positionId: position.id,
    sizeUsd: remainingQty * price,
    price,
  };
}

async function handlePartialSell(
  executor: OrderExecutor,
  asset: string,
  position: Position,
  originalQty: number,
  alreadySoldQty: number,
  price: number,
  action: AltPositionAction,
  ctx: DecisionExecutorContext,
): Promise<DecisionOutcome> {
  const sellQty = partialSellQuantity(originalQty, alreadySoldQty);
  if (sellQty <= 0) {
    return { kind: "skipped", reason: "no remaining quantity to partial-sell" };
  }
  const order = await executor.placeMarketExit(asset, sellQty, {
    relatedPositionId: position.id,
  });
  // Don't close the position — there's still remaining quantity (or one
  // tranche just left). The next brief decides whether to continue laddering.
  await logAltPositionAction(ctx, position, action, {
    order: order.coinbaseOrderId,
    sellQty,
    price,
  });
  log.info("Alt position partial_sell placed", {
    asset,
    positionId: position.id,
    sellQty,
    remainingAfter: originalQty - alreadySoldQty - sellQty,
    price,
  });
  return {
    kind: "placed",
    orderId: order.coinbaseOrderId,
    positionId: position.id,
    sizeUsd: sellQty * price,
    price,
  };
}

async function handleTrailStop(
  executor: OrderExecutor,
  asset: string,
  position: Position,
  entryPrice: number,
  remainingQty: number,
  price: number,
  action: AltPositionAction,
  ctx: DecisionExecutorContext,
): Promise<DecisionOutcome> {
  const currentStop = position.stopPrice ? parseFloat(position.stopPrice) : null;
  const newStop = nextTrailingStopPrice(entryPrice, price, currentStop);
  if (newStop == null) {
    return {
      kind: "skipped",
      reason:
        currentStop != null
          ? `no ratchet upgrade (current stop $${currentStop.toFixed(4)} already at or above schedule)`
          : "insufficient profit to trigger schedule",
    };
  }

  // Cancel the prior stop on the exchange (best-effort — paper executor is
  // a no-op cancel; live executor's reconciliation handles partial failures).
  if (position.stopOrderId) {
    try {
      await executor.cancelOrder(position.stopOrderId);
    } catch (err) {
      // Don't abort: an old stop that failed to cancel will at worst
      // double-stop the position — the new stop is tighter and fills first.
      await errorLogger({
        severity: "warning",
        component: "orchestration.decision-executor",
        error: err instanceof Error ? err : new Error(String(err)),
        context: { asset, positionId: position.id, oldStopOrderId: position.stopOrderId },
        recovered: true,
        recoveryAction: "Continuing with new stop placement.",
      });
    }
  }

  const stopLimitPrice = newStop * 0.995; // a hair below trigger to ensure marketability
  const order = await executor.placeStopLimit(asset, newStop, stopLimitPrice, remainingQty, {
    relatedPositionId: position.id,
  });

  await updatePosition(position.id, {
    stopPrice: newStop.toString(),
    stopOrderId: order.coinbaseOrderId,
  });

  await logAltPositionAction(ctx, position, action, {
    order: order.coinbaseOrderId,
    newStop,
    oldStop: currentStop,
    price,
  });
  log.info("Alt position trail_stop placed", {
    asset,
    positionId: position.id,
    oldStop: currentStop,
    newStop,
    currentPrice: price,
  });
  return {
    kind: "placed",
    orderId: order.coinbaseOrderId,
    positionId: position.id,
    sizeUsd: remainingQty * price,
    price: newStop,
  };
}

async function logAltPositionAction(
  ctx: DecisionExecutorContext,
  position: Position,
  action: AltPositionAction,
  outputs: Record<string, unknown>,
): Promise<void> {
  await appDecisionLogger({
    decisionType: "order_routing",
    inputs: {
      evaluationId: ctx.evaluationId,
      action,
      positionId: position.id,
      asset: position.asset,
      entryPrice: parseFloat(position.entryPrice),
      currentPrice: ctx.currentPrices[position.asset.toUpperCase()] ?? null,
    },
    outputs,
    reasoning: `Alt position ${action.action} on ${position.asset}: ${action.reasoning.slice(0, 220)}`,
    relatedEntity: position.id,
  });
}

