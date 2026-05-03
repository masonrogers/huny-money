import { computeEMASeries } from './moving-averages';

export interface MACDResult {
  line: number;
  signal: number;
  histogram: number;
}

/**
 * Compute MACD indicator.
 *
 * - MACD line = EMA(fast) - EMA(slow)
 * - Signal line = EMA(signal) of the MACD line series
 * - Histogram = MACD line - Signal line
 *
 * Returns NaN fields if there is not enough data. Requires at least
 * `slow + signal - 1` data points for a fully converged signal line.
 */
export function computeMACD(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signal: number = 9,
): MACDResult {
  const nanResult: MACDResult = { line: NaN, signal: NaN, histogram: NaN };

  if (closes.length < slow) return nanResult;

  const fastEMA = computeEMASeries(closes, fast);
  const slowEMA = computeEMASeries(closes, slow);

  // The slow EMA series starts at index (slow - 1) in the original array,
  // while the fast EMA series starts at index (fast - 1).
  // We need to align them: for each slowEMA[i], the corresponding fastEMA
  // index is offset by (slow - fast).
  const offset = slow - fast;
  const macdLine: number[] = [];

  for (let i = 0; i < slowEMA.length; i++) {
    macdLine.push(fastEMA[i + offset] - slowEMA[i]);
  }

  if (macdLine.length === 0) return nanResult;

  // Signal line is EMA of the MACD line series
  if (macdLine.length < signal) {
    // Not enough MACD values for the signal line; return latest MACD with NaN signal
    const latestLine = macdLine[macdLine.length - 1];
    return { line: latestLine, signal: NaN, histogram: NaN };
  }

  const signalSeries = computeEMASeries(macdLine, signal);
  const latestLine = macdLine[macdLine.length - 1];
  const latestSignal = signalSeries[signalSeries.length - 1];

  return {
    line: latestLine,
    signal: latestSignal,
    histogram: latestLine - latestSignal,
  };
}
