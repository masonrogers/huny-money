"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { useApi } from "@/lib/hooks/api";
import { formatUsd, formatPct } from "@/lib/utils/format";
import { LineChart } from "lucide-react";
import type { PerformancePayload } from "@/app/api/dashboard/performance/route";

export default function PerformancePage() {
  const { data, isLoading } = useApi<PerformancePayload>("/api/dashboard/performance", {
    refreshInterval: 60_000,
  });

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
        <CardHeader>
          <CardTitle>Equity curve vs. BTC hold</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<LineChart />}
            title="No equity history yet"
            description="Once the price-poll loop starts writing equity snapshots, this view becomes the headline of the dashboard. The chart will overlay BTC buy-and-hold from the bot's start, and the 'Beating BTC over 30d / 60d / all-time' headline metric will appear with a pass/fail badge."
          />
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
