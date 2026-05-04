"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useApi } from "@/lib/hooks/api";
import { formatRelativeTime, formatUsd, formatNumber } from "@/lib/utils/format";
import { Bot, ChevronRight, ChevronDown } from "lucide-react";
import type { AiActivityPayload, AiActivityEntry } from "@/app/api/dashboard/ai-activity/route";

export default function AiActivityPage() {
  const { data, isLoading } = useApi<AiActivityPayload>(
    "/api/dashboard/ai-activity?limit=50",
    { refreshInterval: 15_000 },
  );

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="AI Activity"
        description="Every Opus and Sonnet call with full prompt, response, parsed output, cost, and tokens. The most important page in the dashboard."
      />

      {!data || isLoading ? (
        <Card>
          <CardContent>
            <EmptyState title="Loading…" description="Reading AI activity log." />
          </CardContent>
        </Card>
      ) : data.entries.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Bot />}
              title="No AI calls yet"
              description="Every Opus and Sonnet call will appear here with full prompt, raw response, parsed JSON, action taken, cost, tokens, and latency. The most recent appears first."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.entries.map((entry) => (
            <ActivityEntry key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityEntry({ entry }: { entry: AiActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isOpus = entry.modelLabel === "Opus";

  return (
    <div className="surface-1 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--color-bg-card-hover)] text-left transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-4 text-[var(--color-text-muted)] shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-[var(--color-text-muted)] shrink-0" />
        )}
        <Badge variant={isOpus ? "accent" : "default"} size="sm">
          {entry.modelLabel}
        </Badge>
        <code className="text-xs text-[var(--color-text-secondary)]">{entry.callType}</code>
        <span className="text-xs text-[var(--color-text-muted)]">{entry.triggerSource}</span>
        {entry.suppressed && (
          <Badge variant="warning" size="sm">
            suppressed
          </Badge>
        )}
        <span className="ml-auto text-xs text-[var(--color-text-faint)] tnum">
          {formatUsd(entry.costUsd)} · {entry.latencyMs ? `${entry.latencyMs}ms` : "—"} ·{" "}
          {formatRelativeTime(entry.timestamp)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)] p-4 space-y-4 text-xs">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[var(--color-text-muted)]">
            <Stat label="input tokens" value={formatNumber(entry.inputTokens)} />
            <Stat label="output tokens" value={formatNumber(entry.outputTokens)} />
            <Stat label="cache read" value={formatNumber(entry.cacheReadTokens)} />
            <Stat label="cache write" value={formatNumber(entry.cacheWriteTokens)} />
          </div>

          {entry.parsedResponse !== null && (
            <div>
              <div className="text-[0.65rem] font-medium uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
                Parsed output
              </div>
              <pre className="font-mono text-[0.7rem] text-[var(--color-text-secondary)] bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-3 max-h-96 overflow-auto">
                {JSON.stringify(entry.parsedResponse, null, 2)}
              </pre>
            </div>
          )}

          <details className="text-[var(--color-text-muted)]">
            <summary className="cursor-pointer text-[0.65rem] font-medium uppercase tracking-wider mb-1.5">
              Raw response
            </summary>
            <pre className="font-mono text-[0.7rem] text-[var(--color-text-secondary)] bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-3 max-h-96 overflow-auto whitespace-pre-wrap">
              {entry.responseText ?? "(no response)"}
            </pre>
          </details>

          <details className="text-[var(--color-text-muted)]">
            <summary className="cursor-pointer text-[0.65rem] font-medium uppercase tracking-wider mb-1.5">
              Full prompt
            </summary>
            <pre className="font-mono text-[0.7rem] text-[var(--color-text-faint)] bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-3 max-h-96 overflow-auto whitespace-pre-wrap">
              {entry.promptText}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[0.65rem] uppercase tracking-wider text-[var(--color-text-faint)]">
        {label}
      </div>
      <div className="font-medium tnum text-[var(--color-text-secondary)] mt-0.5">{value}</div>
    </div>
  );
}
