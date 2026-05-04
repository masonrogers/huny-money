import { getCandles } from "@/lib/coinbase";
import { closesFromCandles } from "@/lib/candles/compress";
import { computeCycleRange, persistCycleRange } from "@/lib/cycle/range";
import { getTicker } from "@/lib/coinbase";
import { CYCLE_WATCHLIST, productIdFor, CYCLE_RANGE_LOOKBACK_DAYS } from "@/lib/strategy/constants";
import { errorLogger } from "@/lib/db/utils";
import { log } from "@/lib/logger";

/**
 * Nightly cycle range recomputation per STRATEGY.md §3.8.
 *
 * For each watchlist asset:
 * - Fetch 180 days of daily candles
 * - Compute cycle_low_zone_top + cycle_high_zone_bottom
 * - Persist to `state` (3 keys per asset)
 *
 * Runs at 00:00 UTC. Phase 5 scheduler dispatches it.
 */

export interface CycleRangeJobResult {
  success: number;
  failed: number;
  errors: Array<{ asset: string; message: string }>;
}

export async function runCycleRangeJob(now: Date = new Date()): Promise<CycleRangeJobResult> {
  const result: CycleRangeJobResult = { success: 0, failed: 0, errors: [] };
  const startMs = Date.now();

  for (const asset of CYCLE_WATCHLIST) {
    try {
      const productId = productIdFor(asset);
      const endSec = Math.floor(now.getTime() / 1000);
      const startSec = endSec - CYCLE_RANGE_LOOKBACK_DAYS * 24 * 3600;

      const candles = await getCandles(productId, "ONE_DAY", startSec, endSec);
      if (candles.length === 0) {
        result.failed++;
        result.errors.push({ asset, message: "no candles returned" });
        continue;
      }

      const closesAsc = closesFromCandles(candles, "newest_first");
      const ticker = await getTicker(productId);

      const range = computeCycleRange({
        asset,
        dailyCloses: closesAsc,
        currentPrice: ticker.midPrice,
      });

      await persistCycleRange(range, "scheduler.cycle-range-job");
      result.success++;

      log.info("Cycle range computed", {
        asset,
        currentPositionPct: range.currentCyclePositionPct.toFixed(1),
        lowZoneTop: range.cycleLowZoneTop.toFixed(4),
        highZoneBottom: range.cycleHighZoneBottom.toFixed(4),
      });
    } catch (err) {
      result.failed++;
      const msg = (err as Error).message;
      result.errors.push({ asset, message: msg });
      await errorLogger({
        severity: "warning",
        component: "scheduler.cycle-range-job",
        error: err instanceof Error ? err : new Error(String(err)),
        context: { asset },
        recovered: true,
        recoveryAction: `Cycle range for ${asset} not refreshed; will retry next nightly run`,
      });
    }
  }

  log.info("Cycle range job complete", {
    success: result.success,
    failed: result.failed,
    durationMs: Date.now() - startMs,
  });

  return result;
}
