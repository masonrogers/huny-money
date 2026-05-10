import { describe, it, expect } from "vitest";
import {
  evaluatePreflight,
  initialStopPrice,
  nextTrailingStopPrice,
  partialSellQuantity,
  quantityFor,
} from "@/lib/orchestration/decision-executor";

/**
 * Pure-function tests for the decision executor's preflight + sizing math.
 * The I/O-touching `executeBriefDecisions` is exercised end-to-end via the
 * paper-mode integration suite (decision → fill → equity update).
 */

describe("evaluatePreflight", () => {
  const baseInput = {
    paused: false,
    phaseHalted: false,
    hardFloorBreached: false,
    dailyLossCapBlocked: false,
    altCooldownActive: false,
  };

  it("allows everything when nothing is tripped", () => {
    const r = evaluatePreflight(baseInput);
    expect(r.blockAll).toBe(false);
    expect(r.blockAltEntries).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it("blocks everything on trading_paused", () => {
    const r = evaluatePreflight({ ...baseInput, paused: true });
    expect(r.blockAll).toBe(true);
    expect(r.reasons).toContain("trading_paused=true");
  });

  it("blocks everything on phase=halted", () => {
    const r = evaluatePreflight({ ...baseInput, phaseHalted: true });
    expect(r.blockAll).toBe(true);
  });

  it("blocks everything when hard floor is breached", () => {
    const r = evaluatePreflight({ ...baseInput, hardFloorBreached: true });
    expect(r.blockAll).toBe(true);
  });

  it("blocks ONLY alt entries on daily loss cap (BTC core + exits still allowed)", () => {
    const r = evaluatePreflight({ ...baseInput, dailyLossCapBlocked: true });
    expect(r.blockAll).toBe(false);
    expect(r.blockAltEntries).toBe(true);
  });

  it("blocks ONLY alt entries on alt cooldown", () => {
    const r = evaluatePreflight({ ...baseInput, altCooldownActive: true });
    expect(r.blockAll).toBe(false);
    expect(r.blockAltEntries).toBe(true);
  });

  it("aggregates multiple reasons", () => {
    const r = evaluatePreflight({
      ...baseInput,
      paused: true,
      altCooldownActive: true,
    });
    expect(r.blockAll).toBe(true);
    expect(r.blockAltEntries).toBe(true);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("quantityFor", () => {
  it("computes quantity = sizeUsd / price", () => {
    expect(quantityFor(500, 50)).toBe(10);
    expect(quantityFor(120, 0.48)).toBeCloseTo(250, 6);
  });

  it("returns 0 for non-positive price (avoid div-by-zero)", () => {
    expect(quantityFor(500, 0)).toBe(0);
    expect(quantityFor(500, -1)).toBe(0);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(quantityFor(Number.NaN, 50)).toBe(0);
    expect(quantityFor(500, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("returns 0 for non-positive size", () => {
    expect(quantityFor(0, 50)).toBe(0);
    expect(quantityFor(-100, 50)).toBe(0);
  });
});

describe("initialStopPrice", () => {
  it("subtracts stop_pct % from entry price", () => {
    expect(initialStopPrice(100, 12)).toBe(88);
    expect(initialStopPrice(0.5, 8)).toBeCloseTo(0.46, 6);
  });

  it("matches the schema's allowed range (4-20%)", () => {
    expect(initialStopPrice(100, 4)).toBe(96);
    expect(initialStopPrice(100, 20)).toBe(80);
  });
});

describe("nextTrailingStopPrice", () => {
  // Schedule: +25%→entry, +50%→+20%, +75%→+40%, +100%→+65%
  it("returns null below the +25% trigger (no schedule applies yet)", () => {
    // Profit = +20%, no upgrade
    expect(nextTrailingStopPrice(100, 120, null)).toBeNull();
    expect(nextTrailingStopPrice(100, 120, 88)).toBeNull();
  });

  it("ratchets to entry at +25%", () => {
    // Profit = +25%, schedule says stop at breakeven (entry)
    const r = nextTrailingStopPrice(100, 125, 88);
    expect(r).toBeCloseTo(100, 6);
  });

  it("ratchets to +20% at the +50% tier", () => {
    const r = nextTrailingStopPrice(100, 150, 100);
    expect(r).toBeCloseTo(120, 6);
  });

  it("ratchets to +65% at the +100% tier", () => {
    const r = nextTrailingStopPrice(100, 200, 140);
    expect(r).toBeCloseTo(165, 6);
  });

  it("never downgrades — returns null when current stop is already at/above schedule", () => {
    // Profit at +50% says stop should be +20% = 120. Current stop is 130.
    expect(nextTrailingStopPrice(100, 150, 130)).toBeNull();
    // Profit at +100% says stop should be +65% = 165. Current stop equals.
    expect(nextTrailingStopPrice(100, 200, 165)).toBeNull();
  });

  it("upgrades from null current stop once schedule applies", () => {
    expect(nextTrailingStopPrice(100, 130, null)).toBeCloseTo(100, 6);
  });

  it("guards against bad inputs", () => {
    expect(nextTrailingStopPrice(0, 130, null)).toBeNull();
    expect(nextTrailingStopPrice(100, 0, null)).toBeNull();
    expect(nextTrailingStopPrice(Number.NaN, 130, null)).toBeNull();
  });

  it("uses the highest cleared tier (not the lowest)", () => {
    // Profit = +90% — clears +25, +50, +75 but not +100. Should pick +75 → +40%.
    const r = nextTrailingStopPrice(100, 190, 130);
    expect(r).toBeCloseTo(140, 6);
  });
});

describe("partialSellQuantity", () => {
  it("sells 1/3 of the original quantity on the first call", () => {
    expect(partialSellQuantity(300, 0)).toBeCloseTo(100, 6);
  });

  it("sells another 1/3 of original on the second call", () => {
    // After 100 sold, remaining is 200; tranche is still 100 of original.
    expect(partialSellQuantity(300, 100)).toBeCloseTo(100, 6);
  });

  it("sells the remaining quantity if less than 1/3 of original is left", () => {
    // After 250 sold, only 50 remains — return 50, not 100.
    expect(partialSellQuantity(300, 250)).toBeCloseTo(50, 6);
  });

  it("returns 0 when nothing remains", () => {
    expect(partialSellQuantity(300, 300)).toBe(0);
    expect(partialSellQuantity(300, 350)).toBe(0); // over-sold; defensive
  });

  it("guards against bad inputs", () => {
    expect(partialSellQuantity(0, 0)).toBe(0);
    expect(partialSellQuantity(-100, 0)).toBe(0);
    expect(partialSellQuantity(300, -10)).toBe(0);
    expect(partialSellQuantity(Number.NaN, 0)).toBe(0);
  });
});
