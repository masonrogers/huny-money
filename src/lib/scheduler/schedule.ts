/**
 * Scheduled event timing per STRATEGY.md §5.2.
 *
 * - 14:00 UTC daily: Opus morning brief
 * - 06:00 + 22:00 UTC daily: Sonnet watch checkpoints
 * - 00:00 UTC daily: cycle range nightly recompute
 *
 * Pure date math — no I/O. The scheduler tick (Phase 5 loop) calls these
 * to decide what should fire now.
 */

export type ScheduledEvent =
  | "opus_morning"
  | "sonnet_check_06"
  | "sonnet_check_22"
  | "cycle_range_recompute";

export const EVENT_HOURS_UTC: Record<ScheduledEvent, number> = {
  opus_morning: 14,
  sonnet_check_06: 6,
  sonnet_check_22: 22,
  cycle_range_recompute: 0,
};

export interface ScheduledEventDue {
  event: ScheduledEvent;
  scheduledAt: Date;
}

/**
 * Returns the most recent past or current scheduled time for `event` —
 * i.e., the timestamp the scheduler "should have fired by now". Caller
 * compares this to `state.last_<event>_fired_at` to decide if a fire is
 * still pending.
 */
export function mostRecentScheduledTime(event: ScheduledEvent, now: Date = new Date()): Date {
  const hour = EVENT_HOURS_UTC[event];
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0),
  );
  if (candidate <= now) return candidate;
  // Today's slot hasn't happened yet; the most-recent past slot was yesterday's.
  return new Date(candidate.getTime() - 24 * 3600_000);
}

/**
 * Returns the next future scheduled time for `event`.
 */
export function nextScheduledTime(event: ScheduledEvent, now: Date = new Date()): Date {
  const hour = EVENT_HOURS_UTC[event];
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0),
  );
  if (candidate > now) return candidate;
  return new Date(candidate.getTime() + 24 * 3600_000);
}

/**
 * Returns the list of events that are "due now" — their most-recent
 * scheduled time is within the look-back window AND they haven't fired
 * since that scheduled time.
 *
 * `lastFiredAt` is a per-event map from `state.last_<event>_fired_at`.
 */
export function eventsDueNow(
  now: Date,
  lastFiredAt: Partial<Record<ScheduledEvent, Date | null>>,
  /** How far back in time to look. Default: 6 hours (catches missed fires after a deploy). */
  lookBackHours = 6,
): ScheduledEventDue[] {
  const lookBackCutoff = new Date(now.getTime() - lookBackHours * 3600_000);
  const due: ScheduledEventDue[] = [];

  for (const event of Object.keys(EVENT_HOURS_UTC) as ScheduledEvent[]) {
    const scheduled = mostRecentScheduledTime(event, now);
    if (scheduled < lookBackCutoff) continue; // older than look-back window
    if (scheduled > now) continue; // not yet

    const last = lastFiredAt[event];
    if (last && last >= scheduled) continue; // already fired this slot

    due.push({ event, scheduledAt: scheduled });
  }

  // Sort by scheduledAt so callers fire oldest-first.
  due.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  return due;
}
