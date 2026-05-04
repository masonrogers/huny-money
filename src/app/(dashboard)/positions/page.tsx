"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useApi } from "@/lib/hooks/api";
import { formatUsd, formatPct, formatRelativeTime } from "@/lib/utils/format";
import { GanttChart } from "lucide-react";
import type { PositionsPayload, PositionRow } from "@/app/api/dashboard/positions/route";

export default function PositionsPage() {
  const { data, isLoading } = useApi<PositionsPayload>("/api/dashboard/positions", {
    refreshInterval: 30_000,
  });

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Positions"
        description="Open positions with full detail; closed positions table with sort and filter."
      />

      <Card>
        <CardHeader>
          <CardTitle>Open positions</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || isLoading ? (
            <EmptyState title="Loading…" description="Reading positions from the database." />
          ) : data.open.length === 0 ? (
            <EmptyState
              icon={<GanttChart />}
              title="No positions open"
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
