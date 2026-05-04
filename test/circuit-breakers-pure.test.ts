import { describe, it, expect } from "vitest";
import {
  evaluateSoftBreaker,
  evaluateBtcUnderperformance,
} from "@/lib/risk/circuit-breakers";

/**
 * Pure-function circuit-breaker tests. The DB-touching breakers
 * (checkHardFloor, checkDailyLossCap, checkAltCooldown) are tested
 * via the integration suite once the schema is pushed.
 */

describe("evaluateSoftBreaker", () => {
  it("trips at 20% drawdown", () => {
    const r = evaluateSoftBreaker(80, 100, false);
    expect(r.shouldBeActive).toBe(true);
    expect(r.drawdownPct).toBe(20);
  });

  it("does not trip at 19.99% drawdown", () => {
    const r = evaluateSoftBreaker(80.01, 100, false);
    expect(r.shouldBeActive).toBe(false);
  });

  it("stays active until within 10% of peak (hysteresis)", () => {
    // Currently active, drawdown still 15% — stays active
    const r1 = evaluateSoftBreaker(85, 100, true);
    expect(r1.shouldBeActive).toBe(true);
    expect(r1.recovered).toBe(false);

    // Currently active, recovered to within 10%
    const r2 = evaluateSoftBreaker(91, 100, true);
    expect(r2.shouldBeActive).toBe(false);
    expect(r2.recovered).toBe(true);
  });

  it("returns 0 drawdown when peak is 0", () => {
    const r = evaluateSoftBreaker(50, 0, false);
    expect(r.drawdownPct).toBe(0);
    expect(r.shouldBeActive).toBe(false);
  });
});

describe("evaluateBtcUnderperformance", () => {
  it("does not pause when 60d delta is positive", () => {
    const d = evaluateBtcUnderperformance({
      systemReturnPct: 12,
      btcHoldReturnPct: 10,
      rolling30dDeltaPct: 2,
      rolling60dDeltaPct: 3,
      consecutiveUnderperfDays: 0,
    });
    expect(d.shouldPause).toBe(false);
    expect(d.shouldFlag30d).toBe(false);
    expect(d.shouldWarn30d).toBe(false);
  });

  it("warns at 30d delta ≤ -3% but does not pause", () => {
    const d = evaluateBtcUnderperformance({
      systemReturnPct: 5,
      btcHoldReturnPct: 9,
      rolling30dDeltaPct: -4,
      rolling60dDeltaPct: -2,
      consecutiveUnderperfDays: 30,
    });
    expect(d.shouldPause).toBe(false);
    expect(d.shouldWarn30d).toBe(true);
    expect(d.shouldFlag30d).toBe(false);
  });

  it("flags at 30d delta ≤ -5%", () => {
    const d = evaluateBtcUnderperformance({
      systemReturnPct: 0,
      btcHoldReturnPct: 8,
      rolling30dDeltaPct: -6,
      rolling60dDeltaPct: -3,
      consecutiveUnderperfDays: 30,
    });
    expect(d.shouldFlag30d).toBe(true);
    expect(d.shouldWarn30d).toBe(true);
  });

  it("pauses on 60d delta < 0 + 60+ consecutive underperf days", () => {
    const d = evaluateBtcUnderperformance({
      systemReturnPct: -5,
      btcHoldReturnPct: 5,
      rolling30dDeltaPct: -4,
      rolling60dDeltaPct: -8,
      consecutiveUnderperfDays: 60,
    });
    expect(d.shouldPause).toBe(true);
  });

  it("does not pause if consecutive days < 60 even with negative delta", () => {
    const d = evaluateBtcUnderperformance({
      systemReturnPct: -2,
      btcHoldReturnPct: 5,
      rolling30dDeltaPct: -4,
      rolling60dDeltaPct: -7,
      consecutiveUnderperfDays: 45,
    });
    expect(d.shouldPause).toBe(false);
  });

  it("does not pause if 60d delta >= 0 even with consecutive underperf days", () => {
    const d = evaluateBtcUnderperformance({
      systemReturnPct: 6,
      btcHoldReturnPct: 5,
      rolling30dDeltaPct: -1,
      rolling60dDeltaPct: 1,
      consecutiveUnderperfDays: 70,
    });
    expect(d.shouldPause).toBe(false);
  });
});
