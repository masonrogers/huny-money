import { describe, it, expect } from "vitest";
import { serializeCandles, closesFromCandles, ohlcFromCandles } from "@/lib/candles/compress";
import type { Candle } from "@/lib/coinbase";

const sample: Candle[] = [
  { start: "1714694400", low: "60000", high: "61000", open: "60500", close: "60800", volume: "1234.5" },
  { start: "1714780800", low: "60800", high: "62000", open: "60800", close: "61500", volume: "2200.7" },
];

describe("serializeCandles", () => {
  it("emits CSV header on first line", () => {
    const out = serializeCandles(sample);
    expect(out.split("\n")[0]).toBe("ts,o,h,l,c,v");
  });

  it("emits one line per candle in order", () => {
    const out = serializeCandles(sample);
    const lines = out.split("\n");
    expect(lines).toHaveLength(3); // header + 2
    expect(lines[1]).toContain("1714694400");
    expect(lines[2]).toContain("1714780800");
  });

  it("rounds volume to integer to save tokens", () => {
    const out = serializeCandles(sample);
    expect(out).toContain("1235"); // 1234.5 rounds up
    expect(out).toContain("2201"); // 2200.7 rounds up
    expect(out).not.toContain("1234.5");
  });

  it("handles empty input as just the header", () => {
    expect(serializeCandles([])).toBe("ts,o,h,l,c,v");
  });
});

describe("closesFromCandles", () => {
  it("reverses Coinbase newest-first into oldest-first by default", () => {
    // Coinbase returns newest-first: sample[0] is the older one in our sample,
    // but if it were newest-first then closesFromCandles should return reversed.
    const newestFirst: Candle[] = [
      { start: "2", low: "0", high: "0", open: "0", close: "200", volume: "0" },
      { start: "1", low: "0", high: "0", open: "0", close: "100", volume: "0" },
    ];
    const closes = closesFromCandles(newestFirst);
    expect(closes).toEqual([100, 200]);
  });

  it("preserves order when explicitly told oldest-first", () => {
    const oldestFirst: Candle[] = [
      { start: "1", low: "0", high: "0", open: "0", close: "100", volume: "0" },
      { start: "2", low: "0", high: "0", open: "0", close: "200", volume: "0" },
    ];
    const closes = closesFromCandles(oldestFirst, "oldest_first");
    expect(closes).toEqual([100, 200]);
  });
});

describe("ohlcFromCandles", () => {
  it("parses all OHLCV numeric fields", () => {
    const oldestFirst: Candle[] = [
      { start: "1", low: "10", high: "20", open: "15", close: "18", volume: "100" },
    ];
    const out = ohlcFromCandles(oldestFirst, "oldest_first");
    expect(out).toEqual([{ open: 15, high: 20, low: 10, close: 18, volume: 100 }]);
  });
});
