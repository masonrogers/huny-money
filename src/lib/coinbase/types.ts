// ─── Coinbase Advanced Trade API Response Types ────────────────────────────
// Based on Coinbase Advanced Trade REST API v3 response shapes.

// ─── Common ────────────────────────────────────────────────────────────────

export interface CoinbaseError {
  error: string;
  message: string;
  error_details: string;
  preview_failure_reason?: string;
}

// ─── Accounts ──────────────────────────────────────────────────────────────

export interface Account {
  uuid: string;
  name: string;
  currency: string;
  available_balance: {
    value: string;
    currency: string;
  };
  default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  type: 'ACCOUNT_TYPE_CRYPTO' | 'ACCOUNT_TYPE_FIAT' | 'ACCOUNT_TYPE_UNSPECIFIED';
  ready: boolean;
  hold: {
    value: string;
    currency: string;
  };
  retail_portfolio_id: string;
}

export interface ListAccountsResponse {
  accounts: Account[];
  has_next: boolean;
  cursor: string;
  size: number;
}

// ─── Products ──────────────────────────────────────────────────────────────

export interface Product {
  product_id: string;
  price: string;
  price_percentage_change_24h: string;
  volume_24h: string;
  volume_percentage_change_24h: string;
  base_increment: string;
  quote_increment: string;
  quote_min_size: string;
  quote_max_size: string;
  base_min_size: string;
  base_max_size: string;
  base_name: string;
  quote_name: string;
  watched: boolean;
  is_disabled: boolean;
  new: boolean;
  status: string;
  cancel_only: boolean;
  limit_only: boolean;
  post_only: boolean;
  trading_disabled: boolean;
  auction_mode: boolean;
  product_type: string;
  quote_currency_id: string;
  base_currency_id: string;
  fcm_trading_session_details: unknown;
  mid_market_price: string;
  alias: string;
  alias_to: string[];
  base_display_symbol: string;
  quote_display_symbol: string;
  view_only: boolean;
  price_book_id: string;
  product_venue: string;
  approximate_quote_24h_volume: string;
}

export interface GetProductResponse {
  product_id: string;
  price: string;
  price_percentage_change_24h: string;
  volume_24h: string;
  volume_percentage_change_24h: string;
  base_increment: string;
  quote_increment: string;
  quote_min_size: string;
  quote_max_size: string;
  base_min_size: string;
  base_max_size: string;
  base_name: string;
  quote_name: string;
  watched: boolean;
  is_disabled: boolean;
  new: boolean;
  status: string;
  cancel_only: boolean;
  limit_only: boolean;
  post_only: boolean;
  trading_disabled: boolean;
  auction_mode: boolean;
  product_type: string;
  quote_currency_id: string;
  base_currency_id: string;
  mid_market_price: string;
  base_display_symbol: string;
  quote_display_symbol: string;
  view_only: boolean;
  price_book_id: string;
  product_venue: string;
  approximate_quote_24h_volume: string;
}

export interface ListProductsResponse {
  products: Product[];
  num_products: number;
}

// ─── Candles ───────────────────────────────────────────────────────────────

export type CandleGranularity =
  | 'ONE_MINUTE'
  | 'FIVE_MINUTE'
  | 'FIFTEEN_MINUTE'
  | 'THIRTY_MINUTE'
  | 'ONE_HOUR'
  | 'TWO_HOUR'
  | 'SIX_HOUR'
  | 'ONE_DAY';

export interface Candle {
  start: string;
  low: string;
  high: string;
  open: string;
  close: string;
  volume: string;
}

export interface GetCandlesResponse {
  candles: Candle[];
}

// ─── Ticker ────────────────────────────────────────────────────────────────

export interface Trade {
  trade_id: string;
  product_id: string;
  price: string;
  size: string;
  time: string;
  side: 'BUY' | 'SELL';
  bid: string;
  ask: string;
}

export interface GetTickerResponse {
  trades: Trade[];
  best_bid: string;
  best_ask: string;
}

// ─── Order Book ────────────────────────────────────────────────────────────

export interface OrderBookEntry {
  price: string;
  size: string;
}

export interface OrderBook {
  product_id: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  time: string;
}

export interface GetOrderBookResponse {
  pricebook: OrderBook;
}

// ─── Orders ────────────────────────────────────────────────────────────────

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT';

export type OrderStatus =
  | 'PENDING'
  | 'OPEN'
  | 'FILLED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED'
  | 'UNKNOWN_ORDER_STATUS';

// Order configuration types for placing orders
export interface LimitLimitGtc {
  base_size: string;
  limit_price: string;
  post_only?: boolean;
}

export interface LimitLimitGtd {
  base_size: string;
  limit_price: string;
  end_time: string;
  post_only?: boolean;
}

export interface LimitLimitFok {
  base_size: string;
  limit_price: string;
}

export interface MarketMarketIoc {
  quote_size?: string;
  base_size?: string;
}

export interface StopLimitStopLimitGtc {
  base_size: string;
  limit_price: string;
  stop_price: string;
  stop_direction: 'STOP_DIRECTION_STOP_DOWN' | 'STOP_DIRECTION_STOP_UP';
}

export interface StopLimitStopLimitGtd {
  base_size: string;
  limit_price: string;
  stop_price: string;
  end_time: string;
  stop_direction: 'STOP_DIRECTION_STOP_DOWN' | 'STOP_DIRECTION_STOP_UP';
}

export interface TriggerBracketGtc {
  base_size: string;
  limit_price: string;
  stop_trigger_price: string;
}

export interface TriggerBracketGtd {
  base_size: string;
  limit_price: string;
  stop_trigger_price: string;
  end_time: string;
}

export interface OrderConfiguration {
  market_market_ioc?: MarketMarketIoc;
  sor_limit_ioc?: {
    base_size: string;
    limit_price: string;
  };
  limit_limit_gtc?: LimitLimitGtc;
  limit_limit_gtd?: LimitLimitGtd;
  limit_limit_fok?: LimitLimitFok;
  stop_limit_stop_limit_gtc?: StopLimitStopLimitGtc;
  stop_limit_stop_limit_gtd?: StopLimitStopLimitGtd;
  trigger_bracket_gtc?: TriggerBracketGtc;
  trigger_bracket_gtd?: TriggerBracketGtd;
}

export interface PlaceOrderRequest {
  client_order_id: string;
  product_id: string;
  side: OrderSide;
  order_configuration: OrderConfiguration;
  leverage?: string;
  margin_type?: string;
  retail_portfolio_id?: string;
}

export interface PlaceOrderResponse {
  success: boolean;
  failure_reason?: string;
  order_id: string;
  success_response?: {
    order_id: string;
    product_id: string;
    side: OrderSide;
    client_order_id: string;
  };
  error_response?: {
    error: string;
    message: string;
    error_details: string;
    preview_failure_reason: string;
    new_order_failure_reason: string;
  };
  order_configuration: OrderConfiguration;
}

// Order as returned from historical/get endpoints
export interface Order {
  order_id: string;
  product_id: string;
  user_id: string;
  order_configuration: OrderConfiguration;
  side: OrderSide;
  client_order_id: string;
  status: OrderStatus;
  time_in_force: string;
  created_time: string;
  completion_percentage: string;
  filled_size: string;
  average_filled_price: string;
  fee: string;
  number_of_fills: string;
  filled_value: string;
  pending_cancel: boolean;
  size_in_quote: boolean;
  total_fees: string;
  size_inclusive_of_fees: boolean;
  total_value_after_fees: string;
  trigger_status: string;
  order_type: string;
  reject_reason: string;
  settled: boolean;
  product_type: string;
  reject_message: string;
  cancel_message: string;
  order_placement_source: string;
  outstanding_hold_amount: string;
  is_liquidation: boolean;
  last_fill_time: string;
  edit_history: Array<{
    price: string;
    size: string;
    replace_accept_timestamp: string;
  }>;
  leverage: string;
  margin_type: string;
  retail_portfolio_id: string;
  originating_order_id: string;
  attached_order_id: string;
}

export interface GetOrderResponse {
  order: Order;
}

export interface ListOrdersParams {
  product_id?: string;
  order_status?: string[];
  limit?: number;
  start_date?: string;
  end_date?: string;
  order_type?: string;
  order_side?: OrderSide;
  cursor?: string;
  product_type?: string;
  order_placement_source?: string;
  contract_expiry_type?: string;
  asset_filters?: string[];
  retail_portfolio_id?: string;
  time_in_forces?: string[];
  sort_by?: string;
}

export interface ListOrdersResponse {
  orders: Order[];
  sequence: string;
  has_next: boolean;
  cursor: string;
}

export interface CancelOrdersRequest {
  order_ids: string[];
}

export interface CancelOrderResult {
  success: boolean;
  failure_reason: string;
  order_id: string;
}

export interface CancelOrdersResponse {
  results: CancelOrderResult[];
}

// ─── Helpers / Utility Types ───────────────────────────────────────────────

export interface CoinbaseRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | string[] | number | undefined>;
}

export class CoinbaseApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public errorBody?: CoinbaseError,
  ) {
    super(message);
    this.name = 'CoinbaseApiError';
  }
}

export class CoinbaseRateLimitError extends CoinbaseApiError {
  constructor(
    message: string,
    public retryAfterMs: number,
  ) {
    super(message, 429);
    this.name = 'CoinbaseRateLimitError';
  }
}
