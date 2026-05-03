/**
 * Simple Moving Average — average of the last `period` values.
 * Returns NaN if there are fewer values than the period requires.
 */
export function computeSMA(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Exponential Moving Average over the full series, returning the final value.
 *
 * The first `period` values are seeded with an SMA, then each subsequent value
 * applies the EMA formula:  EMA_t = close * k + EMA_{t-1} * (1 - k)
 * where k = 2 / (period + 1).
 *
 * Returns NaN if there are fewer values than the period requires.
 */
export function computeEMA(values: number[], period: number): number {
  if (values.length < period) return NaN;

  const k = 2 / (period + 1);

  // Seed with SMA of the first `period` values
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += values[i];
  }
  ema /= period;

  // Apply EMA from period onward
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }

  return ema;
}

/**
 * Compute the full EMA series (one value per input value, starting from index
 * `period - 1`). Useful internally when other indicators need intermediate
 * EMA values (e.g. MACD needs EMA series subtraction).
 */
export function computeEMASeries(values: number[], period: number): number[] {
  if (values.length < period) return [];

  const k = 2 / (period + 1);
  const result: number[] = [];

  // Seed
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += values[i];
  }
  ema /= period;
  result.push(ema);

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result.push(ema);
  }

  return result;
}
