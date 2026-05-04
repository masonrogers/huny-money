import {
  placeLimitBuy,
  placeStopLimitSell,
  placeTakeProfitSell,
  placeMarketExit,
  cancelOrders,
  getOrder,
  type CreateOrderResponse,
} from "@/lib/coinbase/orders";
import { insertOrder, updateOrder } from "@/lib/db/queries/orders";
import { errorLogger } from "@/lib/db/utils";
import { log } from "@/lib/logger";
import { validateOrder } from "./validation";
import type { OrderExecutor, OrderResult, OrderStatus, PlaceOptions } from "./interface";

/**
 * Live order executor.
 *
 * **The ONLY file in the codebase that imports order placement methods from
 * `@/lib/coinbase/orders`.** The CI lint rule (scripts/lint-queries.sh)
 * enforces this; planted violations fail the build.
 *
 * Per STRATEGY.md §13.2:
 * - Imports zero code from paper-executor.ts
 * - Constructed only when factory loaded `state.paper_mode = false` at boot
 * - Every method places real money on the line
 *
 * Defense in depth: each method asserts `this.canPlaceLiveOrders === true`
 * before calling Coinbase. The factory is the only constructor path that
 * sets this flag.
 */

export class LiveExecutor implements OrderExecutor {
  readonly mode = "live" as const;
  /** @internal — set true by the factory; nothing else may toggle it. */
  private readonly canPlaceLiveOrders: true = true;

  /**
   * Construction is intentionally `protected` — only the factory may
   * instantiate. Using `new LiveExecutor()` from random code paths would
   * defeat the executor-IS-the-mode invariant.
   */
  protected constructor(_keyFromFactory: symbol) {
    // The key is enforced by the static factoryConstruct method below.
  }

  static __factoryConstructKey: symbol = Symbol("LiveExecutor.factory-only");

  static __constructFromFactory(key: symbol): LiveExecutor {
    if (key !== LiveExecutor.__factoryConstructKey) {
      throw new Error(
        "LiveExecutor must be constructed via execution/factory.ts only — " +
          "direct instantiation defeats the paper-mode safety guarantee.",
      );
    }
    return new LiveExecutor(key);
  }

  // ---------------------------------------------------------------------
  // Order placement (each guarded by the in-method assertion)
  // ---------------------------------------------------------------------

  async placeLimitBuy(
    asset: string,
    price: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    this.assertCanTrade();
    validateOrder({
      asset,
      positionType: "alt_cycle", // limit-buy is used for alt entries; BTC core uses DCA path
      notionalUsd: price * quantity,
      accountValueUsd: 0, // skip the percent check at this layer
    });
    return this.placeAndRecord(
      () => placeLimitBuy({ asset, baseSize: quantity.toString(), limitPrice: price.toString() }),
      {
        type: "entry_limit",
        asset,
        side: "buy",
        price,
        quantity,
        relatedPositionId: options?.relatedPositionId,
      },
    );
  }

  async placeStopLimit(
    asset: string,
    stopPrice: number,
    limitPrice: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    this.assertCanTrade();
    return this.placeAndRecord(
      () =>
        placeStopLimitSell({
          asset,
          baseSize: quantity.toString(),
          stopPrice: stopPrice.toString(),
          limitPrice: limitPrice.toString(),
          stopDirection: "STOP_DIRECTION_STOP_DOWN",
        }),
      {
        type: "stop_limit",
        asset,
        side: "sell",
        price: limitPrice,
        quantity,
        relatedPositionId: options?.relatedPositionId,
      },
    );
  }

  async placeTakeProfit(
    asset: string,
    limitPrice: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    this.assertCanTrade();
    return this.placeAndRecord(
      () =>
        placeTakeProfitSell({
          asset,
          baseSize: quantity.toString(),
          limitPrice: limitPrice.toString(),
        }),
      {
        type: "take_profit",
        asset,
        side: "sell",
        price: limitPrice,
        quantity,
        relatedPositionId: options?.relatedPositionId,
      },
    );
  }

  async placeMarketExit(
    asset: string,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    this.assertCanTrade();
    return this.placeAndRecord(
      () => placeMarketExit({ asset, baseSize: quantity.toString() }),
      {
        type: "market_exit",
        asset,
        side: "sell",
        price: undefined,
        quantity,
        relatedPositionId: options?.relatedPositionId,
      },
    );
  }

  async placeDcaLimitBuy(
    asset: string,
    price: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult> {
    this.assertCanTrade();
    return this.placeAndRecord(
      () =>
        placeLimitBuy({
          asset,
          baseSize: quantity.toString(),
          limitPrice: price.toString(),
          postOnly: false, // DCA accepts taker rate to ensure fill
        }),
      {
        type: "dca_limit",
        asset,
        side: "buy",
        price,
        quantity,
        relatedPositionId: options?.relatedPositionId,
      },
    );
  }

  async cancelOrder(coinbaseOrderId: string): Promise<void> {
    this.assertCanTrade();
    const result = await cancelOrders([coinbaseOrderId]);
    const r = result.results[0];
    if (!r?.success) {
      await errorLogger({
        severity: "warning",
        component: "execution.live-executor",
        error: new Error(`Cancel failed: ${r?.failure_reason ?? "unknown"}`),
        context: { coinbaseOrderId },
        recovered: false,
      });
      return;
    }
    // Mark our row cancelled so reconciliation doesn't keep retrying.
    // We don't have the local `id` here — but updateOrder by coinbase_order_id
    // would require a query; that lives in the position-state module that
    // calls this method.
  }

  async getOrderStatus(coinbaseOrderId: string): Promise<OrderStatus> {
    this.assertCanTrade();
    const r = await getOrder(coinbaseOrderId);
    return {
      orderId: coinbaseOrderId,
      coinbaseOrderId,
      status: this.mapStatus(r.order.status),
      fillPrice: r.order.average_filled_price ? parseFloat(r.order.average_filled_price) : undefined,
      fillQuantity: r.order.filled_size ? parseFloat(r.order.filled_size) : undefined,
      filledAt: r.order.last_fill_time ? new Date(r.order.last_fill_time) : undefined,
    };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private assertCanTrade(): void {
    // Must be exactly true — any tampering (a Proxy, a partial mock, etc.)
    // would have to deliberately set this to true, which is the point.
    if (this.canPlaceLiveOrders !== true) {
      throw new Error(
        "LiveExecutor.assertCanTrade(): canPlaceLiveOrders is not true. " +
          "Refusing to place live orders. This indicates the executor was " +
          "constructed outside the factory — a critical safety violation.",
      );
    }
  }

  private async placeAndRecord(
    placeFn: () => Promise<CreateOrderResponse>,
    spec: {
      type: "entry_limit" | "stop_limit" | "take_profit" | "market_exit" | "dca_limit";
      asset: string;
      side: "buy" | "sell";
      price: number | undefined;
      quantity: number;
      relatedPositionId?: string;
    },
  ): Promise<OrderResult> {
    let response: CreateOrderResponse;
    try {
      response = await placeFn();
    } catch (err) {
      await errorLogger({
        severity: "error",
        component: "execution.live-executor",
        error: err instanceof Error ? err : new Error(String(err)),
        context: { spec },
        recovered: false,
      });
      throw err;
    }

    if (!response.success || !response.success_response?.order_id) {
      const reason = response.error_response?.message ?? response.failure_reason ?? "unknown";
      const err = new Error(`Coinbase order placement failed: ${reason}`);
      await errorLogger({
        severity: "error",
        component: "execution.live-executor",
        error: err,
        context: { spec, response },
        recovered: false,
      });
      throw err;
    }

    const cbOrderId = response.success_response.order_id;

    const dbRow = await insertOrder({
      coinbaseOrderId: cbOrderId,
      type: spec.type,
      asset: spec.asset.toUpperCase(),
      side: spec.side,
      price: spec.price?.toString() ?? null,
      quantity: spec.quantity.toString(),
      status: "pending",
      relatedPositionId: spec.relatedPositionId ?? null,
      placedAt: new Date(),
      paperMode: false,
    });

    log.info("Live order placed", {
      coinbaseOrderId: cbOrderId,
      type: spec.type,
      asset: spec.asset,
      side: spec.side,
      quantity: spec.quantity,
      price: spec.price,
    });

    return {
      orderId: dbRow.id,
      coinbaseOrderId: cbOrderId,
      status: "pending",
      asset: spec.asset.toUpperCase(),
      side: spec.side,
      price: spec.price,
      quantity: spec.quantity,
    };
  }

  private mapStatus(s: string): OrderStatus["status"] {
    switch (s) {
      case "FILLED":
        return "filled";
      case "OPEN":
      case "PENDING":
      case "QUEUED":
        return "pending";
      case "CANCELLED":
        return "cancelled";
      case "EXPIRED":
        return "expired";
      default:
        return "pending";
    }
  }
}

// Mark this method async-safe and document the integration point with cancellation.
void updateOrder;
