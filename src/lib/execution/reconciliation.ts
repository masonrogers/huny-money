import { stateRead, stateWriter, errorLogger } from "@/lib/db/utils";
import {
  openPositionsAllModes,
  openPositionsForCurrentMode,
} from "@/lib/db/queries/positions";
import {
  pendingOrdersForCurrentMode,
  updateOrder,
} from "@/lib/db/queries/orders";
import { getCurrentMode, type Mode } from "@/lib/mode";
import { log } from "@/lib/logger";
import type { OrderExecutor } from "./interface";

/**
 * Boot reconciliation per STRATEGY.md §6.1 + §13.7 (mode-aware).
 *
 * Runs on every app start. The order matters:
 *
 * 1. **Cross-mode boot rejection** — refuse to start if there are open
 *    positions in the OTHER mode (prevents acting on stale paper state in
 *    live mode and vice versa). This is the highest-priority safety check.
 *
 * 2. **Order status sync** (live mode only): query Coinbase for each pending
 *    order; update DB rows for fills/cancels that happened while we were
 *    down. Paper mode: skip — there's nothing on Coinbase to reconcile.
 *
 * 3. **Position safety check**: every open position must have an active
 *    stop-limit. If missing, place one immediately at the position's
 *    current `stop_price`. Per STRATEGY.md §3.7, this is the highest-
 *    priority action in the entire boot sequence (an unprotected position
 *    is the most dangerous state).
 *
 * 4. **Missed evaluation detection**: read `state.next_eval_at`; if past,
 *    flag for one (and only one) catch-up evaluation after reconciliation
 *    completes.
 *
 * 5. **5%+ price move detection**: compare current prices vs.
 *    `state.last_*_price_at_eval`; flag for emergency evaluation if a
 *    threshold breach occurred during downtime.
 *
 * NOTE: This module's responsibilities are checks + safety actions. The
 * actual rerun of missed evaluations is dispatched by the caller (the
 * boot flow) after reconciliation returns its findings.
 */

export interface ReconciliationFindings {
  mode: Mode;
  downtimeSeconds: number | null;
  /** Any open positions found in the OTHER mode → boot REFUSED. */
  crossModeOpenPositions: number;
  ordersChecked: number;
  ordersUpdated: number;
  positionsScanned: number;
  positionsMissingStopFixed: number;
  missedEvaluation: boolean;
  emergencyTriggers: Array<{ asset: string; lastPrice: number; currentPrice: number; deltaPct: number }>;
  errors: string[];
}

export interface ReconciliationDeps {
  executor: OrderExecutor;
  /** Returns current price for each tradeable asset, used by the 5%+ detector. */
  fetchCurrentPrices: () => Promise<Record<string, number>>;
}

export class CrossModeBootRejection extends Error {
  constructor(
    public foundPaperOpen: number,
    public foundLiveOpen: number,
    public bootMode: Mode,
  ) {
    super(
      `BOOT REJECTED: booting in ${bootMode} mode but found ${
        bootMode === "paper" ? foundLiveOpen : foundPaperOpen
      } open position(s) in the OTHER mode. Close those positions or boot in the matching mode first.`,
    );
    this.name = "CrossModeBootRejection";
  }
}

export async function runBootReconciliation(
  deps: ReconciliationDeps,
): Promise<ReconciliationFindings> {
  const mode = getCurrentMode();
  const findings: ReconciliationFindings = {
    mode,
    downtimeSeconds: null,
    crossModeOpenPositions: 0,
    ordersChecked: 0,
    ordersUpdated: 0,
    positionsScanned: 0,
    positionsMissingStopFixed: 0,
    missedEvaluation: false,
    emergencyTriggers: [],
    errors: [],
  };

  // Downtime
  const lastBootAt = await stateRead<string>("last_boot_at");
  if (lastBootAt) {
    findings.downtimeSeconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(lastBootAt).getTime()) / 1000),
    );
  }

  // ── 1. Cross-mode boot rejection ──────────────────────────────────────
  const allOpen = await openPositionsAllModes();
  const paperOpen = allOpen.filter((p) => p.paperMode).length;
  const liveOpen = allOpen.filter((p) => !p.paperMode).length;
  const otherCount = mode === "paper" ? liveOpen : paperOpen;
  if (otherCount > 0) {
    findings.crossModeOpenPositions = otherCount;
    throw new CrossModeBootRejection(paperOpen, liveOpen, mode);
  }

  // ── 2. Order status sync (live mode only) ────────────────────────────
  const pending = await pendingOrdersForCurrentMode();
  findings.ordersChecked = pending.length;

  if (mode === "live") {
    for (const o of pending) {
      try {
        const status = await deps.executor.getOrderStatus(o.coinbaseOrderId);
        if (status.status !== "pending") {
          await updateOrder(o.id, {
            status: status.status,
            fillPrice: status.fillPrice != null ? status.fillPrice.toString() : null,
            fillQuantity: status.fillQuantity != null ? status.fillQuantity.toString() : null,
            filledAt: status.filledAt ?? null,
            cancelReason:
              status.status === "cancelled" ? "reconciliation.sync" : null,
          });
          findings.ordersUpdated++;
          log.info("Reconciliation: order status updated", {
            coinbaseOrderId: o.coinbaseOrderId,
            from: o.status,
            to: status.status,
            fillPrice: status.fillPrice,
          });
        }
      } catch (err) {
        findings.errors.push(`order ${o.coinbaseOrderId}: ${(err as Error).message}`);
      }
    }
  }

  // ── 3. Position safety check ─────────────────────────────────────────
  const openHere = await openPositionsForCurrentMode();
  findings.positionsScanned = openHere.length;
  for (const pos of openHere) {
    if (pos.type === "btc_core") continue; // BTC core has no stop per §3.7
    if (pos.stopOrderId) continue; // already has a stop tracked
    if (!pos.stopPrice) continue; // no stop level defined yet (planned state)

    try {
      // PLACE THE STOP IMMEDIATELY — highest-priority action.
      const stopPrice = parseFloat(pos.stopPrice);
      // Limit price 0.5% below stop trigger to ensure fill in fast markets.
      const limitPrice = stopPrice * 0.995;
      await deps.executor.placeStopLimit(
        pos.asset,
        stopPrice,
        limitPrice,
        parseFloat(pos.quantity),
        { relatedPositionId: pos.id },
      );
      findings.positionsMissingStopFixed++;
      log.warn("Reconciliation placed missing stop for open alt position", {
        positionId: pos.id,
        asset: pos.asset,
        stopPrice,
      });
    } catch (err) {
      const msg = `Failed to place missing stop for position ${pos.id}: ${(err as Error).message}`;
      findings.errors.push(msg);
      await errorLogger({
        severity: "critical",
        component: "execution.reconciliation",
        error: err instanceof Error ? err : new Error(String(err)),
        context: { positionId: pos.id, asset: pos.asset, stopPrice: pos.stopPrice },
        recovered: false,
        recoveryAction: "Position remains unprotected — operator must intervene immediately.",
      });
    }
  }

  // ── 4. Missed evaluation ─────────────────────────────────────────────
  const nextEvalAt = await stateRead<string>("next_eval_at");
  if (nextEvalAt) {
    const due = new Date(nextEvalAt).getTime();
    if (due < Date.now()) {
      findings.missedEvaluation = true;
    }
  }

  // ── 5. Emergency price-move detection ────────────────────────────────
  try {
    const currentPrices = await deps.fetchCurrentPrices();
    for (const [asset, current] of Object.entries(currentPrices)) {
      const lastKey = `last_${asset.toLowerCase()}_price_at_eval`;
      const last = await stateRead<number>(lastKey);
      if (last == null || last <= 0) continue;
      const deltaPct = ((current - last) / last) * 100;
      if (Math.abs(deltaPct) >= 5) {
        findings.emergencyTriggers.push({
          asset,
          lastPrice: last,
          currentPrice: current,
          deltaPct,
        });
      }
    }
  } catch (err) {
    findings.errors.push(`price-move detector: ${(err as Error).message}`);
  }

  // Update last_boot_at
  await stateWriter({
    key: "last_boot_at",
    value: new Date().toISOString(),
    changedBy: "execution.reconciliation",
  });

  log.info("Boot reconciliation complete", { findings });

  return findings;
}
