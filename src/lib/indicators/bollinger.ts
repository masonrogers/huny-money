import { sma } from "./moving-averages";

/**
 * Bollinger Bands: SMA(period) ± stdDev * sigma.
 * Default: 20-period, 2 sigma.
 */
export interface BollingerResult {
  middle: number;
  upper: number;
  lower: number;
  width: number; // upper - lower (raw, not normalized)
  bandwidth: number; // (upper - lower) / middle, useful for volatility comparison
}

export function bollinger(
  closes: readonly number[],
  period = 20,
  sigma = 2,
): BollingerResult | null {
  if (closes.length < period) return null;
  const middle = sma(closes, period)!;

  const window = closes.slice(closes.length - period);
  let sumSq = 0;
  for (const v of window) sumSq += (v - middle) ** 2;
  const variance = sumSq / period;
  const stdDev = Math.sqrt(variance);

  const upper = middle + sigma * stdDev;
  const lower = middle - sigma * stdDev;

  return {
    middle,
    upper,
    lower,
    width: upper - lower,
    bandwidth: middle === 0 ? 0 : (upper - lower) / middle,
  };
}
