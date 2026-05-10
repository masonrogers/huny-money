import { describe, it, expect } from "vitest";
import {
  summarizePaperCashFlows,
  summarizeFilledSellQtyByPosition,
  summarizeFilledOrderFees,
} from "@/lib/db/queries/orders";
import type { Order } from "@/lib/db/schema";

/**
 * Tests for summarizePaperCashFlows — the pure summarizer over filled paper
 * orders that powers PaperExecutor.getCashBalanceUsd(). The fee schedule
 * MUST match paper-executor.ts (maker 0.4% / taker 0.6%) or the equity curve
 * silently disagrees with the audit trail.
 *
 * Maker-rate types: entry_limit, stop_limit, take_profit
 * Taker-rate types: dca_limit, market_exit
 */

const baseRow = (overrides: Partial<Order>): Order =>
  ({
    id: "id",
    coinbaseOrderId: "cb",
    type: "entry_limit",
    asset: "BTC",
    side: "buy",
    price: "100",
    quantity: "1",
    status: "filled",
    relatedPositionId: null,
    placedAt: new Date(),
    filledAt: new Date(),
    fillPrice: "100",
    fillQuantity: "1",
    cancelReason: null,
    paperMode: true,
    ...overrides,
  }) as Order;

describe("summarizePaperCashFlows", () => {
  it("returns zero on empty input", () => {
    expect(summarizePaperCashFlows([])).toEqual({ outflow: 0, inflow: 0 });
  });

  it("ignores pending and cancelled orders", () => {
    const rows: Order[] = [
      baseRow({ status: "pending" }),
      baseRow({ status: "cancelled" }),
    ];
    expect(summarizePaperCashFlows(rows)).toEqual({ outflow: 0, inflow: 0 });
  });

  it("a maker-rate buy outflows price*qty + 0.4% fee", () => {
    const rows: Order[] = [
      baseRow({
        type: "entry_limit",
        side: "buy",
        fillPrice: "100",
        fillQuantity: "2",
      }),
    ];
    const { outflow, inflow } = summarizePaperCashFlows(rows);
    expect(outflow).toBeCloseTo(200 * 1.004, 8);
    expect(inflow).toBe(0);
  });

  it("a taker-rate buy (dca_limit) uses 0.6% fee", () => {
    const rows: Order[] = [
      baseRow({
        type: "dca_limit",
        side: "buy",
        fillPrice: "50",
        fillQuantity: "10",
      }),
    ];
    const { outflow } = summarizePaperCashFlows(rows);
    expect(outflow).toBeCloseTo(500 * 1.006, 8);
  });

  it("a maker-rate sell (take_profit) inflows price*qty − 0.4% fee", () => {
    const rows: Order[] = [
      baseRow({
        type: "take_profit",
        side: "sell",
        fillPrice: "120",
        fillQuantity: "1",
      }),
    ];
    const { inflow, outflow } = summarizePaperCashFlows(rows);
    expect(inflow).toBeCloseTo(120 * 0.996, 8);
    expect(outflow).toBe(0);
  });

  it("a taker-rate sell (market_exit) uses 0.6% fee", () => {
    const rows: Order[] = [
      baseRow({
        type: "market_exit",
        side: "sell",
        fillPrice: "80",
        fillQuantity: "5",
      }),
    ];
    const { inflow } = summarizePaperCashFlows(rows);
    expect(inflow).toBeCloseTo(400 * 0.994, 8);
  });

  it("buy then sell at the same price nets to roughly zero P&L (just fees)", () => {
    // Round-trip @ 100 × 1 unit, both maker.
    const rows: Order[] = [
      baseRow({ type: "entry_limit", side: "buy", fillPrice: "100", fillQuantity: "1" }),
      baseRow({ type: "take_profit", side: "sell", fillPrice: "100", fillQuantity: "1" }),
    ];
    const { outflow, inflow } = summarizePaperCashFlows(rows);
    const net = inflow - outflow;
    // Two maker fees on $100 = -$0.80 round-trip cost.
    expect(net).toBeCloseTo(-0.8, 6);
  });

  it("falls back to price/quantity when fillPrice/fillQuantity missing", () => {
    const rows: Order[] = [
      baseRow({
        type: "entry_limit",
        side: "buy",
        fillPrice: null,
        fillQuantity: null,
        price: "100",
        quantity: "1",
      }),
    ];
    const { outflow } = summarizePaperCashFlows(rows);
    expect(outflow).toBeCloseTo(100 * 1.004, 8);
  });

  it("skips rows with non-numeric fill data", () => {
    const rows: Order[] = [
      baseRow({ fillPrice: "not-a-number", fillQuantity: "1" }),
      baseRow({ fillPrice: "100", fillQuantity: "abc" }),
    ];
    expect(summarizePaperCashFlows(rows)).toEqual({ outflow: 0, inflow: 0 });
  });
});

describe("summarizeFilledSellQtyByPosition", () => {
  it("returns an empty map on empty input", () => {
    expect(summarizeFilledSellQtyByPosition([])).toEqual(new Map());
  });

  it("aggregates fillQuantity by positionId", () => {
    const rows = [
      { positionId: "p1", qty: "2", status: "filled", side: "sell" },
      { positionId: "p1", qty: "3", status: "filled", side: "sell" },
      { positionId: "p2", qty: "5", status: "filled", side: "sell" },
    ];
    const map = summarizeFilledSellQtyByPosition(rows);
    expect(map.get("p1")).toBeCloseTo(5, 8);
    expect(map.get("p2")).toBeCloseTo(5, 8);
  });

  it("ignores rows without a positionId or fillQuantity", () => {
    const rows = [
      { positionId: null, qty: "100", status: "filled", side: "sell" },
      { positionId: "p1", qty: null, status: "filled", side: "sell" },
    ];
    expect(summarizeFilledSellQtyByPosition(rows)).toEqual(new Map());
  });

  it("ignores non-sell rows when side is provided", () => {
    const rows = [
      { positionId: "p1", qty: "1", status: "filled", side: "buy" },
      { positionId: "p1", qty: "2", status: "filled", side: "sell" },
    ];
    const map = summarizeFilledSellQtyByPosition(rows);
    expect(map.get("p1")).toBeCloseTo(2, 8);
  });

  it("ignores pending rows when status is provided", () => {
    const rows = [
      { positionId: "p1", qty: "1", status: "pending", side: "sell" },
      { positionId: "p1", qty: "2", status: "filled", side: "sell" },
    ];
    const map = summarizeFilledSellQtyByPosition(rows);
    expect(map.get("p1")).toBeCloseTo(2, 8);
  });

  it("ignores zero, negative, and non-finite quantities", () => {
    const rows = [
      { positionId: "p1", qty: "0", status: "filled", side: "sell" },
      { positionId: "p1", qty: "-3", status: "filled", side: "sell" },
      { positionId: "p1", qty: "abc", status: "filled", side: "sell" },
      { positionId: "p1", qty: "2.5", status: "filled", side: "sell" },
    ];
    const map = summarizeFilledSellQtyByPosition(rows);
    expect(map.get("p1")).toBeCloseTo(2.5, 8);
  });
});

describe("summarizeFilledOrderFees", () => {
  it("returns 0 on empty input", () => {
    expect(summarizeFilledOrderFees([])).toBe(0);
  });

  it("sums feesUsd across filled rows", () => {
    const rows = [
      { status: "filled", feesUsd: "0.40" },
      { status: "filled", feesUsd: "0.60" },
    ];
    expect(summarizeFilledOrderFees(rows)).toBeCloseTo(1.0, 8);
  });

  it("ignores non-filled rows", () => {
    const rows = [
      { status: "pending", feesUsd: "0.40" },
      { status: "cancelled", feesUsd: "0.50" },
      { status: "filled", feesUsd: "0.60" },
    ];
    expect(summarizeFilledOrderFees(rows)).toBeCloseTo(0.6, 8);
  });

  it("ignores rows with null feesUsd (e.g., live pending fills not yet reconciled)", () => {
    const rows = [
      { status: "filled", feesUsd: null },
      { status: "filled", feesUsd: "0.50" },
    ];
    expect(summarizeFilledOrderFees(rows)).toBeCloseTo(0.5, 8);
  });

  it("ignores non-finite fees", () => {
    const rows = [
      { status: "filled", feesUsd: "not-a-number" },
      { status: "filled", feesUsd: "1.25" },
    ];
    expect(summarizeFilledOrderFees(rows)).toBeCloseTo(1.25, 8);
  });
});
