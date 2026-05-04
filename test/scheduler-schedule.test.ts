import { describe, it, expect } from "vitest";
import {
  EVENT_HOURS_UTC,
  mostRecentScheduledTime,
  nextScheduledTime,
  eventsDueNow,
  type ScheduledEvent,
} from "@/lib/scheduler";

const utc = (yyyy: number, mm: number, dd: number, hh: number, mn = 0): Date =>
  new Date(Date.UTC(yyyy, mm - 1, dd, hh, mn, 0, 0));

describe("EVENT_HOURS_UTC", () => {
  it("matches STRATEGY.md §5.2 schedule", () => {
    expect(EVENT_HOURS_UTC.opus_morning).toBe(14);
    expect(EVENT_HOURS_UTC.sonnet_check_06).toBe(6);
    expect(EVENT_HOURS_UTC.sonnet_check_22).toBe(22);
    expect(EVENT_HOURS_UTC.cycle_range_recompute).toBe(0);
  });
});

describe("mostRecentScheduledTime", () => {
  it("returns today's slot when now is past it", () => {
    const now = utc(2026, 5, 4, 16); // 16:00 UTC, past today's 14:00
    expect(mostRecentScheduledTime("opus_morning", now)).toEqual(utc(2026, 5, 4, 14));
  });

  it("returns yesterday's slot when now is before today's", () => {
    const now = utc(2026, 5, 4, 12); // 12:00 UTC, before today's 14:00
    expect(mostRecentScheduledTime("opus_morning", now)).toEqual(utc(2026, 5, 3, 14));
  });

  it("returns today midnight when now is past 00:00 (cycle range job)", () => {
    const now = utc(2026, 5, 4, 5);
    expect(mostRecentScheduledTime("cycle_range_recompute", now)).toEqual(utc(2026, 5, 4, 0));
  });
});

describe("nextScheduledTime", () => {
  it("returns today's slot when now is before it", () => {
    const now = utc(2026, 5, 4, 12);
    expect(nextScheduledTime("opus_morning", now)).toEqual(utc(2026, 5, 4, 14));
  });

  it("returns tomorrow's slot when now is past today's", () => {
    const now = utc(2026, 5, 4, 16);
    expect(nextScheduledTime("opus_morning", now)).toEqual(utc(2026, 5, 5, 14));
  });
});

describe("eventsDueNow", () => {
  it("returns nothing when none are due", () => {
    const now = utc(2026, 5, 4, 12, 30); // 12:30 UTC — between 06 and 14
    const due = eventsDueNow(now, {
      opus_morning: utc(2026, 5, 3, 14), // fired yesterday
      sonnet_check_06: utc(2026, 5, 4, 6),
      sonnet_check_22: utc(2026, 5, 3, 22),
      cycle_range_recompute: utc(2026, 5, 4, 0),
    });
    expect(due).toHaveLength(0);
  });

  it("returns events past their slot that haven't fired", () => {
    const now = utc(2026, 5, 4, 14, 30);
    const due = eventsDueNow(now, {
      opus_morning: null, // never fired
      sonnet_check_06: utc(2026, 5, 4, 6),
      sonnet_check_22: utc(2026, 5, 3, 22),
      cycle_range_recompute: utc(2026, 5, 4, 0),
    });
    expect(due.map((d) => d.event)).toEqual(["opus_morning"]);
  });

  it("orders by scheduledAt ascending", () => {
    const now = utc(2026, 5, 4, 23);
    const due = eventsDueNow(
      now,
      {
        opus_morning: null,
        sonnet_check_22: null,
        cycle_range_recompute: null,
        sonnet_check_06: null,
      },
      24, // wide look-back so all 4 events appear
    );
    const events: ScheduledEvent[] = due.map((d) => d.event);
    // Within today: 00:00, 06:00, 14:00, 22:00 (in that order)
    expect(events).toEqual([
      "cycle_range_recompute",
      "sonnet_check_06",
      "opus_morning",
      "sonnet_check_22",
    ]);
  });

  it("respects the look-back window", () => {
    const now = utc(2026, 5, 4, 23);
    const due = eventsDueNow(now, {}, 2); // 2-hour look-back
    // Only events whose scheduled time is within last 2h should appear.
    // 22:00 was 1h ago, others were 9+ hours ago.
    expect(due.map((d) => d.event)).toEqual(["sonnet_check_22"]);
  });

  it("does not include an event whose lastFiredAt >= scheduledAt", () => {
    const now = utc(2026, 5, 4, 14, 30);
    const due = eventsDueNow(now, {
      opus_morning: utc(2026, 5, 4, 14, 1), // fired 1 minute after the slot
    });
    expect(due.find((d) => d.event === "opus_morning")).toBeUndefined();
  });
});
