"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { PageHeader } from "@/components/page-header";
import { useApi } from "@/lib/hooks/api";
import { formatRelativeTime } from "@/lib/utils/format";
import { CalendarClock } from "lucide-react";
import type { TodayPayload } from "@/app/api/dashboard/today/route";

export default function TodaysPlanPage() {
  const { data, isLoading } = useApi<TodayPayload>("/api/dashboard/today", {
    refreshInterval: 60_000,
  });

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Today's Plan"
        description={
          data?.briefAt
            ? `Latest morning brief · ${formatRelativeTime(data.briefAt)}`
            : "The live morning brief, beautifully rendered."
        }
      />

      {!data || isLoading ? (
        <Card>
          <CardContent>
            <EmptyState title="Loading…" description="Reading today's brief." />
          </CardContent>
        </Card>
      ) : !data.brief ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<CalendarClock />}
              title="No morning brief yet"
              description="The first morning brief runs on the next 14:00 UTC scheduler tick. You'll see today's regime call, BTC core decision, alt cycle candidates, and the watch list here."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Regime</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge variant={regimeTone(data.brief.regime)} size="lg">
                  <StatusDot tone={regimeTone(data.brief.regime)} />
                  {data.brief.regime.toUpperCase()}
                </Badge>
                {data.brief.regime_changed_from && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    changed from {data.brief.regime_changed_from}
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {data.brief.regime_evidence}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>BTC core decision</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Badge variant="accent" size="lg">
                  {data.brief.btc_core_decision.action}
                </Badge>
                <span className="text-sm tnum">
                  {data.brief.btc_core_decision.current_alloc_pct}% →{" "}
                  {data.brief.btc_core_decision.target_alloc_pct}%
                </span>
              </div>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {data.brief.btc_core_decision.reasoning}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Alt entry candidates</CardTitle>
            </CardHeader>
            <CardContent>
              {data.brief.alt_entry_candidates.length === 0 ? (
                <EmptyState
                  title="No entry candidates today"
                  description="Cycle position, momentum, volume, and conviction must all align — most days no alt qualifies."
                />
              ) : (
                <ul className="space-y-3">
                  {data.brief.alt_entry_candidates.map((c) => (
                    <li
                      key={c.asset}
                      className="border border-[var(--color-border)] rounded-md p-3 text-sm"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="accent">{c.asset}</Badge>
                        <span className="text-xs text-[var(--color-text-muted)] tnum">
                          conviction {c.conviction} · size {c.size_pct}% · stop {c.stop_pct}%
                        </span>
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] mb-2">
                        cycle position {c.cycle_position_pct.toFixed(1)}%
                      </div>
                      <p className="text-[var(--color-text-secondary)] leading-relaxed">
                        {c.reasoning}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Watch list</CardTitle>
            </CardHeader>
            <CardContent>
              {data.activeTriggers.length === 0 ? (
                <EmptyState
                  title="No active watch triggers"
                  description="Triggers expire after 24 hours. The next morning brief generates a fresh watch list."
                />
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.activeTriggers.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-start gap-3 border border-[var(--color-border)] rounded-md p-3"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-xs text-[var(--color-accent)]">{t.triggerId}</code>
                          {t.asset && <Badge size="sm">{t.asset}</Badge>}
                          <Badge variant={t.urgency === "immediate" ? "warning" : "default"} size="sm">
                            {t.urgency}
                          </Badge>
                        </div>
                        <div className="text-[var(--color-text-primary)] mb-1">{t.conditionText}</div>
                        {t.rationale && (
                          <div className="text-xs text-[var(--color-text-muted)]">{t.rationale}</div>
                        )}
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

          <Card>
            <CardHeader>
              <CardTitle>Actions taken</CardTitle>
            </CardHeader>
            <CardContent>
              {data.executionActions.length === 0 ? (
                <EmptyState
                  title="No orders placed for this brief"
                  description="Either Opus had no actionable decisions, or pre-flight gates blocked execution (paused, halted, hard-floor, daily-loss-cap, alt-cooldown). The Decisions page shows the gate decision."
                />
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.executionActions.map((a, i) => (
                    <li
                      key={`${a.asset}-${i}`}
                      className="border border-[var(--color-border)] rounded-md p-3"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={a.kind === "btc_core" ? "default" : "accent"}>
                          {a.asset}
                        </Badge>
                        <span className="text-xs text-[var(--color-text-muted)] tnum">
                          {a.kind === "btc_core" ? "BTC core" : "alt entry"}
                          {a.sizeUsd != null && ` · $${a.sizeUsd.toFixed(2)}`}
                          {a.price != null && ` @ $${a.price.toFixed(a.price < 1 ? 4 : 2)}`}
                        </span>
                      </div>
                      <p className="text-[var(--color-text-secondary)] leading-relaxed">
                        {a.reasoning}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Discipline check</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {data.brief.discipline_check}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function regimeTone(r: "bull" | "chop" | "bear"): "success" | "warning" | "danger" {
  if (r === "bull") return "success";
  if (r === "chop") return "warning";
  return "danger";
}
