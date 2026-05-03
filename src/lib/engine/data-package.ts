/**
 * Assembles the complete data package (Section 14) for Claude evaluations.
 *
 * Gathers portfolio state, price data, technical indicators, trade history,
 * active theses, strategy params, and feedback data into a single DataPackage
 * object that gets serialized into the Claude prompt.
 */

import type { Candle } from '@/lib/types/market';
import type {
  DataPackage,
  PortfolioData,
  PriceData,
  TechnicalData,
  TradeHistoryEntry,
  ActiveThesis,
  StrategyParamsData,
  FeedbackData,
  BtcBenchmark,
  PositionSnapshot,
} from '@/lib/types/evaluation';
import type { EvaluationType, RegimeName } from '@/lib/types/strategy';
import type { CandleGranularity, Candle as CoinbaseCandle } from '@/lib/coinbase/types';
import { getAccounts, getAllBalances, getCandles, getMidPrice } from '@/lib/coinbase';
import { computeAllIndicators } from '@/lib/indicators/index';
import { getOpenPositions, getClosedPositions } from '@/lib/db/queries/positions';
import { getActiveTheses } from '@/lib/db/queries/theses';
import { getStrategyParams, getCurrentVersion } from '@/lib/db/queries/strategy';
import { getState, getMultipleStates } from '@/lib/db/queries/system-state';
import { getSnapshotsSince } from '@/lib/db/queries/equity';
import { checkCircuitBreakers } from '@/lib/engine/risk-manager';
import { ALL_ASSETS, STARTING_CAPITAL } from '@/lib/constants';

// ─── Coinbase candle -> internal candle conversion ─────────────────────────

function toCandleArray(coinbaseCandles: CoinbaseCandle[]): Candle[] {
  return coinbaseCandles.map((c) => ({
    timestamp: Number(c.start),
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
  }));
}

// ─── Regime -> exposure cap mapping ────────────────────────────────────────

const REGIME_EXPOSURE_CAP: Record<RegimeName, number> = {
  strong_bull: 70,
  mild_bull: 50,
  ranging: 30,
  mild_bear: 15,
  strong_bear: 0,
};

// ─── Aggregate daily candles into weekly candles ───────────────────────────

function aggregateToWeekly(dailyCandles: Candle[]): Candle[] {
  if (dailyCandles.length === 0) return [];

  // Sort by timestamp ascending
  const sorted = [...dailyCandles].sort((a, b) => a.timestamp - b.timestamp);
  const weekly: Candle[] = [];
  let weekStart = sorted[0];
  let weekHigh = weekStart.high;
  let weekLow = weekStart.low;
  let weekVolume = weekStart.volume;
  let weekClose = weekStart.close;
  let candlesInWeek = 1;

  for (let i = 1; i < sorted.length; i++) {
    const candle = sorted[i];
    candlesInWeek++;
    weekHigh = Math.max(weekHigh, candle.high);
    weekLow = Math.min(weekLow, candle.low);
    weekVolume += candle.volume;
    weekClose = candle.close;

    // Close the week every 7 candles or at the last candle
    if (candlesInWeek >= 7 || i === sorted.length - 1) {
      weekly.push({
        timestamp: weekStart.timestamp,
        open: weekStart.open,
        high: weekHigh,
        low: weekLow,
        close: weekClose,
        volume: weekVolume,
      });

      if (i + 1 < sorted.length) {
        weekStart = sorted[i + 1];
        weekHigh = weekStart.high;
        weekLow = weekStart.low;
        weekVolume = weekStart.volume;
        weekClose = weekStart.close;
        candlesInWeek = 0;
        i++; // skip the next candle since we already used it as weekStart
      }
    }
  }

  return weekly;
}

// ─── Price data fetching ───────────────────────────────────────────────────

async function fetchPriceData(asset: string): Promise<PriceData | null> {
  const productId = `${asset}-USD`;
  const now = Math.floor(Date.now() / 1000);

  // Define timeframes:
  // 1h candles for 48h, 6h candles as proxy for 4h (14 days), daily 90 days, daily 365 days for weekly aggregation
  const timeframes: Array<{
    key: 'candles_1h' | 'candles_4h' | 'candles_daily' | 'candles_weekly';
    granularity: CandleGranularity;
    start: number;
    end: number;
    aggregate?: boolean;
  }> = [
    {
      key: 'candles_1h',
      granularity: 'ONE_HOUR',
      start: now - 48 * 3600,
      end: now,
    },
    {
      key: 'candles_4h',
      granularity: 'SIX_HOUR', // closest available to 4h
      start: now - 14 * 24 * 3600,
      end: now,
    },
    {
      key: 'candles_daily',
      granularity: 'ONE_DAY',
      start: now - 90 * 24 * 3600,
      end: now,
    },
    {
      // Fetch 365 days of daily candles and aggregate to weekly
      key: 'candles_weekly',
      granularity: 'ONE_DAY',
      start: now - 365 * 24 * 3600,
      end: now,
      aggregate: true,
    },
  ];

  const result: PriceData = {
    asset,
    candles_1h: [],
    candles_4h: [],
    candles_daily: [],
    candles_weekly: [],
  };

  for (const tf of timeframes) {
    try {
      const rawCandles = await getCandles(productId, tf.granularity, tf.start, tf.end);
      const converted = toCandleArray(rawCandles);

      if (tf.aggregate) {
        result[tf.key] = aggregateToWeekly(converted);
      } else {
        result[tf.key] = converted;
      }
    } catch (err) {
      console.error(
        `[DataPackage] Failed to fetch ${tf.key} candles for ${asset}:`,
        err instanceof Error ? err.message : err
      );
      // Continue with empty array for this timeframe
    }
  }

  // If we got no data at all, return null
  const hasAnyData =
    result.candles_1h.length > 0 ||
    result.candles_4h.length > 0 ||
    result.candles_daily.length > 0 ||
    result.candles_weekly.length > 0;

  return hasAnyData ? result : null;
}

// ─── Technical indicators ──────────────────────────────────────────────────

function computeTechnicals(
  priceData: PriceData[],
  btcPriceData: PriceData | undefined
): TechnicalData[] {
  const results: TechnicalData[] = [];
  const btcDailyCandles = btcPriceData?.candles_daily;

  for (const pd of priceData) {
    try {
      // Daily indicators
      const dailyIndicators = computeAllIndicators(
        pd.candles_daily,
        pd.asset !== 'BTC' ? btcDailyCandles : undefined
      );

      // 4h/6h indicators
      const fourHourIndicators = computeAllIndicators(
        pd.candles_4h,
        // No BTC correlation on sub-daily
      );

      results.push({
        asset: pd.asset,
        daily: dailyIndicators,
        four_hour: fourHourIndicators,
      });
    } catch (err) {
      console.error(
        `[DataPackage] Failed to compute indicators for ${pd.asset}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return results;
}

// ─── Portfolio state assembly ──────────────────────────────────────────────

async function assemblePortfolioState(): Promise<PortfolioData> {
  const openPositions = await getOpenPositions();
  const states = await getMultipleStates([
    'current_regime',
    'peak_portfolio_value',
    'starting_capital',
    'strategy_version',
  ]);

  const regime = (states.current_regime ?? 'ranging') as RegimeName;
  const peakValue = states.peak_portfolio_value ? Number(states.peak_portfolio_value) : STARTING_CAPITAL;
  const startingCapital = states.starting_capital ? Number(states.starting_capital) : STARTING_CAPITAL;

  // Get live balances
  const balances = await getAllBalances(['USD', 'BTC', 'ETH', 'SOL']);
  const cashAvailable = balances.USD?.available ?? 0;

  // Get current prices for open positions and compute position values
  const positionSnapshots: PositionSnapshot[] = [];
  let deployedUsd = 0;

  for (const pos of openPositions) {
    try {
      const currentPrice = await getMidPrice(`${pos.asset}-USD`);
      const quantity = Number(pos.quantity);
      const entryPrice = Number(pos.entryPrice);
      const positionValue = currentPrice * quantity;
      const unrealizedPnlPct = entryPrice > 0
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : 0;
      const daysHeld = (Date.now() - new Date(pos.entryTime).getTime()) / (1000 * 3600 * 24);

      deployedUsd += positionValue;

      positionSnapshots.push({
        asset: pos.asset,
        type: pos.type as 'swing' | 'core',
        entry_price: entryPrice,
        current_price: currentPrice,
        quantity,
        position_value_usd: positionValue,
        unrealized_pnl_pct: unrealizedPnlPct,
        stop_loss: Number(pos.stopLoss),
        take_profit_target: Number(pos.takeProfitTarget),
        stop_order_id: pos.stopOrderId,
        tp_order_id: pos.tpOrderId,
        entry_time: pos.entryTime.toISOString(),
        days_held: Math.round(daysHeld * 10) / 10,
        conviction_at_entry: pos.convictionAtEntry,
        current_conviction: pos.currentConviction,
        strategy_version_at_entry: pos.strategyVersion,
        thesis: pos.thesis ?? '',
      });
    } catch (err) {
      console.error(
        `[DataPackage] Failed to get price for position ${pos.asset}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const totalValue = cashAvailable + deployedUsd;
  const exposurePct = totalValue > 0 ? (deployedUsd / totalValue) * 100 : 0;
  const regimeCapPct = REGIME_EXPOSURE_CAP[regime];
  const maxDeployable = totalValue * (regimeCapPct / 100);
  const remainingDeployable = Math.max(0, maxDeployable - deployedUsd);
  const drawdownPct = peakValue > 0 ? ((peakValue - totalValue) / peakValue) * 100 : 0;
  const breakers = await checkCircuitBreakers(totalValue);

  // BTC benchmark
  let btcBenchmark: BtcBenchmark;
  try {
    const btcPriceNow = await getMidPrice('BTC-USD');
    const btcPriceAtStartStr = await getState('btc_price_at_start');
    const btcPriceAtStart = btcPriceAtStartStr ? Number(btcPriceAtStartStr) : btcPriceNow;
    const btcHoldReturnPct = btcPriceAtStart > 0
      ? ((btcPriceNow - btcPriceAtStart) / btcPriceAtStart) * 100
      : 0;
    const systemReturnPct = startingCapital > 0
      ? ((totalValue - startingCapital) / startingCapital) * 100
      : 0;

    btcBenchmark = {
      btc_price_at_start: btcPriceAtStart,
      btc_price_now: btcPriceNow,
      btc_hold_return_pct: btcHoldReturnPct,
      system_return_pct: systemReturnPct,
      outperformance_pct: systemReturnPct - btcHoldReturnPct,
      consecutive_underperformance_days: 0, // Computed from equity snapshots below
    };

    // Compute consecutive underperformance days from equity snapshots
    try {
      const snapshots = await getSnapshotsSince(
        new Date(Date.now() - 90 * 24 * 3600 * 1000)
      );
      let consecutiveDays = 0;
      // Snapshots are ordered desc, so iterate and count days we underperformed
      for (const snap of snapshots) {
        const snapBtcPrice = Number(snap.btcPrice);
        const snapBtcHoldValue = Number(snap.btcHoldValue);
        const snapTotalValue = Number(snap.totalValueUsd);
        // If BTC hold value > system value, we are underperforming
        if (snapBtcHoldValue > snapTotalValue && snapBtcPrice > 0) {
          consecutiveDays++;
        } else {
          break;
        }
      }
      btcBenchmark.consecutive_underperformance_days = consecutiveDays;
    } catch {
      // Non-critical, leave at 0
    }
  } catch (err) {
    console.error('[DataPackage] Failed to compute BTC benchmark:', err);
    btcBenchmark = {
      btc_price_at_start: 0,
      btc_price_now: 0,
      btc_hold_return_pct: 0,
      system_return_pct: 0,
      outperformance_pct: 0,
      consecutive_underperformance_days: 0,
    };
  }

  return {
    total_value_usd: totalValue,
    cash_available: cashAvailable,
    current_exposure_pct: exposurePct,
    regime_exposure_cap_pct: regimeCapPct,
    remaining_deployable_usd: remainingDeployable,
    peak_value_usd: peakValue,
    drawdown_from_peak_pct: drawdownPct,
    soft_breaker_active: breakers.soft,
    btc_benchmark: btcBenchmark,
    positions: positionSnapshots,
  };
}

// ─── Trade history ─────────────────────────────────────────────────────────

async function assembleTradeHistory(): Promise<TradeHistoryEntry[]> {
  const closedPositions = await getClosedPositions({ limit: 50 });

  return closedPositions.map((pos) => {
    const entryPrice = Number(pos.entryPrice);
    const exitPrice = Number(pos.exitPrice ?? 0);
    const daysHeld = pos.exitTime && pos.entryTime
      ? (new Date(pos.exitTime).getTime() - new Date(pos.entryTime).getTime()) / (1000 * 3600 * 24)
      : 0;

    return {
      id: pos.id,
      asset: pos.asset,
      type: pos.type as 'swing' | 'core',
      direction: pos.direction,
      entry_price: entryPrice,
      exit_price: exitPrice,
      quantity: Number(pos.quantity),
      gross_pnl: Number(pos.grossPnl ?? 0),
      net_pnl: Number(pos.netPnl ?? 0),
      fees_paid: Number(pos.feesPaid ?? 0),
      conviction_at_entry: pos.convictionAtEntry,
      exit_reason: (pos.exitReason ?? 'manual') as TradeHistoryEntry['exit_reason'],
      hold_duration_days: Math.round(daysHeld * 10) / 10,
      strategy_version: pos.strategyVersion,
      regime_at_entry: pos.regimeAtEntry,
      catalyst: pos.catalyst,
      post_trade_assessment: null, // Populated separately if available
      closed_at: pos.exitTime?.toISOString() ?? new Date().toISOString(),
    };
  });
}

// ─── Active theses ─────────────────────────────────────────────────────────

async function assembleActiveTheses(): Promise<ActiveThesis[]> {
  const theses = await getActiveTheses();

  return theses.map((t) => ({
    asset: t.asset,
    thesis: t.thesisText,
    status: t.status as 'active' | 'watching' | 'invalidated',
    conviction: t.conviction,
    created_at: t.createdAt.toISOString(),
    last_reviewed_at: t.lastReviewedAt.toISOString(),
    supporting_evidence: (t.supportingEvidence as string[]) ?? [],
    counter_evidence: (t.counterEvidence as string[]) ?? [],
    performance_to_date_pct: t.performanceToDatePct ? Number(t.performanceToDatePct) : null,
  }));
}

// ─── Strategy params ───────────────────────────────────────────────────────

async function assembleStrategyParams(): Promise<StrategyParamsData> {
  const params = await getStrategyParams();
  const version = await getCurrentVersion();

  const paramsMap: StrategyParamsData['params'] = {};
  for (const p of params) {
    paramsMap[p.paramName] = {
      current_value: Number(p.currentValue),
      default_value: Number(p.defaultValue),
      min_allowed: Number(p.minAllowed),
      max_allowed: Number(p.maxAllowed),
    };
  }

  return { version, params: paramsMap };
}

// ─── Feedback data ─────────────────────────────────────────────────────────

async function assembleFeedbackData(
  tradeHistory: TradeHistoryEntry[]
): Promise<FeedbackData> {
  const totalTrades = tradeHistory.length;

  function computeWinRate(trades: TradeHistoryEntry[]): number | null {
    if (trades.length === 0) return null;
    const wins = trades.filter((t) => t.net_pnl > 0).length;
    return wins / trades.length;
  }

  const last10 = tradeHistory.slice(0, 10);
  const last20 = tradeHistory.slice(0, 20);

  const wins = tradeHistory.filter((t) => t.net_pnl > 0);
  const losses = tradeHistory.filter((t) => t.net_pnl <= 0);

  const avgWinPct = wins.length > 0
    ? wins.reduce((sum, t) => {
        const pct = t.entry_price > 0
          ? ((t.exit_price - t.entry_price) / t.entry_price) * 100
          : 0;
        return sum + pct;
      }, 0) / wins.length
    : null;

  const avgLossPct = losses.length > 0
    ? losses.reduce((sum, t) => {
        const pct = t.entry_price > 0
          ? ((t.exit_price - t.entry_price) / t.entry_price) * 100
          : 0;
        return sum + pct;
      }, 0) / losses.length
    : null;

  // Performance by version
  const byVersion: FeedbackData['performance_by_version'] = {};
  for (const trade of tradeHistory) {
    const v = trade.strategy_version;
    if (!byVersion[v]) {
      byVersion[v] = { trades: 0, win_rate: 0, avg_pnl_pct: 0 };
    }
    byVersion[v].trades++;
  }
  for (const v of Object.keys(byVersion)) {
    const vTrades = tradeHistory.filter((t) => t.strategy_version === v);
    const vWins = vTrades.filter((t) => t.net_pnl > 0).length;
    byVersion[v].win_rate = vTrades.length > 0 ? vWins / vTrades.length : 0;
    byVersion[v].avg_pnl_pct = vTrades.length > 0
      ? vTrades.reduce((sum, t) => {
          return sum + (t.entry_price > 0
            ? ((t.exit_price - t.entry_price) / t.entry_price) * 100
            : 0);
        }, 0) / vTrades.length
      : 0;
  }

  // BTC benchmark delta from portfolio state will be populated separately
  return {
    win_rate_last_10: computeWinRate(last10),
    win_rate_last_20: computeWinRate(last20),
    win_rate_all: totalTrades > 0 ? computeWinRate(tradeHistory) : null,
    avg_win_size_pct: avgWinPct,
    avg_loss_size_pct: avgLossPct,
    best_catalyst_types: [], // Would require NLP analysis of catalyst strings
    worst_catalyst_types: [],
    regime_accuracy_score: null, // Computed from regime history vs actual outcomes
    btc_benchmark_delta_pct: 0, // Will be set from portfolio data
    performance_by_version: byVersion,
  };
}

// ─── Main assembly ─────────────────────────────────────────────────────────

export async function assembleDataPackage(
  evaluationType: EvaluationType = 'swing_l2'
): Promise<DataPackage> {
  console.log(`[DataPackage] Assembling data package for ${evaluationType} evaluation...`);

  // Step A: Portfolio state
  const portfolio = await assemblePortfolioState();
  console.log(`[DataPackage] Portfolio: $${portfolio.total_value_usd.toFixed(2)} total, ${portfolio.positions.length} open positions`);

  // Step B: Price data for all assets
  const priceDataResults = await Promise.allSettled(
    ALL_ASSETS.map((asset) => fetchPriceData(asset))
  );

  const priceData: PriceData[] = [];
  for (let i = 0; i < ALL_ASSETS.length; i++) {
    const result = priceDataResults[i];
    if (result.status === 'fulfilled' && result.value) {
      priceData.push(result.value);
    } else {
      const reason = result.status === 'rejected' ? result.reason : 'no data';
      console.error(`[DataPackage] Failed to fetch price data for ${ALL_ASSETS[i]}:`, reason);
    }
  }

  // Step C: Technical indicators
  const btcPriceData = priceData.find((pd) => pd.asset === 'BTC');
  const technicals = computeTechnicals(priceData, btcPriceData);

  // Step E: Trade history
  const tradeHistory = await assembleTradeHistory();

  // Step F: Active theses
  const activeTheses = await assembleActiveTheses();

  // Step G: Strategy params
  const strategyParams = await assembleStrategyParams();

  // Step H: Feedback data
  const feedback = await assembleFeedbackData(tradeHistory);
  feedback.btc_benchmark_delta_pct = portfolio.btc_benchmark.outperformance_pct;

  const dataPackage: DataPackage = {
    portfolio,
    price_data: priceData,
    technicals,
    trade_history: tradeHistory,
    active_theses: activeTheses,
    strategy_params: strategyParams,
    feedback,
    evaluation_type: evaluationType,
    timestamp: new Date().toISOString(),
  };

  console.log(
    `[DataPackage] Assembly complete: ${priceData.length} assets, ${technicals.length} indicator sets, ${tradeHistory.length} historical trades`
  );

  return dataPackage;
}
