import { describe, it, expect } from "vitest";
import { rsi, sma, ema, macd, bollinger, atr, avgVolume, volumeRatio } from "@/lib/indicators";

// Build a deterministic close series — each value 1 higher than the last.
function ramp(n: number, start = 100): number[] {
  return Array.from({ length: n }, (_, i) => start + i);
}

describe("rsi", () => {
  it("returns null when fewer than period+1 values", () => {
    expect(rsi([1, 2, 3], 14)).toBe(null);
  });

  it("returns 100 for a strictly rising series (no losses)", () => {
    const r = rsi(ramp(20), 14);
    expect(r).toBe(100);
  });

  it("returns 0-ish for a strictly falling series", () => {
    const r = rsi(ramp(20).reverse(), 14);
    expect(r).toBe(0);
  });

  it("returns ~50 for a flat series with one tick of noise", () => {
    const closes = Array.from({ length: 20 }, () => 100);
    closes[10] = 101; // single bump
    const r = rsi(closes, 14)!;
    expect(r).toBeGreaterThan(40);
    expect(r).toBeLessThan(70);
  });
});

describe("sma / ema", () => {
  it("sma of [1..10] period 5 is mean of last 5 = 8", () => {
    expect(sma([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toBe(8);
  });

  it("ema returns null when too few values", () => {
    expect(ema([1, 2], 5)).toBe(null);
  });

  it("ema converges toward latest value over time", () => {
    const flat = Array(50).fill(100);
    flat.push(...Array(50).fill(200));
    const e = ema(flat, 10)!;
    // After 50 bars at 200 with period 10, EMA is very close to 200
    expect(e).toBeGreaterThan(190);
    expect(e).toBeLessThanOrEqual(200);
  });
});

describe("macd", () => {
  it("returns null when too few values", () => {
    expect(macd(ramp(10))).toBe(null);
  });

  it("MACD line positive on a sustained uptrend", () => {
    // Falling then rising — final segment dominates, MACD line should be above zero.
    const closes: number[] = [];
    for (let i = 0; i < 60; i++) closes.push(100 * Math.pow(1.03, i));
    const r = macd(closes);
    expect(r).not.toBe(null);
    expect(r!.macd).toBeGreaterThan(0);
  });

  it("MACD line negative on a sustained downtrend", () => {
    const closes: number[] = [];
    for (let i = 0; i < 60; i++) closes.push(1000 - i * 10); // 1000 → 410
    const r = macd(closes);
    expect(r).not.toBe(null);
    expect(r!.macd).toBeLessThan(0);
  });

  it("histogram crosses zero when momentum reverses", () => {
    // First half rising, second half falling. By the end, MACD should be
    // moving toward negative; histogram negative once the fast EMA catches the reversal.
    const closes: number[] = [];
    for (let i = 0; i < 30; i++) closes.push(100 + i * 5);
    for (let i = 0; i < 30; i++) closes.push(250 - i * 8);
    const r = macd(closes);
    expect(r).not.toBe(null);
    // Histogram measures momentum acceleration — after a reversal it should be negative.
    expect(r!.histogram).toBeLessThan(0);
  });
});

describe("bollinger", () => {
  it("returns null when too few values", () => {
    expect(bollinger([1, 2, 3])).toBe(null);
  });

  it("bands collapse around mean for a flat series", () => {
    const flat = Array(25).fill(100);
    const b = bollinger(flat, 20)!;
    expect(b.middle).toBe(100);
    expect(b.upper).toBe(100); // sigma=0 ⇒ bands collapse
    expect(b.lower).toBe(100);
    expect(b.bandwidth).toBe(0);
  });

  it("bands widen with volatility", () => {
    const noisy: number[] = [];
    for (let i = 0; i < 25; i++) noisy.push(i % 2 === 0 ? 90 : 110);
    const b = bollinger(noisy, 20)!;
    expect(b.upper).toBeGreaterThan(b.middle);
    expect(b.lower).toBeLessThan(b.middle);
    expect(b.bandwidth).toBeGreaterThan(0);
  });
});

describe("atr", () => {
  it("returns null when too few bars", () => {
    expect(atr([{ high: 1, low: 1, close: 1 }], 14)).toBe(null);
  });

  it("returns positive value for noisy bars", () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      high: 100 + (i % 2),
      low: 99 + (i % 2),
      close: 99.5 + (i % 2),
    }));
    expect(atr(bars, 14)).toBeGreaterThan(0);
  });
});

describe("volume helpers", () => {
  it("avgVolume returns null when too few bars", () => {
    expect(avgVolume([1, 2, 3], 5)).toBe(null);
  });

  it("avgVolume averages last `period` values", () => {
    expect(avgVolume([1, 2, 3, 4, 5], 3)).toBe(4); // (3+4+5)/3
  });

  it("volumeRatio returns ratio of recent vs baseline", () => {
    const v = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2];
    // recent 5 avg = 2, baseline 15 avg = (10*1 + 5*2)/15 = 1.333
    const r = volumeRatio(v, 5, 15)!;
    expect(r).toBeCloseTo(2 / (20 / 15), 3);
  });

  it("volumeRatio returns null on zero baseline", () => {
    // All-zero volumes — both recent and baseline are zero, so ratio is undefined.
    expect(volumeRatio([0, 0, 0, 0, 0, 0], 1, 5)).toBe(null);
  });
});
