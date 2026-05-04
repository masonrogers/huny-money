# Huny Money — Trading Strategy v2.0

**Status:** Specification for clean rebuild. Replaces all prior strategy documents.
**Goal:** Make money on a $500 USDC account at Coinbase, trading BTC/ETH/SOL only, within a $50/month Anthropic API budget.
**Audience:** The operator (David) and the implementation agents who will build this.

This document is the single source of truth. There is no companion document. There is no v1.

---

## 1. Goal

**Make money on a $500 account, net of trading fees, while beating BTC buy-and-hold over rolling 60-day windows.**

That is the entire goal. Everything in this spec serves it. If a section can't be traced back to that sentence, it should be cut.

The operator subsidizes the $50/month API cost; it is a budget constraint, not a P&L line item. If the account makes money, the operator adds capital. If the account loses money or persistently underperforms BTC hold, the bot converts to BTC core hold and stops actively trading.

---

## 2. Core Principles (in priority order)

1. **Don't blow up.** Survive first, profit second. The $300 hard floor is sacred.
2. **Default to cash.** Most days, the right action is no action. The bot's job is to wait for setups, not to manufacture them.
3. **Beat BTC hold or stop trading.** The benchmark is buy-and-hold. If the bot can't beat doing nothing, the bot is destroying value. 60-day rolling underperformance → convert to BTC core hold.
4. **Trade catalysts, not feelings.** Every trade requires a specific, named, externally verifiable reason.
5. **Stops are sacred and exchange-side.** Every position has a stop-limit on Coinbase the moment it opens. The bot can adjust them; it cannot remove them.
6. **One model per decision.** Opus decides trades. Sonnet watches and routes. They never overlap on the same decision.
7. **Spend AI on decisions, not chatter.** $50/month is plenty if you only call the model when something might actually change.
8. **Total operator visibility, beautifully presented.** The operator sees every AI decision, every app action, every state change without ambiguity or log diving. The dashboard is a first-class deliverable — frontend quality matches backend quality in effort and polish. The operator should never have to ask "what is the bot doing right now?" or "why did it do that?"

---

## 3. The Strategy

### 3.1 Asset universe

**BTC, ETH, SOL only.** No alts. No memecoins. No tertiary list. No human-approval flow. No exceptions.

Reasoning: $500 is too small to spread across many assets. Liquidity matters at this size. Opus can find substantive data on these three. Adding more is not edge, it's noise.

### 3.2 Three regimes

Daily, Opus classifies the market into one of three regimes. The regime sets a hard exposure ceiling.

| Regime | Description | Max deployed |
|---|---|---|
| **Bull** | BTC making higher highs, above 50d MA, supportive macro | 70% |
| **Chop** | Sideways, no clear trend, mixed signals | 30% |
| **Bear** | BTC below 50d MA, capitulation signs, hostile macro | 0% (cash only) |

Why three not five: simpler classification is more reliable. "Almost bull" and "almost bear" are just bull/bear with lower conviction; they don't deserve their own regime.

Regime can change by one level per day (bull → chop, chop → bear) unless a circuit breaker fires. A regime change requires written evidence in Opus's morning output.

### 3.3 Two layers of position

**Core layer (Bull regime only).** A 25% BTC core position, built via 3 DCA entries spread over 5 days. Held while regime stays Bull. Exited gradually over 3 days when regime drops to Chop or Bear. Provides baseline crypto beta when the trend is favorable.

**Swing layer.** 0–2 active swing trades on top of core. 2–7 day holds. Catalyst-driven. Stop and target set at entry, on the exchange.

Total exposure (core + swing combined) cannot exceed the regime ceiling.

### 3.4 Entry criteria (swing — all required)

1. **Named catalyst.** Specific and verifiable. Examples: "BTC ETF inflows hit 7-day high of $X," "ETH broke $4,200 resistance on 2.1× avg volume," "Fed pivot signaled at FOMC." Not "looks bullish."
2. **Confirmation.** The catalyst is already showing in price action. The bot does not front-run.
3. **Risk:reward ≥ 2:1.** Distance to target ≥ 2× distance to stop.
4. **Conviction ≥ 70.** Below that, watch and wait.
5. **Regime alignment.** Long entries in Bull or Chop only. Never in Bear.
6. **No major counter-catalyst within hold window.** Don't enter the morning before CPI.
7. **Minimum holding period plan: 24 hours.** If the thesis requires a sub-day hold, the thesis is wrong for this system.

### 3.5 Position sizing

| Conviction | Allocation |
|---|---|
| 70–79 | 20% of capital |
| 80–89 | 30% of capital |
| 90–100 | 40% of capital |

Hard maximum single position: **50%**. Hard minimum cash: **30%**. Hard maximum positions: **2 swing + 1 core = 3 total**. Hard minimum position size: **$50** (below this, fees eat the trade).

If a planned swing would push total exposure above the regime ceiling, reduce size or skip.

### 3.6 Exit triggers (any one)

1. **Stop loss hit.** Default 5% below entry, adjustable 4–8% by Opus at entry. Stop is exchange-side from the moment of entry.
2. **Take profit hit.** Take 50% off at the 2:1 R target. Trail the remaining 50% with the trailing stop logic in §3.7.
3. **Thesis invalidated.** The catalyst no longer applies. Exit on next evaluation, market order if needed.
4. **Time decay.** Position is flat (within ±2% of entry) at 5 days → exit. Hard maximum hold: 10 days.
5. **Conviction drops below 50.** General loss of confidence on next evaluation. Exit.
6. **Regime downgrade.** Regime drops below current exposure. Reduce lowest-conviction position first.

### 3.7 Trailing stop logic

When a position is profitable, the stop ratchets up:
- At +4%: stop to breakeven
- At +8%: stop to +4%
- At +12%: stop to +8%
- Continue at 4% intervals

When the stop is moved, the app cancels the old stop-limit on Coinbase and places a new one. If the app dies between cancel and replace, boot reconciliation (§6.1) detects the gap and places a stop immediately. **An unprotected position is the most dangerous state the system can be in.**

### 3.8 Catalyst categories (guidance, not a checklist)

This is what the bot looks for. Listed so Opus's prompt can include them as priors.

- **Macro:** Fed decisions, CPI prints, FOMC minutes, jobs data, dollar/yields shifts
- **Crypto-specific:** BTC ETF inflow/outflow extremes, GBTC unlock dynamics, large exchange flows
- **Regulatory:** SEC actions, ETF approvals/denials, major regulatory clarity events
- **Technical:** confirmed breakout or breakdown of a defined multi-week range, on volume
- **On-chain:** large exchange outflows, miner accumulation/distribution, dormant supply movement
- **Network:** protocol upgrades, mainnet launches, hard fork activations
- **Sentiment:** extreme fear/greed reversals from extreme readings (Fear & Greed Index)
- **Funding:** perpetual futures funding rate extremes (positioning signal even though this system trades spot)

A trade can have one strong catalyst or several mild correlated catalysts. The catalyst must be writeable as a sentence and verifiable.

---

## 4. Risk Management

### 4.1 Hard limits (immutable, in code, not modifiable by AI)

- Max single position: 50% of capital
- Max total deployed: 70% of capital
- Min cash reserve: 30% of capital
- Max positions open: 2 swing + 1 core
- Min position size: $50
- Min risk:reward to enter: 2:1
- Min conviction to enter: 70
- Required at entry: catalyst, exchange-side stop, exchange-side take-profit
- Daily realized loss cap: 4% of capital in rolling 24h
- $300 account floor: hard halt + alert, requires manual restart

To change any of these, the operator edits code and reviews the change. Opus and Sonnet have no authority over these constants.

### 4.2 Circuit breakers

- **Soft (20% drawdown from peak):** halve all subsequent position sizes until account recovers to within 10% of peak.
- **Hard ($300 account value):** halt all trading immediately, alert the operator, refuse to resume without manual intervention.

Peak value is stored in `state.peak_value_usd` and updated whenever total portfolio value (cash + positions marked-to-market) exceeds the stored peak.

### 4.3 Behavioral controls

- **2 consecutive losses:** 24-hour cooldown before next entry. Computed from the `positions` table on demand. `state.cooldown_until` stores the deadline.
- **Daily realized loss > 4%:** entry block until next calendar day (UTC). Computed from `positions` on demand, no in-memory counter.
- **3 consecutive wins:** Opus's morning brief prompt includes a specific overconfidence check.

### 4.4 BTC benchmark gate

The bot tracks cumulative return vs. BTC buy-and-hold from `state.btc_price_at_start`.

- **30-day rolling underperformance > 5%:** Opus's next morning brief MUST include a written assessment of why.
- **60-day rolling underperformance > 0%:** the bot pauses active trading. Operator decides between (a) restart with adjusted strategy or (b) convert to BTC core hold permanently per §6.4.

This is the honesty check. If you can't beat sitting in BTC, sit in BTC.

---

## 5. AI Architecture

### 5.1 Two roles

- **Decider — Claude Opus 4.7** (`claude-opus-4-7`): regime calls, entry decisions, exit decisions, stop adjustments, monthly review. The only model that can cause an order to be placed, modified, or cancelled.
- **Watcher — Claude Sonnet 4.6** (`claude-sonnet-4-6`): cheap monitoring. Reads current state vs. morning plan, decides whether to wake Opus. Cannot place, modify, or cancel orders.

A test must verify that no Sonnet response can result in an order action without an intervening Opus call. If Sonnet returns anything that looks like an order instruction, the response is rejected as malformed.

### 5.2 Schedule

| Time (UTC) | Model | Purpose |
|---|---|---|
| 14:00 | Opus 4.7, max thinking | Daily morning brief: regime, plan, watch list, position management |
| 18:00, 22:00, 02:00, 06:00, 10:00 | Sonnet 4.6 | Routine watch checkpoints (5 per day) |
| Event-driven | Sonnet 4.6 | Wake-up on price move, stop fill, or news keyword |
| On Sonnet escalation | Opus 4.7, medium thinking | Action decision |
| Monthly (operator-triggered) | Opus 4.7, max thinking | Strategy review |

The 14:00 UTC slot is intentional: US market overlap, after Asia close, before US open peaks. Catches both yesterday's outcome and today's setup.

### 5.3 Daily morning brief (Opus, ~$0.20/call)

**Input package:**
- System prompt (cached, ~3K tokens)
- Portfolio state: cash, positions, P&L vs. start, P&L vs. BTC, drawdown from peak, current regime, days in current regime
- Compressed price candles (CSV-style strings, not arrays of objects): daily 90d, 4h 14d, 1h 48h for BTC/ETH/SOL
- Indicators (computed app-side): RSI(14) daily/4h, MACD daily, BBands(20,2) daily, 50d/200d MA, BTC.D, 20d avg volume, ATR(14)
- Recent news (web search inside the call, scoped to crypto/macro, last 24h)
- Yesterday's brief + actions taken + observed outcomes
- Closed trades: last 20
- Active params from `params` table
- Behavioral state: cooldown active?, drawdown level, consecutive wins/losses

**Output (JSON, schema-validated):**
```json
{
  "regime": "bull|chop|bear",
  "regime_evidence": "BTC reclaimed 50d MA on 1.8x avg volume, ETF flows +$430M for 4 consecutive days, DXY weakening",
  "regime_changed_from": "chop",
  "max_exposure_pct": 70,
  "btc_benchmark_assessment": "System +2.4% vs BTC +0.8% over last 30d. No corrective action needed.",
  "current_positions": [
    {
      "asset": "BTC",
      "action": "hold|adjust_stop|take_partial|exit",
      "new_stop": null,
      "new_target": null,
      "reasoning": "..."
    }
  ],
  "new_trades": [
    {
      "asset": "ETH",
      "conviction": 75,
      "catalyst": "specific named catalyst",
      "confirmation": "what confirmed direction",
      "entry_price_target": 4200,
      "stop_loss": 3990,
      "take_profit_target": 4620,
      "size_pct": 20,
      "expected_hold_days": 4,
      "reasoning": "full paragraph"
    }
  ],
  "watch_list": [
    {
      "id": "btc-breakout",
      "asset": "BTC",
      "condition": "price > 70000 with 1h volume > 1.5x 20d hourly avg",
      "rationale": "Breakout above resistance on volume would confirm bull thesis from this morning",
      "urgency": "immediate|next_check"
    }
  ],
  "no_escalation_guidance": "BTC drift in 68k-70k range with normal volume is consolidation; do not escalate. Routine alt drift ±2% on no news is normal; do not escalate.",
  "discipline_check": "I am not entering trades on SOL today because [...]. I am not raising the BTC stop because [...]."
}
```

The `watch_list` is what Sonnet uses during the day. **Hardcoded maximum: 5 watch items.** Above that, the app keeps the first 5 and logs an error. The list is regenerated fresh every morning; it is not persistent state that learns over time.

### 5.4 Sonnet monitoring (~$0.012/call)

**Input package:**
- System prompt for watcher (cached, ~2K tokens)
- Today's morning brief (regime, positions, watch_list, no_escalation_guidance) — passed fresh as a ~500-token summary, not relying on cache
- Current prices for BTC/ETH/SOL
- 1h volume vs. 20d hourly average
- News scan since last check (RSS feed scan, scoped to watch_list keywords)
- Position state: current price, distance to stop, distance to target, days held
- Escalation budget remaining today

**Output (JSON, schema-validated):**
```json
{
  "evaluated": [
    { "trigger_id": "btc-breakout", "fired": false, "current": "BTC at $69,300, volume 1.0x avg", "notes": "..." }
  ],
  "escalate": false,
  "trigger_id": null,
  "discretionary_escalation": false,
  "discretionary_reason": null,
  "summary": "All quiet. No action."
}
```

If `escalate: true`, the app immediately calls Opus with the slim escalation package (current state + what fired + Sonnet's reasoning). Opus's response is the source of truth. Sonnet's analysis is context, not decision.

### 5.5 Escalation budget (hardcoded caps)

- Max scheduled Sonnet calls/day: **5**
- Max event-driven Sonnet wake-ups/day: **6**
- Max event-driven Sonnet wake-ups/month: **120**
- Max Opus calls/day: **5** (1 morning + up to 4 escalations/emergencies)
- Max Opus calls/month: **120**
- Monthly API budget cap: **$50.00 USD**

These are constants in code. Opus and Sonnet cannot change them. To change them: edit code, code review, deploy.

### 5.6 Wake-up triggers (3 types, hardcoded)

The app evaluates these on its 5-minute polling loop. Each one wakes Sonnet (NEVER Opus directly).

1. **Position move:** Any held position moves >3% in either direction within a 1-hour window. Debounce: 30 minutes per asset.
2. **Stop fill:** A stop-limit fired on Coinbase. Wake Sonnet immediately. No debounce. (Sonnet decides whether re-entry is warranted or the exit is final.)
3. **News keyword hit:** RSS feed scan finds a watch_list keyword. Debounce: 15 minutes per keyword.

That's the entire wake-up trigger list. Three. If three turns out not to be enough after 30 days of operation, add one via code change with operator approval.

**News source: RSS only.** Recommended feeds: CoinDesk, The Block, Reuters Crypto, Bloomberg Crypto. Web search is for use *inside* Opus calls, not as a polling source. (Polling web search every 5 minutes would cost ~$86/month and blow the entire budget alone.)

### 5.7 Budget enforcement

Every API call MUST go through `budget_gate(call_type) → ALLOW | BLOCK_DAILY | BLOCK_MONTHLY` which:
- Reads MTD spend from `api_spend`
- Estimates this call's cost × 1.3 buffer
- Returns the decision

**If blocked:**
- **Daily Opus morning brief:** never blocked. Always runs. Alert operator if monthly cap would be exceeded.
- **Sonnet scheduled check:** skip the window, log it.
- **Sonnet wake-up:** skip, log to `wakeups` with `suppression_reason`.
- **Opus escalation:** suppress. Log to `evaluations` as suppressed. Reviewed in next morning's brief.
- **Hard floor or 60-day BTC underperformance triggered concurrently:** the relevant manual action (halt or convert) takes priority over budget gate.

After every API call, write the actual cost to `api_spend` within 5 seconds.

**Cost data is NEVER shown to Opus or Sonnet in any prompt.** Showing the model what it costs creates a structural incentive to manipulate call frequency. The model's decisions should be made on merit, not on budget pressure.

If MTD spend trajectory will exceed the cap, **alert the operator**. Do not silently degrade. The operator can either (a) increase the budget for the month, (b) pause Sonnet checks manually, or (c) accept the alert and let the gate enforce. No automated backoff state machine.

### 5.8 Caching strategy

- System prompts (Opus and Sonnet): cache (1h TTL)
- Indicator computation references: cache (1h TTL)
- Today's morning brief, when used by Sonnet: **NOT cached.** Pass fresh as a ~500-token summary. Cache write cost > value for content used 5 times in 8 hours.
- Long-horizon candles: cached during morning brief assembly only

Track `cache_read_tokens` and `cache_write_tokens` in `api_spend` separately from base input/output for cost accuracy.

### 5.9 System prompt outline (for both models)

The system prompts are critical — they are where the strategy lives at runtime. Outline (full prompts to be written during implementation):

**Opus system prompt must include:**
- Identity: "You are the trading decision engine for a $500 USDC swing trading account on Coinbase."
- The strategy summary from §3 (regimes, entry criteria, exit criteria, sizing)
- Hard rules from §4.1
- Discipline emphasis: "Most evaluations result in no action. That is the expected and correct outcome. Do not manufacture trades."
- Calibration instruction: "Conviction is not vibe. 70 conviction means: if I were to take 100 trades like this, I expect ~70 to win. Be honest about uncertainty."
- The output JSON schema
- The catalyst categories from §3.8 as priors
- The current strategy version

**Sonnet system prompt must include:**
- Identity: "You are a routing classifier. Your only job is to read today's plan and current state, and decide whether to escalate to Opus for a decision."
- Explicit non-authority: "You cannot place, modify, or cancel orders. You cannot change theses or strategy parameters. If you suggest these things, your response will be rejected."
- The escalation criteria: rubric trigger fired, fallback condition met, or discretionary novel situation
- The output JSON schema
- "When in doubt, do not escalate. False positive escalations cost real money. False negatives are caught by the next scheduled check or the next morning's brief."

---

## 6. Operations

### 6.1 Boot sequence

This runs on every app start (cold start, restart, deploy, crash recovery). It is the most safety-critical code in the system.

1. **Health check.** Postgres reachable. Coinbase API reachable, key is TRADE-only (refuse to start if withdrawal permission detected). Anthropic API reachable. If any fail, retry every 60s, alert if down >5 min.
2. **Determine downtime.** Read `state.last_boot_at`. Log to `evaluations` (or a dedicated boot log) with downtime duration.
3. **Reconcile orders.** For every order with `status = 'pending'` in `orders`, query Coinbase by order ID. Update fills, cancellations, expirations. For filled stops/take-profits: close the position in `positions`, compute net P&L (gross minus fees), record exit reason.
4. **Reconcile balances.** Compare DB-expected balances vs. Coinbase actual. If discrepancy > 1% of total capital, alert operator and do NOT auto-correct (could be untracked manual trade or worse). If discrepancy is minor (rounding/fees), silently sync.
5. **Verify position safety.** For every open position, verify an active stop-limit exists on Coinbase. **If missing, place one immediately at the position's current `stop_price`.** This is the highest priority action in the entire boot sequence.
6. **Check missed evaluations.** If `state.next_eval_at` is in the past, run exactly one evaluation now after reconciliation completes. Do not run multiple catch-up evals.
7. **Check 5%+ price moves during downtime.** For each tradeable asset, compare current price vs. `state.last_*_price_at_eval`. If any moved >5%, flag the upcoming evaluation as emergency in its prompt context.
8. **Update `state.last_boot_at`. Resume normal scheduling.** Schedule the next evaluation. Resume polling loop.

### 6.2 First launch

When the database is empty:
1. Verify Coinbase API key is TRADE-only. **Refuse to start if withdrawal permission is enabled.** Non-negotiable.
2. Read account balance from Coinbase. Store as `state.starting_capital_usd`.
3. Initialize all `state` keys to defaults. Set `paper_mode = true`. Set `phase = "paper"`.
4. Initialize `params` to defaults from this spec, version 1.0.
5. Record current BTC price as `state.btc_price_at_start`.
6. Run the first Opus morning brief immediately to establish initial regime.
7. **Do not enter any trades for the first 48 hours.** Observation period. Opus's system prompt explicitly states this.

### 6.3 Phase rollout

**Phase 0: Setup (1–2 days).** Code deployed, paper mode on, observation period. No trades. Dashboard verified working. Operator reviews first morning briefs.

**Phase 1: Paper (30 calendar days).** All decisions made, all "trades" simulated against real prices. Real API costs accrue. Pre-committed criteria to advance to Phase 2 (any failure = stay in Phase 1 for another 30 days OR shut down):

- Hypothetical net P&L > 0 over the 30 days
- Hypothetical performance > BTC hold by ≥ 2% over the 30 days
- ≥ 6 closed paper trades (need a sample)
- Operator has read ≥ 5 morning briefs and judged them coherent
- Zero hard guardrail violations
- Zero "the bot wanted to do something insane" incidents
- No critical errors in `errors` table

**Do not goalpost-move these criteria.** They are pre-committed before paper trading begins.

**Phase 2: Live, half size (30 calendar days).** Real money. Position sizes halved (20% → 10%, 30% → 15%, 40% → 20%). Hard guardrails unchanged (50% max, 30% min cash). Pre-committed criteria to advance to Phase 3:

- Realized net P&L > 0 (after fees, ignoring API cost)
- Realized performance > BTC hold over 30 days
- ≥ 4 closed real trades
- Zero hard circuit breaker triggers
- ≤ 1 soft circuit breaker trigger

**Phase 3: Live, full size.** Position sizes per §3.5. Quarterly operator review.

**Phase 0 (Failure modes):**
- **Hard floor hit ($300):** halt forever. Operator post-mortem before any restart.
- **60-day BTC underperformance:** pause active trading, convert to BTC core hold per §4.4.
- **Phase 1 criteria not met after 60 days of paper:** shut down or restart with revised strategy. Don't proceed to live with a strategy that hasn't earned it.

The toggle from `paper_mode = true` to `false` requires the operator to confirm via the dashboard, AND the app rejects the toggle if Phase 1 criteria are not currently met. The operator can override with explicit double-confirmation, but the rejection is the default.

### 6.4 Kill switches

- **One-button pause:** dashboard control, halts all new entries. Existing positions managed normally per their stops and theses.
- **One-button close-all:** market-exit all positions, cancel all open orders. Confirmation required.
- **Auto-halt:** $300 floor breached → immediate halt, alert.
- **Auto-pause:** 60-day BTC underperformance → pause + alert + present operator with restart-or-convert decision.
- **Convert to BTC core hold:** dashboard action. Closes all positions. Buys BTC with all available USDC. Halts active trading. Bot continues to track P&L vs. BTC (which is now zero) and email/log only.

---

## 7. Data Schema

Postgres. All state lives here. No in-memory state survives restart.

### 7.1 `state` (singleton key-value)

```
key                              | value
---------------------------------|-------------------------
phase                            | paper|half|full|paused|halted
paper_mode                       | bool
mode_change_pending              | bool (true when paper_mode flag was toggled but app not yet restarted)
current_regime                   | bull|chop|bear
peak_value_paper_usd             | numeric
peak_value_live_usd              | numeric
starting_capital_paper_usd       | numeric
starting_capital_live_usd        | numeric
btc_price_at_start_paper         | numeric
btc_price_at_start_live          | numeric
last_btc_price_at_eval           | numeric
last_eth_price_at_eval           | numeric
last_sol_price_at_eval           | numeric
next_eval_at                     | timestamp
last_boot_at                     | timestamp
cooldown_until                   | timestamp nullable
trading_paused                   | bool
strategy_version                 | text (e.g., "1.0")
last_wakeup_position_BTC         | timestamp nullable
last_wakeup_position_ETH         | timestamp nullable
last_wakeup_position_SOL         | timestamp nullable
last_wakeup_news_<keyword>       | timestamp nullable (one per active keyword)
escalations_used_today           | integer
escalations_used_month           | integer
```

P&L-related keys are split per mode (`*_paper_usd` vs `*_live_usd`) so paper history never contaminates live accounting and vice versa. See §13 for full rationale.

### 7.2 `params` (versioned strategy parameters)

```
param_name | current_value | min_allowed | max_allowed | version | changed_reason | changed_at
```

Initial values from this spec at version 1.0. Operator-modifiable; AI cannot modify.

### 7.3 `positions` (open and closed)

```
id                  | uuid
asset               | text (BTC|ETH|SOL)
type                | text (core|swing)
status              | text (open|closed)
direction           | text (long; spot only)
entry_price         | numeric
quantity            | numeric
stop_price          | numeric
target_price        | numeric
conviction_at_entry | integer
catalyst            | text
thesis              | text
entry_time          | timestamp
exit_price          | numeric nullable
exit_time           | timestamp nullable
exit_reason         | text nullable
gross_pnl_usd       | numeric nullable
fees_usd            | numeric nullable
net_pnl_usd         | numeric nullable
strategy_version    | text
regime_at_entry     | text
stop_order_id       | text (Coinbase order ID)
tp_order_id         | text (Coinbase order ID)
entry_order_id      | text (Coinbase order ID)
paper_mode          | bool
```

### 7.4 `orders` (every order placed on Coinbase)

```
id                   | uuid
coinbase_order_id    | text
type                 | text (entry_limit|stop_limit|take_profit|market_exit|dca_limit)
asset                | text
side                 | text (buy|sell)
price                | numeric
quantity             | numeric
status               | text (pending|filled|partially_filled|cancelled|expired)
related_position_id  | uuid nullable
placed_at            | timestamp
filled_at            | timestamp nullable
fill_price           | numeric nullable
fill_quantity        | numeric nullable
cancel_reason        | text nullable
paper_mode           | bool
```

### 7.5 `evaluations` (every AI call: Opus and Sonnet)

```
id                   | uuid
timestamp            | timestamp
model                | text (claude-opus-4-7|claude-sonnet-4-6)
call_type            | text (morning|sonnet_check|opus_escalation|emergency|review|post_restart)
trigger_source       | text (scheduled|wakeup_position_move|wakeup_stop_fill|wakeup_news|escalation)
prompt_text          | text (full rendered prompt sent to API)
response_text        | text (raw response body)
parsed_response      | jsonb (validated, parsed)
actions_taken        | jsonb (what the app did with the response)
input_tokens         | integer
output_tokens        | integer
cache_read_tokens    | integer
cache_write_tokens   | integer
cost_usd             | numeric
latency_ms           | integer
strategy_version     | text
suppressed           | bool (true if the call was blocked by budget gate)
suppression_reason   | text nullable
```

### 7.6 `triggers` (today's watch list from morning brief)

```
id                | uuid
morning_eval_id   | uuid (fk to evaluations)
trigger_id        | text (e.g., "btc-breakout")
asset             | text nullable
condition_text    | text
rationale         | text
urgency           | text (immediate|next_check)
active_from       | timestamp
active_until      | timestamp
times_evaluated   | integer
times_fired       | integer
```

### 7.7 `wakeups` (every event-driven Sonnet wake-up)

```
id                       | uuid
timestamp                | timestamp
trigger_type             | text (position_move|stop_fill|news_keyword)
asset                    | text nullable
observed_value           | jsonb (what was observed)
dispatched               | bool (true if Sonnet was called)
suppression_reason       | text nullable (debounce|budget|daily_cap|monthly_cap)
sonnet_eval_id           | uuid nullable (fk to evaluations)
escalated_to_opus        | bool nullable
opus_eval_id             | uuid nullable (fk to evaluations)
opus_action_taken        | text nullable
```

### 7.8 `api_spend` (every API call's cost, for fast monthly aggregation)

```
id                   | uuid
timestamp            | timestamp
model                | text
call_type            | text
input_tokens         | integer
output_tokens        | integer
cache_read_tokens    | integer
cache_write_tokens   | integer
web_search_count     | integer
cost_usd             | numeric
month                | text (YYYY-MM, generated column for fast SUM grouping)
related_eval_id      | uuid nullable
```

Index on `(month)`.

### 7.9 `errors` (every caught exception, retry, recovery)

```
id              | uuid
timestamp       | timestamp
severity        | text (info|warning|error|critical)
component       | text
error_class     | text
message         | text
traceback       | text nullable
context         | jsonb
recovered       | bool
recovery_action | text nullable
```

### 7.10 `system_state_history` (every state write, append-only audit)

`state` (§7.1) is mutable. This parallel table makes every change auditable forever. Every write to `state` produces a row here.

```
id              | uuid
key             | text
old_value       | jsonb (null for first-time writes)
new_value       | jsonb
changed_at      | timestamp
changed_by      | text (component: 'opus_morning' | 'budget_gate' | 'reconciliation' | 'wakeup_dispatch' | 'manual_dashboard' | 'boot' | etc.)
related_eval_id | uuid nullable (fk to evaluations)
```

Index on `(key, changed_at DESC)`. Makes "what was the regime at 14:23 last Tuesday?" answerable forever.

**Implementation requirement:** all writes to `state` go through a `state_writer` utility that creates the history row in the same transaction. No component writes to `state` directly. A test verifies no path bypasses the writer.

### 7.11 `app_decisions` (every app-level decision, for full operator visibility)

Decisions made by application code, distinct from AI decisions. The app makes hundreds of these per day; without logging they're invisible. The dashboard surfaces this directly so the operator can answer "why did the bot do/not do X?"

```
id              | uuid
timestamp       | timestamp
decision_type   | text ('budget_gate' | 'model_route' | 'wakeup_debounce' |
                       'escalation_dispatch' | 'order_routing' | 'reconciliation_action' |
                       'circuit_breaker' | 'phase_gate' | 'cooldown_check')
inputs          | jsonb (everything that went into the decision)
outputs         | jsonb (what was decided)
reasoning       | text (human-readable explanation generated by the deciding component)
related_entity  | text nullable (e.g., 'order:abc123', 'eval:xyz789', 'wakeup:def456')
```

Examples:
- Budget gate blocks a Sonnet wake-up: `decision_type: 'budget_gate'`, inputs include MTD spend and projected cost, outputs `{"allowed": false, "reason": "monthly_cap"}`.
- Debounce suppresses a wake-up: `decision_type: 'wakeup_debounce'`, inputs include trigger and last-fired timestamp, outputs `{"dispatched": false, "remaining_debounce_seconds": 1247}`.
- Cooldown blocks an entry: `decision_type: 'cooldown_check'`, inputs include last 2 trade outcomes, outputs `{"blocked": true, "until": "..."}`.

Index on `(timestamp DESC)`, `(decision_type, timestamp DESC)`, `(related_entity)`.

### 7.12 `price_snapshots` (market state at every decision point)

Captures market state at every meaningful event. Coinbase tick history may be rate-limited or paywalled later; snapshot at the moment of decision so the dashboard can replay context.

```
id              | uuid
timestamp       | timestamp
trigger_event   | text ('eval_start' | 'order_placed' | 'wakeup_fired' |
                       'reconciliation_check' | 'manual_snapshot' | 'price_poll')
related_entity  | text nullable
btc_price       | numeric
eth_price       | numeric
sol_price       | numeric
btc_dominance   | numeric nullable
fear_greed      | integer nullable
```

**Capture rules:**
- One row at the start of every Opus and Sonnet call
- One row at every order placement, modification, or cancellation
- One row at every wake-up trigger fire (regardless of dispatch)
- One row at every boot reconciliation check
- One row from the routine 5-minute price polling loop

Index on `(timestamp DESC)`, `(trigger_event, timestamp DESC)`.

That's the entire schema. **Twelve tables.** State, params, positions, orders, evaluations, triggers, wakeups, api_spend, errors, system_state_history, app_decisions, price_snapshots. Together these provide complete operator visibility from the dashboard with no log diving required.

---

## 8. Dashboard

**The dashboard is a first-class deliverable. Frontend effort and polish match backend effort and polish.** This is the operator's window into a system spending real money on real trades — it is not an afterthought.

The operator must be able to see every AI decision, every app action, and every state change without ambiguity, log diving, or guesswork. If the operator has to ask "what is the bot doing right now?" or "why did it do that?", the dashboard has failed.

### 8.1 Design principles

- **Total visibility.** Every AI call's full prompt and response is accessible. Every app-level decision is logged and viewable. Every state change is auditable.
- **No questions left unanswered.** If the operator might wonder "why?", the dashboard answers it inline.
- **Tell a story.** Plain English explanations on top, structured data accessible underneath. Don't dump JSON at the user.
- **Beautiful by default.** Clean typography, deliberate color coding, consistent spacing, real animations. Use shadcn/ui (or comparable polished primitive set) for component consistency. Tailwind v4 for styling. Recharts for charts.
- **Information density tuned for the operator.** This is a power-user dashboard for one person. Dense and deep — but never confusing.
- **Real-time where it matters.** Prices stream via WebSocket. AI activity, state changes, alerts update live (SSE or 5-second polling).
- **Informative empty states.** "No open positions because regime is bear and we're sitting in cash" beats a blank table.
- **Login-protected, single user.** No RBAC, single password.

### 8.2 Navigation structure

Single-page application with persistent sidebar (or top-nav). Main views:

1. **Overview** (default landing)
2. **Today's Plan**
3. **AI Activity**
4. **Positions** (open + closed history)
5. **Decisions & Triggers**
6. **Performance**
7. **System**
8. **Controls**

The implementer may collapse or split these as appropriate, but every information area below MUST be present and easily findable.

### 8.3 Overview (default landing)

The "is everything OK at a glance?" view.

- **Top status bar:** phase badge, paper/live mode, current regime + days in regime, paused/halted indicator, time since last AI call
- **Live ticker strip:** BTC/ETH/SOL prices with green/red tick flash via Coinbase WebSocket
- **Equity curve (30d)** with BTC benchmark overlay — single dominant chart
- **Cumulative outperformance vs. BTC** — single prominent number with sparkline
- **Today's plan synopsis** (3 lines from this morning's brief, with link to full plan)
- **Open positions** as compact cards: asset, entry, current, %P&L, days held
- **Last 5 events** of any kind with type icon and one-line summary
- **API spend strip:** MTD spent / cap, today's spend, projected month-end
- **Quick actions:** pause, force brief, close all (with confirmations)

### 8.4 Today's Plan

The live morning brief, beautifully rendered (not raw JSON).

- **Regime header:** current regime in plain English, evidence summary, regime history strip (last 7 days as colored chips)
- **Today's intended trades:** each as a card with catalyst, conviction (visual bar), entry/stop/target levels, expected hold, full reasoning paragraph, current state of entry trigger
- **Watch list:** each trigger as a card with condition, rationale, current observed value, status indicator (🟢 armed / 🟡 firing imminent / 🔵 fired this cycle / ⚪ inactive)
- **Position management plan:** per-position guidance from the morning brief
- **Discipline check:** Opus's stated reasons for NOT doing things today (often the most informative section)
- **Brief metadata:** run time, cost, latency, expandable link to the full prompt/response trace

### 8.5 AI Activity

Chronological feed of every AI call. **The most important page.**

- **Filter bar:** model (Opus/Sonnet), call type, date range, "took action vs. no action," asset
- **Each entry:** collapsed by default, expandable to:
  - Full rendered prompt (the long stable system prompt collapsed by default with hash; the dynamic user message and data package shown by default)
  - Full raw response from the API
  - Parsed structured output (pretty-printed JSON with syntax highlighting)
  - Reasoning text extracted and highlighted for readability
  - Action(s) taken by the app, with links to created/modified entities
  - Cost, input/output tokens, cache read/write tokens, latency
  - Links to related positions, orders, triggers, price snapshot at decision time
- **Morning briefs** get special card treatment (rendered like §8.4) instead of compact entries
- **Sonnet checks** show as one-line entries by default; expand for full detail
- **Search box:** full-text search over prompts and responses

### 8.6 Positions

**Open positions** — full-detail card per position:
- Asset, type (core/swing), entry price, current price, %P&L (live)
- Stop loss, take profit, trailing stop progress with visual indicator
- Coinbase order IDs visible for entry/stop/take-profit (verifies exchange-side protection)
- Days held, conviction at entry, conviction trajectory if updated
- Catalyst (one line), thesis (paragraph)
- **Timeline:** every AI evaluation that touched this position, with the action taken, in chronological order
- Per-position P&L sparkline since entry

**Closed positions** — sortable, filterable table:
- Asset, entry/exit prices, days held, P&L (gross + net), exit reason, strategy version
- Click row to open trade lifecycle view: chronological list of every event for this trade (morning briefs that mentioned it, Sonnet checks, escalations, order events, exit decision)
- Per-trade P&L sparkline

### 8.7 Decisions & Triggers

The "why did the bot do or not do X?" page.

**Today's watch list** — each trigger with current state, last evaluated time, fire count today.

**Wake-up history** — chronological list of every wake-up trigger fire:
- Trigger type, observed value, asset (if any)
- Dispatched (Sonnet called)? Suppressed (with reason)?
- Resulting Sonnet evaluation (link to AI Activity entry)
- Escalated to Opus? Action taken?
- Price snapshot at fire time

**Wake-up statistics** — per-trigger-type counts, escalation rates, actionable rates (7d / 30d). Identifies noise triggers for operator review.

**App decisions stream** — filterable list of every app-level decision (from `app_decisions`):
- Budget gate calls (allow/block, reason)
- Model routing decisions
- Wake-up debounce hits
- Escalation dispatches
- Reconciliation actions
- Circuit breaker checks
- Cooldown blocks
- Each entry expandable to inputs / outputs / reasoning

**State change log** — filterable view of `system_state_history`:
- Every key change with old → new value, who changed it, and the eval/action that caused it
- "What was the regime at 14:23 yesterday?" answerable in one click

### 8.8 Performance

- **Equity curve** with toggleable timeframes (7d / 30d / 90d / all-time)
- **BTC benchmark overlay** on every timeframe
- **Cumulative outperformance** chart (system return − BTC return over time)
- **Drawdown chart** (distance from peak)
- **P&L breakdown:** realized, unrealized, fees paid, by asset, by trade source (morning brief vs. escalation)
- **Trade statistics:** win rate, average win, average loss, R-multiple distribution histogram
- **Fee drag:** total fees as % of gross P&L
- **API cost vs. trading P&L:** the honest comparison (even though API is subsidized, this shows the math)
- **Per-strategy-version segmentation** when multiple versions exist

### 8.9 System

- **Boot history:** every restart with downtime, reconciliation outcome, discrepancies found
- **Error log:** filterable by severity (info / warning / error / critical), date, component
- **API budget detail:** MTD spend, daily spend chart, breakdown by call type, by model, by day, projection vs. cap
- **Cache hit rates** per model (last 7 days) — drops indicate prompt structure changed
- **Last successful action per type:** last successful Opus call, Sonnet call, reconciliation, order placement, price poll — quickly answers "is anything stuck?"
- **Phase progress card:** every Phase advancement criterion with current value, threshold, pass/fail badge, days remaining in current phase
- **Wake-up trigger health:** for each of the 3 hardcoded wake-up triggers, the fire count, escalation rate, actionable rate, current debounce state

### 8.10 Controls

- **Pause / Resume** trading
- **Close all positions** (double-confirmation, market exits)
- **Force morning brief** now (counts against budget; warning shown if would exceed cap)
- **Force reconciliation** (re-run §6.1 without restarting)
- **Toggle paper/live** (gated by Phase 1 criteria; double-confirmation if criteria pass; triple-confirmation if operator overrides a failing gate)
- **Convert to BTC core hold** (double-confirmation, irreversible warning, full explanation of consequences)
- **Strategy parameters** view (read-only by default; edit-mode toggle exposes editing with required `changed_reason` text logged to `params`)

### 8.11 Real-time updates

- **WebSocket:** Coinbase Exchange WS at `wss://ws-feed.exchange.coinbase.com` for BTC/ETH/SOL ticker (no auth required for ticker channel). Updates live ticker strip and position current prices on every tick.
- **Server-Sent Events or 5-second polling:** new AI activity, state changes, new wake-ups, new positions opened/closed.
- **Manual refresh button** on every page for explicit re-fetch.

### 8.12 Tech recommendations

The dashboard is now a first-class concern; pick tools accordingly.

- **Stay on Next.js 16** (App Router, already in use). The hybrid SSR/CSR fits this use case.
- **shadcn/ui** for primitives (button, card, table, dialog, dropdown, sheet, command palette). Provides design polish without library lock-in.
- **Tailwind v4** for styling (already in use). Use a deliberate color system — semantic colors for state (success/warning/danger/muted), not raw palette.
- **Recharts** for all charts (already installed but not used).
- **SWR** for data fetching with revalidation (already in use).
- **Server components** for initial page loads (data already lives on the server).
- **Client components** for interactive elements and live updates.
- Consider **Framer Motion** for tasteful transitions (page loads, expand/collapse, status changes). Animations should feel intentional, not gratuitous.
- **Dark mode by default** — operator stares at this for hours.
- **Keyboard shortcuts** (e.g., `g o` → Overview, `g a` → AI Activity, `cmd+k` → command palette). Power-user dashboard.

### 8.13 Acceptance criteria for the dashboard

Before the bot enters paper trading:

- [ ] All 8 main views render with real data
- [ ] AI Activity shows full prompts and responses for every call
- [ ] Today's Plan renders the morning brief beautifully (not raw JSON)
- [ ] Positions page shows Coinbase order IDs for stops and take-profits
- [ ] Decisions & Triggers page shows app decision stream and state change log
- [ ] Performance page shows equity curve with BTC overlay
- [ ] System page shows phase progress with criterion-by-criterion pass/fail
- [ ] Controls page actions all work, with appropriate confirmations
- [ ] WebSocket prices update live
- [ ] Real-time AI activity updates without page refresh
- [ ] Empty states are informative, not blank
- [ ] Operator has reviewed the dashboard end-to-end and confirmed every section is clear

---

## 9. Tech Stack Recommendations (non-binding)

The implementer chooses. Suggested for fast time-to-ship:

- **Runtime:** Bun or Node.js. Either is fine.
- **Web framework:** Hono (lighter than Next.js, faster cold starts) OR Next.js if rebuilding the dashboard from scratch is too disruptive.
- **Database:** Postgres on DigitalOcean managed cluster (current setup is fine).
- **ORM:** Drizzle (already in use) or kysely. Avoid heavy ORMs.
- **Anthropic SDK:** `@anthropic-ai/sdk` with prompt caching enabled.
- **Coinbase:** direct REST calls with JWT auth (current implementation pattern works).
- **Hosting:** DigitalOcean App Platform basic-xxs (current setup).
- **Scheduler:** in-process via setInterval, backed by `state.next_eval_at` for restart safety.
- **Frontend:** server-rendered HTML + a sprinkle of JS for the equity chart, OR keep Next.js. The dashboard is one page; ship whatever is fastest.

The hardest constraint is the AI orchestration. Don't over-engineer the rest.

---

## 10. Acceptance Criteria

Before flipping `paper_mode = false`:

**Backend code:**
- [ ] All 12 tables created with foreign keys enforced at the DB level
- [ ] Boot sequence with reconciliation passes integration test
- [ ] `budget_gate()` blocks calls correctly at each threshold
- [ ] Test: no Sonnet response can result in an order action without an Opus call
- [ ] Test: morning brief Opus call always runs even if monthly cap exceeded (alert, but run)
- [ ] Test: each of the 3 wake-up triggers fires correctly and respects debounce
- [ ] Test: stop-limit reconciliation places a stop if one is missing on boot
- [ ] Coinbase API key is TRADE-only (boot refuses to start if withdrawal permission detected)
- [ ] All AI calls produce a row in `evaluations` AND `api_spend` within 5 seconds
- [ ] All caught exceptions produce a row in `errors`
- [ ] All `state` writes go through `state_writer` and produce a `system_state_history` row (test verifies no path bypasses)
- [ ] All app-level decisions (budget gate, model route, debounce, dispatch, reconciliation, circuit breaker, cooldown) produce an `app_decisions` row
- [ ] Price snapshots captured at every decision point per §7.12 capture rules
- [ ] Paper-mode toggle is rejected when Phase 1 criteria are not met
- [ ] AI prompts never include API cost data

**Frontend (matches backend in care and polish):**
- [ ] All 8 main views (§8.2) render with real data
- [ ] AI Activity shows full prompts AND responses for every call, with syntax highlighting and reasoning extraction
- [ ] Today's Plan renders the morning brief beautifully (rendered cards, not raw JSON)
- [ ] Positions page shows Coinbase order IDs for stops and take-profits, with timeline of every AI eval that touched the position
- [ ] Decisions & Triggers page shows app decision stream AND state change log (`system_state_history`)
- [ ] Performance page shows equity curve with BTC overlay, drawdown, P&L breakdown, R-multiple distribution
- [ ] System page shows phase progress with criterion-by-criterion pass/fail
- [ ] Controls page actions all work, with appropriate confirmations
- [ ] WebSocket prices update live (Coinbase Exchange WS)
- [ ] Real-time AI activity updates without page refresh (SSE or 5s poll)
- [ ] Empty states are informative, not blank ("No positions because regime is bear...")
- [ ] Design system in place (shadcn/ui or comparable) — consistent components throughout
- [ ] Dark mode default
- [ ] Keyboard shortcuts implemented (at least: nav shortcuts + cmd+k command palette)
- [ ] Operator has reviewed the dashboard end-to-end and confirmed every section is clear

**Operations:**
- [ ] 30 days of paper trading completed
- [ ] All Phase 1 advance criteria pass (§6.3)
- [ ] Operator has read morning briefs and judged them coherent

---

## 11. What NOT to Build

Listed because previous iterations of this project over-engineered. Do not build any of the following without explicit operator approval after the bot is in Phase 3 and demonstrably profitable.

- **Tertiary asset universe.** BTC/ETH/SOL only. No human-approval flow for additional assets.
- **Strategy self-modification.** The bot does NOT adjust its own parameters. The operator does it manually based on observed performance after Phase 2.
- **Watcher rubric self-modification / self-improving routing layer.** The morning brief produces a fresh watch list each day. There is no separate "rubric" entity that learns over time. Today's plan is not persistent learnable state.
- **5+ wake-up trigger types.** Three. If three turns out not to be enough after 30+ days of operation, add one via code change.
- **Backoff state machine with multiple levels.** If you're hitting the budget cap, alert the operator. Don't silently degrade.
- **Operator role / RBAC.** Single password, single user, single role.
- **Extended thinking on every call.** Max effort on the morning brief. Medium on Opus escalations. Sonnet runs without thinking.
- **Web search as a regular polling source.** Web search is for use inside Opus calls only. RSS feeds are the polling source for news triggers.
- **WebSocket price feed for trading logic.** WebSocket for dashboard display only. Polling REST every 5 minutes is the source of truth for trigger evaluation.
- **Notification systems beyond the dashboard.** No Telegram bots. No Discord webhooks. No SMS. The dashboard is the surface.
- **Strategy versioning machinery beyond a `strategy_version` text field.** No major/minor semver math. Just bump the string when params change.
- **A "watcher_rubrics" table.** The watch list lives in `triggers` for today only. No persistence beyond the day.
- **Any "phase 2 of the supplement" feature.** This document IS the supplement. There is no further architectural overlay coming.

**What you SHOULD spend extra effort on (overrides any "minimum viable" instinct):**

- **The dashboard.** Match backend effort with frontend effort. Polish the design, the typography, the animations, the empty states, the color system. This is the operator's daily interface; it should feel as carefully built as the trading logic.
- **AI activity rendering.** Don't show prompts and responses as raw text dumps. Pretty-print, syntax-highlight, extract reasoning sections, link to related entities. The operator must be able to follow the AI's thinking without effort.
- **Forensic logging.** `system_state_history`, `app_decisions`, `price_snapshots` exist so the operator can answer any "why" question from the dashboard. They are not optional.

If an implementation agent finds itself building something not in this spec, or extending it "for completeness," **stop and ask the operator first.**

---

## 12. Failure Modes (honest list)

Things that will probably go wrong, and what happens:

- **Opus produces a low-quality regime call.** The morning brief includes review of yesterday's call and outcomes — pattern of bad calls becomes visible. Operator pauses bot, investigates the prompt, iterates on the system prompt.
- **Bot sits in cash for two weeks.** This is correct behavior in chop or bear regimes. Not a bug.
- **Bot enters a trade then immediately stops out.** Pattern of this means poor entry confirmation. Operator tightens conviction threshold to 75 in `params`.
- **Bot underperforms BTC by trading too much.** The 60-day check catches it. Convert to BTC core hold per §4.4.
- **API costs run hot in volatile weeks.** Operator gets alerted. Decides to add budget for the month or pause Sonnet checks manually. No automated backoff.
- **Coinbase outage during a stop-fill.** Stop is exchange-side, fires regardless of bot state. Boot reconciliation picks up the fill.
- **Anthropic outage during morning brief.** Retry every 5 minutes for 30 minutes. After 30 minutes, log missed eval, skip. Existing positions are protected by exchange-side stops.
- **Database loss.** Daily automated backups to a separate location. If state is lost, bot effectively restarts in observation mode (no positions, no trade history). Trades on Coinbase are recoverable from Coinbase's order history.
- **The strategy doesn't make money in 30-day paper.** Phase 1 criteria fail. Iterate on the strategy in paper for another 30 days OR shut it down. Don't go live with a strategy that hasn't earned the right.

---

## 13. Paper Mode Architecture (first-class isolation)

Paper mode is not "the live code with a flag set." It is a separately reasoned, separately tested execution path that shares AI and decision logic with live mode but **cannot reach Coinbase's order placement endpoints under any circumstance**. Without proper isolation, paper mode is dangerous — a single bug can quietly place real orders, pollute live P&L, or corrupt reconciliation.

### 13.1 Risk model

Specific failures this section prevents:
- A real order placed when the operator believed the system was in paper mode
- A paper position polluting live P&L computation
- Reconciliation confused by mixed paper/live state and "fixing" the wrong thing
- A mode flip leaves stale state behind that the next session operates on
- A "tested in paper" code path that quietly diverges from live and breaks on the first real order

### 13.2 Code path isolation

The function that places a real Coinbase order is **physically distinct** from the function that simulates one. They share an interface but their implementations live in different files, and **neither imports anything from the other**.

```
src/lib/execution/
  ├── interface.ts         // OrderExecutor interface
  ├── live-executor.ts     // Calls Coinbase order endpoints
  ├── paper-executor.ts    // Simulates orders against real prices
  ├── factory.ts           // Returns the correct executor based on mode AT BOOT
  └── market-data.ts       // Shared price/candle reader (used by both modes)
```

Read endpoints (prices, candles, account balance) are shared via `market-data.ts` — both modes need real market data. **Write endpoints (orders, cancels, modifications) live ONLY in `live-executor.ts`** and are guarded by an in-method assertion on top of the file isolation.

The factory is called once at boot, returns one executor for the session's lifetime, and the rest of the codebase holds a typed `OrderExecutor` reference. **The mode flag is never re-read at runtime — the executor object IS the mode.**

This eliminates flag-check-at-every-order-site bugs by construction.

### 13.3 Database isolation

The `paper_mode` column on `positions` and `orders` is `NOT NULL`. Every query that touches positions or orders MUST filter by mode.

Two query helpers live in `src/lib/db/queries/`:

```typescript
positionsForCurrentMode()  // default; filters by mode at query time
positionsAllModes()        // explicit; only used by reconciliation diagnostics and analytics
```

There is no third helper. The default enforces isolation; the explicit one is rare and grep-able. CI rejects any direct query of `positions` or `orders` outside these helpers (lint rule).

P&L-related state keys are split per mode (see §7.1). The dashboard and computation logic reads the variant matching the current mode. Drawdown is always computed against the current mode's peak.

### 13.4 Mode loading and invariance

- Mode is loaded from `state.paper_mode` exactly **once, at boot**, into the executor factory
- The mode is then **invariant for the session**
- Toggling the mode in the dashboard writes to `state.paper_mode` and sets `state.mode_change_pending = true` but does NOT take effect until the operator restarts the app
- The dashboard surfaces this loudly: "MODE CHANGE PENDING — RESTART REQUIRED"

Live runtime mode flipping is a class of bug that can only cause damage. There is no legitimate scenario in which flipping mode mid-session is the right action.

### 13.5 Mode transition safety

The toggle from paper → live (or live → paper) is gated by these preconditions, **enforced server-side**:

- **No open positions in either mode.** Operator must close-all first.
- **No pending orders in either mode.**
- **All reconciliation completed.** No outstanding pending timers or unreconciled orders.
- **For paper → live specifically:** all Phase 1 advance criteria pass (per §6.3).
- **Operator double-confirmation:** typed phrase ("transition to live trading" or "transition to paper trading"), not just a button click.

After confirmation, the toggle writes the new value, sets `mode_change_pending = true`, and the dashboard displays "RESTART REQUIRED" prominently. **All order placement (paper or live) is blocked from the moment the toggle is confirmed until the next successful boot.**

### 13.6 Paper executor behavior

The paper executor:
- Receives the same `placeOrder()` calls that the live executor would receive
- Validates the order shape (stop within range, R:R ≥ 2, size within limits, etc.) — same validation as live
- Generates synthetic Coinbase order IDs (e.g., `paper-{uuid}`)
- Writes to `orders` with `paper_mode = true`
- Simulates fills against **real Coinbase prices** fetched from the shared market data provider — NOT a mock price feed. The strategy must be tested against real market behavior.
- Simulates stop-limit and take-profit triggers based on the real price stream
- Computes fees using the actual Coinbase fee schedule (~0.4% maker, ~0.6% taker)
- Writes simulated fills with `fill_price`, `fill_quantity`, `paper_mode = true`
- Closes positions when stops/take-profits trigger; computes paper P&L net of simulated fees

**The paper executor never makes a network call to Coinbase's order, cancel, or modification endpoints.** This is enforced by the file-level isolation in §13.2 AND verified by the test in §13.8.

### 13.7 Reconciliation isolation

Boot reconciliation (per §6.1) operates on the current mode's data only:

- **Paper mode boot:** queries `positions WHERE paper_mode = true AND status = 'open'`. Verifies internal consistency only — there is nothing on Coinbase to reconcile against. The position safety check verifies that the simulated stop-limit order still exists in the simulated `orders` rows.
- **Live mode boot:** queries `positions WHERE paper_mode = false AND status = 'open'`. Reconciles against Coinbase's actual order/balance state.

**Boot refuses to start if it finds open positions in the OTHER mode.** Live boot finding open paper positions = bad mode transition occurred. Operator must investigate before proceeding. The app halts with an actionable error: "Open paper positions found while booting in live mode. Close paper positions or boot in paper mode first."

### 13.8 Tests that MUST pass before paper trading begins

These tests are **non-negotiable** for Phase 1 paper trading to start:

- **No live order in paper mode.** Force paper mode, run the AI flow end-to-end through `placeOrder()`, assert that the mock HTTP layer recorded zero requests to Coinbase order endpoints. Test fails if any matching request is made.
- **Mode invariance.** Boot in paper mode. Mutate `state.paper_mode = false` directly in the DB. Attempt to place an order. Assert the order is still routed to the paper executor (the executor object is the mode, not the flag).
- **Mode transition gate.** Attempt to flip paper → live with open paper positions. Assert rejection. Repeat for: pending orders, failing Phase 1 criteria, missing typed-phrase confirmation.
- **Cross-mode boot rejection.** Plant an open paper position. Boot in live mode. Assert app refuses to start with the actionable error.
- **Query helper enforcement.** CI lint rule: any direct query of `positions` or `orders` outside the two query helpers fails the build.
- **Reconciliation isolation.** Plant both a paper position and a live position. Boot in paper mode. Assert reconciliation only touches the paper position; the live position remains untouched.
- **P&L isolation.** Insert mixed paper+live closed trades. Compute equity curve for the current mode. Assert it includes only current-mode trades.
- **Order endpoint guard.** Static analysis: `live-executor.ts` is the ONLY file that imports the Coinbase client's `placeOrder` / `cancelOrder` methods. Any other file importing them fails the build.

### 13.9 Visual safety in the dashboard

- **Mode badge** is the most prominent element on every page (top-left, large, color-coded: blue for paper, red/orange for live)
- **"MODE CHANGE PENDING — RESTART REQUIRED"** banner is impossible to miss when `state.mode_change_pending = true`
- All position cards, order lists, P&L numbers, and equity curves are visually tagged with their mode
- The Controls page mode toggle requires the typed-phrase confirmation, not a click
- The toggle is disabled (with a clear explanation of which precondition is unmet) when §13.5 preconditions are not satisfied

### 13.10 What this prevents

This isolation makes the following classes of bug **unreachable, not just unlikely**:

- A bug in any controller, scheduler, or AI flow path cannot accidentally route to live order placement when in paper mode (executor object identity vs. flag check)
- A query that forgets to filter by mode cannot return mixed rows (default helpers enforce filtering; CI rejects bypasses)
- A successful test in paper mode is meaningful for live mode because both share validation, sizing, and the AI flows — only the order endpoint differs
- A mode transition cannot leave inconsistent state across paper/live accounting (boot refuses to start in such a state)

The bot will spend its first 30 days exclusively in paper mode and another 30 days at half-size live. Both phases must be safe.

---

## 14. Closing Note

The bot's edge is **discipline, not intelligence**. A simple rule-following bot that beats BTC hold is more valuable than a clever bot that doesn't.

Four things to keep in mind during implementation and operation:

**1. The bot must earn the right to keep trading.** The 60-day BTC underperformance check is the most important rule in this document. Honor it. If the bot can't beat doing nothing, stop the bot.

**2. Spend AI when it matters, not for show.** $50/month is plenty if the model is only called when something might actually change. The morning brief sets the day's hypothesis. Sonnet checks if the hypothesis is still true. Opus is woken when the answer changes.

**3. When in doubt, do nothing.** Default to cash. Default to no trade. Default to no parameter change. Default to no new backend feature. The cost of inaction is tiny; the cost of a bad action can be the entire account.

**4. The frontend is half the deliverable.** The operator must see everything: every AI prompt and response, every app decision, every state change, every wake-up trigger fire, every order placement. Match backend effort with frontend effort. Polish typography, animations, empty states, color systems. The dashboard is how the operator validates that the bot is doing what it should — if the dashboard isn't clear, the discipline rules are unenforceable.

**5. Paper mode is real money.** Not in the trading sense — but in the bug-class sense. A paper-mode bug that places a real order is the same outcome as a live-mode bug. Treat paper mode isolation as a critical-path safety system, not a convenience feature.

That's the system.
