"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Activity, Check, Loader2, X } from "lucide-react";
import { useApi } from "@/lib/hooks/api";
import { cn } from "@/lib/utils/cn";
import type { ActivityPayload } from "@/app/api/dashboard/activity/route";

/**
 * Live backend activity indicator. Lives in the header on every dashboard
 * page so the operator always knows what the bot is doing right now.
 *
 * Polls /api/dashboard/activity every 2s.
 *   - active.length === 0 → static dot, no spinner
 *   - active.length > 0   → spinning ring + count badge
 * Click opens a dropdown showing the live items + last 20 recent items.
 *
 * The polling cadence is intentionally faster than dashboard data hooks
 * (which poll at 30s or 60s) — the operator wants to *see* activity start
 * within a couple seconds, not wait for the next 30s tick.
 */

export function ActivityIndicator() {
  const { data } = useApi<ActivityPayload>("/api/dashboard/activity", {
    refreshInterval: 2_000,
    dedupingInterval: 1_000,
    revalidateOnFocus: true,
  });

  const active = data?.active ?? [];
  const recent = data?.recent ?? [];
  const activeCount = active.length;
  const isActive = activeCount > 0;
  const [open, setOpen] = React.useState(false);

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md",
            "border border-[var(--color-border)] bg-[var(--color-bg-card)]",
            "text-xs font-medium text-[var(--color-text-secondary)]",
            "hover:bg-[var(--color-bg-card-hover)] hover:text-[var(--color-text-primary)]",
            "focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]",
            "transition-colors",
            isActive && "border-[var(--color-accent)]/40 text-[var(--color-accent)]",
          )}
          aria-label={
            isActive
              ? `${activeCount} backend ${activeCount === 1 ? "task" : "tasks"} running`
              : "No backend activity"
          }
        >
          {isActive ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Activity className="size-3.5 opacity-60" />
          )}
          <span className="tnum">
            {isActive ? activeCount : "Idle"}
          </span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn(
            "z-50 w-[420px] max-h-[70vh] overflow-y-auto",
            "rounded-md border border-[var(--color-border)]",
            "bg-[var(--color-bg-elevated)] shadow-2xl",
            "p-3",
          )}
        >
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 font-medium">
            Live activity
          </div>

          {active.length === 0 ? (
            <div className="text-xs text-[var(--color-text-muted)] italic px-2 py-3">
              No backend tasks running. The bot is calm.
            </div>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {active.map((a) => (
                <ActivityRow key={a.id} entry={a} live />
              ))}
            </ul>
          )}

          <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 mt-3 font-medium">
            Recent ({recent.length})
          </div>
          {recent.length === 0 ? (
            <div className="text-xs text-[var(--color-text-faint)] italic px-2 py-2">
              Nothing finished yet this session.
            </div>
          ) : (
            <ul className="space-y-1">
              {recent.map((a) => (
                <ActivityRow key={a.id} entry={a} live={false} />
              ))}
            </ul>
          )}

          <div className="mt-3 pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-faint)] flex items-center justify-between">
            <span>Polls every 2s · in-memory tracker</span>
            <span className="tnum">history kept up to 50 entries</span>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ActivityRow({
  entry,
  live,
}: {
  entry: ActivityPayload["active"][number];
  live: boolean;
}) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [live]);

  const startedMs = new Date(entry.startedAt).getTime();
  const elapsedMs = live ? now - startedMs : entry.durationMs ?? 0;
  const elapsedSec = Math.max(0, Math.round(elapsedMs / 1000));

  const status: "running" | "completed" | "failed" = entry.status;
  const statusIcon =
    status === "running" ? (
      <Loader2 className="size-3 animate-spin text-[var(--color-accent)]" />
    ) : status === "completed" ? (
      <Check className="size-3 text-[var(--color-success)]" />
    ) : (
      <X className="size-3 text-[var(--color-danger)]" />
    );

  return (
    <li
      className={cn(
        "flex items-start gap-2.5 px-2 py-1.5 rounded text-xs",
        live && "bg-[var(--color-bg-card)]",
        !live && "hover:bg-[var(--color-bg-card)]",
      )}
    >
      <div className="mt-0.5 shrink-0">{statusIcon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-[var(--color-text-primary)] truncate">
            {entry.label}
          </span>
          <span className="text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider tnum shrink-0">
            {entry.kind.replace(/_/g, " ")}
          </span>
        </div>
        {entry.detail && (
          <div className="text-[var(--color-text-muted)] text-[11px] truncate mt-0.5">
            {entry.detail}
          </div>
        )}
        {entry.errorMessage && (
          <div className="text-[var(--color-danger)] text-[11px] mt-0.5 line-clamp-2">
            {entry.errorMessage}
          </div>
        )}
      </div>
      <div className="text-[10px] text-[var(--color-text-faint)] tnum shrink-0 mt-1">
        {formatElapsed(elapsedSec)}
      </div>
    </li>
  );
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}
