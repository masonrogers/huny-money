"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useApi } from "@/lib/hooks/api";
import { formatUsd, formatRelativeTime } from "@/lib/utils/format";
import { TrendingUp } from "lucide-react";
import type { CyclePayload } from "@/app/api/dashboard/cycles/route";

export default function CyclePositionPage() {
  const { data, isLoading } = useApi<CyclePayload>("/api/dashboard/cycles", {
    refreshInterval: 60_000,
  });

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Cycle Position"
        description="Per-asset 6-month range zones — the AI's input frame for every alt cycle decision. Recomputed nightly at 00:00 UTC."
      />

      {!data || isLoading ? (
        <Card>
          <CardContent>
            <EmptyState title="Loading…" description="Reading cycle range state." />
          </CardContent>
        </Card>
      ) : data.assets.every((a) => a.cycleLowZoneTop == null) ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<TrendingUp />}
              title="No cycle ranges computed yet"
              description="The nightly job at 00:00 UTC fetches 180 days of daily candles for each watchlist asset and computes the cycle low zone (bottom 30%) and cycle high zone (top 25%). Once it has run, this view shows the zones, the current price's position within the range, and the bot's entry/exit history overlaid."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.assets.map((a) => (
            <Card key={a.asset}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {a.asset}
                  {a.isStale && (
                    <Badge variant="warning" size="sm">
                      stale
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {a.cycleLowZoneTop == null || a.cycleHighZoneBottom == null ? (
                  <EmptyState
                    title="Range not yet computed"
                    description="Awaiting next nightly cycle range job."
                  />
                ) : (
                  <div className="space-y-3 text-sm">
                    <CycleZoneRow
                      label="Cycle low zone (top of bottom 30%)"
                      value={formatUsd(a.cycleLowZoneTop)}
                      tone="success"
                    />
                    <CycleZoneRow
                      label="Cycle high zone (bottom of top 25%)"
                      value={formatUsd(a.cycleHighZoneBottom)}
                      tone="danger"
                    />
                    {a.computedAt && (
                      <div className="text-xs text-[var(--color-text-faint)]">
                        computed {formatRelativeTime(a.computedAt)}
                      </div>
                    )}
                  </div>
                )}
                <p className="text-xs text-[var(--color-text-muted)] mt-4 leading-relaxed">
                  Phase 8 adds the 6-month price chart with these zones shaded, the bot&apos;s
                  entry/exit history overlaid, and the volume profile.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CycleZoneRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "danger";
}) {
  const colorClass =
    tone === "success" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]";
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs text-[var(--color-text-muted)] flex-1 pr-2">{label}</span>
      <span className={`text-base font-medium tnum ${colorClass}`}>{value}</span>
    </div>
  );
}
