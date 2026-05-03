import { computeSMA } from './moving-averages';

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
}

/**
 * Compute Bollinger Bands.
 *
 * - Middle = SMA(period)
 * - Upper  = middle + stdDev * population standard deviation of the last `period` values
 * - Lower  = middle - stdDev * population standard deviation of the last `period` values
 *
 * Returns NaN fields if there are fewer values than the period.
 */
export function computeBollinger(
  closes: number[],
  period: number = 20,
  stdDev: number = 2,
): BollingerResult {
  const nanResult: BollingerResult = { upper: NaN, middle: NaN, lower: NaN };

  if (closes.length < period) return nanResult;

  const middle = computeSMA(closes, period);
  const slice = closes.slice(-period);

  // Population standard deviation
  const mean = middle;
  const squaredDiffs = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  const sd = Math.sqrt(squaredDiffs / period);

  return {
    upper: middle + stdDev * sd,
    middle,
    lower: middle - stdDev * sd,
  };
}
