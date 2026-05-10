import { describe, it, expect } from "vitest";
import {
  countConsecutiveUnderperfDays,
  deltaReturnPct,
  returnPct,
} from "@/lib/orchestration/btc-benchmark";

/**
 * Pure-function tests for the BTC benchmark math. The I/O-touching
 * computeBenchmarkSummary is exercised via the integration suite once
 * equity snapshots and price snapshots are flowing in the live DB.
 */

describe("returnPct", () => {
  it("computes the percentage return", () => {
    expect(returnPct(100, 110)).toBe(10);
    expect(returnPct(100, 90)).toBe(-10);
    expect(returnPct(100, 100)).toBe(0);
  });

  it("returns null on null input", () => {
    expect(returnPct(null, 110)).toBeNull();
    expect(returnPct(100, null)).toBeNull();
  });

  it("returns null when start <= 0 (avoids divide-by-zero / nonsensical %)", () => {
    expect(returnPct(0, 100)).toBeNull();
    expect(returnPct(-50, 100)).toBeNull();
  });

  it("returns null on non-finite input", () => {
    expect(returnPct(Number.NaN, 100)).toBeNull();
    expect(returnPct(100, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("deltaReturnPct", () => {
  it("returns system − BTC return over the same window", () => {
    // Bot grew 12%, BTC grew 5% → delta = +7
    expect(deltaReturnPct(100, 112, 50_000, 52_500)).toBeCloseTo(7, 6);
  });

  it("is symmetric around zero", () => {
    // Bot fell 5%, BTC fell 5% → delta = 0
    expect(deltaReturnPct(100, 95, 50_000, 47_500)).toBeCloseTo(0, 6);
  });

  it("returns null when either return is unknown", () => {
    expect(deltaReturnPct(null, 110, 50_000, 52_500)).toBeNull();
    expect(deltaReturnPct(100, 110, null, 52_500)).toBeNull();
    expect(deltaReturnPct(100, 110, 0, 52_500)).toBeNull();
  });
});

describe("countConsecutiveUnderperfDays", () => {
  const startCap = 500;
  const btcStart = 50_000;

  it("returns 0 when there are no samples", () => {
    expect(countConsecutiveUnderperfDays([], startCap, btcStart)).toBe(0);
  });

  it("returns 0 when the most recent sample is winning", () => {
    // Day 0 (newest): bot +20%, BTC +10% → not underperforming → run=0
    const samples = [
      { equity: 600, btc: 55_000 }, // +20% vs +10%
      { equity: 540, btc: 60_000 }, // +8% vs +20% (would have underperformed)
    ];
    expect(countConsecutiveUnderperfDays(samples, startCap, btcStart)).toBe(0);
  });

  it("counts all-trailing run when every recent day underperforms", () => {
    // All three days bot is below BTC
    const samples = [
      { equity: 510, btc: 60_000 }, // +2% vs +20%
      { equity: 505, btc: 58_000 },
      { equity: 502, btc: 55_000 },
    ];
    expect(countConsecutiveUnderperfDays(samples, startCap, btcStart)).toBe(3);
  });

  it("stops counting at the first winning day", () => {
    // Newest 2 days underperform, 3rd day was winning → run = 2
    const samples = [
      { equity: 510, btc: 60_000 }, // underperf
      { equity: 505, btc: 58_000 }, // underperf
      { equity: 700, btc: 55_000 }, // winning — stops here
      { equity: 510, btc: 60_000 }, // would have been underperf but ignored
    ];
    expect(countConsecutiveUnderperfDays(samples, startCap, btcStart)).toBe(2);
  });

  it("guards against zero or negative anchors", () => {
    const samples = [{ equity: 510, btc: 60_000 }];
    expect(countConsecutiveUnderperfDays(samples, 0, btcStart)).toBe(0);
    expect(countConsecutiveUnderperfDays(samples, startCap, 0)).toBe(0);
    expect(countConsecutiveUnderperfDays(samples, -1, btcStart)).toBe(0);
  });

  it("treats exact ties as not underperforming (>= BTC return is fine)", () => {
    // Bot matches BTC exactly
    const samples = [{ equity: 600, btc: 60_000 }]; // +20% vs +20%
    expect(countConsecutiveUnderperfDays(samples, startCap, btcStart)).toBe(0);
  });
});
