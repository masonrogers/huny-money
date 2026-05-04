// Coinbase Advanced Trade API types — trimmed to what v3 actually uses.
// Full type definitions (orders) will be added in Phase 4 when the executors
// land.

export interface CoinbaseError {
  error: string;
  message: string;
  error_details?: string;
}

// ─── Common request/response shape ─────────────────────────────────────────

export interface CoinbaseRequestOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | boolean | undefined | null | string[]>;
}

export class CoinbaseApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "CoinbaseApiError";
  }
}

export class CoinbaseRateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs: number,
  ) {
    super(message);
    this.name = "CoinbaseRateLimitError";
  }
}

// ─── Accounts ──────────────────────────────────────────────────────────────

export interface Account {
  uuid: string;
  name: string;
  currency: string;
  available_balance: { value: string; currency: string };
  default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  type: "ACCOUNT_TYPE_CRYPTO" | "ACCOUNT_TYPE_FIAT" | "ACCOUNT_TYPE_UNSPECIFIED";
  ready: boolean;
  hold: { value: string; currency: string };
  retail_portfolio_id: string;
}

export interface ListAccountsResponse {
  accounts: Account[];
  has_next: boolean;
  cursor: string;
  size: number;
}

// ─── API Key Permissions ───────────────────────────────────────────────────

export interface ApiKeyPermissions {
  can_view: boolean;
  can_trade: boolean;
  can_transfer: boolean; // <-- this MUST be false; boot refuses to start otherwise
  portfolio_uuid?: string;
  portfolio_type?: string;
}

// ─── Candles ───────────────────────────────────────────────────────────────

export type CandleGranularity =
  | "ONE_MINUTE"
  | "FIVE_MINUTE"
  | "FIFTEEN_MINUTE"
  | "THIRTY_MINUTE"
  | "ONE_HOUR"
  | "TWO_HOUR"
  | "SIX_HOUR"
  | "ONE_DAY";

export interface Candle {
  start: string; // unix seconds as string
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
  side: "BUY" | "SELL";
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
