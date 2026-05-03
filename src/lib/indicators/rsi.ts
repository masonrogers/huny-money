/**
 * Compute RSI using Wilder's smoothing method.
 *
 * Wilder's smoothing uses:
 *   avgGain_t = (avgGain_{t-1} * (period - 1) + currentGain) / period
 *   avgLoss_t = (avgLoss_{t-1} * (period - 1) + currentLoss) / period
 *
 * The first average gain/loss is a simple average of the first `period` changes.
 * Returns a value between 0 and 100, or NaN if not enough data.
 *
 * Requires at least `period + 1` close values (period changes).
 */
export function computeRSI(closes: number[], period: number = 14): number {
  // We need at least period + 1 data points to compute `period` price changes
  if (closes.length < period + 1) return NaN;

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // First average gain/loss: simple average of the first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      avgGain += changes[i];
    } else {
      avgLoss += Math.abs(changes[i]);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // Apply Wilder's smoothing for remaining changes
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  // Avoid division by zero
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
