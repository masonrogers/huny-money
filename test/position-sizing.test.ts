import { describe, it, expect } from "vitest";
import {
  targetBtcCoreUsd,
  btcCoreSizing,
  altSizing,
  minCashUsd,
} from "@/lib/risk/position-sizing";

describe("targetBtcCoreUsd", () => {
  it("returns 70% in bull", () => {
    expect(targetBtcCoreUsd("bull", 500)).toBe(350);
  });
  it("returns 50% in chop", () => {
    expect(targetBtcCoreUsd("chop", 500)).toBe(250);
  });
  it("returns 0 in bear", () => {
    expect(targetBtcCoreUsd("bear", 500)).toBe(0);
  });
});

describe("btcCoreSizing", () => {
  it("max equals target in normal regimes (regime cap = target)", () => {
    const r = btcCoreSizing("bull", 500);
    expect(r.targetUsd).toBe(350);
    expect(r.maxUsd).toBe(350);
    expect(r.regimeCapPct).toBe(70);
  });
  it("bear regime is fully zeroed", () => {
    const r = btcCoreSizing("bear", 500);
    expect(r.targetUsd).toBe(0);
    expect(r.maxUsd).toBe(0);
  });
});

describe("altSizing", () => {
  it("rejects in bear regime", () => {
    const d = altSizing({
      regime: "bear",
      requestedSizePct: 12,
      accountValueUsd: 500,
      currentAltExposureUsd: 0,
      softBreakerActive: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.rejectionReason).toMatch(/bear forbids/);
  });

  it("caps single alt at 15%", () => {
    const d = altSizing({
      regime: "bull",
      requestedSizePct: 30,
      accountValueUsd: 500,
      currentAltExposureUsd: 0,
      softBreakerActive: false,
    });
    expect(d.allowed).toBe(true);
    expect(d.effectiveSizePct).toBe(15);
    expect(d.effectiveSizeUsd).toBe(75);
  });

  it("halves size when soft breaker active", () => {
    const d = altSizing({
      regime: "bull",
      requestedSizePct: 12,
      accountValueUsd: 500,
      currentAltExposureUsd: 0,
      softBreakerActive: true,
    });
    expect(d.effectiveSizePct).toBe(6);
    expect(d.effectiveSizeUsd).toBe(30);
    // 30 < $50 minimum → reject
    expect(d.allowed).toBe(false);
    expect(d.rejectionReason).toMatch(/below minimum/);
  });

  it("rejects below $50 min position size at $500 account", () => {
    // 9% of $500 = $45 — below $50 minimum
    const d = altSizing({
      regime: "bull",
      requestedSizePct: 9,
      accountValueUsd: 500,
      currentAltExposureUsd: 0,
      softBreakerActive: false,
    });
    expect(d.allowed).toBe(false);
    expect(d.rejectionReason).toMatch(/below minimum/);
  });

  it("reduces size to fit total alt headroom rather than rejecting outright", () => {
    // Already 25% allocated; trying to add another 15% would exceed 30% total cap.
    const d = altSizing({
      regime: "bull",
      requestedSizePct: 15,
      accountValueUsd: 500,
      currentAltExposureUsd: 125, // 25% of 500
      softBreakerActive: false,
    });
    // Headroom = 30% - 25% = 5% = $25 — below minimum, so REJECT
    expect(d.allowed).toBe(false);
  });

  it("scales down to fit available headroom when above min", () => {
    // 20% already, requesting 15% — headroom is 10%, should reduce.
    const d = altSizing({
      regime: "bull",
      requestedSizePct: 15,
      accountValueUsd: 1000,
      currentAltExposureUsd: 200, // 20%
      softBreakerActive: false,
    });
    expect(d.allowed).toBe(true);
    expect(d.effectiveSizeUsd).toBe(100); // 10% of 1000 (fit headroom)
  });
});

describe("minCashUsd", () => {
  it("0% in bull", () => {
    expect(minCashUsd("bull", 500)).toBe(0);
  });
  it("20% in chop", () => {
    expect(minCashUsd("chop", 500)).toBe(100);
  });
  it("100% in bear", () => {
    expect(minCashUsd("bear", 500)).toBe(500);
  });
});
