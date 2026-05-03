import crypto from 'crypto';
import { coinbaseRequest } from './client';
import type {
  OrderSide,
  OrderConfiguration,
  PlaceOrderRequest,
  PlaceOrderResponse,
  Order,
  GetOrderResponse,
  ListOrdersParams,
  ListOrdersResponse,
  CancelOrdersResponse,
} from './types';

// ─── Order Placement ───────────────────────────────────────────────────────

export interface PlaceLimitOrderParams {
  productId: string;
  side: OrderSide;
  baseSize: string;
  limitPrice: string;
  postOnly?: boolean;
  clientOrderId?: string;
}

export interface PlaceMarketOrderParams {
  productId: string;
  side: OrderSide;
  /** For BUY: amount in quote currency (USD). For SELL: amount in base currency. */
  quoteSize?: string;
  baseSize?: string;
  clientOrderId?: string;
}

export interface PlaceStopLimitOrderParams {
  productId: string;
  side: OrderSide;
  baseSize: string;
  limitPrice: string;
  stopPrice: string;
  /** STOP_DOWN = triggers when price falls below stop. STOP_UP = triggers when price rises above stop. */
  stopDirection: 'STOP_DIRECTION_STOP_DOWN' | 'STOP_DIRECTION_STOP_UP';
  clientOrderId?: string;
}

/**
 * Place an order on Coinbase Advanced Trade.
 *
 * POST /api/v3/brokerage/orders
 *
 * This is the low-level method. Prefer the typed helpers below.
 */
export async function placeOrder(
  params: PlaceOrderRequest,
): Promise<PlaceOrderResponse> {
  return coinbaseRequest<PlaceOrderResponse>({
    method: 'POST',
    path: '/api/v3/brokerage/orders',
    body: params as unknown as Record<string, unknown>,
  });
}

/**
 * Place a limit order (Good-Till-Cancelled).
 *
 * Used for entry orders, take-profit orders, and DCA entries.
 */
export async function placeLimitOrder(
  params: PlaceLimitOrderParams,
): Promise<PlaceOrderResponse> {
  const orderConfig: OrderConfiguration = {
    limit_limit_gtc: {
      base_size: params.baseSize,
      limit_price: params.limitPrice,
      post_only: params.postOnly ?? false,
    },
  };

  return placeOrder({
    client_order_id: params.clientOrderId ?? crypto.randomUUID(),
    product_id: params.productId,
    side: params.side,
    order_configuration: orderConfig,
  });
}

/**
 * Place a market order (Immediate-Or-Cancel).
 *
 * Used for emergency exits, DCA fallbacks, and partial-fill cleanup.
 */
export async function placeMarketOrder(
  params: PlaceMarketOrderParams,
): Promise<PlaceOrderResponse> {
  const marketConfig: { quote_size?: string; base_size?: string } = {};
  if (params.quoteSize) {
    marketConfig.quote_size = params.quoteSize;
  }
  if (params.baseSize) {
    marketConfig.base_size = params.baseSize;
  }

  const orderConfig: OrderConfiguration = {
    market_market_ioc: marketConfig,
  };

  return placeOrder({
    client_order_id: params.clientOrderId ?? crypto.randomUUID(),
    product_id: params.productId,
    side: params.side,
    order_configuration: orderConfig,
  });
}

/**
 * Place a stop-limit order (Good-Till-Cancelled).
 *
 * Used for stop-loss orders. The stop triggers at stopPrice, then a limit order
 * is placed at limitPrice.
 *
 * For stop-loss on a long position:
 *   - side: SELL
 *   - stopDirection: STOP_DIRECTION_STOP_DOWN (triggers when price falls)
 *   - limitPrice should be slightly below stopPrice to ensure fill in fast markets
 *
 * For stop-loss on a short position (not used in this system):
 *   - side: BUY
 *   - stopDirection: STOP_DIRECTION_STOP_UP
 */
export async function placeStopLimitOrder(
  params: PlaceStopLimitOrderParams,
): Promise<PlaceOrderResponse> {
  const orderConfig: OrderConfiguration = {
    stop_limit_stop_limit_gtc: {
      base_size: params.baseSize,
      limit_price: params.limitPrice,
      stop_price: params.stopPrice,
      stop_direction: params.stopDirection,
    },
  };

  return placeOrder({
    client_order_id: params.clientOrderId ?? crypto.randomUUID(),
    product_id: params.productId,
    side: params.side,
    order_configuration: orderConfig,
  });
}

// ─── Order Queries ─────────────────────────────────────────────────────────

/**
 * Get details for a specific order by its Coinbase order ID.
 *
 * GET /api/v3/brokerage/orders/historical/{order_id}
 *
 * Used during reconciliation to check the actual status of pending orders.
 */
export async function getOrder(orderId: string): Promise<Order> {
  const response = await coinbaseRequest<GetOrderResponse>({
    method: 'GET',
    path: `/api/v3/brokerage/orders/historical/${orderId}`,
  });

  return response.order;
}

/**
 * List historical orders with optional filters.
 *
 * GET /api/v3/brokerage/orders/historical
 *
 * Handles pagination. Returns all matching orders up to the specified limit.
 */
export async function listOrders(
  params: ListOrdersParams = {},
): Promise<Order[]> {
  const allOrders: Order[] = [];
  let cursor: string | undefined = params.cursor;
  const maxResults = params.limit ?? 1000;

  do {
    const queryParams: Record<string, string | string[] | number | undefined> = {
      limit: String(Math.min(maxResults - allOrders.length, 250)),
    };

    if (params.product_id) queryParams.product_id = params.product_id;
    if (params.order_status) queryParams.order_status = params.order_status;
    if (params.start_date) queryParams.start_date = params.start_date;
    if (params.end_date) queryParams.end_date = params.end_date;
    if (params.order_type) queryParams.order_type = params.order_type;
    if (params.order_side) queryParams.order_side = params.order_side;
    if (params.product_type) queryParams.product_type = params.product_type;
    if (params.order_placement_source) queryParams.order_placement_source = params.order_placement_source;
    if (params.sort_by) queryParams.sort_by = params.sort_by;
    if (cursor) queryParams.cursor = cursor;

    const response = await coinbaseRequest<ListOrdersResponse>({
      method: 'GET',
      path: '/api/v3/brokerage/orders/historical',
      params: queryParams,
    });

    allOrders.push(...response.orders);

    cursor = response.has_next ? response.cursor : undefined;
  } while (cursor && allOrders.length < maxResults);

  return allOrders;
}

// ─── Order Cancellation ────────────────────────────────────────────────────

/**
 * Cancel one or more orders by their Coinbase order IDs.
 *
 * POST /api/v3/brokerage/orders/batch_cancel
 *
 * Returns results for each order indicating success or failure.
 */
export async function cancelOrders(
  orderIds: string[],
): Promise<CancelOrdersResponse> {
  return coinbaseRequest<CancelOrdersResponse>({
    method: 'POST',
    path: '/api/v3/brokerage/orders/batch_cancel',
    body: { order_ids: orderIds },
  });
}
