import { stateRead } from "@/lib/db/utils";
import { setCurrentMode } from "@/lib/mode";
import { closedPositionsForCurrentMode } from "@/lib/db/queries/positions";
import { mostRecentSnapshot } from "@/lib/db/queries/price_snapshots";
import { computeBenchmarkSummary } from "@/lib/orchestration/btc-benchmark";
import { safeDashboardHandler } from "@/lib/api/safe-handler";

export interface BenchmarkPanel {
  cumulativeDeltaPct: number | null;
  rolling30dDeltaPct: number | null;
  rolling60dDeltaPct: number | null;
  consecutiveUnderperfDays: number;
  /** True if the bot is on track for the Phase 1 advance criterion (≥3% over 60d). */
  passesPhase1Criterion: boolean | null;
}

export interface PerformancePayload {
  startingCapitalUsd: number | null;
  totalRealizedPnlUsd: number;
  totalFeesUsd: number;
  closedTradeCount: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  rMultipleDistribution: Array<{ bucket: string; count: number }>;
  feeDragPct: number | null;
  benchmark: BenchmarkPanel;
  closedTrades: Array<{
    id: string;
    asset: string;
    type: string;
    entryPrice: number;
    exitPrice: number | null;
    pnlPct: number | null;
    netPnlUsd: number | null;
    daysHeld: number | null;
    exitReason: string | null;
    exitTime: string | null;
  }>;
  dbReady: boolean;
}

const EMPTY_BENCHMARK: BenchmarkPanel = {
  cumulativeDeltaPct: null,
  rolling30dDeltaPct: null,
  rolling60dDeltaPct: null,
  consecutiveUnderperfDays: 0,
  passesPhase1Criterion: null,
};

/**
 * Buckets a list of R-multiples into a fixed histogram.
 * Buckets: <-3R, -3 to -2, -2 to -1, -1 to 0, 0 to 1, 1 to 2, 2 to 3, >3R.
 */
export function bucketRMultiples(rs: readonly number[]): Array<{ bucket: string; count: number }> {
  const labels = [
    "<-3R",
    "-3 to -2R",
    "-2 to -1R",
    "-1 to 0R",
    "0 to 1R",
    "1 to 2R",
    "2 to 3R",
    ">3R",
  ];
  const counts = labels.map(() => 0);
  for (const r of rs) {
    let i: number;
    if (r < -3) i = 0;
    else if (r < -2) i = 1;
    else if (r < -1) i = 2;
    else if (r < 0) i = 3;
    else if (r < 1) i = 4;
    else if (r < 2) i = 5;
    else if (r < 3) i = 6;
    else i = 7;
    counts[i]!++;
  }
  return labels.map((bucket, i) => ({ bucket, count: counts[i]! }));
}

export async function GET() {
  return safeDashboardHandler<PerformancePayload>(
    "api.dashboard.performance",
    {
      startingCapitalUsd: null,
      totalRealizedPnlUsd: 0,
      totalFeesUsd: 0,
      closedTradeCount: 0,
      winRate: null,
      avgWinPct: null,
      avgLossPct: null,
      rMultipleDistribution: [],
      feeDragPct: null,
      benchmark: EMPTY_BENCHMARK,
      closedTrades: [],
      dbReady: false,
    },
    async () => {
      const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
      setCurrentMode(paperMode ? "paper" : "live");
      const suffix = paperMode ? "paper" : "live";

      const [startingCapital, closed, latestSnap] = await Promise.all([
        stateRead<number>(`starting_capital_${suffix}_usd`),
        closedPositionsForCurrentMode(200),
        mostRecentSnapshot(),
      ]);

      const currentBtcPriceUsd =
        latestSnap?.btcPrice != null ? Number(latestSnap.btcPrice) : 0;
      const benchmarkSummary =
        Number.isFinite(currentBtcPriceUsd) && currentBtcPriceUsd > 0
          ? await computeBenchmarkSummary({
              now: new Date(),
              currentBtcPriceUsd,
            })
          : null;
      const benchmark: BenchmarkPanel = benchmarkSummary
        ? {
            cumulativeDeltaPct: benchmarkSummary.cumulativeDeltaPct,
            rolling30dDeltaPct: benchmarkSummary.rolling30dDeltaPct,
            rolling60dDeltaPct: benchmarkSummary.rolling60dDeltaPct,
            consecutiveUnderperfDays: benchmarkSummary.consecutiveUnderperfDays,
            passesPhase1Criterion:
              benchmarkSummary.rolling60dDeltaPct != null
                ? benchmarkSummary.rolling60dDeltaPct >= 3
                : null,
          }
        : EMPTY_BENCHMARK;

      let totalRealized = 0;
      let totalFees = 0;
      let wins = 0;
      let losses = 0;
      let sumWinPct = 0;
      let sumLossPct = 0;
      const rMultiples: number[] = [];

      for (const p of closed) {
        const pnl = p.netPnlUsd != null ? Number(p.netPnlUsd) : 0;
        const fees = p.feesUsd != null ? Number(p.feesUsd) : 0;
        totalRealized += pnl;
        totalFees += fees;
        const entry = Number(p.entryPrice);
        const exit = p.exitPrice != null ? Number(p.exitPrice) : null;
        if (exit != null && entry > 0) {
          const pct = ((exit - entry) / entry) * 100;
          if (pct >= 0) {
            wins++;
            sumWinPct += pct;
          } else {
            losses++;
            sumLossPct += pct;
          }
          // R-multiple: how many "R" units of risk did this trade earn,
          // where 1R = the distance from entry to the original stop.
          // Trades without a stop price at entry are skipped (no R denominator).
          const stop = p.stopPrice != null ? Number(p.stopPrice) : null;
          if (stop != null && stop > 0 && stop !== entry) {
            const r = (exit - entry) / Math.abs(entry - stop);
            if (Number.isFinite(r)) rMultiples.push(r);
          }
        }
      }
      const rMultipleDistribution = bucketRMultiples(rMultiples);

      const closedTrades = closed.slice(0, 50).map((p) => {
        const entry = Number(p.entryPrice);
        const exit = p.exitPrice != null ? Number(p.exitPrice) : null;
        const pnlPct = exit != null && entry > 0 ? ((exit - entry) / entry) * 100 : null;
        const daysHeld =
          p.entryTime && p.exitTime
            ? Math.round((p.exitTime.getTime() - p.entryTime.getTime()) / 86400_000)
            : null;
        return {
          id: p.id,
          asset: p.asset,
          type: p.type,
          entryPrice: entry,
          exitPrice: exit,
          pnlPct,
          netPnlUsd: p.netPnlUsd != null ? Number(p.netPnlUsd) : null,
          daysHeld,
          exitReason: p.exitReason,
          exitTime: p.exitTime?.toISOString() ?? null,
        };
      });

      const totalForRate = wins + losses;
      const winRate = totalForRate > 0 ? (wins / totalForRate) * 100 : null;
      const avgWinPct = wins > 0 ? sumWinPct / wins : null;
      const avgLossPct = losses > 0 ? sumLossPct / losses : null;
      const feeDragPct =
        Math.abs(totalRealized) > 0 ? (totalFees / Math.abs(totalRealized)) * 100 : null;

      return {
        startingCapitalUsd: startingCapital,
        totalRealizedPnlUsd: totalRealized,
        totalFeesUsd: totalFees,
        closedTradeCount: closed.length,
        winRate,
        avgWinPct,
        avgLossPct,
        rMultipleDistribution,
        feeDragPct,
        benchmark,
        closedTrades,
        dbReady: true,
      };
    },
  );
}
