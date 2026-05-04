import crypto from "crypto";
import { coinbaseRequest } from "./client";

/**
 * Low-level Coinbase Advanced Trade order endpoints.
 *
 * **CRITICAL**: per STRATEGY.md §13.2 + the CI lint rule, this file MUST
 * only be imported from `src/lib/execution/live-executor.ts`. Importing it
 * elsewhere is a build failure.
 *
 * The intent: only ONE file in the codebase has the ability to actually
 * place real orders on Coinbase. That file (live-executor.ts) is wrapped
 * by the executor factory which loads paper-mode-state at boot. If we are
 * in paper mode, the live-executor is never instantiated and these
 * functions never run.
 */

// ---------------------------------------------------------------------------
// Endpoint shapes
// ---------------------------------------------------------------------------

interface CreateOrderResponse {
  success: boolean;
  failure_reason?: string;
  order_id?: string;
  success_response?: {
    order_id: string;
    product_id: string;
    side: "BUY" | "SELL";
    client_order_id: string;
  };
  error_response?: {
    error: string;
    message: string;
    error_details?: string;
  };
}

interface GetOrderResponse {
  order: {
    order_id: string;
    product_id: string;
    user_id: string;
    side: "BUY" | "SELL";
    status:
      | "OPEN"
      | "FILLED"
      | "CANCELLED"
      | "EXPIRED"
      | "FAILED"
      | "PENDING"
      | "QUEUED"
      | "UNKNOWN_ORDER_STATUS";
    average_filled_price: string;
    filled_size: string;
    filled_value: string;
    completion_percentage: string;
    created_time: string;
    last_fill_time?: string;
    total_fees: string;
  };
}

interface CancelOrdersResponse {
  results: Array<{
    success: boolean;
    failure_reason?: string;
    order_id: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientOrderId(): string {
  return crypto.randomUUID();
}

function productId(asset: string): string {
  return `${asset.toUpperCase()}-USD`;
}

// ---------------------------------------------------------------------------
// Limit BUY (good-till-cancelled)
// ---------------------------------------------------------------------------

export interface PlaceLimitBuyParams {
  asset: string;
  baseSize: string; // quantity in base currency, e.g., "0.0029"
  limitPrice: string;
  postOnly?: boolean;
}

export async function placeLimitBuy(p: PlaceLimitBuyParams): Promise<CreateOrderResponse> {
  return coinbaseRequest<CreateOrderResponse>({
    method: "POST",
    path: "/api/v3/brokerage/orders",
    body: {
      client_order_id: clientOrderId(),
      product_id: productId(p.asset),
      side: "BUY",
      order_configuration: {
        limit_limit_gtc: {
          base_size: p.baseSize,
          limit_price: p.limitPrice,
          post_only: p.postOnly ?? true,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Stop-limit SELL (good-till-cancelled)
// ---------------------------------------------------------------------------

export interface PlaceStopLimitSellParams {
  asset: string;
  baseSize: string;
  stopPrice: string;
  limitPrice: string;
  /** STOP_DOWN for stop-loss on a long position (price falling triggers). */
  stopDirection: "STOP_DIRECTION_STOP_DOWN" | "STOP_DIRECTION_STOP_UP";
}

export async function placeStopLimitSell(
  p: PlaceStopLimitSellParams,
): Promise<CreateOrderResponse> {
  return coinbaseRequest<CreateOrderResponse>({
    method: "POST",
    path: "/api/v3/brokerage/orders",
    body: {
      client_order_id: clientOrderId(),
      product_id: productId(p.asset),
      side: "SELL",
      order_configuration: {
        stop_limit_stop_limit_gtc: {
          base_size: p.baseSize,
          limit_price: p.limitPrice,
          stop_price: p.stopPrice,
          stop_direction: p.stopDirection,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Take-profit limit SELL (good-till-cancelled)
// ---------------------------------------------------------------------------

export interface PlaceTakeProfitParams {
  asset: string;
  baseSize: string;
  limitPrice: string;
}

export async function placeTakeProfitSell(
  p: PlaceTakeProfitParams,
): Promise<CreateOrderResponse> {
  return coinbaseRequest<CreateOrderResponse>({
    method: "POST",
    path: "/api/v3/brokerage/orders",
    body: {
      client_order_id: clientOrderId(),
      product_id: productId(p.asset),
      side: "SELL",
      order_configuration: {
        limit_limit_gtc: {
          base_size: p.baseSize,
          limit_price: p.limitPrice,
          post_only: false,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Market exit (immediate-or-cancel SELL)
// ---------------------------------------------------------------------------

export interface PlaceMarketExitParams {
  asset: string;
  baseSize: string;
}

export async function placeMarketExit(p: PlaceMarketExitParams): Promise<CreateOrderResponse> {
  return coinbaseRequest<CreateOrderResponse>({
    method: "POST",
    path: "/api/v3/brokerage/orders",
    body: {
      client_order_id: clientOrderId(),
      product_id: productId(p.asset),
      side: "SELL",
      order_configuration: {
        market_market_ioc: {
          base_size: p.baseSize,
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelOrders(orderIds: string[]): Promise<CancelOrdersResponse> {
  return coinbaseRequest<CancelOrdersResponse>({
    method: "POST",
    path: "/api/v3/brokerage/orders/batch_cancel",
    body: { order_ids: orderIds },
  });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function getOrder(orderId: string): Promise<GetOrderResponse> {
  return coinbaseRequest<GetOrderResponse>({
    method: "GET",
    path: `/api/v3/brokerage/orders/historical/${orderId}`,
  });
}

export type { CreateOrderResponse, GetOrderResponse, CancelOrdersResponse };
