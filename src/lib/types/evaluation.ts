import type { Candle, IndicatorPackage } from './market';
import type {
  RegimeName,
  EvaluationType,
  PositionType,
  ExitReason,
} from './strategy';

// ─── Data Package (Section 14) ─────────────────────────────────────────────

export interface BtcBenchmark {
  btc_price_at_start: number;
  btc_price_now: number;
  btc_hold_return_pct: number;
  system_return_pct: number;
  outperformance_pct: number;
  consecutive_underperformance_days: number;
}

export interface PositionSnapshot {
  asset: string;
  type: PositionType;
  entry_price: number;
  current_price: number;
  quantity: number;
  position_value_usd: number;
  unrealized_pnl_pct: number;
  stop_loss: number;
  take_profit_target: number;
  stop_order_id: string | null;
  tp_order_id: string | null;
  entry_time: string; // ISO 8601
  days_held: number;
  conviction_at_entry: number;
  current_conviction: number;
  strategy_version_at_entry: string;
  thesis: string;
}

export interface PortfolioData {
  total_value_usd: number;
  cash_available: number;
  current_exposure_pct: number;
  regime_exposure_cap_pct: number;
  remaining_deployable_usd: number;
  peak_value_usd: number;
  drawdown_from_peak_pct: number;
  soft_breaker_active: boolean;
  btc_benchmark: BtcBenchmark;
  positions: PositionSnapshot[];
}

export interface PriceData {
  asset: string;
  candles_1h: Candle[];
  candles_4h: Candle[];
  candles_daily: Candle[];
  candles_weekly: Candle[];
}

export interface TechnicalData {
  asset: string;
  daily: IndicatorPackage;
  four_hour: IndicatorPackage;
}

export interface TradeHistoryEntry {
  id: number;
  asset: string;
  type: PositionType;
  direction: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  gross_pnl: number;
  net_pnl: number;
  fees_paid: number;
  conviction_at_entry: number;
  exit_reason: ExitReason;
  hold_duration_days: number;
  strategy_version: string;
  regime_at_entry: string;
  catalyst: string | null;
  post_trade_assessment: string | null;
  closed_at: string; // ISO 8601
}

export interface ActiveThesis {
  asset: string;
  thesis: string;
  status: 'active' | 'watching' | 'invalidated';
  conviction: number;
  created_at: string;
  last_reviewed_at: string;
  supporting_evidence: string[];
  counter_evidence: string[];
  performance_to_date_pct: number | null;
}

export interface StrategyParamsData {
  version: string;
  params: Record<string, {
    current_value: number;
    default_value: number;
    min_allowed: number;
    max_allowed: number;
  }>;
}

export interface FeedbackData {
  win_rate_last_10: number | null;
  win_rate_last_20: number | null;
  win_rate_all: number | null;
  avg_win_size_pct: number | null;
  avg_loss_size_pct: number | null;
  best_catalyst_types: string[];
  worst_catalyst_types: string[];
  regime_accuracy_score: number | null;
  btc_benchmark_delta_pct: number;
  performance_by_version: Record<string, {
    trades: number;
    win_rate: number;
    avg_pnl_pct: number;
  }>;
}

export interface DataPackage {
  portfolio: PortfolioData;
  price_data: PriceData[];
  technicals: TechnicalData[];
  trade_history: TradeHistoryEntry[];
  active_theses: ActiveThesis[];
  strategy_params: StrategyParamsData;
  feedback: FeedbackData;
  evaluation_type: EvaluationType;
  timestamp: string; // ISO 8601
}

// ─── Evaluation Output (Section 15) ────────────────────────────────────────

export interface Layer1Assessment {
  market_regime: RegimeName;
  regime_changed: boolean;
  regime_evidence: string;
  target_exposure_pct: number;
  btc_outlook: string;
  eth_outlook: string;
  sol_outlook: string;
  macro_summary: string;
  active_theses: {
    asset: string;
    thesis: string;
    status: 'active' | 'watching' | 'invalidated';
    conviction: number;
    action: string;
    notes: string;
  }[];
  btc_benchmark_assessment: string;
}

export interface PositionAction {
  asset: string;
  type: PositionType;
  action: 'hold' | 'exit' | 'reduce' | 'add';
  conviction_now: number;
  reasoning: string;
  new_stop_loss: number | null;
  exit_percentage: number | null;
}

export interface TradeProposal {
  asset: string;
  type: PositionType;
  direction: 'long';
  conviction: number;
  catalyst: string;
  confirmation: string;
  regime_alignment: string;
  entry_price_target: number;
  stop_loss: number;
  take_profit_target: number;
  risk_reward_ratio: number;
  position_size_usd: number;
  position_size_pct: number;
  correlation_check: string;
  expected_hold_days: number;
  reasoning: string;
}

export interface DailyLossCheck {
  realized_losses_24h_pct: number;
  daily_limit_remaining_pct: number;
  entries_blocked: boolean;
}

export interface Layer2Decision {
  existing_positions: PositionAction[];
  new_trades: TradeProposal[];
  strategy_notes: string;
  daily_loss_check: DailyLossCheck;
}

export interface EvaluationOutput {
  timestamp: string; // ISO 8601
  strategy_version: string;
  layer_1?: Layer1Assessment; // present only in daily evaluations
  layer_2: Layer2Decision;
}
