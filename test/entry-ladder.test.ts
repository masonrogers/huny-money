import { describe, it, expect } from "vitest";
import {
  dueLadders,
  hasDriftedTooFar,
  scheduleTrancheTwo,
  trancheUsd,
  type PendingEntryLadder,
} from "@/lib/orchestration/entry-ladder";

/**
 * Pure-function tests for the entry-ladder helpers. The processor itself
 * (processPendingEntryLadders) is exercised end-to-end via the paper-mode
 * integration suite once a real entry has fired.
 */

describe("trancheUsd", () => {
  it("halves the total USD evenly", () => {
    expect(trancheUsd(120)).toBe(60);
    expect(trancheUsd(75)).toBe(37.5);
  });

  it("returns 0 for non-positive or non-finite inputs", () => {
    expect(trancheUsd(0)).toBe(0);
    expect(trancheUsd(-50)).toBe(0);
    expect(trancheUsd(Number.NaN)).toBe(0);
  });
});

describe("scheduleTrancheTwo", () => {
  it("defaults to 12 hours after now", () => {
    const now = new Date("2026-05-09T12:00:00Z");
    const next = scheduleTrancheTwo(now);
    expect(next.getTime() - now.getTime()).toBe(12 * 3600_000);
  });

  it("respects a custom hour offset", () => {
    const now = new Date("2026-05-09T12:00:00Z");
    const next = scheduleTrancheTwo(now, 6);
    expect(next.getTime() - now.getTime()).toBe(6 * 3600_000);
  });
});

describe("dueLadders", () => {
  const now = new Date("2026-05-09T12:00:00Z");
  const make = (id: string, scheduledAt: string): PendingEntryLadder => ({
    id,
    positionId: `pos-${id}`,
    asset: "AERO",
    trancheUsd: 60,
    originalEntryPrice: 0.5,
    scheduledAt,
    evaluationId: "eval-1",
    createdAt: now.toISOString(),
  });

  it("returns ladders whose scheduledAt is at or before now", () => {
    const ladders = [
      make("a", "2026-05-09T11:00:00Z"), // 1h ago — due
      make("b", "2026-05-09T12:00:00Z"), // exactly now — due (boundary inclusive)
      make("c", "2026-05-09T13:00:00Z"), // 1h ahead — not due
    ];
    const due = dueLadders(ladders, now);
    expect(due.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("returns empty when none are due", () => {
    const ladders = [make("future", "2026-05-10T00:00:00Z")];
    expect(dueLadders(ladders, now)).toEqual([]);
  });
});

describe("hasDriftedTooFar", () => {
  it("returns false when within tolerance", () => {
    expect(hasDriftedTooFar(0.50, 0.52)).toBe(false); // +4%
    expect(hasDriftedTooFar(0.50, 0.46)).toBe(false); // -8%
    expect(hasDriftedTooFar(0.50, 0.549)).toBe(false); // +9.8% — just inside 10%
  });

  it("returns true beyond tolerance", () => {
    expect(hasDriftedTooFar(0.50, 0.60)).toBe(true); // +20%
    expect(hasDriftedTooFar(0.50, 0.40)).toBe(true); // -20%
  });

  it("respects a custom tolerance", () => {
    expect(hasDriftedTooFar(100, 105, 0.03)).toBe(true); // +5% > 3% custom
    expect(hasDriftedTooFar(100, 102, 0.03)).toBe(false); // +2% < 3% custom
  });

  it("returns true defensively for non-positive inputs (treat as bad data)", () => {
    expect(hasDriftedTooFar(0, 0.50)).toBe(true);
    expect(hasDriftedTooFar(0.50, 0)).toBe(true);
    expect(hasDriftedTooFar(-1, 0.50)).toBe(true);
  });
});
