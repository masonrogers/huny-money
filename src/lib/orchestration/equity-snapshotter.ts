import { stateRead, stateWriter } from "@/lib/db/utils";
import { openPositionsForCurrentMode } from "@/lib/db/queries/positions";
import { filledSellQtyByPositionForCurrentMode } from "@/lib/db/queries/orders";
import { getExecutor } from "@/lib/execution";
import { setCurrentMode } from "@/lib/mode";
import { log } from "@/lib/logger";

/**
 * Equity snapshot writer.
 *
 * Called from the wake-up cycle (every 5 minutes) after price fetching and
 * fill processing. Computes cash + open-position mark-to-market, persists to
 * `state` via stateWriter so the time series falls out of system_state_history.
 *
 * Why state+history instead of a new table: schema additions on the live
 * DigitalOcean cluster carry migration risk (the migrate-v1-to-v3 script
 * can drop the public schema if it sees the wrong shape). state /
 * system_state_history are already audited, append-only, and indexed on
 * (key, changed_at) — exactly what the equity curve needs.
 *
 * Mode-split via the suffix: keys are `last_equity_paper_usd`,
 * `last_cash_paper_usd`, `last_positions_value_paper_usd` (and `_live` peers).
 * Cross-mode queries never mix.
 */

export interface EquitySnapshot {
  mode: "paper" | "live";
  cashUsd: number;
  positionsValueUsd: number;
  equityUsd: number;
  prices: Record<string, number>;
}

/** Compute and persist the current equity. Safe to call at any time. */
export async function persistEquitySnapshot(
  prices: Record<string, number>,
): Promise<EquitySnapshot | null> {
  try {
    const executor = getExecutor();
    const mode = executor.mode;
    const suffix = mode === "paper" ? "paper" : "live";

    // The mode-aware DB helpers below read the mode singleton, not the
    // executor. Aligning the singleton to the executor here makes the
    // snapshotter safe to call from any context (not only the wake-up
    // cycle, which already calls setCurrentMode at its top).
    setCurrentMode(mode);

    const cashUsd = await executor.getCashBalanceUsd();

    const [openPositions, soldByPosition] = await Promise.all([
      openPositionsForCurrentMode(),
      filledSellQtyByPositionForCurrentMode(),
    ]);

    let positionsValueUsd = 0;
    for (const p of openPositions) {
      const totalQty = Number(p.quantity);
      const sold = soldByPosition.get(p.id) ?? 0;
      const remainingQty = totalQty - sold;
      // Skip positions that have already been fully sold but not yet
      // reconciled-closed: counting them at price would double-count cash.
      if (!Number.isFinite(remainingQty) || remainingQty <= 0) continue;

      const price = prices[p.asset.toUpperCase()];
      // Strict price requirement: a held position with no/zero/non-finite
      // price would silently mark-to-zero, publishing wrong equity. Better
      // to skip the snapshot entirely than write a bad number.
      if (price == null || !Number.isFinite(price) || price <= 0) {
        log.warn("Equity snapshot skipped: missing price for held position", {
          asset: p.asset,
          positionId: p.id,
        });
        return null;
      }
      positionsValueUsd += remainingQty * price;
    }

    const equityUsd = cashUsd + positionsValueUsd;

    await stateWriter({
      key: `last_equity_${suffix}_usd`,
      value: equityUsd,
      changedBy: "equity-snapshotter",
    });
    await stateWriter({
      key: `last_cash_${suffix}_usd`,
      value: cashUsd,
      changedBy: "equity-snapshotter",
    });
    await stateWriter({
      key: `last_positions_value_${suffix}_usd`,
      value: positionsValueUsd,
      changedBy: "equity-snapshotter",
    });

    const peak = (await stateRead<number>(`peak_value_${suffix}_usd`)) ?? 0;
    if (equityUsd > peak) {
      await stateWriter({
        key: `peak_value_${suffix}_usd`,
        value: equityUsd,
        changedBy: "equity-snapshotter",
      });
    }

    return { mode, cashUsd, positionsValueUsd, equityUsd, prices };
  } catch (err) {
    // Equity snapshotting is best-effort: a failure should not abort the
    // wake-up cycle, which has fill processing to do regardless.
    log.warn("Equity snapshot failed", { error: (err as Error).message });
    return null;
  }
}
