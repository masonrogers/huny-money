import { coinbaseRequest } from "./client";
import type {
  Candle,
  CandleGranularity,
  GetCandlesResponse,
  GetTickerResponse,
  GetOrderBookResponse,
  OrderBook,
} from "./types";

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------

/**
 * Fetch OHLCV candles for a product.
 *
 * GET /api/v3/brokerage/products/{product_id}/candles
 *
 * @param productId  e.g. "BTC-USD"
 * @param granularity ONE_HOUR | ONE_DAY | etc.
 * @param start      Unix seconds (range start)
 * @param end        Unix seconds (range end)
 */
export async function getCandles(
  productId: string,
  granularity: CandleGranularity,
  start: number,
  end: number,
): Promise<Candle[]> {
  const response = await coinbaseRequest<GetCandlesResponse>({
    method: "GET",
    path: `/api/v3/brokerage/products/${productId}/candles`,
    params: {
      granularity,
      start: String(start),
      end: String(end),
    },
  });
  return response.candles;
}

// ---------------------------------------------------------------------------
// Ticker
// ---------------------------------------------------------------------------

export interface TickerSummary {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  lastPrice: number;
  time: string;
}

/**
 * Fetch the current ticker for a product. Used by the price polling loop and
 * by the price snapshot writer.
 *
 * GET /api/v3/brokerage/products/{product_id}/ticker?limit=1
 */
export async function getTicker(productId: string): Promise<TickerSummary> {
  const response = await coinbaseRequest<GetTickerResponse>({
    method: "GET",
    path: `/api/v3/brokerage/products/${productId}/ticker`,
    params: { limit: "1" },
  });

  const lastTrade = response.trades[0];
  const bestBid = parseFloat(response.best_bid);
  const bestAsk = parseFloat(response.best_ask);

  return {
    bestBid,
    bestAsk,
    midPrice: (bestBid + bestAsk) / 2,
    lastPrice: lastTrade ? parseFloat(lastTrade.price) : (bestBid + bestAsk) / 2,
    time: lastTrade?.time ?? new Date().toISOString(),
  };
}

/**
 * Fetch tickers for several products in parallel. Used to assemble price
 * snapshots and the BTC/ETH/SOL polling loop.
 */
export async function getTickers(
  productIds: readonly string[],
): Promise<Record<string, TickerSummary>> {
  const results = await Promise.all(productIds.map(async (id) => [id, await getTicker(id)] as const));
  return Object.fromEntries(results);
}

// ---------------------------------------------------------------------------
// Order book
// ---------------------------------------------------------------------------

/**
 * Fetch the order book for a product.
 *
 * GET /api/v3/brokerage/product_book?product_id=...&limit=...
 */
export async function getOrderBook(productId: string, limit = 50): Promise<OrderBook> {
  const response = await coinbaseRequest<GetOrderBookResponse>({
    method: "GET",
    path: `/api/v3/brokerage/product_book`,
    params: { product_id: productId, limit: String(limit) },
  });
  return response.pricebook;
}
