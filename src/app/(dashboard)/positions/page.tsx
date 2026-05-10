"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useApi } from "@/lib/hooks/api";
import { useDashboardView } from "@/lib/contexts/dashboard-view";
import { formatUsd, formatPct, formatRelativeTime } from "@/lib/utils/format";
import { GanttChart, Wallet } from "lucide-react";
import type { PositionsPayload, PositionRow } from "@/app/api/dashboard/positions/route";
import type { WalletPayload } from "@/app/api/dashboard/wallet/route";

export default function PositionsPage() {
  const { view } = useDashboardView();
  const { data, isLoading } = useApi<PositionsPayload>("/api/dashboard/positions", {
    refreshInterval: 30_000,
  });
  const { data: wallet } = useApi<WalletPayload>("/api/dashboard/wallet", {
    refreshInterval: 60_000,
  });

  if (view === "coinbase") {
    return <CoinbasePositionsView wallet={wallet} />;
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Paper positions"
        description="Bot-managed paper positions with full detail; closed positions table with P&L."
      />

      <Card>
        <CardHeader>
          <CardTitle>Open paper positions</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || isLoading ? (
            <EmptyState title="Loading…" description="Reading positions from the database." />
          ) : data.open.length === 0 ? (
            <EmptyState
              icon={<GanttChart />}
              title="No paper positions open"
              description="The bot is sitting in cash. Positions appear here when the AI identifies an alt cycle entry candidate that meets all 7 entry criteria, or when the regime upgrades to bull and BTC core DCA begins."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.open.map((p) => (
                <OpenPositionCard key={p.id} position={p} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recently closed</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.recentClosed.length === 0 ? (
            <EmptyState
              title="No closed trades yet"
              description="Closed positions show entry/exit prices, P&L, hold duration, exit reason, and the reasoning the AI provided at entry."
            />
          ) : (
            <ClosedPositionsTable positions={data.recentClosed} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CoinbasePositionsView({ wallet }: { wallet: WalletPayload | undefined }) {
  const cb = wallet?.coinbase;
  const holdings = cb?.holdings ?? [];
  const sorted = holdings.slice().sort((a, b) => b.valueUsd - a.valueUsd);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Coinbase wallet holdings"
        description="Your real Coinbase positions — informational. The bot does not manage these in paper mode."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-[var(--color-text-muted)]" />
            Wallet
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]">
              Real · informational
            </span>
            {cb?.snapshotAtIso && (
              <span className="ml-auto text-xs text-[var(--color-text-muted)]">
                snapshot {formatRelativeTime(cb.snapshotAtIso)}
              </span>
            )}
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
                cb.error ?? "Coinbase API didn't respond. Retries every 60s."
              }
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-3xl font-semibold tnum">
                  {formatUsd(cb.totalUsd ?? 0)}
                </span>
                <span className="text-sm text-[var(--color-text-muted)]">
                  total · cash {formatUsd(cb.cashUsd ?? 0)}
                </span>
              </div>

              {sorted.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  All cash. Wallet holds {formatUsd(cb.cashUsd ?? 0)} in USD/USDC and no
                  other assets.
                </p>
              ) : (
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                        <th className="text-left font-medium px-2 py-2">Asset</th>
                        <th className="text-right font-medium px-2 py-2">Quantity</th>
                        <th className="text-right font-medium px-2 py-2">Value</th>
                        <th className="text-right font-medium px-2 py-2">% of wallet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((h) => {
                        const pct =
                          cb.totalUsd && cb.totalUsd > 0
                            ? (h.valueUsd / cb.totalUsd) * 100
                            : null;
                        return (
                          <tr
                            key={h.asset}
                            className="border-t border-[var(--color-border)]"
                          >
                            <td className="px-2 py-2 font-medium">{h.asset}</td>
                            <td className="px-2 py-2 text-right tnum text-[var(--color-text-secondary)]">
                              {h.quantity.toLocaleString(undefined, {
                                maximumFractionDigits: 8,
                              })}
                            </td>
                            <td className="px-2 py-2 text-right tnum">
                              {formatUsd(h.valueUsd)}
                            </td>
                            <td className="px-2 py-2 text-right tnum text-[var(--color-text-muted)]">
                              {pct != null ? `${pct.toFixed(1)}%` : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-[var(--color-text-faint)] leading-relaxed border-t border-[var(--color-border)] pt-3">
                These balances reflect your real Coinbase wallet. They are completely
                separate from the bot's paper accounting — the bot does not buy or
                sell against this wallet in paper mode.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OpenPositionCard({ position }: { position: PositionRow }) {
  return (
    <div className="border border-[var(--color-border)] rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="accent" size="lg">
          {position.asset}
        </Badge>
        <Badge size="sm">{position.type === "btc_core" ? "core" : "alt cycle"}</Badge>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          {formatRelativeTime(position.entryTime)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Entry" value={formatUsd(position.entryPrice)} mono />
        <Field label="Quantity" value={position.quantity.toString()} mono />
        <Field
          label="Stop"
          value={position.stopPrice != null ? formatUsd(position.stopPrice) : "—"}
          mono
        />
        <Field
          label="Target"
          value={position.targetPrice != null ? formatUsd(position.targetPrice) : "—"}
          mono
        />
      </div>

      {position.thesis && (
        <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed border-t border-[var(--color-border)] pt-3">
          {position.thesis}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-[0.65rem] text-[var(--color-text-faint)]">
        {position.stopOrderId && (
          <span>
            stop order:{" "}
            <code className="text-[var(--color-text-muted)]">
              {position.stopOrderId.slice(0, 16)}…
            </code>
          </span>
        )}
        {position.tpOrderId && (
          <span>
            tp order:{" "}
            <code className="text-[var(--color-text-muted)]">
              {position.tpOrderId.slice(0, 16)}…
            </code>
          </span>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[0.65rem] uppercase tracking-wider text-[var(--color-text-faint)]">
        {label}
      </div>
      <div className={`mt-0.5 ${mono ? "tnum font-medium" : ""}`}>{value}</div>
    </div>
  );
}

function ClosedPositionsTable({ positions }: { positions: PositionRow[] }) {
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
            <th className="text-right font-medium px-2 py-2">When</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const pnl = p.netPnlUsd;
            const days =
              p.exitTime && p.entryTime
                ? Math.round(
                    (new Date(p.exitTime).getTime() - new Date(p.entryTime).getTime()) / 86400_000,
                  )
                : null;
            const pnlPct =
              p.exitPrice != null && p.entryPrice > 0
                ? ((p.exitPrice - p.entryPrice) / p.entryPrice) * 100
                : null;
            return (
              <tr key={p.id} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-2 font-medium">{p.asset}</td>
                <td className="px-2 py-2 text-xs text-[var(--color-text-muted)]">
                  {p.type === "btc_core" ? "core" : "alt"}
                </td>
                <td className="px-2 py-2 text-right tnum">{formatUsd(p.entryPrice)}</td>
                <td className="px-2 py-2 text-right tnum">{formatUsd(p.exitPrice)}</td>
                <td
                  className={`px-2 py-2 text-right tnum ${
                    pnl == null
                      ? "text-[var(--color-text-muted)]"
                      : pnl >= 0
                        ? "text-[var(--color-success)]"
                        : "text-[var(--color-danger)]"
                  }`}
                >
                  {pnl != null ? formatUsd(pnl) : "—"}
                  {pnlPct != null && (
                    <span className="block text-[0.65rem]">{formatPct(pnlPct, true)}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right tnum text-[var(--color-text-muted)]">
                  {days ?? "—"}
                </td>
                <td className="px-2 py-2 text-xs text-[var(--color-text-muted)]">
                  {p.exitReason ?? "—"}
                </td>
                <td className="px-2 py-2 text-right text-xs text-[var(--color-text-faint)]">
                  {p.exitTime ? formatRelativeTime(p.exitTime) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
