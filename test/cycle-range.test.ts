import { describe, it, expect } from "vitest";
import { computeCycleRange } from "@/lib/cycle/range";

describe("computeCycleRange", () => {
  it("computes correct zones for a known synthetic series", () => {
    // 200 closes ranging from $0.40 to $1.20 (range = $0.80)
    const closes: number[] = [];
    for (let i = 0; i < 200; i++) {
      closes.push(0.4 + (i % 100) * 0.008);
    }
    const r = computeCycleRange({
      asset: "AERO",
      dailyCloses: closes,
      currentPrice: 0.55,
    });

    // Min ≈ 0.4, Max ≈ 1.192 (last value of the % cycle)
    expect(r.min).toBeCloseTo(0.4, 2);
    expect(r.max).toBeCloseTo(1.192, 2);

    const range = r.max - r.min;
    // cycleLowZoneTop = min + 0.30 * range
    expect(r.cycleLowZoneTop).toBeCloseTo(r.min + 0.3 * range, 4);
    // cycleHighZoneBottom = min + 0.75 * range
    expect(r.cycleHighZoneBottom).toBeCloseTo(r.min + 0.75 * range, 4);

    // 0.55 in the lower portion of [0.40, 1.192]: position ≈ (0.55-0.4)/0.792 ≈ 18.9%
    expect(r.currentCyclePositionPct).toBeGreaterThan(15);
    expect(r.currentCyclePositionPct).toBeLessThan(25);
  });

  it("uses only the last 180 closes when more provided", () => {
    // First 100 closes are 100; last 200 closes are 50.
    const closes = [...Array(100).fill(100), ...Array(200).fill(50)];
    const r = computeCycleRange({
      asset: "X",
      dailyCloses: closes,
      currentPrice: 50,
    });
    // Last 180 are all 50, so min=max=50
    expect(r.min).toBe(50);
    expect(r.max).toBe(50);
    // Range zero ⇒ position defaults to 50% (avoid divide by zero)
    expect(r.currentCyclePositionPct).toBe(50);
  });

  it("handles range=0 without divide-by-zero", () => {
    const r = computeCycleRange({
      asset: "FLAT",
      dailyCloses: Array(180).fill(100),
      currentPrice: 100,
    });
    expect(r.min).toBe(100);
    expect(r.max).toBe(100);
    expect(r.cycleLowZoneTop).toBe(100);
    expect(r.cycleHighZoneBottom).toBe(100);
    expect(r.currentCyclePositionPct).toBe(50);
  });

  it("position is 0% when current price equals min", () => {
    const closes = [50, 60, 70, 80, 90, 100];
    const r = computeCycleRange({
      asset: "X",
      dailyCloses: closes,
      currentPrice: 50,
    });
    expect(r.currentCyclePositionPct).toBe(0);
  });

  it("position is 100% when current price equals max", () => {
    const closes = [50, 60, 70, 80, 90, 100];
    const r = computeCycleRange({
      asset: "X",
      dailyCloses: closes,
      currentPrice: 100,
    });
    expect(r.currentCyclePositionPct).toBe(100);
  });

  it("uppercases asset symbol", () => {
    const r = computeCycleRange({
      asset: "aero",
      dailyCloses: [1, 2, 3],
      currentPrice: 2,
    });
    expect(r.asset).toBe("AERO");
  });

  it("throws on empty closes", () => {
    expect(() =>
      computeCycleRange({ asset: "X", dailyCloses: [], currentPrice: 1 }),
    ).toThrow();
  });
});
