export interface ClosedPosition {
  id: number;
  asset: string;
  type: string;
  direction: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  gross_pnl: number;
  net_pnl: number;
  fees_paid: number;
  conviction_at_entry: number;
  exit_reason: string;
  hold_duration_days: number;
  strategy_version: string;
  regime_at_entry: string;
  catalyst: string | null;
  thesis: string | null;
  reasoning: string | null;
  entry_time: string;
  exit_time: string;
  stop_loss: number;
  take_profit_target: number;
}

export interface PostTradeMarketConditions {
  asset_price_now: number;
  asset_price_24h_after: number | null;
  regime_at_exit: string;
  btc_price_at_entry: number;
  btc_price_at_exit: number;
}

/**
 * Builds the user prompt for a post-trade assessment.
 * Run after every trade closes to capture lessons learned.
 */
export function buildPostTradePrompt(
  trade: ClosedPosition,
  marketConditions: PostTradeMarketConditions
): string {
  const pnlLabel = trade.net_pnl >= 0 ? 'WIN' : 'LOSS';
  const pnlPct =
    trade.entry_price > 0
      ? (
          ((trade.exit_price - trade.entry_price) / trade.entry_price) *
          100
        ).toFixed(2)
      : '0.00';

  return `## Post-Trade Assessment — ${trade.asset} ${pnlLabel}

Analyze this completed trade and provide a lessons-learned assessment.

### Trade Summary

- Asset: ${trade.asset}
- Type: ${trade.type}
- Direction: ${trade.direction}
- Entry price: $${trade.entry_price}
- Exit price: $${trade.exit_price}
- Quantity: ${trade.quantity}
- Gross P&L: $${trade.gross_pnl.toFixed(2)}
- Net P&L (after fees): $${trade.net_pnl.toFixed(2)} (${pnlPct}%)
- Fees paid: $${trade.fees_paid.toFixed(2)}
- Conviction at entry: ${trade.conviction_at_entry}
- Exit reason: ${trade.exit_reason}
- Hold duration: ${trade.hold_duration_days.toFixed(1)} days
- Strategy version: ${trade.strategy_version}
- Regime at entry: ${trade.regime_at_entry}

### Original Thesis
Catalyst: ${trade.catalyst ?? 'not recorded'}
Thesis: ${trade.thesis ?? 'not recorded'}
Reasoning: ${trade.reasoning ?? 'not recorded'}

### Trade Targets vs Actual
- Stop loss was set at: $${trade.stop_loss}
- Take profit target was: $${trade.take_profit_target}
- Actual exit at: $${trade.exit_price}

### Market Context
- ${trade.asset} price now: $${marketConditions.asset_price_now}
${marketConditions.asset_price_24h_after !== null ? `- ${trade.asset} price 24h after exit: $${marketConditions.asset_price_24h_after}` : '- 24h post-exit price: not yet available'}
- Regime at exit: ${marketConditions.regime_at_exit}
- BTC at entry: $${marketConditions.btc_price_at_entry} -> BTC at exit: $${marketConditions.btc_price_at_exit}

### Assessment Questions

1. **Was the catalyst correctly identified?** Did the expected catalyst actually drive the move, or was it something else?

2. **Was timing appropriate?** Did we enter too early, too late, or at the right time?

3. **Was the stop loss correctly placed?** Too tight (stopped out before the real move)? Too loose (gave back too much)?

4. **Was the position size appropriate?** Given the outcome, was the sizing right for the conviction level?

5. **Was the exit well-timed?** If we exited via stop or TP, was the level right? If thesis invalidated, did we exit fast enough?

6. **What would you do differently?** Specific, actionable improvements.

7. **Regime accuracy:** Was the regime assessment at entry correct in hindsight?

### Required JSON Output

Return a JSON object with this structure:

{
  "outcome": "win | loss",
  "grade": "A | B | C | D | F",
  "catalyst_accuracy": "<was the catalyst correctly identified and timed?>",
  "timing_assessment": "<entry and exit timing analysis>",
  "stop_loss_assessment": "<was the stop appropriately placed?>",
  "sizing_assessment": "<was position sizing appropriate?>",
  "key_lesson": "<single most important takeaway from this trade>",
  "what_went_right": "<what worked well>",
  "what_went_wrong": "<what could be improved>",
  "actionable_improvement": "<specific change to make for future trades>",
  "regime_accuracy": "<was the regime assessment correct?>"
}

Grade on a curve: A = excellent execution even if it was a loss (good process, bad luck), F = poor process regardless of outcome.`;
}
