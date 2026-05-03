// ─── Market Regime ──────────────────────────────────────────────────────────
export type RegimeName =
  | 'strong_bull'
  | 'mild_bull'
  | 'ranging'
  | 'mild_bear'
  | 'strong_bear';

// ─── Evaluation Types ──────────────────────────────────────────────────────
export type EvaluationType =
  | 'daily_l1l2'
  | 'swing_l2'
  | 'emergency'
  | 'post_restart';

// ─── Position & Order Types ────────────────────────────────────────────────
export type PositionType = 'swing' | 'core';

export type OrderType =
  | 'entry_limit'
  | 'stop_limit'
  | 'take_profit'
  | 'market_exit'
  | 'dca_limit';

// ─── Exit Reasons ──────────────────────────────────────────────────────────
export type ExitReason =
  | 'stop_hit'
  | 'tp_hit'
  | 'thesis_invalidated'
  | 'time_decay'
  | 'conviction_drop'
  | 'regime_override'
  | 'manual';

// ─── Alerts ────────────────────────────────────────────────────────────────
export type AlertType =
  | 'circuit_breaker_soft'
  | 'circuit_breaker_hard'
  | 'daily_loss_limit'
  | 'cooldown_active'
  | 'regime_change'
  | 'stop_triggered'
  | 'tp_triggered'
  | 'order_failed'
  | 'reconciliation_discrepancy'
  | 'btc_underperformance'
  | 'strategy_modification'
  | 'emergency_evaluation';

export type AlertSeverity = 'info' | 'warning' | 'critical';
