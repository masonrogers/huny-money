import type { PositionType, RegimeName } from './strategy';

export interface PositionWithPrice {
  id: number;
  asset: string;
  type: PositionType;
  direction: string;
  entry_price: number;
  current_price: number;
  quantity: number;
  cost_basis: number;
  position_value_usd: number;
  unrealized_pnl_usd: number;
  unrealized_pnl_pct: number;
  stop_loss: number;
  take_profit_target: number;
  stop_order_id: string | null;
  tp_order_id: string | null;
  entry_time: string; // ISO 8601
  days_held: number;
  conviction_at_entry: number;
  current_conviction: number;
  strategy_version: string;
  catalyst: string | null;
  thesis: string | null;
}

export interface PortfolioState {
  total_value_usd: number;
  cash_usd: number;
  deployed_usd: number;
  exposure_pct: number;
  regime: RegimeName;
  regime_exposure_cap_pct: number;
  remaining_deployable_usd: number;
  peak_value_usd: number;
  drawdown_from_peak_pct: number;
  soft_breaker_active: boolean;
  hard_breaker_active: boolean;
  positions: PositionWithPrice[];
  strategy_version: string;
}
