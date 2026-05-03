import type { DataPackage } from '@/lib/types/evaluation';

/**
 * Builds the user prompt for a daily evaluation (Layer 1 + Layer 2).
 * This is the most comprehensive evaluation, run once per day during
 * the first scheduled evaluation window.
 */
export function buildDailyPrompt(dataPackage: DataPackage): string {
  return `## Daily Evaluation — Layer 1 (Regime) + Layer 2 (Trading)

Timestamp: ${dataPackage.timestamp}

Perform a full daily evaluation. Follow these steps in order:

### Step 1: Market Regime Assessment (Layer 1)

Assess the current market regime based on the data provided. Consider:
- BTC price relative to 50-day and 200-day moving averages
- Volume trends across all assets
- RSI levels and momentum indicators
- Macro conditions and sentiment
- Weekly candle structure for trend confirmation

Classify into one of: strong_bull, mild_bull, ranging, mild_bear, strong_bear.
Remember: regime can only change by ONE level per evaluation unless a circuit breaker triggers.

Provide:
- The regime classification with specific evidence
- Target exposure percentage matching the regime
- Individual outlook for BTC, ETH, and SOL
- A macro summary of conditions
- BTC benchmark assessment comparing system performance to buy-and-hold

### Step 2: Thesis Management

Review all active theses. For each:
- Is the thesis still valid? What new evidence supports or contradicts it?
- Should conviction be adjusted?
- Should status change (active/watching/invalidated)?
- What action should be taken (continue, enter, exit, add)?

### Step 3: Position Management (Layer 2)

For each open position, assess:
- Is the thesis still intact?
- Has conviction changed?
- Should the stop loss be adjusted (trailing stop logic)?
- Should we exit, reduce, add, or hold?
- Time decay: has the position been open too long?

### Step 4: New Trade Evaluation (Layer 2)

Scan for new trade opportunities. For each potential trade, verify ALL entry criteria:
1. Identifiable catalyst
2. Directional confirmation
3. Risk/reward >= 2:1
4. No major counter-catalyst in the holding window
5. Regime alignment

Only propose trades where ALL criteria are met and conviction >= 60.

### Step 5: Daily Loss Check

Calculate realized losses in the past 24 hours as a percentage of total capital.
If losses exceed 4%, flag entries_blocked = true and do NOT propose new trades.

### Required JSON Output Schema

Return a JSON object with this exact structure:

{
  "timestamp": "<ISO 8601>",
  "strategy_version": "<current version>",
  "layer_1": {
    "market_regime": "strong_bull | mild_bull | ranging | mild_bear | strong_bear",
    "regime_changed": true | false,
    "regime_evidence": "<specific evidence for the regime assessment>",
    "target_exposure_pct": <number 0-70>,
    "btc_outlook": "<BTC analysis>",
    "eth_outlook": "<ETH analysis>",
    "sol_outlook": "<SOL analysis>",
    "macro_summary": "<macro conditions summary>",
    "active_theses": [
      {
        "asset": "<ticker>",
        "thesis": "<thesis text>",
        "status": "active | watching | invalidated",
        "conviction": <0-100>,
        "action": "<what to do>",
        "notes": "<additional context>"
      }
    ],
    "btc_benchmark_assessment": "<how system is performing vs BTC hold>"
  },
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

If no action is warranted, existing_positions should all have action "hold" and new_trades should be an empty array. This is the expected common case.

## Data Package

${JSON.stringify(dataPackage, null, 2)}`;
}
