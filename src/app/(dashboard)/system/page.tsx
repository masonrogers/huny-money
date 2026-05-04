"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useApi } from "@/lib/hooks/api";
import { formatUsd, formatRelativeTime } from "@/lib/utils/format";
import { Check, Hourglass, X } from "lucide-react";
import type { SystemPayload } from "@/app/api/dashboard/system/route";

export default function SystemPage() {
  const { data, isLoading } = useApi<SystemPayload>("/api/dashboard/system", {
    refreshInterval: 30_000,
  });

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="System"
        description="Boot history, error log, API budget detail, phase progress."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>API budget</CardTitle>
          </CardHeader>
          <CardContent>
            {!data ? (
              <EmptyState title="Loading…" description="Reading API spend." />
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <div className="text-2xl font-semibold tnum">
                      {formatUsd(data.apiBudget.mtd)}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] tnum">
                      / {formatUsd(data.apiBudget.cap)} cap
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--color-bg)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)]"
                      style={{ width: `${Math.min(100, data.apiBudget.pctOfCap)}%` }}
                    />
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] tnum mt-1.5">
                    {data.apiBudget.pctOfCap.toFixed(1)}% of monthly cap
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[var(--color-border)]">
                  <SpendLine label="Opus" value={data.apiBudget.byModel.opus} />
                  <SpendLine label="Sonnet" value={data.apiBudget.byModel.sonnet} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Last successful actions</CardTitle>
          </CardHeader>
          <CardContent>
            {!data ? (
              <EmptyState title="Loading…" description="" />
            ) : (
              <ul className="space-y-2.5 text-sm">
                <LastActionRow label="Boot" at={data.lastSuccessfulActions.lastBootAt} />
                <LastActionRow label="Opus call" at={data.lastSuccessfulActions.lastOpusCallAt} />
                <LastActionRow label="Sonnet call" at={data.lastSuccessfulActions.lastSonnetCallAt} />
                <LastActionRow
                  label="Reconciliation"
                  at={data.lastSuccessfulActions.lastReconciliationAt}
                />
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Phase 1 advance criteria</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || isLoading ? (
            <EmptyState title="Loading…" description="" />
          ) : data.phase1Criteria.length === 0 ? (
            <EmptyState
              title="No criteria evaluated yet"
              description="Phase 1 criteria are computed from live data + operator confirmations once paper trading starts."
            />
          ) : (
            <div className="space-y-2">
              {data.phase1Criteria.map((c) => (
                <CriterionRow key={c.id} criterion={c} />
              ))}
              <div className="pt-3 mt-3 border-t border-[var(--color-border)] flex items-center gap-2 text-sm">
                <span className="text-[var(--color-text-muted)]">Overall:</span>
                {data.phase1AllPass ? (
                  <Badge variant="success">All criteria pass</Badge>
                ) : (
                  <Badge variant="warning">Not yet ready for live</Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent errors</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.recentErrors.length === 0 ? (
            <EmptyState
              title="No errors recorded"
              description="Caught exceptions, retries, and degraded-mode fallbacks appear here. Severity ranges from info (recoverable noise) to critical (system halted)."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {data.recentErrors.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start gap-3 border border-[var(--color-border)] rounded-md p-3"
                >
                  <Badge variant={severityTone(e.severity)} size="sm">
                    {e.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-[var(--color-text-secondary)]">
                        {e.component}
                      </code>
                      <span className="text-xs text-[var(--color-text-muted)]">{e.errorClass}</span>
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] mt-1 truncate">
                      {e.message}
                    </div>
                  </div>
                  <span className="text-xs text-[var(--color-text-faint)] tnum shrink-0">
                    {formatRelativeTime(e.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SpendLine({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[0.65rem] uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="text-base font-medium tnum mt-0.5">{formatUsd(value)}</div>
    </div>
  );
}

function LastActionRow({ label, at }: { label: string; at: string | null }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-xs text-[var(--color-text-faint)] tnum">
        {at ? formatRelativeTime(at) : "never"}
      </span>
    </li>
  );
}

function CriterionRow({
  criterion,
}: {
  criterion: SystemPayload["phase1Criteria"][number];
}) {
  return (
    <div className="flex items-start gap-3 text-sm py-1.5">
      <CriterionStatus pass={criterion.pass} />
      <div className="flex-1">
        <div className="text-[var(--color-text-primary)]">{criterion.description}</div>
        <div className="text-xs text-[var(--color-text-muted)] tnum">
          current: {criterion.currentValue ?? "—"} · threshold: {criterion.threshold}
        </div>
      </div>
    </div>
  );
}

function CriterionStatus({ pass }: { pass: boolean | null }) {
  if (pass === true) return <Check className="size-4 text-[var(--color-success)] mt-0.5 shrink-0" />;
  if (pass === false) return <X className="size-4 text-[var(--color-danger)] mt-0.5 shrink-0" />;
  return <Hourglass className="size-4 text-[var(--color-text-muted)] mt-0.5 shrink-0" />;
}

function severityTone(s: string): "default" | "warning" | "danger" {
  if (s === "critical" || s === "error") return "danger";
  if (s === "warning") return "warning";
  return "default";
}
