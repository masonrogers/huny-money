import { describe, it, expect } from "vitest";
import { nextRegimeDayState } from "@/lib/orchestration/morning-brief";

/**
 * FINDINGS.md #32 — `days_in_current_regime` must increment per UTC day,
 * not per brief. Force-iteration (multiple briefs in one calendar day) was
 * inflating the counter and poisoning regime-conviction gating.
 */

describe("nextRegimeDayState", () => {
  it("first-ever brief: prev regime null → changed=true, days=1", () => {
    const r = nextRegimeDayState({
      newRegime: "chop",
      prevRegime: null,
      prevDays: 0,
      lastIncrementUtcDay: null,
      todayUtcDay: "2026-05-11",
    });
    expect(r.changed).toBe(true);
    expect(r.shouldIncrement).toBe(true);
    expect(r.daysAfter).toBe(1);
  });

  it("regime change: chop → bull resets days to 1", () => {
    const r = nextRegimeDayState({
      newRegime: "bull",
      prevRegime: "chop",
      prevDays: 12,
      lastIncrementUtcDay: "2026-05-10",
      todayUtcDay: "2026-05-11",
    });
    expect(r.changed).toBe(true);
    expect(r.shouldIncrement).toBe(true);
    expect(r.daysAfter).toBe(1);
  });

  it("same regime, new UTC day: days incremented by 1", () => {
    const r = nextRegimeDayState({
      newRegime: "chop",
      prevRegime: "chop",
      prevDays: 12,
      lastIncrementUtcDay: "2026-05-10",
      todayUtcDay: "2026-05-11",
    });
    expect(r.changed).toBe(false);
    expect(r.shouldIncrement).toBe(true);
    expect(r.daysAfter).toBe(13);
  });

  it("same regime, same UTC day: no increment (force-iteration is idempotent)", () => {
    const r = nextRegimeDayState({
      newRegime: "chop",
      prevRegime: "chop",
      prevDays: 12,
      lastIncrementUtcDay: "2026-05-11",
      todayUtcDay: "2026-05-11",
    });
    expect(r.changed).toBe(false);
    expect(r.shouldIncrement).toBe(false);
    expect(r.daysAfter).toBe(12);
  });

  it("same regime, no prior increment-day recorded: increments (legacy boot)", () => {
    // Bot just upgraded — old deploys never wrote `days_in_regime_last_utc_day`.
    // The first brief after the upgrade should set the anchor and increment.
    const r = nextRegimeDayState({
      newRegime: "chop",
      prevRegime: "chop",
      prevDays: 5,
      lastIncrementUtcDay: null,
      todayUtcDay: "2026-05-11",
    });
    expect(r.changed).toBe(false);
    expect(r.shouldIncrement).toBe(true);
    expect(r.daysAfter).toBe(6);
  });

  it("three back-to-back force-briefs in same UTC day stay at the same counter", () => {
    // Reproduces the live behavior observed in second-test 2026-05-11:
    // baseline days=12, three force briefs in same UTC day should each leave
    // the counter unchanged once the FIRST one of the day anchored it.
    const firstBrief = nextRegimeDayState({
      newRegime: "chop",
      prevRegime: "chop",
      prevDays: 12,
      lastIncrementUtcDay: "2026-05-10",
      todayUtcDay: "2026-05-11",
    });
    expect(firstBrief.daysAfter).toBe(13);
    expect(firstBrief.shouldIncrement).toBe(true);

    const secondBrief = nextRegimeDayState({
      newRegime: "chop",
      prevRegime: "chop",
      prevDays: 13,
      lastIncrementUtcDay: "2026-05-11", // first brief set this
      todayUtcDay: "2026-05-11",
    });
    expect(secondBrief.daysAfter).toBe(13);
    expect(secondBrief.shouldIncrement).toBe(false);

    const thirdBrief = nextRegimeDayState({
      newRegime: "chop",
      prevRegime: "chop",
      prevDays: 13,
      lastIncrementUtcDay: "2026-05-11",
      todayUtcDay: "2026-05-11",
    });
    expect(thirdBrief.daysAfter).toBe(13);
    expect(thirdBrief.shouldIncrement).toBe(false);
  });
});
