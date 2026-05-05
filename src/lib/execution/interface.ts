/**
 * The OrderExecutor interface.
 *
 * Per STRATEGY.md §13.2, the function that places a real Coinbase order is
 * physically distinct from the function that simulates one. They share THIS
 * interface; their implementations live in `live-executor.ts` and
 * `paper-executor.ts` respectively, and neither file imports anything from
 * the other.
 *
 * The factory (factory.ts) reads `state.paper_mode` ONCE at boot and returns
 * one executor for the session's lifetime. The rest of the codebase holds a
 * typed OrderExecutor reference. The mode flag is never re-read at runtime —
 * **the executor object IS the mode**.
 */

export type Asset = string;

export interface OrderResult {
  orderId: string;
  coinbaseOrderId: string;
  status: "pending" | "filled" | "partially_filled" | "cancelled" | "expired";
  asset: Asset;
  side: "buy" | "sell";
  /** Limit price (or stop-limit limit). Undefined for market orders. */
  price?: number;
  quantity: number;
  /** When did the order fill (if it did)? */
  fillPrice?: number;
  fillQuantity?: number;
  filledAt?: Date;
  /** Fees paid (USD) on this fill. */
  feesUsd?: number;
}

export interface OrderStatus {
  orderId: string;
  coinbaseOrderId: string;
  status: "pending" | "filled" | "partially_filled" | "cancelled" | "expired";
  fillPrice?: number;
  fillQuantity?: number;
  filledAt?: Date;
}

export interface PlaceOptions {
  /** Position id this order belongs to (links order → position). */
  relatedPositionId?: string;
}

export interface OrderExecutor {
  /**
   * The mode this executor was constructed for. Read for debugging/logging
   * only — production code should never branch on mode. If you find yourself
   * checking `executor.mode === 'paper'` to decide behavior, you are
   * violating §13.2's "executor IS the mode" rule. Use the executor's
   * methods directly.
   */
  readonly mode: "paper" | "live";

  /** Buy at a limit price. Maker order. */
  placeLimitBuy(
    asset: Asset,
    price: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult>;

  /** Stop-limit SELL: triggers at stopPrice, places limit at limitPrice. */
  placeStopLimit(
    asset: Asset,
    stopPrice: number,
    limitPrice: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult>;

  /** Take-profit SELL: limit order at the target. */
  placeTakeProfit(
    asset: Asset,
    limitPrice: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult>;

  /** Emergency exit: market sell at current bid. */
  placeMarketExit(
    asset: Asset,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult>;

  /** DCA leg: limit buy near current ask, falls through to market after timeout. */
  placeDcaLimitBuy(
    asset: Asset,
    price: number,
    quantity: number,
    options?: PlaceOptions,
  ): Promise<OrderResult>;

  cancelOrder(coinbaseOrderId: string): Promise<void>;

  getOrderStatus(coinbaseOrderId: string): Promise<OrderStatus>;

  /**
   * Called by the price-polling loop on each 5-min tick.
   *
   * Paper executor: scans pending stop-limit / take-profit / market_exit
   * orders and fills them against the supplied prices, returning the list
   * of fills that landed this cycle.
   *
   * Live executor: no-op. Real Coinbase fills happen server-side and are
   * discovered by reconciliation against `getOrderStatus`.
   */
  processPendingFills(currentPrices: Record<string, number>): Promise<
    Array<{
      orderId: string;
      coinbaseOrderId: string;
      fillPrice: number;
      quantity: number;
      asset: string;
      type: string;
    }>
  >;
}
