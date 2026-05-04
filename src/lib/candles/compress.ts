import type { Candle } from "@/lib/coinbase";

/**
 * Compact CSV-style serializer for Coinbase candles.
 *
 * Per STRATEGY.md §5.3 / "data package size discipline" — sending arrays of
 * OHLCV objects in JSON wastes 50%+ tokens vs. a simple CSV. This pays for
 * the long-horizon candles (90d daily, 30d 4h, 7d 1h) we ship in the morning
 * brief without blowing the prompt budget.
 *
 * Format:
 *   "ts,o,h,l,c,v\n<unix_seconds>,<open>,<high>,<low>,<close>,<volume>\n..."
 *
 * Numeric values are unmodified strings (Coinbase already returns strings).
 * Volume is rounded to integer to save a few tokens.
 */
export function serializeCandles(candles: readonly Candle[]): string {
  const lines: string[] = ["ts,o,h,l,c,v"];
  for (const c of candles) {
    const v = Math.round(parseFloat(c.volume)).toString();
    lines.push(`${c.start},${c.open},${c.high},${c.low},${c.close},${v}`);
  }
  return lines.join("\n");
}

/**
 * Extract closes from a candles array, oldest first. Coinbase returns newest
 * first by default; pass `coinbaseOrder: "newest_first"` to reverse.
 */
export function closesFromCandles(
  candles: readonly Candle[],
  coinbaseOrder: "oldest_first" | "newest_first" = "newest_first",
): number[] {
  const ordered = coinbaseOrder === "newest_first" ? [...candles].reverse() : candles;
  return ordered.map((c) => parseFloat(c.close));
}

/** Same as closesFromCandles but returns full OHLC bars for ATR. */
export function ohlcFromCandles(
  candles: readonly Candle[],
  coinbaseOrder: "oldest_first" | "newest_first" = "newest_first",
): Array<{ open: number; high: number; low: number; close: number; volume: number }> {
  const ordered = coinbaseOrder === "newest_first" ? [...candles].reverse() : candles;
  return ordered.map((c) => ({
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
  }));
}
