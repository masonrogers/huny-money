import type { Candle } from '../types/market';
import type { IndicatorPackage } from '../types/market';
import { computeRSI } from './rsi';
import { computeMACD } from './macd';
import { computeBollinger } from './bollinger';
import { computeSMA } from './moving-averages';
import { computeVolumeRatio } from './volume';
import { computeATR } from './atr';
import { computeCorrelation } from './correlation';

export { computeRSI } from './rsi';
export { computeMACD } from './macd';
export type { MACDResult } from './macd';
export { computeBollinger } from './bollinger';
export type { BollingerResult } from './bollinger';
export { computeSMA, computeEMA, computeEMASeries } from './moving-averages';
export { computeVolumeRatio } from './volume';
export { computeATR } from './atr';
export { computeCorrelation } from './correlation';

/**
 * Compute all technical indicators for a single asset.
 *
 * @param candles  - OHLCV candle array for the asset (daily candles, at least
 *                   200 for a fully converged 200-day SMA).
 * @param btcCandles - Optional BTC daily candles for correlation calculation.
 *                     Should cover the same date range. If provided and the
 *                     asset is not BTC, the 30-day rolling Pearson correlation
 *                     is computed from the last 31 close prices.
 */
export function computeAllIndicators(
  candles: Candle[],
  btcCandles?: Candle[],
): IndicatorPackage {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const rsi_14 = computeRSI(closes, 14);
  const macd = computeMACD(closes, 12, 26, 9);
  const bollinger = computeBollinger(closes, 20, 2);
  const sma_50 = computeSMA(closes, 50);
  const sma_200 = computeSMA(closes, 200);
  const volume_ratio = computeVolumeRatio(volumes, 20);
  const atr_14 = computeATR(candles, 14);

  const result: IndicatorPackage = {
    rsi_14,
    macd,
    bollinger,
    sma_50,
    sma_200,
    volume_ratio,
    atr_14,
  };

  // BTC correlation: use the last 31 close prices (30 daily returns)
  if (btcCandles && btcCandles.length >= 31) {
    const assetCloses = closes.slice(-31);
    const btcCloses = btcCandles.map((c) => c.close).slice(-31);

    if (assetCloses.length === 31 && btcCloses.length === 31) {
      result.btc_correlation = computeCorrelation(assetCloses, btcCloses);
    }
  }

  return result;
}
