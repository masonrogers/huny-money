import { randomUUID } from "crypto";
import {
  appDecisionLogger,
  errorLogger,
  stateRead,
  stateWriter,
} from "@/lib/db/utils";
import {
  positionByIdForCurrentMode,
  updatePosition,
} from "@/lib/db/queries/positions";
import { getExecutor } from "@/lib/execution";
import type { OrderExecutor } from "@/lib/execution/interface";
import { log } from "@/lib/logger";

/**
 * Two-tranche entry ladder per STRATEGY.md §3.5.
 *
 * Goal: avoid placing one big order that nudges the market. The bot enters
 * an alt cycle position in two halves, ~12 hours apart. The first tranche
 * fires immediately from the morning brief. The second is queued in
 * `state.pending_entry_ladders` and processed by the wake-up cycle once
 * its scheduledAt timestamp passes.
 *
 * State shape (single key, JSON array):
 *   pending_entry_ladders = [{
 *     id, positionId, asset, trancheUsd, originalEntryPrice,
 *     scheduledAt, evaluationId, createdAt
 *   }, ...]
 *
 * Tranche 2 re-validates conditions before placing:
 *   - Position still open (otherwise: skip + drop)
 *   - Asset has a current price (otherwise: skip + retry next tick)
 *   - Current price within ±DRIFT_TOLERANCE of original entry
 *     (otherwise: skip + drop — conditions changed, let the next brief decide)
 *
 * After tranche 2 fills, the position's stop is RE-PLACED for the combined
 * quantity. The original stop on tranche-1-only quantity is cancelled first.
 *
 * Concurrency: state reads/writes are NOT atomic across the read-modify-write
 * cycle. Risk is bounded — the bot is single-process, the scheduler runs
 * ticks sequentially, and morning briefs run synchronously inside withActivity.
 * A pathological interleave could lose at most one tranche-2 record between
 * two ticks. Operator can re-place manually if it ever happens.
 */

const STATE_KEY = "pending_entry_ladders";
const TRANCHE_DELAY_HOURS = 12;
const DRIFT_TOLERANCE = 0.10; // ±10% from original entry → drop the tranche
const STOP_LIMIT_OFFSET = 0.995; // limit a hair below trigger for marketability

export interface PendingEntryLadder {
  id: string;
  positionId: string;
  asset: string;
  trancheUsd: number;
  originalEntryPrice: number;
  scheduledAt: string;
  evaluationId: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// State helpers (read / append / remove)
// ---------------------------------------------------------------------------

export async function readPendingLadders(): Promise<PendingEntryLadder[]> {
  const raw = await stateRead<PendingEntryLadder[]>(STATE_KEY);
  return Array.isArray(raw) ? raw : [];
}

/** Append a new pending ladder. Read-modify-write — see concurrency note above. */
export async function appendPendingLadder(
  ladder: Omit<PendingEntryLadder, "id" | "createdAt">,
): Promise<PendingEntryLadder> {
  const existing = await readPendingLadders();
  const full: PendingEntryLadder = {
    ...ladder,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await stateWriter({
    key: STATE_KEY,
    value: [...existing, full],
    changedBy: "orchestration.entry-ladder.append",
    relatedEvalId: ladder.evaluationId,
  });
  return full;
}

async function removeLadder(id: string, changedBy: string): Promise<void> {
  const existing = await readPendingLadders();
  const filtered = existing.filter((l) => l.id !== id);
  await stateWriter({
    key: STATE_KEY,
    value: filtered,
    changedBy,
  });
}

// ---------------------------------------------------------------------------
// Pure helpers (testable)
// ---------------------------------------------------------------------------

/** Half the dollar size for tranche 1 / tranche 2 ladder. */
export function trancheUsd(totalUsd: number): number {
  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return 0;
  return totalUsd / 2;
}

/** Schedule tranche 2 N hours after `now`. */
export function scheduleTrancheTwo(now: Date, hours = TRANCHE_DELAY_HOURS): Date {
  return new Date(now.getTime() + hours * 3600_000);
}

export function dueLadders(
  ladders: ReadonlyArray<PendingEntryLadder>,
  now: Date,
): PendingEntryLadder[] {
  const cutoff = now.getTime();
  return ladders.filter((l) => new Date(l.scheduledAt).getTime() <= cutoff);
}

/** True if the current price has drifted too far from the original entry. */
export function hasDriftedTooFar(
  originalPrice: number,
  currentPrice: number,
  tolerance = DRIFT_TOLERANCE,
): boolean {
  if (originalPrice <= 0 || currentPrice <= 0) return true;
  const drift = Math.abs(currentPrice - originalPrice) / originalPrice;
  return drift > tolerance;
}

// ---------------------------------------------------------------------------
// Main processor — called from wakeup-cycle every 5 min
// ---------------------------------------------------------------------------

export interface ProcessLaddersResult {
  examined: number;
  placed: number;
  skippedDrift: number;
  skippedClosed: number;
  skippedNoPrice: number;
  errors: number;
}

export async function processPendingEntryLadders(
  prices: Record<string, number>,
  now: Date = new Date(),
): Promise<ProcessLaddersResult> {
  const result: ProcessLaddersResult = {
    examined: 0,
    placed: 0,
    skippedDrift: 0,
    skippedClosed: 0,
    skippedNoPrice: 0,
    errors: 0,
  };

  const all = await readPendingLadders();
  const due = dueLadders(all, now);
  result.examined = due.length;
  if (due.length === 0) return result;

  const executor = getExecutor();

  for (const ladder of due) {
    try {
      const outcome = await processOne(executor, ladder, prices, now);
      switch (outcome) {
        case "placed":
          result.placed++;
          break;
        case "drift":
          result.skippedDrift++;
          break;
        case "closed":
          result.skippedClosed++;
          break;
        case "no_price":
          result.skippedNoPrice++;
          break;
      }
    } catch (err) {
      result.errors++;
      await errorLogger({
        severity: "error",
        component: "orchestration.entry-ladder",
        error: err instanceof Error ? err : new Error(String(err)),
        context: { ladder },
        recovered: false,
      });
      // Drop on error — operator can re-place manually if needed. Better
      // than retrying every 5 min and potentially double-placing.
      await removeLadder(ladder.id, "orchestration.entry-ladder.drop-after-error");
    }
  }

  if (result.placed > 0 || result.skippedDrift > 0 || result.errors > 0) {
    log.info("Entry-ladder processing complete", { result });
  }

  return result;
}

async function processOne(
  executor: OrderExecutor,
  ladder: PendingEntryLadder,
  prices: Record<string, number>,
  now: Date,
): Promise<"placed" | "drift" | "closed" | "no_price"> {
  const asset = ladder.asset.toUpperCase();
  const position = await positionByIdForCurrentMode(ladder.positionId);

  if (!position || position.status !== "open") {
    await appDecisionLogger({
      decisionType: "order_routing",
      inputs: { ladder, reason: "position_not_open" },
      outputs: {},
      reasoning: `Tranche 2 dropped: ${asset} position ${ladder.positionId} is no longer open.`,
      relatedEntity: ladder.positionId,
    });
    await removeLadder(ladder.id, "orchestration.entry-ladder.position-closed");
    return "closed";
  }

  const currentPrice = prices[asset];
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    // Don't drop — try again next tick when prices may be available.
    return "no_price";
  }

  if (hasDriftedTooFar(ladder.originalEntryPrice, currentPrice)) {
    await appDecisionLogger({
      decisionType: "order_routing",
      inputs: { ladder, currentPrice, drift: priceDrift(ladder.originalEntryPrice, currentPrice) },
      outputs: { placed: false },
      reasoning: `Tranche 2 dropped: ${asset} drifted from entry $${ladder.originalEntryPrice.toFixed(4)} to $${currentPrice.toFixed(4)} (>${(DRIFT_TOLERANCE * 100).toFixed(0)}%). Conditions changed; let the next brief re-decide.`,
      relatedEntity: ladder.positionId,
    });
    await removeLadder(ladder.id, "orchestration.entry-ladder.drift");
    return "drift";
  }

  // Compute tranche 2 qty at the CURRENT price, not the original.
  const tranche2Qty = ladder.trancheUsd / currentPrice;
  if (!Number.isFinite(tranche2Qty) || tranche2Qty <= 0) {
    await removeLadder(ladder.id, "orchestration.entry-ladder.zero-qty");
    return "drift";
  }

  // Place tranche 2
  const tranche2Order = await executor.placeLimitBuy(asset, currentPrice, tranche2Qty, {
    relatedPositionId: position.id,
  });

  // Cancel the old stop (covered tranche-1 qty only) and place a new stop
  // covering the combined position. Best-effort cancel — paper executor's
  // cancel is a no-op; live executor failures are logged but don't abort.
  if (position.stopOrderId) {
    try {
      await executor.cancelOrder(position.stopOrderId);
    } catch (err) {
      await errorLogger({
        severity: "warning",
        component: "orchestration.entry-ladder",
        error: err instanceof Error ? err : new Error(String(err)),
        context: { positionId: position.id, oldStopOrderId: position.stopOrderId },
        recovered: true,
        recoveryAction: "Continuing with combined-qty stop placement.",
      });
    }
  }

  const tranche1Qty = parseFloat(position.quantity);
  const combinedQty = tranche1Qty + tranche2Qty;
  const stopPrice = position.stopPrice ? parseFloat(position.stopPrice) : currentPrice * 0.88;
  const stopLimitPrice = stopPrice * STOP_LIMIT_OFFSET;
  const newStop = await executor.placeStopLimit(
    asset,
    stopPrice,
    stopLimitPrice,
    combinedQty,
    { relatedPositionId: position.id },
  );

  // Update position to reflect actual held quantity + new stop order id.
  await updatePosition(position.id, {
    quantity: combinedQty.toString(),
    stopOrderId: newStop.coinbaseOrderId,
  });

  await removeLadder(ladder.id, "orchestration.entry-ladder.placed");

  await appDecisionLogger({
    decisionType: "order_routing",
    inputs: {
      ladder,
      currentPrice,
      tranche1Qty,
      tranche2Qty,
      combinedQty,
    },
    outputs: {
      tranche2OrderId: tranche2Order.coinbaseOrderId,
      newStopOrderId: newStop.coinbaseOrderId,
      stopPrice,
    },
    reasoning: `Tranche 2 placed for ${asset}: $${ladder.trancheUsd.toFixed(2)} at $${currentPrice.toFixed(4)} (${tranche2Qty.toFixed(6)} units). Stop re-placed on combined ${combinedQty.toFixed(6)} units at $${stopPrice.toFixed(4)}. ${TRANCHE_DELAY_HOURS}h after tranche 1.`,
    relatedEntity: position.id,
  });

  log.info("Entry-ladder tranche 2 placed", {
    asset,
    positionId: position.id,
    tranche2Qty,
    combinedQty,
    currentPrice,
    elapsedHours: (now.getTime() - new Date(ladder.createdAt).getTime()) / 3600_000,
  });

  return "placed";
}

function priceDrift(original: number, current: number): number {
  if (original <= 0) return 0;
  return (current - original) / original;
}
