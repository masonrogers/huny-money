import type { DataPackage } from '@/lib/types/evaluation';

/**
 * Builds the user prompt for a non-daily 8-hour evaluation (Layer 2 only).
 * The current regime is taken from the data package — no regime reassessment.
 */
export function buildSwingPrompt(dataPackage: DataPackage): string {
  const currentRegime =
    dataPackage.portfolio.positions.length > 0
      ? `Current positions are open. Manage them carefully.`
      : `No open positions. Evaluate whether conditions warrant a new entry.`;

  return `## Swing Evaluation — Layer 2 Only

Timestamp: ${dataPackage.timestamp}

This is a standard 8-hour swing evaluation. The market regime was already assessed during today's daily evaluation. Use the regime and exposure cap from the portfolio data — do NOT reassess the regime.

Current regime exposure cap: ${dataPackage.portfolio.regime_exposure_cap_pct}%
Current exposure: ${dataPackage.portfolio.current_exposure_pct}%
${currentRegime}

### Step 1: Position Management

For each open position, assess:
- Is the thesis still intact given any price movement since last evaluation?
- Has conviction changed? If below 50, recommend exit.
- Should the stop loss be adjusted? Apply trailing stop logic:
  - Up 4%+: move stop to breakeven
  - Up 8%+: move stop to +4%
  - Up 12%+: move stop to +8%
  - Continue trailing at 4% intervals
- Time decay: swing trades at 7+ days and flat should exit. At 10 days exit regardless unless extended hold conditions met.
- Should we exit, reduce, add, or hold?

### Step 2: New Trade Evaluation

Scan for new trade opportunities. For each potential trade, verify ALL entry criteria:
1. Identifiable catalyst — a specific, nameable reason for the expected move
2. Directional confirmation — the catalyst is already showing early signs of playing out
3. Risk/reward >= 2:1 — if best available is < 2:1, skip regardless of conviction
4. No major counter-catalyst within the expected holding window
5. Regime alignment — trade direction must align with or be neutral to current regime

Only propose trades where ALL criteria are met and conviction >= 60.

Check correlation rules before proposing:
- BTC + ETH: OK at full sizing
- BTC + SOL: OK at full sizing
- ETH + SOL: combined capped at 50%
- No two tertiary assets simultaneously

### Step 3: Daily Loss Check

Calculate realized losses in the past 24 hours. If >= 4% of total capital, set entries_blocked = true.
Check for cooldown: if 2 consecutive losing trades, no new entries for 24 hours.

### Required JSON Output Schema

Return a JSON object with this exact structure (NO layer_1 field):

{
  "timestamp": "<ISO 8601>",
  "strategy_version": "<current version>",
  "layer_2": {
    "existing_positions": [
      {
        "asset": "<ticker>",
        "type": "swing | core",
        "action": "hold | exit | reduce | add",
        "conviction_now": <0-100>,
        "reasoning": "<why this action>",
        "new_stop_loss": <number or null>,
        "exit_percentage": <number 0-100 or null>
      }
    ],
    "new_trades": [
      {
        "asset": "<ticker>",
        "type": "swing | core",
        "direction": "long",
        "conviction": <60-100>,
        "catalyst": "<specific named catalyst>",
        "confirmation": "<what confirmed the direction>",
        "regime_alignment": "<how this aligns with regime>",
        "entry_price_target": <number>,
        "stop_loss": <number>,
        "take_profit_target": <number>,
        "risk_reward_ratio": <number >= 2.0>,
        "position_size_usd": <number>,
        "position_size_pct": <number 0-0.50>,
        "correlation_check": "<correlation analysis vs existing positions>",
        "expected_hold_days": <number>,
        "reasoning": "<full paragraph explaining the thesis>"
      }
    ],
    "strategy_notes": "<general observations and notes>",
    "daily_loss_check": {
      "realized_losses_24h_pct": <number>,
      "daily_limit_remaining_pct": <number>,
      "entries_blocked": true | false
    }
  }
}

If no action is warranted, set all existing_positions to action "hold" and new_trades to an empty array. This is the expected common case — most evaluations result in no action.

## Data Package

${JSON.stringify(dataPackage, null, 2)}`;
}
