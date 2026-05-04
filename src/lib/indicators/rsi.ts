/**
 * Relative Strength Index (RSI). Wilder's smoothing.
 *
 * RSI = 100 - 100/(1 + RS) where RS = avg gain / avg loss over `period` bars.
 * Uses exponential smoothing after the first `period` bars (Wilder method).
 *
 * Returns the RSI for the most recent close, in [0, 100].
 * Returns null if there are fewer than `period + 1` closes.
 */
export function rsi(closes: readonly number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses += -diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
