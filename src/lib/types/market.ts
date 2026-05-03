export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorPackage {
  rsi_14: number;
  macd: { line: number; signal: number; histogram: number };
  bollinger: { upper: number; middle: number; lower: number };
  sma_50: number;
  sma_200: number;
  volume_ratio: number; // current vs 20-day average
  atr_14: number;
  btc_correlation?: number; // 30-day rolling Pearson correlation
}
