import { stateRead } from "@/lib/db/utils";
import { setCurrentMode } from "@/lib/mode";
import { closedPositionsForCurrentMode } from "@/lib/db/queries/positions";
import { safeDashboardHandler } from "@/lib/api/safe-handler";

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
      closedTrades: [],
      dbReady: false,
    },
    async () => {
      const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
      setCurrentMode(paperMode ? "paper" : "live");
      const suffix = paperMode ? "paper" : "live";

      const [startingCapital, closed] = await Promise.all([
        stateRead<number>(`starting_capital_${suffix}_usd`),
        closedPositionsForCurrentMode(200),
      ]);

      let totalRealized = 0;
      let totalFees = 0;
      let wins = 0;
      let losses = 0;
      let sumWinPct = 0;
      let sumLossPct = 0;

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
        }
      }

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
        rMultipleDistribution: [], // computed in a follow-up; needs entry stop data
        feeDragPct,
        closedTrades,
        dbReady: true,
      };
    },
  );
}
