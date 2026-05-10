import { randomUUID } from "crypto";

/**
 * In-process activity tracker.
 *
 * The bot's heavy work — Opus morning briefs, Sonnet checkpoints, wake-up
 * cycles, scheduler ticks, control actions, AI calls — all happens
 * server-side. Without a live indicator the operator can't tell whether the
 * silence on the dashboard means "everything's calm" or "something's hung
 * for two minutes." This tracker exposes "what's running right now" + a
 * short rolling history of "what just finished."
 *
 * In-memory by design:
 *   - Single-instance app (one DO basic-xxs container)
 *   - Activities are short-lived (seconds to a few minutes)
 *   - Long-term history lives in evaluations / wakeups / app_decisions
 *   - State loss on restart is correct behavior — restart implies
 *     nothing is currently active anyway
 *
 * Wrap any async backend job in `withActivity(kind, label, fn)` and it
 * appears in the header dropdown until it resolves or rejects.
 */

export type ActivityKind =
  | "scheduler_tick"
  | "wakeup_cycle"
  | "morning_brief"
  | "sonnet_check"
  | "cycle_range_job"
  | "reconciliation"
  | "ai_call"
  | "control_action"
  | "boot";

export type ActivityStatus = "running" | "completed" | "failed";

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: ActivityStatus;
  errorMessage?: string;
}

const MAX_RECENT = 50;

const active = new Map<string, ActivityEntry>();
const recent: ActivityEntry[] = [];

export function startActivity(
  kind: ActivityKind,
  label: string,
  detail?: string,
): string {
  const id = randomUUID();
  const entry: ActivityEntry = {
    id,
    kind,
    label,
    detail,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  active.set(id, entry);
  return id;
}

export function endActivity(
  id: string,
  status: "completed" | "failed",
  errorMessage?: string,
): void {
  const entry = active.get(id);
  if (!entry) return; // already ended or never started
  active.delete(id);
  const endedAt = new Date();
  const finished: ActivityEntry = {
    ...entry,
    status,
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - new Date(entry.startedAt).getTime(),
    errorMessage,
  };
  recent.unshift(finished); // newest first
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
}

/**
 * Convenience wrapper: starts an activity, runs `fn`, ends on settle.
 * Always rethrows the original error.
 */
export async function withActivity<T>(
  kind: ActivityKind,
  label: string,
  fn: () => Promise<T>,
  detail?: string,
): Promise<T> {
  const id = startActivity(kind, label, detail);
  try {
    const result = await fn();
    endActivity(id, "completed");
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    endActivity(id, "failed", msg);
    throw err;
  }
}

export function getActiveActivities(): ActivityEntry[] {
  // Return a snapshot in start-time order (oldest first → "running longest").
  return Array.from(active.values()).sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
}

export function getRecentActivities(limit = 20): ActivityEntry[] {
  return recent.slice(0, limit);
}

/** For tests. */
export function __resetActivityTrackerForTesting(): void {
  active.clear();
  recent.length = 0;
}
