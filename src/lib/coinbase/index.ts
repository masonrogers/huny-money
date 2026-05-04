// Barrel export for the Coinbase client surface.
//
// Order placement (placeLimitBuy, placeStopLimit, etc.) is intentionally
// NOT exported here. Per STRATEGY.md §13.2 only `src/lib/execution/live-executor.ts`
// is permitted to import order placement methods. They live in
// `src/lib/coinbase/orders.ts` (added in Phase 4) and have a dedicated
// import path that the static-analysis check enforces.

export { coinbaseRequest } from "./client";
export {
  getAccounts,
  getBalance,
  getAllBalances,
  getApiKeyPermissions,
  assertTradeOnlyKey,
  type BalanceSummary,
} from "./accounts";
export {
  getCandles,
  getTicker,
  getTickers,
  getOrderBook,
  type TickerSummary,
} from "./market-data";
export type {
  Account,
  ApiKeyPermissions,
  Candle,
  CandleGranularity,
  OrderBook,
  OrderBookEntry,
  CoinbaseRequestOptions,
} from "./types";
export { CoinbaseApiError, CoinbaseRateLimitError } from "./types";
