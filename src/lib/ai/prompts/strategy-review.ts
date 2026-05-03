export interface StrategyReviewData {
  tradeHistory: {
    id: number;
    asset: string;
    type: string;
    direction: string;
    entry_price: number;
    exit_price: number;
    net_pnl: number;
    fees_paid: number;
    conviction_at_entry: number;
    exit_reason: string;
    hold_duration_days: number;
    strategy_version: string;
    regime_at_entry: string;
    catalyst: string | null;
    post_trade_assessment: string | null;
    closed_at: string;
  }[];
  winRate: number;
  avgWin: number;
  avgLoss: number;
  strategyParams: Record<
    string,
    {
      current_value: number;
      default_value: number;
      min_allowed: number;
      max_allowed: number;
    }
  >;
  regimeAccuracy: number | null;
  benchmarkDelta: number;
}

/**
 * Builds the user prompt for the self-modification strategy review (Section 13).
 * Run after every 5 completed trades or every 30 days.
 */
export function buildStrategyReviewPrompt(
  reviewData: StrategyReviewData
): string {
  return `## Strategy Self-Modification Review

Analyze the trading performance data below and recommend parameter adjustments.

### Performance Summary

- Win rate: ${(reviewData.winRate * 100).toFixed(1)}%
- Average win size: ${reviewData.avgWin.toFixed(2)}%
- Average loss size: ${reviewData.avgLoss.toFixed(2)}%
- Regime detection accuracy: ${reviewData.regimeAccuracy !== null ? `${(reviewData.regimeAccuracy * 100).toFixed(1)}%` : 'insufficient data'}
- BTC benchmark delta: ${reviewData.benchmarkDelta >= 0 ? '+' : ''}${reviewData.benchmarkDelta.toFixed(2)}%
- Total completed trades: ${reviewData.tradeHistory.length}

### Review Checklist

Analyze each of the following:

1. **Stop loss tightness**: Were stops too tight (stopped out before the move happened) or too loose (gave back too much profit)? Look at exit_reason distribution.

2. **Position sizing**: Were positions too aggressive (large losses hurt) or too conservative (wins too small to matter)?

3. **Conviction calibration**: Are high-conviction trades actually performing better than low-conviction ones? Is the entry threshold too low or too high?

4. **Holding period**: Are trades being held too long (time decay exits) or exited too early (missing the full move)?

5. **Catalyst quality**: Which catalyst types produced the best and worst trades?

6. **Regime detection**: How accurately did regime assessments predict actual market conditions?

7. **BTC benchmark**: Is the system outperforming buy-and-hold BTC? If not, what is the primary drag?

8. **Correlation impact**: Did correlated positions amplify losses?

### Adjustable Parameters (with allowed ranges)

${Object.entries(reviewData.strategyParams)
  .map(
    ([name, p]) =>
      `- ${name}: current=${p.current_value}, default=${p.default_value}, range=[${p.min_allowed}, ${p.max_allowed}]`
  )
  .join('\n')}

### What You CAN Adjust
- Conviction thresholds (within +/-10 points of defaults)
- Default stop loss percentage (4-10% range)
- Holding period emphasis
- Take profit staging (e.g., 40/60 instead of 50/50)
- Evaluation cadence (6-12 hour range)
- Asset preferences (weight toward BTC vs ETH vs SOL)
- Trailing stop intervals
- Regime exposure caps (within +/-10% of defaults)
- Core position DCA schedule

### What You CANNOT Adjust (hard guardrails)
- Max single position size (50%)
- Absolute max deployment (70%)
- Min cash reserve (30%)
- Circuit breaker thresholds ($300 hard, 20% soft)
- Min risk/reward ratio (2:1)
- Catalyst requirement
- 60-minimum conviction entry threshold
- Max simultaneous positions (2 swing + 1 core)
- Min position size ($50)
- Tradeable asset universe
- Correlation rules
- Daily loss limit (4%)
- BTC benchmark requirement

### Required JSON Output

Return a JSON object with this structure:

{
  "analysis": "<comprehensive analysis of performance covering all checklist items>",
  "changes": [
    {
      "param_name": "<parameter name>",
      "old_value": <current value>,
      "new_value": <proposed new value>,
      "reasoning": "<specific reasoning based on the data>"
    }
  ],
  "version_increment": "minor | major",
  "overall_assessment": "<is the strategy improving, stable, or deteriorating?>",
  "btc_benchmark_recommendation": "<should we continue active trading or pause and hold BTC?>"
}

If no changes are warranted, return an empty "changes" array. Stability is fine — do not change parameters for the sake of changing them.

If performance is poor and you cannot identify fixable issues, recommend pausing active trading in the btc_benchmark_recommendation field.

### Trade History

${JSON.stringify(reviewData.tradeHistory, null, 2)}`;
}
