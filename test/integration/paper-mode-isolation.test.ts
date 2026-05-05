import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { stateWriter } from "@/lib/db/utils";
import {
  bootConstructExecutor,
  __resetExecutorForTesting,
  CrossModeBootRejection,
} from "@/lib/execution";
import { setCurrentModeForTesting } from "@/lib/mode";
import { insertPosition, openPositionsForCurrentMode } from "@/lib/db/queries/positions";
import { runBootReconciliation } from "@/lib/execution/reconciliation";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

describe.skipIf(!integrationEnabled)("integration: paper mode isolation (§13.8)", () => {
  beforeEach(async () => {
    await resetIntegration();
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  it("paper executor never reaches Coinbase order endpoints (mock fetch)", async () => {
    await stateWriter({ key: "paper_mode", value: true, changedBy: "test" });
    const { executor } = await bootConstructExecutor();
    expect(executor.mode).toBe("paper");

    let coinbaseOrderCallCount = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("api.coinbase.com") && u.includes("/orders")) {
        coinbaseOrderCallCount++;
      }
      return realFetch(url, init);
    }) as typeof globalThis.fetch;

    try {
      await executor.placeLimitBuy("AERO", 0.5, 100);
      await executor.placeStopLimit("AERO", 0.44, 0.435, 100);
      await executor.placeTakeProfit("AERO", 0.95, 100);
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(coinbaseOrderCallCount).toBe(0);
  });

  it("mode invariance: mutating state.paper_mode mid-session does not change executor", async () => {
    await stateWriter({ key: "paper_mode", value: true, changedBy: "test" });
    const { executor } = await bootConstructExecutor();
    expect(executor.mode).toBe("paper");

    // Mutate the flag — this should NOT affect the executor object
    await stateWriter({ key: "paper_mode", value: false, changedBy: "test" });

    // Same executor reference; same mode.
    expect(executor.mode).toBe("paper");
  });

  it("cross-mode boot rejection: live boot finds open paper positions → throws", async () => {
    // Plant an open paper position
    setCurrentModeForTesting("paper");
    await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "open",
      entryPrice: "0.5",
      quantity: "100",
      stopPrice: "0.44",
      entryTime: new Date(),
      strategyVersion: "3.0",
      paperMode: true,
    });

    // Now try to boot in LIVE mode — should refuse
    await stateWriter({ key: "paper_mode", value: false, changedBy: "test" });
    __resetExecutorForTesting(null);
    const { executor } = await bootConstructExecutor();
    expect(executor.mode).toBe("live");

    await expect(
      runBootReconciliation({
        executor,
        fetchCurrentPrices: async () => ({}),
      }),
    ).rejects.toBeInstanceOf(CrossModeBootRejection);
  });

  it("query helpers mode-filter correctly", async () => {
    setCurrentModeForTesting("paper");
    await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "open",
      entryPrice: "0.5",
      quantity: "100",
      entryTime: new Date(),
      strategyVersion: "3.0",
      paperMode: true,
    });
    await insertPosition({
      asset: "BTC",
      type: "btc_core",
      status: "open",
      entryPrice: "70000",
      quantity: "0.01",
      entryTime: new Date(),
      strategyVersion: "3.0",
      paperMode: false, // a live position
    });

    // In paper mode, only the AERO row should be visible
    const paperOpen = await openPositionsForCurrentMode();
    expect(paperOpen).toHaveLength(1);
    expect(paperOpen[0]!.asset).toBe("AERO");

    // Switch to live and only BTC should be visible
    setCurrentModeForTesting("live");
    const liveOpen = await openPositionsForCurrentMode();
    expect(liveOpen).toHaveLength(1);
    expect(liveOpen[0]!.asset).toBe("BTC");
  });
});
