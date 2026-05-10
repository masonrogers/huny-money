import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { stateWriter } from "@/lib/db/utils";
import { bootConstructExecutor } from "@/lib/execution";
import {
  insertPosition,
  positionByIdForCurrentMode,
} from "@/lib/db/queries/positions";
import { runWakeupCycle } from "@/lib/orchestration/wakeup-cycle";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

/**
 * The wakeup-cycle close-on-fill path is the canonical close path with full
 * fee aggregation (FINDINGS #30 + #21/#30 follow-up). This test seeds an
 * open alt position with a filled entry order, places a stop-limit, runs
 * the cycle with a triggering price, and asserts the position closes with
 * exitPrice + grossPnl + feesUsd (entry+exit summed) + netPnl.
 *
 * If a future refactor stops calling `sumFilledOrderFeesForPositionForCurrentMode`
 * on this path, or stops persisting feesUsd in `processPendingFills`, this
 * test fails before the regression reaches production.
 */

const MAKER = 0.004;

// Mock Coinbase market-data at module level so getTickers returns canned
// prices without going through JWT signing + network. The Coinbase client
// signs JWTs even for public ticker endpoints; with stub credentials the
// JWT signing fails before fetch is called, so fetch-mocking is too late.
const { mockState } = vi.hoisted(() => ({
  mockState: { prices: {} as Record<string, number> },
}));

vi.mock("@/lib/coinbase", async () => {
  const actual = await vi.importActual<typeof import("@/lib/coinbase")>("@/lib/coinbase");
  const ticker = (asset: string) => {
    const px = mockState.prices[asset] ?? 0;
    return {
      bestBid: px * 0.999,
      bestAsk: px * 1.001,
      midPrice: px,
      lastPrice: px,
      time: new Date().toISOString(),
    };
  };
  return {
    ...actual,
    getTicker: async (productId: string) => ticker(productId.split("-")[0]!),
    getTickers: async (productIds: readonly string[]) => {
      const out: Record<string, ReturnType<typeof ticker>> = {};
      for (const id of productIds) out[id] = ticker(id.split("-")[0]!);
      return out;
    },
  };
});

describe.skipIf(!integrationEnabled)("integration: wakeup-cycle close aggregates P&L", () => {
  beforeEach(async () => {
    await resetIntegration();
    await stateWriter({ key: "paper_mode", value: true, changedBy: "test" });
    await stateWriter({ key: "starting_capital_paper_usd", value: 10_000, changedBy: "test" });
    mockState.prices = { AERO: 0.43, BTC: 70_000, ETH: 3000, SOL: 100 };
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  it("stop_limit fill closes the linked position with entry+exit fees aggregated", async () => {
    const { executor } = await bootConstructExecutor();

    // Seed: open AERO alt position at 0.50, qty 100. notional = $50.
    const pos = await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "open",
      direction: "long",
      entryPrice: "0.50",
      quantity: "100",
      stopPrice: "0.435",
      entryTime: new Date(),
      strategyVersion: "3.0",
      paperMode: true,
    });

    // Filled limit_buy linked to the position. Maker fee on $50 = $0.20.
    await executor.placeLimitBuy("AERO", 0.5, 100, { relatedPositionId: pos.id });

    // Stop_limit linked to the position. Stays pending until processPendingFills.
    await executor.placeStopLimit("AERO", 0.44, 0.435, 100, { relatedPositionId: pos.id });

    // Run the cycle. Triggering price 0.43 → stop fills at min(0.43, 0.435) = 0.43.
    const result = await runWakeupCycle();

    expect(result.paperFills).toBe(1);
    expect(result.stopFillFires).toBe(1);

    const closed = await positionByIdForCurrentMode(pos.id);
    expect(closed).not.toBeNull();
    expect(closed!.status).toBe("closed");
    expect(closed!.exitReason).toBe("stop_filled");
    expect(Number(closed!.exitPrice)).toBeCloseTo(0.43, 6);

    // grossPnl = (0.43 - 0.50) * 100 = -7.00
    expect(Number(closed!.grossPnlUsd)).toBeCloseTo(-7, 6);

    // feesUsd aggregates: entry maker on $50 = $0.20, stop_limit maker on
    // $43 = $0.172. Total = $0.372.
    const expectedFees = 50 * MAKER + 43 * MAKER;
    expect(Number(closed!.feesUsd)).toBeCloseTo(expectedFees, 6);

    expect(Number(closed!.netPnlUsd)).toBeCloseTo(-7 - expectedFees, 6);
  });

  it("status guard: already-closed position is not re-closed by the cycle", async () => {
    const { executor } = await bootConstructExecutor();

    const pos = await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "closed",
      direction: "long",
      entryPrice: "0.50",
      quantity: "100",
      exitPrice: "0.45",
      exitTime: new Date(Date.now() - 60_000),
      exitReason: "manual_close_before_fill",
      grossPnlUsd: "-5",
      feesUsd: "0.20",
      netPnlUsd: "-5.20",
      entryTime: new Date(Date.now() - 120_000),
      strategyVersion: "3.0",
      paperMode: true,
    });

    await executor.placeStopLimit("AERO", 0.44, 0.435, 100, { relatedPositionId: pos.id });

    await runWakeupCycle();

    const after = await positionByIdForCurrentMode(pos.id);
    expect(after!.exitReason).toBe("manual_close_before_fill");
    expect(Number(after!.grossPnlUsd)).toBeCloseTo(-5, 6);
  });
});
