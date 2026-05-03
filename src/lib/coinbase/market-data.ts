import { coinbaseRequest } from './client';
import type {
  Candle,
  CandleGranularity,
  GetCandlesResponse,
  GetTickerResponse,
  GetProductResponse,
} from './types';

// ─── Market Data ───────────────────────────────────────────────────────────

/**
 * Fetch OHLCV candles for a product.
 *
 * GET /api/v3/brokerage/products/{product_id}/candles
 *
 * @param productId - e.g., "BTC-USD", "ETH-USD", "SOL-USD"
 * @param granularity - Candle period: 'ONE_HOUR', 'ONE_DAY', etc.
 * @param start - Unix timestamp (seconds) for range start
 * @param end - Unix timestamp (seconds) for range end
 */
export async function getCandles(
  productId: string,
  granularity: CandleGranularity,
  start: number,
  end: number,
): Promise<Candle[]> {
  const response = await coinbaseRequest<GetCandlesResponse>({
    method: 'GET',
    path: `/api/v3/brokerage/products/${productId}/candles`,
    params: {
      granularity,
      start: String(start),
      end: String(end),
    },
  });

  return response.candles;
}

/**
 * Fetch the current ticker (best bid, best ask, recent trades) for a product.
 *
 * GET /api/v3/brokerage/products/{product_id}/ticker
 *
 * @param productId - e.g., "BTC-USD"
 * @param limit - Number of recent trades to include (default 1)
 */
export async function getTicker(
  productId: string,
  limit: number = 1,
): Promise<{
  bestBid: number;
  bestAsk: number;
  lastPrice: number;
  lastSize: number;
  time: string;
  raw: GetTickerResponse;
}> {
  const response = await coinbaseRequest<GetTickerResponse>({
    method: 'GET',
    path: `/api/v3/brokerage/products/${productId}/ticker`,
    params: {
      limit: String(limit),
    },
  });

  const lastTrade = response.trades[0];

  return {
    bestBid: parseFloat(response.best_bid),
    bestAsk: parseFloat(response.best_ask),
    lastPrice: lastTrade ? parseFloat(lastTrade.price) : 0,
    lastSize: lastTrade ? parseFloat(lastTrade.size) : 0,
    time: lastTrade?.time ?? new Date().toISOString(),
    raw: response,
  };
}

/**
 * Fetch product details (trading pair info, increments, limits).
 *
 * GET /api/v3/brokerage/products/{product_id}
 *
 * @param productId - e.g., "BTC-USD"
 */
export async function getProduct(productId: string): Promise<GetProductResponse> {
  return coinbaseRequest<GetProductResponse>({
    method: 'GET',
    path: `/api/v3/brokerage/products/${productId}`,
  });
}

// ─── Convenience Methods ───────────────────────────────────────────────────

/**
 * Get the current mid-market price for a product.
 * Mid-market = (bestBid + bestAsk) / 2
 */
export async function getMidPrice(productId: string): Promise<number> {
  const ticker = await getTicker(productId);
  return (ticker.bestBid + ticker.bestAsk) / 2;
}

/**
 * Fetch candles for multiple timeframes at once.
 * Used to assemble the data package for evaluations.
 *
 * Returns candles keyed by granularity.
 */
export async function getMultiTimeframeCandles(
  productId: string,
  timeframes: Array<{
    granularity: CandleGranularity;
    start: number;
    end: number;
  }>,
): Promise<Record<CandleGranularity, Candle[]>> {
  const results: Partial<Record<CandleGranularity, Candle[]>> = {};

  // Fetch all timeframes (sequentially to respect rate limits)
  for (const tf of timeframes) {
    results[tf.granularity] = await getCandles(
      productId,
      tf.granularity,
      tf.start,
      tf.end,
    );
  }

  return results as Record<CandleGranularity, Candle[]>;
}
