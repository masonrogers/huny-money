import { emaSeries } from "./moving-averages";

/**
 * MACD: difference of fast EMA and slow EMA, plus signal line and histogram.
 *
 * Returns the latest values. Returns null if there's not enough data for
 * `slow + signal` bars.
 */
export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

export function macd(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult | null {
  if (closes.length < slow + signalPeriod) return null;

  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);

  const macdSeries: (number | null)[] = closes.map((_, i) => {
    const f = fastSeries[i];
    const s = slowSeries[i];
    return f != null && s != null ? f - s : null;
  });

  // Build signal as EMA of the macd series, only using non-null portion.
  const macdNonNull: number[] = [];
  for (const v of macdSeries) {
    if (v != null) macdNonNull.push(v);
  }
  if (macdNonNull.length < signalPeriod) return null;

  const signalEma = emaSeries(macdNonNull, signalPeriod);
  const signal = signalEma[signalEma.length - 1];
  const macdNow = macdNonNull[macdNonNull.length - 1];
  if (signal == null || macdNow == null) return null;

  return {
    macd: macdNow,
    signal,
    histogram: macdNow - signal,
  };
}
