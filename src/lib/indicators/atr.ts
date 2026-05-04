/**
 * Average True Range. Wilder smoothing of true range.
 *
 * TR = max(high - low, |high - prevClose|, |low - prevClose|)
 * ATR(n) = Wilder smoothing over n periods.
 */
export interface OHLCBar {
  high: number;
  low: number;
  close: number;
}

export function atr(bars: readonly OHLCBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i]!;
    const prev = bars[i - 1]!;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trueRanges.push(tr);
  }

  // Initial ATR = SMA of first `period` true ranges.
  let value = 0;
  for (let i = 0; i < period; i++) value += trueRanges[i]!;
  value /= period;

  // Wilder smoothing for the remainder.
  for (let i = period; i < trueRanges.length; i++) {
    value = (value * (period - 1) + trueRanges[i]!) / period;
  }
  return value;
}
