import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { stateWriter } from "@/lib/db/utils";
import { bootConstructExecutor } from "@/lib/execution";
import { ordersForCurrentMode } from "@/lib/db/queries/orders";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

/**
 * Paper-executor MUST persist `feesUsd` on every fill so the position-close
 * P&L paths can aggregate fees across all linked orders. Maker rate (0.4%)
 * for limit-style fills, taker rate (0.6%) for taker-style fills. Tracks the
 * #21/#30 fee-aggregation closure: if a future refactor drops `feesUsd` from
 * the insert/update calls, this test fails before the regression ships.
 */

const MAKER = 0.004;
const TAKER = 0.006;

describe.skipIf(!integrationEnabled)("integration: paper-executor persists feesUsd", () => {
  beforeEach(async () => {
    await resetIntegration();
    await stateWriter({ key: "paper_mode", value: true, changedBy: "test" });
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  it("simulatedFill (entry_limit) writes feesUsd at maker rate", async () => {
    const { executor } = await bootConstructExecutor();
    // notional = 0.5 * 100 = $50; maker fee = $0.20
    await executor.placeLimitBuy("AERO", 0.5, 100);

    const orders = await ordersForCurrentMode();
    expect(orders).toHaveLength(1);
    const o = orders[0]!;
    expect(o.type).toBe("entry_limit");
    expect(o.status).toBe("filled");
    expect(o.feesUsd).not.toBeNull();
    expect(Number(o.feesUsd)).toBeCloseTo(50 * MAKER, 6);
  });

  it("simulatedFill (dca_limit) writes feesUsd at taker rate", async () => {
    const { executor } = await bootConstructExecutor();
    // notional = 100_000 * 0.05 = $5,000; taker fee = $30
    await executor.placeDcaLimitBuy("BTC", 100_000, 0.05);

    const orders = await ordersForCurrentMode();
    expect(orders).toHaveLength(1);
    const o = orders[0]!;
    expect(o.type).toBe("dca_limit");
    expect(o.status).toBe("filled");
    expect(Number(o.feesUsd)).toBeCloseTo(5000 * TAKER, 6);
  });

  it("processPendingFills (stop_limit) writes feesUsd on async fill", async () => {
    const { executor } = await bootConstructExecutor();
    await executor.placeStopLimit("AERO", 0.44, 0.435, 100);

    // pre-fill: stop_limit row is pending with no feesUsd
    const before = await ordersForCurrentMode();
    const stopBefore = before.find((o) => o.type === "stop_limit")!;
    expect(stopBefore.status).toBe("pending");
    expect(stopBefore.feesUsd).toBeNull();

    // Trigger the fill — paper-executor's stop_limit fills when
    // current price <= limit * 1.005. Pass 0.43 to fill at min(0.43, 0.435) = 0.43.
    const fills = await executor.processPendingFills({ AERO: 0.43 });
    expect(fills).toHaveLength(1);

    const after = await ordersForCurrentMode();
    const stopAfter = after.find((o) => o.type === "stop_limit")!;
    expect(stopAfter.status).toBe("filled");
    expect(stopAfter.feesUsd).not.toBeNull();
    // notional = 0.43 * 100 = $43; stop_limit is maker → 0.4% = $0.172
    expect(Number(stopAfter.feesUsd)).toBeCloseTo(43 * MAKER, 6);
  });

  it("processPendingFills (market_exit) writes feesUsd at taker rate on fill", async () => {
    const { executor } = await bootConstructExecutor();
    await executor.placeMarketExit("AERO", 100);

    // market_exit fills at the current price. Pass 0.5 → notional $50, taker $0.30.
    const fills = await executor.processPendingFills({ AERO: 0.5 });
    expect(fills).toHaveLength(1);

    const orders = await ordersForCurrentMode();
    const ex = orders.find((o) => o.type === "market_exit")!;
    expect(ex.status).toBe("filled");
    expect(Number(ex.feesUsd)).toBeCloseTo(50 * TAKER, 6);
  });
});
