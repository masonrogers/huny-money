import type { DataPackage } from '@/lib/types/evaluation';

export interface EmergencyTrigger {
  asset: string;
  priceChange: number;
  direction: string;
}

/**
 * Builds the user prompt for an emergency evaluation triggered by a 5%+ price move.
 * Focuses on immediate risk assessment: should we act on this move?
 */
export function buildEmergencyPrompt(
  dataPackage: DataPackage,
  trigger: EmergencyTrigger
): string {
  const moveDescription =
    trigger.direction === 'up'
      ? `${trigger.asset} surged ${Math.abs(trigger.priceChange).toFixed(1)}% since the last evaluation`
      : `${trigger.asset} dropped ${Math.abs(trigger.priceChange).toFixed(1)}% since the last evaluation`;

  return `## EMERGENCY EVALUATION — ${trigger.asset} ${trigger.direction.toUpperCase()} ${Math.abs(trigger.priceChange).toFixed(1)}%

Timestamp: ${dataPackage.timestamp}

**TRIGGER:** ${moveDescription}

This is an off-cycle emergency evaluation triggered because ${trigger.asset} moved more than 5% since the last evaluation. Focus on immediate risk management.

### Priority Questions

1. **Do we hold open positions in ${trigger.asset}?**
   - If yes: Is the thesis still valid given this move? Should stops be adjusted? Should we exit immediately?
   - If the move is AGAINST our position: Is the stop still appropriate or has the thesis been invalidated?
   - If the move is IN FAVOR of our position: Should we trail the stop? Take partial profit?

2. **Do we hold positions in correlated assets?**
   - A major move in ${trigger.asset} likely affects correlated positions.
   - Assess whether correlated positions need stop adjustments.

3. **Is this a regime-changing event?**
   - A 5%+ move can signal a regime shift. If so, note it — but DO NOT change the regime outside of a daily evaluation unless a circuit breaker is triggered.
   - If account value has dropped to $300 or below, the hard circuit breaker triggers — recommend halting all trading.
   - If drawdown from peak exceeds 20%, the soft circuit breaker activates — halve position sizes.

4. **Should we act on this move?**
   - Is this move creating a new entry opportunity?
   - Only if ALL entry criteria are met (catalyst, confirmation, R:R >= 2:1, no counter-catalyst, regime alignment).
   - Do NOT chase. If the move is already extended, wait for a pullback.
   - Check daily loss limits before proposing new entries.

### Required JSON Output Schema

Return a JSON object with this structure (NO layer_1 field — this is an emergency Layer 2 response):

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
        "reasoning": "<why this action — specifically address the ${trigger.asset} move>",
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
        "correlation_check": "<correlation analysis>",
        "expected_hold_days": <number>,
        "reasoning": "<full paragraph — must address why entering during an emergency is justified>"
      }
    ],
    "strategy_notes": "<assessment of the emergency move, what it means, and what to watch for>",
    "daily_loss_check": {
      "realized_losses_24h_pct": <number>,
      "daily_limit_remaining_pct": <number>,
      "entries_blocked": true | false
    }
  }
}

In most emergency evaluations, the correct response is to adjust stops on existing positions and NOT enter new trades. Chasing emergency moves is dangerous.

## Data Package

${JSON.stringify(dataPackage, null, 2)}`;
}
