import { describe, it, expect } from "vitest";
import {
  evaluatePreflight,
  initialStopPrice,
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
