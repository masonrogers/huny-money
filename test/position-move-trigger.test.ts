import { describe, it, expect } from "vitest";
import { checkPositionMove } from "@/lib/triggers/position-move";

/**
 * Pre-debounce guards for the position-move trigger.
 *
 * The wake-up cycle defaults missing tickers to 0 (`prices[a] ?? 0`). Without
 * a current-price guard, that turns into a deltaPct of −100%, which trips
 * the 5% threshold and fires a spurious wake-up on every Coinbase ticker
 * hiccup. This suite locks in the guards.
 *
 * Tests run with no DB — checkPositionMove must reject invalid inputs
 * BEFORE calling isDebounced (which would otherwise hit the database).
 */

describe("checkPositionMove pre-debounce guards", () => {
  it("rejects when priceFourHoursAgo is null", async () => {
    const fire = await checkPositionMove({
      asset: "AERO",
      currentPrice: 1.5,
      priceFourHoursAgo: null,
    });
    expect(fire).toBeNull();
  });

  it("rejects when priceFourHoursAgo is zero or negative", async () => {
    expect(
      await checkPositionMove({
        asset: "AERO",
        currentPrice: 1.5,
        priceFourHoursAgo: 0,
      }),
    ).toBeNull();
    expect(
      await checkPositionMove({
        asset: "AERO",
        currentPrice: 1.5,
        priceFourHoursAgo: -1,
      }),
    ).toBeNull();
  });

  it("rejects when currentPrice is zero (ticker fetch failure → ?? 0)", async () => {
    const fire = await checkPositionMove({
      asset: "AERO",
      currentPrice: 0,
      priceFourHoursAgo: 1.5,
    });
    expect(fire).toBeNull();
  });

  it("rejects when currentPrice is negative", async () => {
    const fire = await checkPositionMove({
      asset: "AERO",
      currentPrice: -0.01,
      priceFourHoursAgo: 1.5,
    });
    expect(fire).toBeNull();
  });

  it("rejects when currentPrice is non-finite", async () => {
    const fire = await checkPositionMove({
      asset: "AERO",
      currentPrice: Number.NaN,
      priceFourHoursAgo: 1.5,
    });
    expect(fire).toBeNull();
  });

  it("rejects when |deltaPct| < threshold (5%)", async () => {
    // 4% move
    const fire = await checkPositionMove({
      asset: "AERO",
      currentPrice: 1.04,
      priceFourHoursAgo: 1.0,
    });
    expect(fire).toBeNull();
  });
});
