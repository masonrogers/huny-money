"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { EquityChart, EquityChartLegend } from "@/components/charts/equity-chart";
import { useApi } from "@/lib/hooks/api";
import { formatUsd, formatPct, formatRelativeTime } from "@/lib/utils/format";
import { Activity, ArrowDownUp, Bot, Layers, TrendingUp, Wallet } from "lucide-react";
import type { OverviewPayload } from "@/app/api/dashboard/overview/route";
import type { EquityCurvePayload } from "@/app/api/dashboard/equity-curve/route";
import type { WalletPayload } from "@/app/api/dashboard/wallet/route";

export default function OverviewPage() {
  const { data, isLoading } = useApi<OverviewPayload>("/api/dashboard/overview", {
    refreshInterval: 30_000,
  });
  const { data: curve } = useApi<EquityCurvePayload>("/api/dashboard/equity-curve?days=30", {
    refreshInterval: 60_000,
  });
  const { data: wallet } = useApi<WalletPayload>("/api/dashboard/wallet", {
    refreshInterval: 60_000,
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

      <CoinbaseWalletCard wallet={wallet} />

      <Card>
        <CardHeader>
          <CardTitle>Equity curve · 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          {!curve || curve.points.length === 0 ? (
            <EmptyState
              icon={<TrendingUp />}
              title="No equity history yet"
              description="The first equity snapshot is captured at the next 5-minute wake-up tick. The curve overlays the same dollars held in BTC for an honest comparison."
            />
          ) : (
            <div className="space-y-3">
              <EquityChart
                points={curve.points}
                startingCapital={curve.startingCapitalUsd}
                height={240}
              />
              <EquityChartLegend
                trend={trendOf(curve.points.map((p) => p.equity))}
                startingCapital={curve.startingCapitalUsd}
              />
            </div>
          )}
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

function CoinbaseWalletCard({ wallet }: { wallet: WalletPayload | undefined }) {
  const cb = wallet?.coinbase;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="size-4 text-[var(--color-text-muted)]" />
          Coinbase wallet
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]">
            Real · informational
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!cb ? (
          <EmptyState title="Loading…" description="Reading Coinbase balances." />
        ) : !cb.available ? (
          <EmptyState
            icon={<Wallet />}
            title="Wallet snapshot unavailable"
            description={
              cb.error ?? "Coinbase API didn't respond. The header retries every 60s."
            }
          />
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-2xl font-semibold tnum">
                {formatUsd(cb.totalUsd ?? 0)}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                total · cash {formatUsd(cb.cashUsd ?? 0)} · {cb.holdings.length}{" "}
                asset{cb.holdings.length === 1 ? "" : "s"}
              </span>
            </div>
            {cb.holdings.length > 0 && (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                      <th className="text-left font-medium px-2 py-1.5">Asset</th>
                      <th className="text-right font-medium px-2 py-1.5">Quantity</th>
                      <th className="text-right font-medium px-2 py-1.5">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cb.holdings
                      .slice()
                      .sort((a, b) => b.valueUsd - a.valueUsd)
                      .map((h) => (
                        <tr
                          key={h.asset}
                          className="border-t border-[var(--color-border)]"
                        >
                          <td className="px-2 py-1.5 font-medium">{h.asset}</td>
                          <td className="px-2 py-1.5 text-right tnum text-[var(--color-text-secondary)]">
                            {h.quantity.toLocaleString(undefined, {
                              maximumFractionDigits: 8,
                            })}
                          </td>
                          <td className="px-2 py-1.5 text-right tnum">
                            {formatUsd(h.valueUsd)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-[var(--color-text-faint)] leading-relaxed">
              These are your real Coinbase balances. The bot in paper mode does
              <strong> not </strong>
              touch this — paper accounting runs on{" "}
              {wallet.paper.startingCapitalUsd != null
                ? `$${wallet.paper.startingCapitalUsd.toFixed(2)} of synthetic dollars`
                : "synthetic dollars"}
              . Manage the paper balance on the{" "}
              <a href="/controls" className="text-[var(--color-accent)] underline">
                Controls
              </a>{" "}
              page.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
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

function trendOf(values: number[]): "up" | "down" | "flat" {
  if (values.length < 2) return "flat";
  const first = values[0]!;
  const last = values[values.length - 1]!;
  if (last > first) return "up";
  if (last < first) return "down";
  return "flat";
}
