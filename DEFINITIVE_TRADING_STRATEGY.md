# Opus Trading Bot — Definitive Strategy Document

## 1. Core Philosophy

This system operates on two layers: a **long-term positioning layer** that manages overall market exposure and builds core holdings based on macro thesis, and a **swing trading layer** that captures medium-term moves driven by specific catalysts. The two layers work together — the long-term layer sets the stage, the swing layer acts on it.

Cash is a position. The bot should spend more time in cash than in trades. If there is nothing compelling, the correct action is nothing.

The edge is not speed. The edge is Opus's ability to synthesize macro conditions, news sentiment, technical structure, on-chain signals, and portfolio context into directional conviction — and then have the discipline to only act when that synthesis produces genuine reasoning. An LLM has no advantage in short-term price prediction. It has a real advantage in narrative interpretation, regime detection, and thesis evaluation over multi-day and multi-week timeframes.

---

## 2. Infrastructure Constraints

The app runs on a **DigitalOcean App Platform instance with no persistent filesystem.** The only thing that survives a restart is the **Postgres database.** The app can be restarted at any time without warning — deployments, platform maintenance, scaling events, health check failures, or container recycling.

This constraint drives every architectural decision in this document:
- Every piece of application state lives in Postgres. No in-memory state is trusted to persist.
- Every timed operation (evaluation schedules, order cancel timers, DCA timers) is stored as a database row with a target timestamp, not an in-memory timer.
- On every boot, the app runs a full reconciliation sequence before doing anything else.
- Exchange-side orders (stop-limits, take-profits) are the safety net, not app-side price monitoring.

---

## 3. Account Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| Starting Capital | $500 | Total risk capital |
| Exchange | Coinbase Advanced Trade | REST API via official SDK |
| Base Currency | USD | All positions measured against USD |
| Circuit Breaker (Hard) | $300 | If account drops to $300 (40% loss from start), halt ALL trading and require human review before resuming |
| Circuit Breaker (Soft) | 20% drawdown from peak | Reduce max position sizes by half until account recovers to within 10% of peak |
| API Cost Budget | Uncapped | API costs handled externally; not factored into P&L requirements |

---

## 4. Two-Layer System

### Layer 1: Long-Term Positioning (The Foundation)

This layer answers the question: **"How much of my capital should be in the market at all, and in what?"**

It manages overall portfolio exposure based on market regime. It does not make individual trades — it sets target allocations that the swing layer operates within.

**Evaluation cadence:** Once per day (during the first scheduled evaluation of the day).

**What it produces:**
- Market regime assessment (bull, bear, chop, uncertain)
- Target overall crypto exposure percentage (0–70%)
- Core holding recommendations (assets worth building long-term positions in)
- Investment theses for each recommended core holding

**How it affects the swing layer:**
- If the long-term layer says "bear market, target exposure 20%," the swing layer cannot deploy more than 20% of capital into trades regardless of conviction.
- If the long-term layer identifies a core holding thesis (e.g., "accumulate ETH ahead of major upgrade"), the swing layer can use that as a catalyst for individual entries.
- The long-term layer can override the swing layer's desire to trade by declaring a "no-trade regime" during extreme uncertainty.

### Layer 2: Swing Trading (The Active Edge)

This layer answers the question: **"Is there a specific, catalyst-driven trade worth taking right now?"**

It operates within the exposure limits set by Layer 1. It handles individual entries, exits, position management, and the tactical execution of trades with a 3–7 day holding horizon.

**Evaluation cadence:** Every 8 hours (three times per day).

---

## 5. Tradeable Assets

The asset universe is intentionally constrained. More assets means more noise, more mediocre trades, and more chances to be wrong.

**Primary (highest liquidity, most data, most predictable catalysts):**
- BTC (Bitcoin)
- ETH (Ethereum)

**Secondary (only when Opus has specific conviction):**
- SOL (Solana)

**Tertiary (requires elevated conviction AND human pre-approval):**
- Top 10–15 assets by market cap on Coinbase (e.g., LINK, AVAX, ADA, DOT, MATIC)
- A tertiary asset may be temporarily added to the active universe if Opus identifies a high-conviction catalyst AND the human operator approves via the dashboard
- Tertiary assets are removed from the active universe after the trade closes

No memecoins. No micro-caps. No tokens Opus cannot find substantial fundamental data on. The bot does not trade anything outside the primary and secondary lists without explicit human approval logged in the database.

---

## 6. Holding Period

**Target: 3–7 days** for swing trades.
**Target: 2–12 weeks** for core long-term positions.

### Swing Trades

- **Minimum:** 24 hours. Nothing shorter. If the thesis requires a sub-day hold, the thesis is wrong for this system.
- **Sweet spot:** 3–5 days. Most swing trades should land here.
- **Maximum:** 10 days. If a swing position hasn't hit its target or stop in 10 days, exit and reassess. The thesis has decayed.
- **Early exit:** Always allowed if the thesis breaks or the stop is hit.
- **Extended hold:** Allowed only if the trend is strong AND Opus re-confirms conviction above 70% on each evaluation cycle. Capped at 14 days absolute maximum.

### Core Positions (Long-Term Layer)

- **Minimum:** 2 weeks. Core positions are not swing trades. If the thesis doesn't justify a multi-week hold, it's a swing trade, not a core position.
- **Target:** 4–8 weeks. These are trend-riding positions built during confirmed bull regimes.
- **Maximum:** 12 weeks. After 12 weeks, force a full thesis reassessment regardless of performance.
- **Thesis expiration:** If a core position hasn't been profitable within 4 weeks, Opus must reassess and either produce a stronger justification or exit.
- **Exit trigger:** Thesis invalidation, regime change to bearish, or conviction drops below 50%.

---

## 7. Evaluation Cadence

### Daily Long-Term Evaluation (Layer 1)

Runs once per day, during the first scheduled evaluation window.

**What happens:**
- Opus reviews weekly and daily candles, macro data, on-chain metrics, and BTC dominance
- Produces or updates market regime assessment
- Sets target overall exposure percentage
- Reviews and updates all active investment theses
- Compares portfolio performance against a BTC benchmark

### Swing Evaluations (Layer 2) — Every 8 Hours

Suggested evaluation windows (UTC):
- 06:00 UTC (Asia session winding down, Europe opening) — **this one includes the daily Layer 1 evaluation**
- 14:00 UTC (US market open overlap)
- 22:00 UTC (US afternoon / Asia pre-open)

**What happens on each evaluation:**
Opus receives a complete data package (see Section 14) and produces a structured decision. Most evaluations result in "no action." That is the expected outcome.

If the bot is in a position, Opus can: hold, adjust stop loss, take partial profit, or exit.
If the bot is in cash, Opus can: enter a new position or stay in cash.

### Emergency Evaluation

If price moves more than 5% in either direction on any primary or secondary asset since the last evaluation, trigger an immediate off-cycle evaluation. This catches flash crashes and parabolic moves between scheduled checks.

**Stateless implementation:** The "last known price at last evaluation" for each asset is stored in the `system_state` table. On boot and on every price check interval, the app fetches current prices, compares against stored values, and triggers an emergency evaluation if the threshold is breached. If a 5%+ move happened during downtime, the post-boot reconciliation (Section 22) will catch it and trigger the emergency evaluation before normal scheduling resumes.

### Scheduling Without In-Memory Timers

All evaluation scheduling is database-driven:
- The `system_state` table stores `next_evaluation_at` as a timestamp.
- On boot, the app reads this value. If it's in the past, a missed evaluation occurred — run it immediately after reconciliation. If it's in the future, calculate the delay and schedule it.
- After each evaluation completes, the app writes the next evaluation timestamp to `system_state`.
- The same pattern applies to every timed operation: order cancel timers (15 min), DCA fallback timers (2 hours), API retry timers (5 min intervals for 30 min). Each is a row in a `pending_timers` table with fields: `timer_id`, `type`, `target_time`, `status` (pending/completed/expired/missed), `related_order_id` or `related_entity`.
- On boot, the app queries `pending_timers` for any rows with `status = 'pending'` and `target_time` in the past. These are resolved in order: expired order cancels are executed, missed DCA fallbacks are evaluated, missed retries are attempted.

---

## 8. Market Regime Detection (Layer 1 Core Function)

Every daily evaluation, Opus classifies the overall crypto market into one of five regimes:

| Regime | Description | Max Allowed Exposure |
|--------|-------------|---------------------|
| Strong Bull | BTC in confirmed uptrend, above 200D MA, rising on volume, macro supportive | 70% |
| Mild Bull | Uptrend but with mixed signals, some macro headwinds | 50% |
| Ranging/Chop | No clear trend, sideways action, low conviction environment | 30% |
| Mild Bear | Downtrend forming, below key MAs, negative macro shifts | 15% |
| Strong Bear | Confirmed downtrend, capitulation signals, hostile macro | 0% (cash only) |

The exposure cap set by the regime is a hard ceiling. The swing layer cannot exceed it. In a Strong Bear regime, the system sits in cash entirely and waits. This single decision — how much to have in the market at all — is the largest driver of long-term survival.

**Regime change rules:**
- Regime can only change by one level per daily evaluation (e.g., Strong Bull → Mild Bull, not Strong Bull → Strong Bear in one step) unless a circuit breaker triggers
- Exception: a circuit breaker event can force an immediate jump to any regime
- Opus must provide specific, written evidence for any regime change
- The current regime is stored in `system_state` and persists across restarts

---

## 9. Conviction Scoring

Every evaluation, Opus assigns a conviction score from 0–100 for each potential trade direction on each asset.

| Score | Meaning | Action |
|-------|---------|--------|
| 0–40 | No edge. Noise. | Stay in cash. Do nothing. |
| 41–59 | Possible setup forming. | Watch. Log reasoning. No trade. |
| 60–69 | Decent setup but missing confirmation. | Small position allowed (20% of capital max). |
| 70–84 | Strong setup with catalyst + confirmation. | Standard position (30–40% of capital). |
| 85–100 | Exceptional setup. Multiple confirming signals. Rare. | Full position (up to 50% of capital). |

**Entry threshold: 60 minimum.** Below 60, no trade is placed regardless of circumstances.

The conviction score is not a vibe. Opus must provide specific, written reasoning for every score. "Feels bullish" is not a reason. "BTC broke above 200-day MA on 2x average volume following positive ETF inflow data, with RSI at 58 leaving room to run" is a reason.

---

## 10. Position Sizing Rules

These are hard limits. The self-modifying strategy (Section 13) cannot override them.

| Rule | Limit | Rationale |
|------|-------|-----------|
| Max single position | 50% of total capital | No all-in bets. Ever. |
| Max total deployment | Regime exposure cap (see Section 8) | Never exceed what the market regime allows. Hard ceiling of 70%. |
| Min cash reserve | 30% of total capital | Survival buffer. Always have dry powder. |
| Max positions open | 2 swing + 1 core = 3 total | Focus. See correlation rules below. |
| Min position size | $50 | Below this, fees eat the trade alive. |

**Sizing formula for swing trades:**

```
position_size = base_allocation * conviction_multiplier

base_allocation = total_capital * 0.30  (30% as default)
conviction_multiplier:
  60-69 conviction → 0.67  (yields ~20% of capital)
  70-84 conviction → 1.00  (yields ~30% of capital)
  85-100 conviction → 1.50  (yields ~45% of capital, capped at 50%)
```

**Core position sizing (long-term layer):**

Core positions are built gradually via dollar-cost averaging, not entered all at once. If Opus recommends a 20% core ETH position, the system builds it over 3–5 entries spread across 1–2 weeks. This protects against buying the local top.

Core positions are also exited gradually — sold in 2–3 tranches over several days when a thesis is invalidated or a regime change occurs.

**Correlation rules:**
- BTC + ETH simultaneously: allowed at full sizing
- BTC + SOL simultaneously: allowed at full sizing
- ETH + SOL simultaneously: combined size capped at 50% of capital (these are highly correlated; both dumping at once is effectively one large position)
- Any two tertiary assets: not allowed. One tertiary position at a time.
- ETH + SOL + any other alt: not allowed. Too much correlated alt exposure.

---

## 11. Entry Criteria (Swing Trades)

Opus must confirm ALL of the following before entering a swing trade:

**1. Identifiable Catalyst**
There must be a specific, nameable reason for the expected move. Examples:
- Macro event (Fed decision, CPI print, regulatory ruling)
- Technical breakout/breakdown from a defined range
- On-chain signal (whale accumulation, exchange outflows, network upgrade)
- Sentiment shift (institutional announcement, ETF flows)
- A thesis from the long-term layer that has reached an actionable inflection point

"It looks like it wants to go up" is not a catalyst.

**2. Directional Confirmation**
The catalyst must already be showing early signs of playing out. The bot does not front-run. It confirms then acts. Examples of confirmation:
- Price broke and held above/below a key level
- Volume spike accompanying the move
- Successive higher lows (bullish) or lower highs (bearish)

**3. Risk/Reward Ratio ≥ 2:1**
The distance to the profit target must be at least 2x the distance to the stop loss. If the stop is 5% away, the target must be at least 10% away.

If the best available risk/reward is 1.5:1 or worse, the trade does not happen regardless of conviction.

**4. No Major Counter-Catalyst**
If a known event could invalidate the thesis within the holding window (e.g., FOMC meeting in 2 days that could reverse the trend), the trade is delayed or skipped.

**5. Regime Alignment**
The trade direction must align with or be neutral to the current market regime. No long swing trades in a Strong Bear regime. No short swing trades in a Strong Bull regime (this system is long-only on Coinbase spot anyway, but the principle applies to staying in cash vs. entering).

---

## 12. Exit Rules

Exits happen for exactly six reasons:

**1. Stop Loss Hit**
Default stop loss: **6% below entry** (for longs).
Adjustable by Opus within a hard range of 4–10%.
Once a position is profitable, Opus can trail the stop to lock in gains.

Trailing stop logic:
- When position is up 4%+, move stop to breakeven.
- When position is up 8%+, move stop to +4%.
- When position is up 12%+, move stop to +8%.
- Continue trailing at 4% intervals.

When Opus adjusts a trailing stop, the app must **cancel the old stop-limit order on Coinbase and place a new one at the updated level.** The exchange-side order is the real stop. The database record is just tracking. If the app dies between cancelling the old stop and placing the new one, the reconciliation sequence (Section 22) will detect the missing stop-limit order and place one immediately on boot.

**2. Take Profit Target Hit**
Staged exits:
- Take 50% of position at first target (the 2:1 R:R target).
- Trail remaining 50% with the trailing stop logic above.

Both the take-profit limit order and the stop-limit order are placed on Coinbase at the time of entry. This means if the app is down, profits still get taken and stops still get hit.

**3. Thesis Invalidated**
If the catalyst no longer applies — news reversed, breakout failed and price reclaimed the range, the expected event didn't happen — exit immediately on the next evaluation. Do not wait for the stop.

**4. Time Decay**
If a swing position has been open for 7+ days and is flat (less than ±2% from entry), exit. The thesis has stalled. The capital is being wasted.

At 10 days, exit regardless of P&L (unless extended hold conditions from Section 6 are met).

For core positions, time decay is assessed at 4 weeks. If flat after 4 weeks, reassess the thesis.

**5. Conviction Drops Below 50%**
If on any evaluation Opus's conviction in the current position drops below 50%, exit. This is distinct from thesis invalidation — it's a general loss of confidence. The market might be sending mixed signals. Get out.

**6. Regime Override**
If the market regime shifts downward (e.g., from Mild Bull to Ranging) and current exposure exceeds the new regime's cap, reduce positions to fit within the new cap. Reduce the lowest-conviction position first. This is a hard rule — regime caps override individual trade conviction.

---

## 13. Self-Modifying Strategy

After every **5 completed trades** (or every 30 days, whichever comes first), Opus conducts a strategy review.

**What Opus reviews:**
- Win rate (trades closed in profit / total trades)
- Average win size vs. average loss size
- Whether stops were too tight (stopped out before the move happened) or too loose (gave back too much profit)
- Whether position sizing was too aggressive or too conservative
- Whether the 8-hour evaluation cadence is appropriate
- Whether the current market regime is trending, ranging, or volatile
- Which catalysts produced the best and worst trades
- BTC benchmark comparison: is the system outperforming a simple BTC buy-and-hold? If not, why not?
- Regime detection accuracy: how often did the regime assessment prove correct in hindsight?
- Thesis quality: which long-term theses played out and which didn't?
- Correlation impact: did correlated positions amplify losses?

**What Opus CAN adjust:**
- Conviction thresholds (within ±10 points of defaults)
- Default stop loss percentage (within 4–10% range)
- Preferred holding period emphasis (shorter or longer within the 3–7 day window for swings)
- Take profit staging (e.g., take 40/60 instead of 50/50)
- Evaluation cadence (6–12 hour range)
- Asset preferences (weight toward BTC vs ETH vs SOL)
- Trailing stop intervals
- Regime exposure caps (within ±10% of defaults, e.g., Mild Bull cap could move from 50% to 40–60%)
- Core position DCA schedule (faster or slower accumulation)

**What Opus CANNOT adjust (hard guardrails):**
- Maximum single position size (50%)
- Absolute maximum total deployment (70%)
- Minimum cash reserve (30%)
- Circuit breaker thresholds ($300 hard, 20% drawdown soft)
- Minimum risk/reward ratio (2:1)
- Requirement for an identifiable catalyst
- The 60-minimum conviction entry threshold
- Maximum number of simultaneous positions (2 swing + 1 core)
- Minimum position size ($50)
- The tradeable asset universe (additions require human approval)
- Correlation rules
- Daily loss limit (4% rolling 24-hour cap)
- The requirement to benchmark against BTC

All strategy modifications must be logged with full reasoning. The human operator should be able to read why every change was made.

**Strategy versioning:**
Every time Opus modifies one or more strategy parameters, the strategy version increments. The initial strategy is v1.0. The first modification produces v1.1, the second v1.2, and so on. Major regime-driven overhauls (3+ parameters changed simultaneously) increment the major version: v1.x → v2.0.

Every trade is tagged with the strategy version it was executed under. This creates clean performance segmentation — you can see that v1.0 had a 45% win rate over 8 trades while v1.1 had a 62% win rate over 10 trades. Without versioning, the self-modification feedback loop is just a pile of parameter changes with no way to measure whether the changes actually helped. The question is not "did the strategy evolve" but "did the strategy improve." Versioning answers that.

All strategy parameters and the current version string are stored in the `strategy_params` table in Postgres. They persist across restarts and are loaded on every boot.

---

## 14. Data Package — What Opus Receives Each Evaluation

Every 8 hours, the app assembles this data from Postgres and live API calls, then sends it to Opus.

### A. Portfolio State

```json
{
  "total_value_usd": 487.32,
  "cash_available": 287.32,
  "current_exposure_pct": 41.1,
  "regime_exposure_cap_pct": 50,
  "remaining_deployable_usd": 43.34,
  "peak_value_usd": 512.00,
  "drawdown_from_peak_pct": 4.82,
  "soft_breaker_active": false,
  "btc_benchmark": {
    "btc_price_at_start": 67000.00,
    "btc_price_now": 69120.00,
    "btc_hold_return_pct": 3.16,
    "system_return_pct": -2.54,
    "outperformance_pct": -5.70,
    "consecutive_underperformance_days": 18
  },
  "positions": [
    {
      "asset": "BTC",
      "type": "swing",
      "entry_price": 68450.00,
      "current_price": 69120.00,
      "quantity": 0.00292,
      "position_value_usd": 201.83,
      "unrealized_pnl_pct": 0.98,
      "stop_loss": 64343.00,
      "take_profit_target": 74726.00,
      "stop_order_id": "cb-order-abc123",
      "tp_order_id": "cb-order-def456",
      "entry_time": "2026-04-28T14:00:00Z",
      "days_held": 4.2,
      "conviction_at_entry": 74,
      "current_conviction": 72,
      "strategy_version_at_entry": "1.0",
      "thesis": "Breakout above 68k resistance on ETF inflow surge"
    }
  ]
}
```

### B. Price Data

OHLCV candles for each asset in the tradeable universe:
- 1-hour candles for the last 48 hours (short-term structure)
- 4-hour candles for the last 14 days (medium-term trend)
- Daily candles for the last 90 days (long-term context)
- Weekly candles for the last 52 weeks (macro trend — used by Layer 1)

### C. Technical Indicators (computed by the app, not by Opus)

For each asset:
- RSI (14-period) on daily and 4-hour
- MACD (12, 26, 9) on daily
- Bollinger Bands (20, 2) on daily
- 50-day and 200-day simple moving averages
- 20-day average volume vs. current volume
- ATR (14-period) for volatility context
- BTC dominance percentage (BTC.D) — critical for alt timing
- BTC correlation coefficient for each alt (30-day rolling)

### D. Macro & On-Chain Context (fetched via web search in the Opus API call)

Opus gets the web search tool enabled so it can pull:
- Latest crypto news and sentiment
- Macro events (Fed rate decisions, CPI prints, regulatory rulings)
- BTC ETF inflow/outflow data
- Major on-chain movements (exchange reserve changes, whale wallet activity, long-term holder behavior)
- Fear & Greed Index
- Funding rates on perpetual futures (even though this system trades spot, funding rates signal market sentiment)
- Upcoming known events (protocol upgrades, token unlocks, halving countdowns)

### E. Trade History

Complete log of all past trades with entry/exit prices, P&L, conviction scores, reasoning, outcome assessment, and strategy version. Include Opus's post-trade review of what went right or wrong.

### F. Active Theses (Layer 1)

All current investment theses with:
- Asset, thesis text, date created, last reviewed, current status (active/watching/invalidated)
- Supporting evidence and counter-evidence observed since creation
- Thesis performance to date

### G. Current Strategy Parameters

The current state of all adjustable strategy parameters loaded from the `strategy_params` table, including the current version string and modification history.

### H. Feedback Data

- Win rate over last 10, 20, and all trades
- Average win size vs. average loss size
- Best and worst performing catalyst types
- Regime detection accuracy score
- BTC benchmark delta (cumulative outperformance or underperformance)
- Performance segmented by strategy version

---

## 15. Opus Decision Output Format

### Daily Evaluation (Layer 1 + Layer 2)

```json
{
  "timestamp": "2026-05-02T06:00:00Z",
  "strategy_version": "1.0",
  "layer_1": {
    "market_regime": "mild_bull",
    "regime_changed": false,
    "regime_evidence": "BTC holding above 200D MA, ETF inflows positive for 8 consecutive days, but CPI print Thursday creates uncertainty",
    "target_exposure_pct": 50,
    "btc_outlook": "...",
    "eth_outlook": "...",
    "sol_outlook": "...",
    "macro_summary": "...",
    "active_theses": [
      {
        "asset": "ETH",
        "thesis": "Accumulate ahead of Pectra upgrade catalyst expected to drive narrative",
        "status": "active",
        "conviction": 65,
        "action": "continue_dca",
        "notes": "3 of 5 planned DCA entries completed"
      }
    ],
    "btc_benchmark_assessment": "System underperforming BTC hold by 2.3% over 45 days. Primary drag is two stopped-out SOL trades. Regime detection has been accurate — the issue is trade selection on alts, not exposure management."
  },
  "layer_2": {
    "existing_positions": [
      {
        "asset": "BTC",
        "type": "swing",
        "action": "hold",
        "conviction_now": 72,
        "reasoning": "...",
        "new_stop_loss": null,
        "exit_percentage": null
      }
    ],
    "new_trades": [
      {
        "asset": "ETH",
        "type": "swing",
        "direction": "long",
        "conviction": 75,
        "catalyst": "specific named catalyst",
        "confirmation": "what confirmed the direction",
        "regime_alignment": "mild_bull supports long entries",
        "entry_price_target": 3850.00,
        "stop_loss": 3619.00,
        "take_profit_target": 4312.00,
        "risk_reward_ratio": 2.0,
        "position_size_usd": 150.00,
        "position_size_pct": 0.30,
        "correlation_check": "No other alt positions open. ETH-BTC correlation at 0.82 — acceptable with current BTC swing position as they share directional thesis.",
        "expected_hold_days": 5,
        "reasoning": "full paragraph explaining the thesis"
      }
    ],
    "strategy_notes": "...",
    "daily_loss_check": {
      "realized_losses_24h_pct": 0.0,
      "daily_limit_remaining_pct": 4.0,
      "entries_blocked": false
    }
  }
}
```

### Standard 8-Hour Evaluation (Layer 2 Only)

Same as the `layer_2` block above, without the `layer_1` section.

If no action is taken, `existing_positions` actions are all "hold" and `new_trades` is an empty array. This is the expected common case.

---

## 16. Risk Management Summary

### Per-Trade Risk

- Max loss per trade: 10% of position value (widest stop) × 50% of capital (max position) = 5% of total capital per trade worst case.
- Typical loss per trade: 6% of position value × 30% of capital = 1.8% of total capital.

### Portfolio-Level Risk

- Two max-size positions both stopped out simultaneously = 10% of capital. Painful but survivable.
- Correlation rules prevent the worst-case scenario of three highly correlated positions all failing at once.
- Soft circuit breaker at 20% drawdown from peak halves position sizes until recovery.
- Hard circuit breaker at $300 (40% drawdown from start) forces a complete halt and human review.

### Behavioral Risk Controls

- **Daily loss limit:** If realized losses in a rolling 24-hour window exceed 4% of total capital, no new entries until the next calendar day. Computed from the `trades` table on demand (`SELECT SUM(realized_loss) FROM trades WHERE closed_at > NOW() - INTERVAL '24 hours'`), not tracked as an in-memory counter. Restart-proof by design.
- **Cooldown after losses:** After 2 consecutive losing trades, Opus must wait at least 24 hours before entering a new position (prevents revenge trading). Computed from the last 2 closed trades in the `trades` table. If a cooldown is active, the `cooldown_until` timestamp is stored in `system_state`.
- **Win streak check:** After 3 consecutive wins, Opus must explicitly check for overconfidence in its reasoning (prevents complacency).
- **Drawdown scaling:** If account is down 15%+ from peak, reduce max single position size to 35% until account recovers to within 10% of peak. Peak value is stored in `system_state` and updated whenever total portfolio value exceeds the stored peak.
- **Regime respect:** No fighting the regime. If the regime says low exposure, low exposure it is. No "but this one trade is different" exceptions.

### BTC Benchmark Accountability

If the system underperforms a simple BTC buy-and-hold for 60 consecutive days, Opus must produce a written assessment explaining why and what should change. If it cannot identify a fixable issue, it should recommend pausing active trading and defaulting to a BTC core hold until conditions improve. This is the ultimate honesty check — if the AI can't beat doing nothing, the AI should do nothing.

The number of consecutive underperformance days is stored in `system_state` and included in every data package so Opus is always aware of where it stands.

---

## 17. Fee Accounting

All P&L calculations must account for Coinbase fees.

- **Maker fee:** ~0.4% (limit orders)
- **Taker fee:** ~0.6% (market orders)
- Prefer limit orders where possible to reduce fees.
- Round-trip cost estimate: ~1.0% per trade (entry + exit).
- Fee drag is tracked as a separate line item in performance reports so you can see how much active trading is costing vs. holding.

---

## 18. Logging Requirements

Every evaluation and every trade must be logged to the database with full context.

**Evaluation logs:**
- Timestamp, complete data package sent (or a hash/reference to avoid storing megabytes of candle data repeatedly), complete Opus response, any actions taken, whether this was a scheduled, emergency, or post-restart evaluation.

**Trade logs:**
- Entry: timestamp, asset, type (swing/core), direction, price, quantity, fees, conviction score, catalyst, reasoning, regime at entry, strategy version, Coinbase order IDs for entry/stop/take-profit.
- Exit: timestamp, price, quantity, fees, P&L (gross and net of fees), exit reason, hold duration, cost basis, realized gain/loss.
- Post-trade: Opus's assessment of what went right or wrong.

Every completed crypto trade is a taxable event in the US. The `cost_basis` and `realized_gain_loss` fields are computed at close and stored with every trade from day one. On $500 the tax implications are trivial, but if this system ever scales up, you want clean records built in from the start — not retrofitted six months later when you realize you need them for Schedule D.

**Layer 1 logs:**
- Daily regime assessment with evidence.
- Thesis creation, updates, and invalidation with full reasoning.
- Target exposure changes with justification.
- BTC benchmark comparison.

**Strategy modification logs:**
- What changed, old value, new value, Opus's reasoning, trade history that motivated the change, new version number.

**Feedback loop logs:**
- Rolling performance metrics updated after each trade close.
- Catalyst effectiveness scores (which types of catalysts produce winning trades).
- Regime detection accuracy (was the regime call correct in hindsight?).

**Reconciliation logs:**
- Every boot: timestamp, downtime duration, discrepancies found between database state and Coinbase state, actions taken to reconcile.

---

## 19. Order Execution Rules

- **Entry orders (swing):** Use limit orders placed slightly above the current ask (for longs). If not filled within 15 minutes, cancel and reassess on the next evaluation. The 15-minute cancel timer is stored in the `pending_timers` table.
- **Entry orders (core DCA):** Use limit orders at or slightly below current market price. If not filled within 2 hours, use market order to ensure the DCA schedule stays on track. The 2-hour fallback timer is stored in the `pending_timers` table.
- **Stop loss orders:** Use stop-limit orders on Coinbase. Set the limit price 0.5% below the stop trigger to ensure fills in fast markets. These are placed on the exchange immediately when a position is opened.
- **Take profit orders:** Use limit orders at the target price. Placed on the exchange immediately when a position is opened.
- **Emergency exits:** Use market orders only for emergency exits (thesis invalidated, circuit breaker hit, regime override).
- **Gradual exits (core positions):** Split into 2–3 limit orders spread across 1–3 days.

Never chase a fill. If the price has moved significantly from where Opus made the decision, the risk/reward has changed. Recalculate, don't blindly execute.

**Partial fill handling:**
When a limit order is partially filled before the cancel timer hits:
- If filled ≥60% of intended size: keep the partial position. Manage it with the same stop loss and take profit targets (adjust order quantities on Coinbase to match the actual filled amount). The position is smaller than planned but large enough to justify the overhead.
- If filled <60% of intended size: cancel the remainder. The partial fill is too small to manage as a real trade. Exit the partial position with a market order immediately — do not hold it waiting for breakeven. The cost of a small market-order loss on a sub-$50 position is less than the cost of carrying an orphan position through subsequent evaluation cycles.

**Exchange failure handling:**
Coinbase's API will go down. Rate limits will be hit. Maintenance windows will overlap with evaluations. Rules for when this happens:
- If the API is unreachable during a scheduled evaluation, retry every 5 minutes for 30 minutes. Each retry is a row in `pending_timers`.
- If still unreachable after 30 minutes, log a missed evaluation and skip it. Do not attempt to "catch up" with double actions on the next successful evaluation. One evaluation, one set of decisions.
- Existing stop-limit and take-profit orders already placed on the exchange will still execute during outages — that is their entire purpose.
- If the bot has open positions and cannot reach the API for more than 2 hours, send an alert to the human operator. The bot cannot trail stops, exit on thesis invalidation, or respond to regime changes while disconnected. The human may need to act manually.
- After connectivity is restored, run the full reconciliation sequence (Section 22) before the next evaluation.

**Order ID tracking:**
Every order placed on Coinbase is stored in an `orders` table with fields: `order_id` (from Coinbase), `type` (entry_limit/stop_limit/take_profit/market_exit/dca_limit), `asset`, `side`, `price`, `quantity`, `status` (pending/filled/partially_filled/cancelled/expired), `related_position_id`, `placed_at`, `filled_at`, `fill_price`, `fill_quantity`. This table is the source of truth for reconciliation — on boot, every order with `status = 'pending'` is checked against Coinbase's order history API to determine its actual state.

---

## 20. Database Schema

All state lives in Postgres. The schema is organized by function.

### Core State Tables

**`system_state`** — Key-value store for singleton app state.
```
key                         | value                    | updated_at
----------------------------|--------------------------|-------------------
next_evaluation_at          | 2026-05-02T14:00:00Z     | 2026-05-02T06:01:12Z
current_regime              | mild_bull                | 2026-05-02T06:01:12Z
strategy_version            | 1.0                      | 2026-05-01T00:00:00Z
peak_value_usd              | 512.00                   | 2026-04-29T14:01:00Z
btc_price_at_start          | 67000.00                 | 2026-04-15T00:00:00Z
last_btc_price_at_eval      | 69120.00                 | 2026-05-02T06:01:12Z
last_eth_price_at_eval      | 3820.00                  | 2026-05-02T06:01:12Z
last_sol_price_at_eval      | 178.50                   | 2026-05-02T06:01:12Z
cooldown_until              | null                     | 2026-05-01T22:01:00Z
paper_trading_mode          | false                    | 2026-04-15T00:00:00Z
trading_paused              | false                    | 2026-04-15T00:00:00Z
last_successful_boot_at     | 2026-05-02T05:58:30Z     | 2026-05-02T05:58:30Z
consecutive_underperf_days  | 18                       | 2026-05-02T06:01:12Z
target_exposure_pct         | 50                       | 2026-05-02T06:01:12Z
```

**`strategy_params`** — All adjustable strategy parameters with version history.
```
param_name          | current_value | default_value | min_allowed | max_allowed | version_changed | changed_reason
--------------------|---------------|---------------|-------------|-------------|-----------------|----------------
default_stop_pct    | 6             | 6             | 4           | 10          | 1.0             | initial
entry_threshold     | 60            | 60            | 50          | 70          | 1.0             | initial
eval_cadence_hours  | 8             | 8             | 6           | 12          | 1.0             | initial
tp_first_exit_pct   | 50            | 50            | 30          | 70          | 1.0             | initial
trailing_interval   | 4             | 4             | 2           | 6           | 1.0             | initial
...
```

### Position & Order Tables

**`positions`** — All open and closed positions.
```
id | asset | type (swing/core) | status (open/closed) | direction | entry_price | quantity |
   entry_time | exit_price | exit_time | stop_loss | take_profit_target | conviction_at_entry |
   current_conviction | catalyst | thesis | reasoning | exit_reason | gross_pnl | net_pnl |
   fees_paid | cost_basis | realized_gain_loss | strategy_version | regime_at_entry |
   stop_order_id | tp_order_id | entry_order_id
```

**`orders`** — Every order placed on Coinbase.
```
id | coinbase_order_id | type (entry_limit/stop_limit/take_profit/market_exit/dca_limit) |
   asset | side | price | quantity | status (pending/filled/partially_filled/cancelled/expired) |
   related_position_id | placed_at | filled_at | fill_price | fill_quantity | cancel_reason
```

**`pending_timers`** — All scheduled future actions.
```
id | type (order_cancel/dca_fallback/api_retry/evaluation) | target_time |
   status (pending/completed/expired/missed) | related_order_id | related_entity | created_at
```

### Analysis Tables

**`evaluations`** — Log of every Opus evaluation.
```
id | timestamp | type (daily_l1l2/swing_l2/emergency/post_restart) | data_package_hash |
   opus_response (jsonb) | actions_taken (jsonb) | strategy_version
```

**`theses`** — Layer 1 investment theses.
```
id | asset | thesis_text | status (active/watching/invalidated) | conviction |
   created_at | last_reviewed_at | invalidation_reason | supporting_evidence (jsonb) |
   counter_evidence (jsonb) | performance_to_date_pct
```

**`strategy_modifications`** — Self-modification audit trail.
```
id | from_version | to_version | timestamp | params_changed (jsonb) |
   reasoning | trade_count_at_modification | win_rate_at_modification |
   btc_benchmark_delta_at_modification
```

**`regime_history`** — Regime assessment history for accuracy tracking.
```
id | regime | evidence | assessed_at | was_correct (boolean, filled in retrospectively)
```

**`reconciliation_log`** — Boot reconciliation audit trail.
```
id | boot_at | downtime_seconds | discrepancies_found (jsonb) | actions_taken (jsonb)
```

---

## 21. Coinbase API Endpoints Required

The app needs these Coinbase Advanced Trade API capabilities:

- `GET /api/v3/brokerage/accounts` — check balances
- `GET /api/v3/brokerage/market/products/{product_id}/candles` — OHLCV data
- `GET /api/v3/brokerage/market/products/{product_id}/ticker` — current price
- `GET /api/v3/brokerage/market/products/{product_id}/product_book` — order book depth
- `POST /api/v3/brokerage/orders` — place orders (limit, stop-limit, market)
- `GET /api/v3/brokerage/orders/historical` — check order status and fills
- `GET /api/v3/brokerage/orders/historical/{order_id}` — check specific order status (used during reconciliation)
- `DELETE /api/v3/brokerage/orders/batch_cancel` — cancel unfilled orders

Trading pairs: BTC-USD, ETH-USD, SOL-USD (plus any human-approved tertiary pairs).

**API key permissions: TRADE ONLY. Never enable withdrawal permissions.** If the server is compromised, an attacker can make bad trades but cannot steal funds. This is a non-negotiable security constraint.

---

## 22. Boot & Reconciliation Sequence

This runs on every app start — cold start, restart, crash recovery, deployment. It is the most safety-critical code in the entire system.

### Step 1: Health Check
1. Verify Postgres connectivity.
2. Verify Coinbase API connectivity and permissions.
3. If either fails, log the failure, send an alert, and do not proceed. Retry every 60 seconds.

### Step 2: Determine Context
1. Read `last_successful_boot_at` from `system_state`.
2. Calculate downtime duration.
3. Log this in `reconciliation_log`.

### Step 3: Reconcile Orders
1. Query `orders` table for all rows with `status = 'pending'`.
2. For each pending order, call `GET /api/v3/brokerage/orders/historical/{order_id}` to get actual status from Coinbase.
3. For each order that filled during downtime:
   - If it was an entry order: update the order row, confirm the position in the `positions` table, verify that the corresponding stop-limit and take-profit orders are still active on Coinbase.
   - If it was a stop-limit: update the order row, close the position in the `positions` table with the actual fill price, compute P&L, cost basis, realized gain/loss.
   - If it was a take-profit: same as stop-limit. If it was the staged 50% take-profit, update the position quantity and adjust the remaining stop-limit order quantity on Coinbase.
4. For each order that was cancelled or expired during downtime: update the order row and log the reason.
5. For orders that are still pending on Coinbase: leave them. They're fine.

### Step 4: Reconcile Balances
1. Fetch actual balances from Coinbase.
2. Compare against expected balances derived from the `positions` and `orders` tables.
3. If there is a discrepancy greater than 1% of total capital, log it as a warning and alert the human operator. Do not auto-correct — a discrepancy here could mean an untracked manual trade, a fee miscalculation, or something worse.
4. If discrepancy is minor (rounding, fee estimation), silently adjust the database to match Coinbase.

### Step 5: Verify Position Safety
1. For every open position in the `positions` table, verify that a corresponding stop-limit order exists and is active on Coinbase.
2. If a position has no active stop-limit order (e.g., the app crashed between cancelling an old stop and placing a new one during a trailing stop update), **place a stop-limit order immediately** at the position's current `stop_loss` value. This is the highest priority action in the entire reconciliation sequence. An unprotected position is the most dangerous state the system can be in.
3. Verify take-profit orders similarly.

### Step 6: Check for Missed Evaluations
1. Read `next_evaluation_at` from `system_state`.
2. If the scheduled time is in the past, a missed evaluation occurred during downtime.
3. Do not run multiple catch-up evaluations. Run exactly one evaluation now (after reconciliation completes). If a Layer 1 daily evaluation was missed, include it. One evaluation, one set of decisions, regardless of how many were missed.

### Step 7: Check Emergency Thresholds
1. For each primary and secondary asset, fetch current price and compare against `last_*_price_at_eval` in `system_state`.
2. If any asset moved more than 5% during downtime, flag the upcoming evaluation as an emergency evaluation (include emergency context in the data package).

### Step 8: Resume Normal Operations
1. Update `last_successful_boot_at` in `system_state`.
2. Schedule the next evaluation (either the catch-up evaluation from Step 6, or the next scheduled one if nothing was missed).
3. Resume the normal evaluation cycle, price monitoring for emergency triggers, and timer resolution loop.
4. Log the full reconciliation outcome in `reconciliation_log`.

---

## 23. System Startup Sequence (First Launch Only)

When the bot launches for the very first time (no existing data in Postgres):

1. Verify Coinbase API connectivity and permissions (trade only — never withdrawal permissions).
2. Fetch current account balance and confirm starting capital is available.
3. Initialize all `system_state` values to defaults.
4. Initialize all `strategy_params` to defaults from this document with version 1.0.
5. Record starting BTC price for benchmark tracking.
6. Set `paper_trading_mode = true`.
7. Run the first Layer 1 evaluation immediately to establish market regime.
8. Log the initial state.
9. Begin the 8-hour evaluation cycle.

The first trade should not happen on the first evaluation. Opus needs at least 2–3 evaluation cycles (16–24 hours) to establish market context before acting. The system prompt should instruct it to observe first.

**Paper trading phase:** Run the full system without executing real trades for at least 2–4 weeks. Log all hypothetical trades as if they were real, including computing hypothetical P&L based on price at the time the order would have filled. Evaluate performance against BTC benchmark. Only go live (set `paper_trading_mode = false` via dashboard) when:
- The system has generated hypothetical signals for at least 20 evaluation cycles
- Win rate on hypothetical trades exceeds 50%
- Average win is larger than average loss
- Regime detection has been directionally correct at least 60% of the time
- You have manually reviewed at least 10 of Opus's reasoning outputs and found them coherent

---

## 24. What Success Looks Like

**Month 1:** System is live. Net positive after fees. Even $5 profit is a success. Regime detection is producing coherent assessments. The system is spending most of its time in cash, which is correct.

**Month 3:** Consistent positive returns net of fees. Win rate of 55%+ with average wins larger than average losses. System has outperformed BTC hold in at least 1 of the 3 months. Strategy has self-modified at least once based on evidence.

**Month 6:** Strategy has self-modified 2–3 times based on market conditions. The system trades differently in a bull market vs. a chop zone. Account value is meaningfully above starting capital. Long-term thesis layer has correctly identified at least one major regime shift. BTC benchmark delta is positive on a cumulative basis.

**Month 12:** Account has survived at least one significant drawdown (10%+) and recovered. The self-modifying strategy has produced a measurably different parameter set from the defaults. The system has a documented track record that can be evaluated for whether to increase capital allocation.

**What failure looks like:** Account hits $300 circuit breaker within the first 2 months. This means either the regime detection failed, the swing trade selection was poor, or the market was simply hostile. Halt, review all logs, identify the failure mode, adjust, and restart with lessons learned. Failure is information, not a death sentence — but never restart without understanding what went wrong.

---

## 25. Dashboard Requirements (Next.js Frontend)

The dashboard is not optional. It is how you maintain oversight of a system that is spending your money.

**Portfolio Overview:**
- Current total value, cash balance, deployed percentage vs. regime cap
- Equity curve chart with BTC benchmark overlay
- Current market regime indicator with color coding
- Drawdown chart (distance from peak)
- Soft/hard circuit breaker status indicators
- System uptime and last boot time

**Position Cards:**
- Each open position: asset, type (swing/core), allocation %, entry price, current price, unrealized P&L, stop loss, target, conviction at entry, current conviction, days held, thesis summary
- Coinbase order status for each position's stop-limit and take-profit orders (confirms exchange-side protection is active)

**Trade History:**
- Sortable/filterable log of all completed trades
- Each entry shows: asset, entry/exit prices, P&L (gross and net), hold duration, exit reason, Opus's reasoning, Opus's post-trade assessment, strategy version, cost basis, realized gain/loss

**Layer 1 Dashboard:**
- Current regime with evidence summary
- Active theses with status indicators
- Target exposure vs. actual exposure gauge
- BTC benchmark comparison (rolling 30-day, 60-day, all-time)
- Consecutive underperformance day counter with 60-day warning threshold

**Signal Feed:**
- Scrollable feed of all Opus evaluations with full reasoning
- Color-coded: green for entries, red for exits, gray for no-action, blue for regime changes
- Flagged entries for post-restart and emergency evaluations

**Strategy Review Log:**
- History of all self-modifications with version number, old/new values and reasoning
- Performance metrics segmented by strategy version
- Performance metrics at time of each modification

**Reconciliation Log:**
- History of every boot: downtime duration, discrepancies found, actions taken
- Flagged entries for reconciliations that found issues (order fills during downtime, missing stops, balance discrepancies)

**Manual Controls:**
- Pause all trading (one click)
- Close all positions (one click, with confirmation)
- Override market regime (with logging)
- Approve/deny tertiary asset requests
- Adjust hard guardrail values (with confirmation and logging)
- Force immediate evaluation
- Toggle paper trading mode
- Force reconciliation (re-run Section 22 without restarting the app)

**Alerts:**
- Circuit breaker triggered (soft or hard)
- Regime change
- Trade executed
- Thesis invalidated
- Strategy self-modification occurred
- BTC benchmark underperformance exceeds 30 days
- Position approaching stop loss
- Daily loss limit reached (4% cap hit)
- Exchange API unreachable for 2+ hours with open positions
- Missed evaluation due to API outage or app downtime
- Reconciliation found discrepancies (especially missing stop-limit orders)
- App restarted (with downtime duration)
- Balance discrepancy detected during reconciliation
