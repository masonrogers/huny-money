import type { Candle } from '../types/market';

/**
 * Compute Average True Range using Wilder's smoothing.
 *
 * True Range for each candle is the greatest of:
 *   - high - low
 *   - |high - previous close|
 *   - |low  - previous close|
 *
 * The first ATR value is a simple average of the first `period` true ranges.
 * Subsequent values use Wilder's smoothing:
 *   ATR_t = (ATR_{t-1} * (period - 1) + TR_t) / period
 *
 * Requires at least `period + 1` candles (period true ranges need period + 1
 * candles because TR depends on the previous candle's close).
 * Returns NaN if there is not enough data.
 */
export function computeATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return NaN;

  // Calculate true ranges (starting from the second candle)
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trueRanges.push(tr);
  }

  // First ATR: simple average of the first `period` true ranges
  let atr = 0;
  for (let i = 0; i < period; i++) {
    atr += trueRanges[i];
  }
  atr /= period;

  // Wilder's smoothing for remaining true ranges
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}
