"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { useApi } from "@/lib/hooks/api";
import { formatUsd, formatPct, formatRelativeTime } from "@/lib/utils/format";
import { Activity, ArrowDownUp, Bot, Layers, TrendingUp, Wallet } from "lucide-react";
import type { OverviewPayload } from "@/app/api/dashboard/overview/route";

export default function OverviewPage() {
  const { data, isLoading } = useApi<OverviewPayload>("/api/dashboard/overview", {
    refreshInterval: 30_000,
  });

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Overview"
        description="At-a-glance view of the bot's state, equity, and what just happened."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total value"
          value={formatUsd(data?.totalValueUsd ?? null)}
          delta={data ? formatPct(data.systemReturnPct, true) : "—"}
          deltaTone={metricTone(data?.systemReturnPct)}
        />
        <MetricCard
          label="vs BTC hold"
          value={data ? formatPct(data.btcOutperformancePct, true) : "—"}
          delta={
            data?.btcOutperformancePct == null
              ? "awaiting equity snapshots"
              : data.btcOutperformancePct >= 0
                ? "beating benchmark"
                : "underperforming"
          }
          deltaTone={metricTone(data?.btcOutperformancePct)}
        />
        <MetricCard
          label="Cash (USDC)"
          value={formatUsd(data?.cashUsd ?? null)}
          delta={
            data?.cashUsd != null && data.totalValueUsd && data.totalValueUsd > 0
              ? `${((data.cashUsd / data.totalValueUsd) * 100).toFixed(0)}% of capital`
              : "—"
          }
          deltaTone="muted"
        />
        <MetricCard
          label="MTD API spend"
          value={data ? formatUsd(data.apiSpend.mtd) : "—"}
          delta={data ? `of ${formatUsd(data.apiSpend.cap)} cap` : "—"}
          deltaTone={data && data.apiSpend.pctOfCap > 80 ? "danger" : "muted"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equity curve · 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<TrendingUp />}
            title="No equity history yet"
            description="The equity curve appears once the price-poll loop has been writing equity snapshots for at least 24 hours. The full view (Performance) will overlay a BTC buy-and-hold benchmark."
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Open positions</CardTitle>
          </CardHeader>
          <CardContent>
            {!data || isLoading ? (
              <EmptyState title="Loading…" description="Reading positions from the database." />
            ) : data.openPositionsCount === 0 ? (
              <EmptyState
                icon={<Wallet />}
                title="No positions open"
                description="The bot is sitting in cash. Positions appear here when the AI identifies an alt cycle entry candidate that meets all 7 entry criteria, or when the regime upgrades to bull and BTC core DCA begins."
              />
            ) : (
              <div className="text-sm text-[var(--color-text-secondary)]">
                {data.openPositionsCount} open position{data.openPositionsCount > 1 ? "s" : ""}. Full detail on the{" "}
                <a href="/positions" className="text-[var(--color-accent)] underline">
                  Positions
                </a>{" "}
                page.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {!data || data.recentActivity.length === 0 ? (
              <EmptyState
                icon={<Activity />}
                title="No activity to show"
                description="Morning briefs, Sonnet checkpoints, wake-up triggers, trades opened/closed, and errors appear here in chronological order."
              />
            ) : (
              <ul className="space-y-2.5">
                {data.recentActivity.map((a, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <ActivityIcon type={a.type} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--color-text-primary)] truncate">{a.label}</div>
                      {a.sublabel && (
                        <div className="text-xs text-[var(--color-text-muted)] truncate">
                          {a.sublabel}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-[var(--color-text-faint)] tnum shrink-0">
                      {formatRelativeTime(a.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  deltaTone,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone: "success" | "danger" | "muted";
}) {
  const deltaColor =
    deltaTone === "success"
      ? "text-[var(--color-success)]"
      : deltaTone === "danger"
        ? "text-[var(--color-danger)]"
        : "text-[var(--color-text-muted)]";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          {label}
        </div>
        <div className="mt-2 text-2xl font-semibold tnum">{value}</div>
        <div className={`mt-1.5 text-xs tnum ${deltaColor}`}>{delta}</div>
      </CardContent>
    </Card>
  );
}

function metricTone(n: number | null | undefined): "success" | "danger" | "muted" {
  if (n == null || n === 0) return "muted";
  return n > 0 ? "success" : "danger";
}

function ActivityIcon({ type }: { type: "eval" | "wakeup" | "error" }) {
  if (type === "eval") return <Bot className="size-4 mt-0.5 text-[var(--color-accent)] shrink-0" />;
  if (type === "wakeup") return <ArrowDownUp className="size-4 mt-0.5 text-[var(--color-warning)] shrink-0" />;
  return <Layers className="size-4 mt-0.5 text-[var(--color-danger)] shrink-0" />;
}
