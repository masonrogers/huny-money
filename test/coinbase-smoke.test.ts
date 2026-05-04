/**
 * Coinbase JWT auth smoke test.
 *
 * Skipped automatically unless RUN_LIVE_SMOKE=1 is set, so CI doesn't depend
 * on Coinbase credentials or network access. Run manually:
 *
 *   RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke
 *
 * Verifies that:
 * - The JWT we sign is accepted by Coinbase
 * - The configured key has TRADE permission and NOT transfer permission
 * - We can fetch the account list
 */

import { describe, it, expect } from "vitest";

const live = process.env.RUN_LIVE_SMOKE === "1";

describe.skipIf(!live)("coinbase live smoke", () => {
  it("authenticates and lists accounts", async () => {
    const { getAccounts } = await import("@/lib/coinbase");
    const accounts = await getAccounts();
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.length).toBeGreaterThan(0);
  });

  it("API key is TRADE-only (assertTradeOnlyKey passes)", async () => {
    const { assertTradeOnlyKey } = await import("@/lib/coinbase");
    await expect(assertTradeOnlyKey()).resolves.not.toThrow();
  });

  it("ticker fetch returns a price for BTC-USD", async () => {
    const { getTicker } = await import("@/lib/coinbase");
    const t = await getTicker("BTC-USD");
    expect(t.bestBid).toBeGreaterThan(0);
    expect(t.bestAsk).toBeGreaterThanOrEqual(t.bestBid);
    expect(t.midPrice).toBeGreaterThan(0);
  });
});
