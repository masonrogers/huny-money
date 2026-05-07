import { stateRead } from "@/lib/db/utils";
import { monthKey, monthlySpendUsd } from "@/lib/db/queries/api_spend";
import { openPositionsAllModes } from "@/lib/db/queries/positions";
import { recentEvaluations } from "@/lib/db/queries/evaluations";
import { recentWakeups } from "@/lib/db/queries/wakeups";
import { recentErrors } from "@/lib/db/queries/errors";
import { mostRecentSnapshot } from "@/lib/db/queries/price_snapshots";
import { MONTHLY_BUDGET_USD } from "@/lib/anthropic";
import { safeDashboardHandler } from "@/lib/api/safe-handler";

export interface OverviewPayload {
  mode: "paper" | "live";
  totalValueUsd: number | null;
  startingCapitalUsd: number | null;
  cashUsd: number | null;
  systemReturnPct: number | null;
  btcOutperformancePct: number | null;
  drawdownFromPeakPct: number | null;
  apiSpend: {
    mtd: number;
    cap: number;
    pctOfCap: number;
  };
  openPositionsCount: number;
  recentActivity: Array<{
    timestamp: string;
    type: "eval" | "wakeup" | "error";
    label: string;
    sublabel?: string;
  }>;
  dbReady: boolean;
}

export async function GET() {
  return safeDashboardHandler<OverviewPayload>(
    "api.dashboard.overview",
    {
      mode: "paper",
      totalValueUsd: null,
      startingCapitalUsd: null,
      cashUsd: null,
      systemReturnPct: null,
      btcOutperformancePct: null,
      drawdownFromPeakPct: null,
      apiSpend: { mtd: 0, cap: MONTHLY_BUDGET_USD, pctOfCap: 0 },
      openPositionsCount: 0,
      recentActivity: [],
      dbReady: false,
    },
    async () => {
      const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
      const mode: "paper" | "live" = paperMode ? "paper" : "live";
      const suffix = mode === "paper" ? "paper" : "live";

      const [
        startingCapital,
        peakValueUsd,
        lastEquity,
        lastCash,
        btcAtStart,
        mtd,
        allOpen,
        evals,
        wakeups,
        errors,
        latestSnap,
      ] = await Promise.all([
        stateRead<number>(`starting_capital_${suffix}_usd`),
        stateRead<number>(`peak_value_${suffix}_usd`),
        stateRead<number>(`last_equity_${suffix}_usd`),
        stateRead<number>(`last_cash_${suffix}_usd`),
        stateRead<number>(`btc_price_at_start_${suffix}`),
        monthlySpendUsd(monthKey()),
        openPositionsAllModes(),
        recentEvaluations(10),
        recentWakeups(10),
        recentErrors(10),
        mostRecentSnapshot(),
      ]);

      const openInMode = allOpen.filter((p) => p.paperMode === paperMode);
      // Prefer the equity snapshotter's mark-to-market value; fall back to
      // starting capital pre-first-tick.
      const totalValueUsd =
        lastEquity != null
          ? lastEquity
          : startingCapital != null
            ? startingCapital
            : null;
      const cashUsd = lastCash != null ? lastCash : startingCapital;

      const systemReturnPct =
        startingCapital != null && totalValueUsd != null && startingCapital > 0
          ? ((totalValueUsd - startingCapital) / startingCapital) * 100
          : null;

      // BTC outperformance: how much the bot's equity grew vs. holding the
      // entire starting capital in BTC over the same window. Positive ≡ ahead
      // of buy-and-hold; this is the benchmark the bot exists to beat.
      const currentBtc = latestSnap?.btcPrice != null ? Number(latestSnap.btcPrice) : null;
      const btcReturnPct =
        btcAtStart != null && currentBtc != null && btcAtStart > 0
          ? ((currentBtc - btcAtStart) / btcAtStart) * 100
          : null;
      const btcOutperformancePct =
        systemReturnPct != null && btcReturnPct != null
          ? systemReturnPct - btcReturnPct
          : null;

      const drawdownFromPeakPct =
        peakValueUsd != null && totalValueUsd != null && peakValueUsd > 0
          ? Math.max(0, ((peakValueUsd - totalValueUsd) / peakValueUsd) * 100)
          : null;

      // Merge recent eval/wakeup/error into a single chronological list.
      const recentActivity = [
        ...evals.map((e) => ({
          timestamp: e.timestamp.toISOString(),
          type: "eval" as const,
          label: `${e.callType.replace(/_/g, " ")} (${e.model.startsWith("claude-opus") ? "Opus" : "Sonnet"})`,
          sublabel: e.suppressed ? `suppressed: ${e.suppressionReason ?? "—"}` : undefined,
        })),
        ...wakeups.map((w) => ({
          timestamp: w.timestamp.toISOString(),
          type: "wakeup" as const,
          label: `wake-up: ${w.triggerType}${w.asset ? ` (${w.asset})` : ""}`,
          sublabel: w.dispatched ? "dispatched" : `suppressed: ${w.suppressionReason ?? "—"}`,
        })),
        ...errors.map((er) => ({
          timestamp: er.timestamp.toISOString(),
          type: "error" as const,
          label: `${er.severity}: ${er.errorClass}`,
          sublabel: er.message.slice(0, 100),
        })),
      ]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 12);

      return {
        mode,
        totalValueUsd,
        startingCapitalUsd: startingCapital,
        cashUsd,
        systemReturnPct,
        btcOutperformancePct,
        drawdownFromPeakPct,
        apiSpend: {
          mtd,
          cap: MONTHLY_BUDGET_USD,
          pctOfCap: (mtd / MONTHLY_BUDGET_USD) * 100,
        },
        openPositionsCount: openInMode.length,
        recentActivity,
        dbReady: true,
      };
    },
  );
}
