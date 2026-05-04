/**
 * Simple and exponential moving averages.
 */

/** Simple moving average over the most recent `period` closes. */
export function sma(closes: readonly number[], period: number): number | null {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i]!;
  return sum / period;
}

/**
 * Full SMA series (one value per bar starting at index `period - 1`).
 * Earlier indices are null.
 */
export function smaSeries(closes: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i]!;
  out[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    sum += closes[i]! - closes[i - period]!;
    out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average. Seeded with the SMA of the first `period`
 * values (standard convention). Returns the EMA value at the last index.
 */
export function ema(closes: readonly number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let value = sma(closes.slice(0, period), period)!;
  for (let i = period; i < closes.length; i++) {
    value = closes[i]! * k + value * (1 - k);
  }
  return value;
}

/** Full EMA series, with `null` for indices before the seed window. */
export function emaSeries(closes: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  let value = sma(closes.slice(0, period), period)!;
  out[period - 1] = value;
  for (let i = period; i < closes.length; i++) {
    value = closes[i]! * k + value * (1 - k);
    out[i] = value;
  }
  return out;
}
