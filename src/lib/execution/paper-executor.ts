import { randomUUID } from "crypto";
import {
  insertOrder,
  pendingOrdersForCurrentMode,
  orderByCoinbaseIdForCurrentMode,
  paperCashFlowsFromDb,
  updateOrder,
} from "@/lib/db/queries/orders";
import { errorLogger, stateRead } from "@/lib/db/utils";
import { log } from "@/lib/logger";
import { validateOrder } from "./validation";
import type { OrderExecutor, OrderResult, OrderStatus, PlaceOptions } from "./interface";

/**
 * Paper order executor.
 *
 * Per STRATEGY.md §13.2 + §13.6:
 * - Imports zero code from `live-executor.ts`
 * - **Never** makes a network call to Coinbase order/cancel/modification
 *   endpoints. The `coinbase/orders` module is forbidden by the CI lint
 *   rule for any file other than live-executor.ts.
 * - Reads real prices via the shared market-data module (price polling loop)
 * - Simulates fills using the actual Coinbase fee schedule (maker 0.4%, taker 0.6%)
 * - Writes to `orders` with `paper_mode = true`
 *
 * Fill semantics:
 * - Limit BUY (alt entry, DCA): assumed filled immediately at the limit
 *   price. Maker fee applied.
 * - Stop-limit SELL: stays pending until processPendingFills() detects the
 *   stop trigger has been crossed by the current price stream. Then filled
 *   at the limit price (or worse, but we use the limit for simplicity).
 *   Maker fee.
 * - Take-profit SELL: stays pending until processPendingFills() detects the
 *   limit price has been reached. Maker fee.
 * - Market exit: assumed filled immediately at the current price (caller
 *   passes a price hint). Taker fee.
 *
 * **Construction is gated** the same way as LiveExecutor — only the factory
 * may instantiate. This prevents test code accidentally using the paper
 * executor in a context where the live one was expected (and vice versa).
 */

const MAKER_FEE_PCT = 0.004; // 0.4%
const TAKER_FEE_PCT = 0.006; // 0.6%

export class PaperExecutor implements OrderExecutor {
  readonly mode = "paper" as const;

  protected constructor(_keyFromFactory: symbol) {
    void _keyFromFactory;
  }

  static __factoryConstructKey: symbol = Symbol("PaperExecutor.factory-only");

  static __constructFromFactory(key: symbol): PaperExecutor {
    if (key !== PaperExecutor.__factoryConstructKey) {
      throw new Error(
        "PaperExecutor must be constructed via execution/factory.ts only.",
      );
    }
    return new PaperExecutor(key);
  }

  // ---------------------------------------------------------------------
  // Order placement (every method writes to `orders` with paper_mode=true)
  // ---------------------------------------------------------------------

  async placeLimitBuy(
    asset: string,
    price: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    validateOrder({
      asset,
      positionType: "alt_cycle",
      notionalUsd: price * quantity,
      accountValueUsd: 0,
    });
    return this.simulatedFill({
      type: "entry_limit",
      asset,
      side: "buy",
      price,
      quantity,
      isMaker: true,
      relatedPositionId: options?.relatedPositionId,
    });
  }

  async placeStopLimit(
    asset: string,
    stopPrice: number,
    limitPrice: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    // Pending — fired later by processPendingFills().
    return this.simulatedPending({
      type: "stop_limit",
      asset,
      side: "sell",
      price: limitPrice,
      stopPrice,
      quantity,
      relatedPositionId: options?.relatedPositionId,
    });
  }

  async placeTakeProfit(
    asset: string,
    limitPrice: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    return this.simulatedPending({
      type: "take_profit",
      asset,
      side: "sell",
      price: limitPrice,
      stopPrice: undefined,
      quantity,
      relatedPositionId: options?.relatedPositionId,
    });
  }

  async placeMarketExit(
    asset: string,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    // Caller passes the price hint via a workaround: market exits in paper
    // mode use the most recent observed price. Since we don't fetch it here
    // (Phase 5 polling supplies prices to processPendingFills), we mark the
    // market exit as pending and let the next poll fill it. For immediate
    // simulated fills, callers who have a known price use placeLimitBuy /
    // placeTakeProfit shapes instead.
    return this.simulatedPending({
      type: "market_exit",
      asset,
      side: "sell",
      price: undefined,
      stopPrice: undefined,
      quantity,
      relatedPositionId: options?.relatedPositionId,
    });
  }

  async placeDcaLimitBuy(
    asset: string,
    price: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    validateOrder({
      asset,
      positionType: asset.toUpperCase() === "BTC" ? "btc_core" : "alt_cycle",
      notionalUsd: price * quantity,
      accountValueUsd: 0,
    });
    return this.simulatedFill({
      type: "dca_limit",
      asset,
      side: "buy",
      price,
      quantity,
      isMaker: false, // DCA accepts taker rate to ensure fill
      relatedPositionId: options?.relatedPositionId,
    });
  }

  async cancelOrder(coinbaseOrderId: string): Promise<void> {
    const row = await orderByCoinbaseIdForCurrentMode(coinbaseOrderId);
    if (!row) {
      log.warn("PaperExecutor.cancelOrder: no row found", { coinbaseOrderId });
      return;
    }
    // Defensive: the helper already mode-filtered, so paperMode must be true.
    if (row.paperMode !== true) {
      throw new Error(
        `PaperExecutor.cancelOrder: order ${coinbaseOrderId} is NOT paper-mode. Refusing to cancel.`,
      );
    }
    await updateOrder(row.id, { status: "cancelled", cancelReason: "paper_executor.cancelOrder" });
  }

  async getOrderStatus(coinbaseOrderId: string): Promise<OrderStatus> {
    const row = await orderByCoinbaseIdForCurrentMode(coinbaseOrderId);
    if (!row) {
      throw new Error(`PaperExecutor.getOrderStatus: no row found for ${coinbaseOrderId}`);
    }
    return {
      orderId: row.id,
      coinbaseOrderId,
      status: row.status,
      fillPrice: row.fillPrice ? parseFloat(row.fillPrice) : undefined,
      fillQuantity: row.fillQuantity ? parseFloat(row.fillQuantity) : undefined,
      filledAt: row.filledAt ?? undefined,
    };
  }

  // ---------------------------------------------------------------------
  // Phase 5 hook: process pending paper orders against current prices.
  // ---------------------------------------------------------------------

  /**
   * Called by the price polling loop (Phase 5). For each pending paper order,
   * checks if the current price would have triggered a fill, and updates the
   * order row accordingly.
   *
   * Returns the list of orders that filled this cycle (for the caller to
   * propagate fills to position state).
   */
  async processPendingFills(currentPrices: Record<string, number>): Promise<
    Array<{ orderId: string; coinbaseOrderId: string; fillPrice: number; quantity: number; asset: string; type: string }>
  > {
    const pending = await pendingOrdersForCurrentMode();
    const fills: Array<{
      orderId: string;
      coinbaseOrderId: string;
      fillPrice: number;
      quantity: number;
      asset: string;
      type: string;
    }> = [];

    for (const o of pending) {
      const price = currentPrices[o.asset.toUpperCase()];
      if (price == null) continue;

      const limitPrice = o.price ? parseFloat(o.price) : null;
      const quantity = parseFloat(o.quantity);

      let fillPrice: number | null = null;

      if (o.type === "stop_limit") {
        // For a sell stop-limit on a long: trigger when price <= stop, fill at limit.
        // We don't store stop_price separately on the orders row in the v3 schema —
        // the limit price IS the conservative fill estimate. Use it as the trigger.
        if (limitPrice != null && price <= limitPrice * 1.005) {
          fillPrice = Math.min(price, limitPrice);
        }
      } else if (o.type === "take_profit") {
        // For a sell TP: fill when price >= limit.
        if (limitPrice != null && price >= limitPrice) {
          fillPrice = Math.max(price, limitPrice);
        }
      } else if (o.type === "market_exit") {
        // Market exits fill at current price.
        fillPrice = price;
      } else if (o.type === "entry_limit" || o.type === "dca_limit") {
        // Buys with limit ≥ current ask fill immediately. We already simulate
        // those at place time, but if any slipped through, fill them here.
        if (limitPrice != null && price <= limitPrice) {
          fillPrice = Math.min(price, limitPrice);
        }
      }

      if (fillPrice != null) {
        const isMaker = o.type === "stop_limit" || o.type === "take_profit" || o.type === "entry_limit";
        const feeUsd = fillPrice * quantity * (isMaker ? MAKER_FEE_PCT : TAKER_FEE_PCT);
        const filled = await updateOrder(o.id, {
          status: "filled",
          fillPrice: fillPrice.toString(),
          fillQuantity: quantity.toString(),
          filledAt: new Date(),
        });
        if (filled) {
          fills.push({
            orderId: filled.id,
            coinbaseOrderId: filled.coinbaseOrderId,
            fillPrice,
            quantity,
            asset: filled.asset,
            type: filled.type,
          });
          log.info("Paper order filled", {
            coinbaseOrderId: filled.coinbaseOrderId,
            type: filled.type,
            asset: filled.asset,
            fillPrice,
            quantity,
            feeUsd,
          });
        }
      }
    }

    return fills;
  }

  // ---------------------------------------------------------------------
  // Cash balance — derived from filled-order cash flows + starting capital.
  // ---------------------------------------------------------------------

  async getCashBalanceUsd(): Promise<number> {
    const startingCapital =
      (await stateRead<number>("starting_capital_paper_usd")) ?? 0;
    const { outflow, inflow } = await paperCashFlowsFromDb();
    return startingCapital + inflow - outflow;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async simulatedFill(spec: {
    type: "entry_limit" | "dca_limit" | "market_exit" | "take_profit";
    asset: string;
    side: "buy" | "sell";
    price: number;
    quantity: number;
    isMaker: boolean;
    relatedPositionId?: string;
  }): Promise<OrderResult> {
    const cbId = `paper-${randomUUID()}`;
    const feeUsd = spec.price * spec.quantity * (spec.isMaker ? MAKER_FEE_PCT : TAKER_FEE_PCT);
    const now = new Date();

    const dbRow = await insertOrder({
      coinbaseOrderId: cbId,
      type: spec.type,
      asset: spec.asset.toUpperCase(),
      side: spec.side,
      price: spec.price.toString(),
      quantity: spec.quantity.toString(),
      status: "filled",
      relatedPositionId: spec.relatedPositionId ?? null,
      placedAt: now,
      filledAt: now,
      fillPrice: spec.price.toString(),
      fillQuantity: spec.quantity.toString(),
      paperMode: true,
    });

    log.info("Paper order simulated-filled at place time", {
      coinbaseOrderId: cbId,
      type: spec.type,
      asset: spec.asset,
      side: spec.side,
      quantity: spec.quantity,
      price: spec.price,
      feeUsd,
    });

    return {
      orderId: dbRow.id,
      coinbaseOrderId: cbId,
      status: "filled",
      asset: spec.asset.toUpperCase(),
      side: spec.side,
      price: spec.price,
      quantity: spec.quantity,
      fillPrice: spec.price,
      fillQuantity: spec.quantity,
      filledAt: now,
      feesUsd: feeUsd,
    };
  }

  private async simulatedPending(spec: {
    type: "stop_limit" | "take_profit" | "market_exit";
    asset: string;
    side: "buy" | "sell";
    price: number | undefined;
    stopPrice: number | undefined;
    quantity: number;
    relatedPositionId?: string;
  }): Promise<OrderResult> {
    const cbId = `paper-${randomUUID()}`;
    const dbRow = await insertOrder({
      coinbaseOrderId: cbId,
      type: spec.type,
      asset: spec.asset.toUpperCase(),
      side: spec.side,
      price: spec.price?.toString() ?? null,
      quantity: spec.quantity.toString(),
      status: "pending",
      relatedPositionId: spec.relatedPositionId ?? null,
      placedAt: new Date(),
      paperMode: true,
    });

    log.info("Paper order recorded as pending", {
      coinbaseOrderId: cbId,
      type: spec.type,
      asset: spec.asset,
      quantity: spec.quantity,
      price: spec.price,
      stopPrice: spec.stopPrice,
    });

    return {
      orderId: dbRow.id,
      coinbaseOrderId: cbId,
      status: "pending",
      asset: spec.asset.toUpperCase(),
      side: spec.side,
      price: spec.price,
      quantity: spec.quantity,
    };
  }
}

// Mark error logger import as intentional even if not used in current paths.
void errorLogger;
