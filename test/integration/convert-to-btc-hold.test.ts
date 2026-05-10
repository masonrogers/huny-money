import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { stateRead, stateWriter } from "@/lib/db/utils";
import { bootConstructExecutor } from "@/lib/execution";
import {
  insertPosition,
  openPositionsForCurrentMode,
  positionsForCurrentMode,
} from "@/lib/db/queries/positions";
import { ordersForCurrentMode } from "@/lib/db/queries/orders";
import { POST as convertToBtcHold } from "@/app/api/controls/convert-to-btc-hold/route";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

/**
 * convert-to-btc-hold (FINDINGS #27) is the §4.4 honesty-check fallback:
 * close all positions, swap cash for BTC, halt. Originally inherited the
 * #11 (no btc_core position record on buy) and #21 (no P&L on close) bugs.
 * This test asserts the post-fix invariants:
 *   1. every prior position is closed with non-null exitPrice + P&L
 *   2. a new btc_core position row exists with the BTC purchase qty
 *   3. the BTC dca_limit order is linked via relatedPositionId
 *   4. phase=halted and trading_paused=true
 */

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

describe.skipIf(!integrationEnabled)("integration: convert-to-btc-hold leaves clean books", () => {
  beforeEach(async () => {
    await resetIntegration();
    await stateWriter({ key: "paper_mode", value: true, changedBy: "test" });
    await stateWriter({ key: "starting_capital_paper_usd", value: 10_000, changedBy: "test" });
    await stateWriter({ key: "phase", value: "paper", changedBy: "test" });
    await stateWriter({ key: "trading_paused", value: false, changedBy: "test" });
    mockState.prices = { AERO: 0.45, LINK: 11.5, BTC: 80_000, ETH: 3000, SOL: 100 };
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  it("closes all positions with P&L, opens a backing btc_core, halts trading", async () => {
    const { executor } = await bootConstructExecutor();

    const aero = await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "open",
      direction: "long",
      entryPrice: "0.50",
      quantity: "100",
      entryTime: new Date(),
      strategyVersion: "3.0",
      paperMode: true,
    });
    await executor.placeLimitBuy("AERO", 0.5, 100, { relatedPositionId: aero.id });

    const link = await insertPosition({
      asset: "LINK",
      type: "alt_cycle",
      status: "open",
      direction: "long",
      entryPrice: "12.00",
      quantity: "10",
      entryTime: new Date(),
      strategyVersion: "3.0",
      paperMode: true,
    });
    await executor.placeLimitBuy("LINK", 12, 10, { relatedPositionId: link.id });

    expect(await openPositionsForCurrentMode()).toHaveLength(2);
    expect(await executor.getCashBalanceUsd()).toBeGreaterThan(9_000);

    const request = new Request("http://localhost/api/controls/convert-to-btc-hold", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        confirmedAgain: true,
        typedPhrase: "convert to BTC core hold",
      }),
    });

    const response = await convertToBtcHold(request);

    const body = (await response.json()) as {
      ok: boolean;
      closed: number;
      btcBuyResult: { quantity: number; price: number; positionId?: string } | null;
    };
    expect(body.ok).toBe(true);
    expect(body.closed).toBe(2);
    expect(body.btcBuyResult).not.toBeNull();
    expect(body.btcBuyResult!.positionId).toBeTruthy();

    // (1) Every prior position is closed with non-null exitPrice + P&L.
    const aeroAfter = (await positionsForCurrentMode()).find((p) => p.id === aero.id)!;
    expect(aeroAfter.status).toBe("closed");
    expect(Number(aeroAfter.exitPrice)).toBeCloseTo(0.45, 6);
    expect(aeroAfter.grossPnlUsd).not.toBeNull();
    expect(aeroAfter.feesUsd).not.toBeNull();
    expect(aeroAfter.netPnlUsd).not.toBeNull();
    // gross = (0.45 - 0.50) * 100 = -5
    expect(Number(aeroAfter.grossPnlUsd)).toBeCloseTo(-5, 6);
    expect(aeroAfter.exitReason).toBe("convert_to_btc_core_hold");

    const linkAfter = (await positionsForCurrentMode()).find((p) => p.id === link.id)!;
    expect(linkAfter.status).toBe("closed");
    expect(Number(linkAfter.exitPrice)).toBeCloseTo(11.5, 6);

    // (2) A new btc_core position row exists, open, with the BTC purchase qty.
    const allPositions = await positionsForCurrentMode();
    const btcCore = allPositions.find((p) => p.type === "btc_core");
    expect(btcCore).toBeDefined();
    expect(btcCore!.status).toBe("open");
    expect(btcCore!.id).toBe(body.btcBuyResult!.positionId!);
    expect(btcCore!.catalyst).toBe("convert_to_btc_core_hold");
    expect(Number(btcCore!.entryPrice)).toBeCloseTo(80_000, 6);
    expect(Number(btcCore!.quantity)).toBeGreaterThan(0);

    // (3) BTC dca_limit order is linked to the new position.
    const orders = await ordersForCurrentMode();
    const btcOrder = orders.find((o) => o.asset === "BTC" && o.type === "dca_limit");
    expect(btcOrder).toBeDefined();
    expect(btcOrder!.relatedPositionId).toBe(btcCore!.id);

    // (4) Phase + paused flipped to halted state.
    expect(await stateRead<string>("phase")).toBe("halted");
    expect(await stateRead<boolean>("trading_paused")).toBe(true);
  });

  it("rejects when triple-confirmation is missing", async () => {
    const request = new Request("http://localhost/api/controls/convert-to-btc-hold", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true, typedPhrase: "convert to BTC core hold" }),
    });
    const response = await convertToBtcHold(request);
    expect(response.status).toBe(400);
    expect(await stateRead<string>("phase")).toBe("paper");
  });
});
