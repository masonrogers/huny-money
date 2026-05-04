import { describe, it, expect } from "vitest";
import { validateOrder, OrderValidationError } from "@/lib/execution/validation";

describe("validateOrder", () => {
  const base = {
    asset: "BTC",
    positionType: "btc_core" as const,
    notionalUsd: 100,
    accountValueUsd: 500,
  };

  it("accepts a normal BTC core order", () => {
    expect(() => validateOrder(base)).not.toThrow();
  });

  it("rejects below-minimum position size", () => {
    expect(() => validateOrder({ ...base, notionalUsd: 25 })).toThrow(OrderValidationError);
  });

  it("rejects asset outside the universe", () => {
    expect(() => validateOrder({ ...base, asset: "DOGE" })).toThrow(/not in the configured universe/);
  });

  it("accepts watchlist alts", () => {
    expect(() =>
      validateOrder({ ...base, asset: "AERO", positionType: "alt_cycle", notionalUsd: 60 }),
    ).not.toThrow();
  });

  it("rejects BTC core position > 70% of account value", () => {
    expect(() =>
      validateOrder({ ...base, notionalUsd: 400 }), // 80% of 500
    ).toThrow(/exceeds cap 70%/);
  });

  it("rejects single alt position > 15% of account value", () => {
    expect(() =>
      validateOrder({
        ...base,
        asset: "AERO",
        positionType: "alt_cycle",
        notionalUsd: 100, // 20% of 500
      }),
    ).toThrow(/exceeds single-alt cap 15%/);
  });

  it("rejects stop above entry for a long position", () => {
    expect(() =>
      validateOrder({
        ...base,
        asset: "AERO",
        positionType: "alt_cycle",
        notionalUsd: 60,
        entryPrice: 1.0,
        stopPrice: 1.05,
      }),
    ).toThrow(/Stop price.*must be below entry price/);
  });

  it("accepts a 12% stop on alt cycle entry", () => {
    expect(() =>
      validateOrder({
        ...base,
        asset: "AERO",
        positionType: "alt_cycle",
        notionalUsd: 60,
        entryPrice: 1.0,
        stopPrice: 0.88, // 12% below
      }),
    ).not.toThrow();
  });

  it("rejects an absurdly wide stop (> 2× initial)", () => {
    expect(() =>
      validateOrder({
        ...base,
        asset: "AERO",
        positionType: "alt_cycle",
        notionalUsd: 60,
        entryPrice: 1.0,
        stopPrice: 0.4, // 60% below — way too wide
      }),
    ).toThrow(/exceeds 2× initial stop/);
  });

  it("skips percentage cap when accountValueUsd=0 (delegated to caller)", () => {
    expect(() =>
      validateOrder({ ...base, notionalUsd: 1000, accountValueUsd: 0 }),
    ).not.toThrow();
  });
});
