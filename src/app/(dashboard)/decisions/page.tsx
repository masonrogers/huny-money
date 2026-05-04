"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useApi } from "@/lib/hooks/api";
import { formatRelativeTime } from "@/lib/utils/format";
import { ListChecks } from "lucide-react";
import type { DecisionsPayload } from "@/app/api/dashboard/decisions/route";

export default function DecisionsPage() {
  const { data, isLoading } = useApi<DecisionsPayload>("/api/dashboard/decisions", {
    refreshInterval: 30_000,
  });

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Decisions & Triggers"
        description={'The "why did the bot do (or not do) X?" page.'}
      />

      <Card>
        <CardHeader>
          <CardTitle>Active watch list</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.watchList.length === 0 ? (
            <EmptyState
              icon={<ListChecks />}
              title="No active watch triggers"
              description="The morning brief generates the watch list for the next 24 hours. Sonnet evaluates each trigger on every checkpoint and at every wake-up event."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {data.watchList.map((t) => (
                <li
                  key={t.id}
                  className="border border-[var(--color-border)] rounded-md p-3 flex items-start gap-3"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-xs text-[var(--color-accent)]">{t.triggerId}</code>
                      {t.asset && <Badge size="sm">{t.asset}</Badge>}
                      <Badge variant={t.urgency === "immediate" ? "warning" : "default"} size="sm">
                        {t.urgency}
                      </Badge>
                    </div>
                    <div className="text-[var(--color-text-primary)]">{t.conditionText}</div>
                  </div>
                  <div className="text-xs text-[var(--color-text-faint)] tnum shrink-0">
                    {t.timesEvaluated} evals · {t.timesFired} fires
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Recent wake-ups</CardTitle>
          </CardHeader>
          <CardContent>
            {!data || isLoading ? (
              <EmptyState title="Loading…" description="" />
            ) : data.recentWakeups.length === 0 ? (
              <EmptyState
                title="No wake-up events yet"
                description="Position-move (>5% in 4h), stop fills, and news keyword matches appear here."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {data.recentWakeups.map((w) => (
                  <li
                    key={w.id}
                    className="flex items-start gap-3 border border-[var(--color-border)] rounded-md p-3"
                  >
                    <Badge size="sm">{w.triggerType}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--color-text-primary)] truncate">
                        {w.asset && <span className="font-medium">{w.asset}</span>}
                        {w.dispatched ? " · dispatched" : ` · suppressed: ${w.suppressionReason}`}
                      </div>
                      {w.opusActionTaken && (
                        <div className="text-xs text-[var(--color-text-muted)]">
                          Opus action: {w.opusActionTaken}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-[var(--color-text-faint)] tnum shrink-0">
                      {formatRelativeTime(w.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent app decisions</CardTitle>
          </CardHeader>
          <CardContent>
            {!data || data.recentAppDecisions.length === 0 ? (
              <EmptyState
                title="No app decisions yet"
                description="Budget gate, model routing, debounce, escalation dispatch, reconciliation, circuit breakers — every app-level decision logs here."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {data.recentAppDecisions.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-start gap-3 border border-[var(--color-border)] rounded-md p-3"
                  >
                    <Badge size="sm">{d.decisionType}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--color-text-secondary)] text-xs leading-relaxed">
                        {d.reasoning}
                      </div>
                    </div>
                    <span className="text-xs text-[var(--color-text-faint)] tnum shrink-0">
                      {formatRelativeTime(d.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>State change log</CardTitle>
        </CardHeader>
        <CardContent>
          {!data || data.recentStateChanges.length === 0 ? (
            <EmptyState
              title="No state changes recorded"
              description="Every write to the state table appends a row here. Useful for answering 'what was the value of regime at 14:23 yesterday?'"
            />
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                    <th className="text-left font-medium px-2 py-2">Key</th>
                    <th className="text-left font-medium px-2 py-2">Old</th>
                    <th className="text-left font-medium px-2 py-2">New</th>
                    <th className="text-left font-medium px-2 py-2">By</th>
                    <th className="text-right font-medium px-2 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentStateChanges.map((c) => (
                    <tr key={c.id} className="border-t border-[var(--color-border)]">
                      <td className="px-2 py-2">
                        <code className="text-xs text-[var(--color-text-secondary)]">{c.key}</code>
                      </td>
                      <td className="px-2 py-2 text-xs text-[var(--color-text-muted)]">
                        {JSON.stringify(c.oldValue)?.slice(0, 50) ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {JSON.stringify(c.newValue)?.slice(0, 50) ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-xs text-[var(--color-text-muted)]">
                        {c.changedBy}
                      </td>
                      <td className="px-2 py-2 text-right text-xs text-[var(--color-text-faint)] tnum">
                        {formatRelativeTime(c.changedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
