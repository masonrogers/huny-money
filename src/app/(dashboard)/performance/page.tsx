"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { EquityChart, EquityChartLegend } from "@/components/charts/equity-chart";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/lib/hooks/api";
import { formatUsd, formatPct } from "@/lib/utils/format";
import { LineChart } from "lucide-react";
import type { PerformancePayload } from "@/app/api/dashboard/performance/route";
import type { EquityCurvePayload } from "@/app/api/dashboard/equity-curve/route";

export default function PerformancePage() {
  const { data, isLoading } = useApi<PerformancePayload>("/api/dashboard/performance", {
    refreshInterval: 60_000,
  });
  const { data: curve } = useApi<EquityCurvePayload>("/api/dashboard/equity-curve?days=60", {
    refreshInterval: 60_000,
  });
  const headline = computeHeadlineOutperformance(curve);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Performance"
        description="The honest comparison vs. BTC buy-and-hold. The bot exists to beat this benchmark."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Realized P&L" value={formatUsd(data?.totalRealizedPnlUsd ?? 0)} />
        <StatCard label="Closed trades" value={String(data?.closedTradeCount ?? 0)} />
        <StatCard
          label="Win rate"
          value={data?.winRate != null ? formatPct(data.winRate) : "—"}
        />
        <StatCard
          label="Total fees"
          value={formatUsd(data?.totalFeesUsd ?? 0)}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Equity curve vs. BTC hold</CardTitle>
          {headline && (
            <Badge variant={headline.beating ? "success" : "warning"}>
              {headline.beating ? "Beating BTC" : "Trailing BTC"} · {formatPct(headline.deltaPct, true)} ({headline.windowLabel})
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {!curve || curve.points.length === 0 ? (
            <EmptyState
              icon={<LineChart />}
              title="No equity history yet"
              description="The first equity snapshot is captured at the next 5-minute wake-up tick. The dashed line overlays the same dollars held in BTC since the bot's start; the bot's job is to stay above it."
            />
          ) : (
            <div className="space-y-3">
              <EquityChart
                points={curve.points}
                startingCapital={curve.startingCapitalUsd}
                height={320}
              />
              <EquityChartLegend
                trend={trendOf(curve.points.map((p) => p.equity))}
                startingCapital={curve.startingCapitalUsd}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Closed trade detail</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || isLoading ? (
            <EmptyState title="Loading…" description="" />
          ) : data.closedTrades.length === 0 ? (
            <EmptyState
              title="No closed trades yet"
              description="The Performance view becomes meaningful once the bot has at least 5-10 closed trades to compute meaningful win rate and R-multiple distributions."
            />
          ) : (
            <ClosedTradeTable trades={data.closedTrades} />
          )}
        </CardContent>
      </Card>

      {data && data.closedTrades.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="Avg win"
            value={data.avgWinPct != null ? formatPct(data.avgWinPct, true) : "—"}
            tone="success"
          />
          <StatCard
            label="Avg loss"
            value={data.avgLossPct != null ? formatPct(data.avgLossPct) : "—"}
            tone="danger"
          />
          <StatCard
            label="Fee drag (% of |P&L|)"
            value={data.feeDragPct != null ? formatPct(data.feeDragPct) : "—"}
            tone={data.feeDragPct != null && data.feeDragPct > 30 ? "danger" : "muted"}
          />
        </div>
      )}

      {data && data.rMultipleDistribution.some((b) => b.count > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>R-multiple distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <RMultipleHistogram buckets={data.rMultipleDistribution} />
            <p className="mt-3 text-xs text-[var(--color-text-faint)]">
              R = (exit − entry) / |entry − stop|. Trades that closed without an entry-time stop
              are excluded. A healthy edge shows a positive average and a long right tail —
              big winners pay for many small losers.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RMultipleHistogram({
  buckets,
}: {
  buckets: PerformancePayload["rMultipleDistribution"];
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="grid grid-cols-8 gap-2 items-end h-32">
      {buckets.map((b) => {
        const heightPct = (b.count / max) * 100;
        const isLoss = b.bucket.startsWith("<") || b.bucket.startsWith("-");
        return (
          <div key={b.bucket} className="flex flex-col items-center gap-1.5 h-full">
            <div className="flex-1 w-full flex flex-col justify-end">
              <div
                className="w-full rounded-t-sm tnum text-[10px] text-[var(--color-text-muted)] flex items-start justify-center pt-0.5 transition-all"
                style={{
                  height: `${heightPct}%`,
                  background: isLoss ? "var(--color-danger)" : "var(--color-success)",
                  opacity: b.count === 0 ? 0.15 : 0.85,
                  minHeight: b.count > 0 ? 8 : 2,
                  color: b.count > 0 ? "white" : undefined,
                }}
              >
                {b.count > 0 ? b.count : ""}
              </div>
            </div>
            <div className="text-[10px] text-[var(--color-text-faint)] tnum text-center leading-tight">
              {b.bucket}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "success" | "danger" | "muted";
}) {
  const colorClass =
    tone === "success"
      ? "text-[var(--color-success)]"
      : tone === "danger"
        ? "text-[var(--color-danger)]"
        : "text-[var(--color-text-primary)]";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          {label}
        </div>
        <div className={`mt-2 text-2xl font-semibold tnum ${colorClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function trendOf(values: number[]): "up" | "down" | "flat" {
  if (values.length < 2) return "flat";
  const first = values[0]!;
  const last = values[values.length - 1]!;
  if (last > first) return "up";
  if (last < first) return "down";
  return "flat";
}

function computeHeadlineOutperformance(
  curve: EquityCurvePayload | undefined,
): { beating: boolean; deltaPct: number; windowLabel: string } | null {
  if (!curve || curve.points.length < 2) return null;
  const first = curve.points[0]!;
  const last = curve.points[curve.points.length - 1]!;
  if (first.btcEquivalent == null || last.btcEquivalent == null) return null;
  if (first.equity <= 0 || first.btcEquivalent <= 0) return null;
  const equityRet = ((last.equity - first.equity) / first.equity) * 100;
  const btcRet = ((last.btcEquivalent - first.btcEquivalent) / first.btcEquivalent) * 100;
  const delta = equityRet - btcRet;
  // Label by the visible window, not the requested days — bot may be younger
  // than the request window, in which case "60d" would be a lie.
  const ms = new Date(last.ts).getTime() - new Date(first.ts).getTime();
  const days = ms / 86_400_000;
  const windowLabel =
    days < 1
      ? `${Math.max(1, Math.round(ms / 3_600_000))}h`
      : days < 7
        ? `${Math.round(days)}d`
        : `${Math.round(days)}d`;
  return { beating: delta >= 0, deltaPct: delta, windowLabel };
}

function ClosedTradeTable({ trades }: { trades: PerformancePayload["closedTrades"] }) {
  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
            <th className="text-left font-medium px-2 py-2">Asset</th>
            <th className="text-left font-medium px-2 py-2">Type</th>
            <th className="text-right font-medium px-2 py-2">Entry</th>
            <th className="text-right font-medium px-2 py-2">Exit</th>
            <th className="text-right font-medium px-2 py-2">P&amp;L</th>
            <th className="text-right font-medium px-2 py-2">Days</th>
            <th className="text-left font-medium px-2 py-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-t border-[var(--color-border)]">
              <td className="px-2 py-2 font-medium">{t.asset}</td>
              <td className="px-2 py-2 text-xs text-[var(--color-text-muted)]">{t.type}</td>
              <td className="px-2 py-2 text-right tnum">{formatUsd(t.entryPrice)}</td>
              <td className="px-2 py-2 text-right tnum">{formatUsd(t.exitPrice)}</td>
              <td
                className={`px-2 py-2 text-right tnum ${
                  t.netPnlUsd == null
                    ? "text-[var(--color-text-muted)]"
                    : t.netPnlUsd >= 0
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-danger)]"
                }`}
              >
                {formatUsd(t.netPnlUsd)}
                {t.pnlPct != null && (
                  <span className="block text-[0.65rem]">{formatPct(t.pnlPct, true)}</span>
                )}
              </td>
              <td className="px-2 py-2 text-right tnum text-[var(--color-text-muted)]">
                {t.daysHeld ?? "—"}
              </td>
              <td className="px-2 py-2 text-xs text-[var(--color-text-muted)]">
                {t.exitReason ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
