# Strategy Supplement — Model Orchestration & Budget Architecture

**Companion to:** `DEFINITIVE_TRADING_STRATEGY.md` (v1.0)
**Status:** Specification — apply before Phase 1 paper trading begins.
**Audience:** The human operator and the agent teams implementing the AI orchestration layer.

This document does not replace v1.0. It sits next to it. The trading strategy in v1.0 — regimes, conviction scoring, position sizing, entry criteria, exit rules, self-modification limits, correlation rules, risk controls, the database schema for `positions`/`orders`/`pending_timers`/`evaluations`/`theses`/`strategy_modifications`/`regime_history`/`reconciliation_log`, the Coinbase integration, the boot reconciliation sequence — all of that stands.

What this supplement adds is the model orchestration architecture: which AI model makes which decision, how the system learns to schedule its own AI calls, and how API spending is bounded. Where this supplement contradicts v1.0, this supplement wins. Those contradictions are listed explicitly in Section A.

---

## A. Overrides From v1.0

Read this section first. It is the canonical list of instructions in v1.0 that no longer apply or are modified. Anything not in this list is unchanged.

| v1.0 Reference | v1.0 Said | Override |
|---|---|---|
| §3 Account Parameters → "API Cost Budget: Uncapped" | API costs handled externally; not factored into P&L | **OVERRIDDEN.** API budget is hard-capped at $50/month, enforced in code. See Section C. |
| §7 Evaluation Cadence → "Every 8 hours (three times per day)" | All three swing evaluations are full Opus calls | **OVERRIDDEN.** Only the 06:00 UTC evaluation is a full Opus call. The 14:00 UTC and 22:00 UTC evaluations are Sonnet 4.6 watcher checkpoints. Opus is invoked off-schedule via watcher escalation. See Section B. |
| §14 Data Package | One data package shape sent to "Opus" each evaluation | **MODIFIED.** Two data package shapes now exist: the full Opus package (06:00 UTC and on escalation) and the slim Sonnet watcher package (14:00 and 22:00 UTC). See Section E. |
| §15 Decision Output Format | One output shape ("Daily Evaluation" + "Standard 8-Hour Evaluation") | **EXTENDED.** Daily Opus output now includes `watcher_directives` (today's rubric) and `watcher_corrections` (review of yesterday's rubric performance). Sonnet watcher has its own structured output. See Section F. |
| §13 Self-Modifying Strategy | One self-modification surface (strategy parameters) | **EXTENDED.** Two self-modification surfaces now exist: (1) the existing strategy parameter modification every 5 trades, unchanged; and (2) the watcher rubric, regenerated daily by Opus. The watcher rubric self-modification is bounded by hard caps in Section D. |
| §20 Database Schema | Lists tables for state, positions, orders, evaluations, theses, etc. | **EXTENDED.** Five new orchestration tables: `watcher_rubrics`, `escalations`, `suppressed_escalations`, `api_spend`, `wakeup_trigger_log` (Section G). Five additional forensic logging tables: `decision_traces`, `system_state_history`, `app_decisions`, `price_snapshots`, `error_log` (Section N). |
| §23 System Startup Sequence → "Run the first Layer 1 evaluation immediately" | First Layer 1 runs on first launch | **MODIFIED.** First boot also bootstraps an empty starter watcher rubric (no triggers, escalation_budget=0) so that Sonnet has something to read. The first morning Opus call replaces it with a real rubric. |
| §25 Dashboard Requirements | Lists panels for portfolio, positions, trades, signals, strategy, reconciliation | **EXTENDED.** Four new dashboard panels required: API Budget panel, Watcher Rubric panel, Escalation Log panel, Active Triggers panel. See Section J. |
| §18 Logging Requirements | Specifies evaluation logs and trade logs | **EXTENDED.** Comprehensive forensic logging is added (always on, not a debug toggle): full prompts/responses, immutable state history, app-level decisions, price snapshots at decision time, errors. See Section N. |
| §7 Emergency Evaluation → "trigger an immediate off-cycle evaluation" | Immediate evaluation goes directly to Opus on 5%+ moves | **EXTENDED.** Two-tier off-cycle evaluation now exists: app-level coded triggers (Section D.4 fallbacks) wake Opus directly on severe conditions, and app-level coded wake-up triggers (Section D.4.1) wake Sonnet on developing conditions. Sonnet then decides whether to escalate to Opus. |

Everything else in v1.0 remains in force. In particular: the trading strategy itself (regimes, sizing, conviction, entry/exit) is unchanged. If an agent finds itself wanting to modify §8–§12 or §16–§17 of v1.0, stop and ask the operator.

---

## B. Two-Role Model Architecture

### B.1 The roles

The system uses two AI models in distinct, non-overlapping roles.

**Decider — Claude Opus 4.7** (model string: `claude-opus-4-7`)

Opus is the only model authorized to make decisions that move money or change rules. Specifically:

- Market regime classification (overrides v1.0 §8).
- Investment thesis creation, update, and invalidation (v1.0 §6 Layer 1).
- Trade entry decisions (v1.0 §11).
- Trade exit decisions (v1.0 §12), including stop-loss and take-profit adjustments.
- Strategy parameter self-modification (v1.0 §13).
- Watcher rubric generation and correction (Sections D and F of this supplement).

Opus runs with adaptive thinking enabled. The `effort` parameter is set per call type:
- `effort: "max"` for daily L1+L2, watcher escalations that result in entry decisions, and strategy reviews.
- `effort: "high"` for emergency evaluations and exit decisions.
- `effort: "medium"` for post-restart reconciliation evaluations and stop adjustments only.

**Watcher — Claude Sonnet 4.6** (model string: `claude-sonnet-4-6`)

Sonnet runs the off-cycle checkpoints. It has one job: read the current rubric, the current portfolio and price state, and decide whether to escalate to Opus. Sonnet does not place orders, modify orders, modify theses, or change strategy parameters. Ever. If Sonnet's output contains an instruction to do any of those things, the app rejects the response and logs a malformed-output error.

Sonnet runs with `effort: "low"` or no extended thinking. It is a cheap, fast classifier, not a reasoner.

### B.2 Why this split

The asymmetry matters. Conviction scores from Opus are calibrated against Opus's priors. A 70 conviction from Sonnet does not mean the same thing. Mixing models on entry decisions corrupts the strategy review feedback loop in v1.0 §13 — if half the trades came from a different model's calibration, win-rate stats become noise.

The escalation decision (whether to wake Opus) is fine to delegate to Sonnet because escalation itself is not actionable. It is a routing decision. The actionable decision still happens at Opus.

### B.3 Schedule

The 8-hour cadence in v1.0 §7 is replaced by:

| Time (UTC) | Model | Purpose | Triggers Possible |
|---|---|---|---|
| 06:00 | Opus 4.7 | Full Layer 1 + Layer 2 + watcher rubric + review of yesterday's rubric | Always runs (highest priority — never blocked by budget gate; alerts operator if budget would be exceeded) |
| 14:00 | Sonnet 4.6 | Watcher checkpoint | May escalate to Opus if rubric trigger fires |
| 22:00 | Sonnet 4.6 | Watcher checkpoint | May escalate to Opus if rubric trigger fires |
| Off-cycle | Opus 4.7 | Watcher escalation, emergency 5% eval, post-restart eval | Driven by triggers; capped by Section C |
| Every 5 trades or 30 days | Opus 4.7 | Strategy review (v1.0 §13, unchanged) | Triggered by trade count or elapsed days |

Sonnet watchers run on the 06:00/14:00/22:00 schedule via `pending_timers` rows, same pattern as v1.0 §7's "scheduling without in-memory timers." The `next_evaluation_at` field in `system_state` becomes `next_scheduled_check_at`, and the app determines on each tick whether the next check is an Opus daily call or a Sonnet watcher.

### B.4 The escalation flow

When a Sonnet watcher decides to escalate:

1. Sonnet returns a structured response with `escalate: true` and a `trigger_id` from the active rubric (or `trigger_id: "fallback"` for app-level fallback rules — see Section D.4).
2. The app reads the daily escalation budget remaining from `system_state.escalations_remaining_today`.
3. If budget remaining > 0: the app decrements the counter, fetches the full Opus data package, calls Opus with the escalation context, and acts on Opus's response.
4. If budget remaining = 0: the escalation is logged to `suppressed_escalations` with `reason: "daily_budget_exhausted"`. No Opus call is made. The next morning's Opus call will see the suppressed escalation and review whether to widen the budget for similar future situations.
5. If the monthly API budget cap would be exceeded by the call: the escalation is suppressed with `reason: "monthly_budget_exhausted"` regardless of daily budget remaining.

### B.5 Acceptance criteria

- The model router function MUST return Opus only for the call types listed in B.1, and Sonnet only for watcher checkpoints.
- A test MUST verify that no Sonnet response can result in a placed/modified/cancelled order without an intermediate Opus call.
- A test MUST verify that the daily Opus call runs even when the monthly budget would be exceeded (with operator alert).
- The 14:00 and 22:00 Sonnet watchers MUST receive the morning's Opus output as cached context, so Sonnet has continuity with what Opus established that day.

### B.6 Anti-patterns

- **DO NOT** allow Sonnet to call Opus directly. Sonnet returns a structured escalation request; the app decides whether to invoke Opus. This separation is what makes the budget enforceable.
- **DO NOT** "mix" models on a single decision (e.g., have Sonnet draft an entry and Opus approve it). Either Opus decides or it doesn't. Drafting-and-approving costs more than just having Opus decide and produces inferior output.
- **DO NOT** have Sonnet write prose that needs to be parsed by another LLM call. Sonnet's output is structured JSON consumed by the app directly.

---

## C. API Budget Enforcement

### C.1 Hard cap

The system MUST NOT spend more than **$50.00 USD** on Anthropic API calls in any calendar month. This overrides v1.0 §3's "Uncapped" line.

### C.2 Pricing reference (as of April 2026)

| Model | Input | Output | Cache Read | Cache Write (5-min / 1-hour) |
|---|---|---|---|---|
| Opus 4.7 (`claude-opus-4-7`) | $5.00/M | $25.00/M | $0.50/M | $6.25/M / $10.00/M |
| Sonnet 4.6 (`claude-sonnet-4-6`) | $3.00/M | $15.00/M | $0.30/M | $3.75/M / $6.00/M |

Web search tool: ~$0.01 per search (priced separately, counts toward monthly cap).

Opus 4.7's tokenizer can produce up to 35% more tokens than older models on the same input text. Budget estimates assume the high end of that range.

### C.3 Pre-call cost estimates

Use these for the budget gate's pre-call estimation. Multiply by 1.3 for variance buffer.

| Call type | Model | Pre-call estimate | With buffer |
|---|---|---|---|
| Daily L1+L2 + rubric + review | Opus 4.7 | $0.65 | $0.85 |
| Sonnet watcher checkpoint | Sonnet 4.6 | $0.08 | $0.10 |
| Watcher escalation → Opus decision | Opus 4.7 | $0.50 | $0.65 |
| Emergency 5% evaluation | Opus 4.7 | $0.55 | $0.72 |
| Strategy review | Opus 4.7 | $0.80 | $1.04 |
| Post-restart reconciliation eval | Opus 4.7 | $0.50 | $0.65 |

### C.4 Target monthly allocation

| Item | Calls/month | Cost/call | Monthly |
|---|---|---|---|
| Daily Opus L1+L2 | 30 | $0.65 | $19.50 |
| Sonnet scheduled watchers (06/14/22 UTC) | 60 | $0.08 | $4.80 |
| Sonnet wake-up calls (cap: 4/day, 90/month) | ≤90 | $0.08 | $7.20 |
| Watcher escalations to Opus (cap: 1/day, 20/month) | ≤20 | $0.50 | $10.00 |
| Emergency Opus evals (cap: 5/month) | ≤5 | $0.55 | $2.75 |
| Post-restart Opus | ~4 | $0.50 | $2.00 |
| Strategy review | ~1.5 | $0.80 | $1.20 |
| Web search | ~50 searches | $0.01 | $0.50 |
| **Subtotal** | | | **$47.95** |
| **Variance buffer** | | | **$2.05** |
| **Cap** | | | **$50.00** |

Note: the variance buffer drops from $9.25 (without wake-ups) to $2.05 (with wake-ups). This is tight. The dynamic backoff in Section C.8 is what protects the cap when actual usage runs above projection. If wake-up volume consistently runs above 90/month, the operator must either tighten wake-up trigger conditions in code or accept that the monthly cap is being hit.

### C.5 Hard caps (enforced server-side)

These are constants in code. Opus and Sonnet MUST NOT have authority to change them. To change one, modify code, code-review the change, and increment the strategy version.

- `MAX_OPUS_CALLS_PER_DAY = 4` (1 daily + 1 escalation + 2 emergency/restart/review)
- `MAX_SONNET_CALLS_PER_DAY = 7` (3 scheduled at 06/14/22 UTC + 4 wake-up calls)
- `MAX_SONNET_WAKEUPS_PER_DAY = 4`
- `MAX_SONNET_WAKEUPS_PER_MONTH = 90`
- `MAX_ESCALATIONS_PER_DAY = 1` (Opus's morning rubric may authorize 0 or 1)
- `MAX_ESCALATIONS_PER_MONTH = 20`
- `MAX_EMERGENCY_EVALS_PER_MONTH = 5`
- `MONTHLY_BUDGET_USD = 50.00`

### C.6 Budget gate

Every API call (Opus and Sonnet) MUST be preceded by a call to `budget_gate(call_type, estimated_tokens) -> Decision`.

The gate reads `api_spend` for the current calendar month, computes MTD spend, computes the pre-call estimate × 1.3, and returns one of:
- `Decision.ALLOW` — proceed with the call.
- `Decision.BLOCK_HARD_CAP` — would exceed monthly $50. Take action per C.7.
- `Decision.BLOCK_DAILY_CEILING` — would exceed `MAX_*_CALLS_PER_DAY`. Take action per C.7.
- `Decision.WARN_BACKOFF` — within cap but spend trajectory is hot. Allow but apply backoff per C.8.

After the call completes, write a row to `api_spend` with actual token counts and computed cost within 5 seconds.

### C.7 Behavior when blocked

| Call type | If blocked |
|---|---|
| Daily Opus L1+L2 | Never blocked. Run anyway. Alert operator that budget is mismanaged. |
| Sonnet scheduled watcher | Skip. Mark window as `skipped_budget` in evaluation log. |
| Sonnet wake-up call | Skip. Log to `wakeup_trigger_log` with `was_dispatched: false` and `suppression_reason: "budget"`. The wake-up event itself is not lost — it's logged for tomorrow morning's review. |
| Watcher escalation | Suppress. Log to `suppressed_escalations` with reason. Reviewed next morning. |
| Emergency 5% eval | Downgrade to Sonnet. If Sonnet also blocked, log event with no AI eval (Coinbase stops still active). |
| Strategy review | Defer. Next morning's L1 call notes deferred review. |
| Post-restart reconciliation eval | Downgrade to Sonnet. |

### C.8 Dynamic backoff

If MTD spend is running hot relative to elapsed month, automatically tighten:

| Spend ratio (MTD spend / elapsed-month linear projection) | Backoff |
|---|---|
| < 1.10 | None (normal operation) |
| ≥ 1.10 | Daily escalation budget capped at 0 unless Opus's morning call explicitly justifies authorizing 1; daily wake-up cap reduced to 2 |
| ≥ 1.25 | Drop to 1 Sonnet scheduled watcher per day (skip the 22:00 UTC watcher); daily wake-up cap reduced to 1 |
| ≥ 1.40 | Daily Opus call only. All Sonnet calls (scheduled and wake-up) suppressed unless adjusting a stop on an open position. |

The spend ratio is computed on every API call. Backoff state is stored in `system_state.budget_backoff_level` (0–3, integer). Reset to 0 at the start of each calendar month.

### C.9 Acceptance criteria

- `SELECT SUM(computed_cost_usd) FROM api_spend WHERE month = CURRENT_MONTH` MUST always return ≤ $50.00.
- Every Anthropic API request MUST be preceded by a `budget_gate` call.
- Every Anthropic API response MUST result in a row in `api_spend` within 5 seconds.
- A test harness MUST simulate the budget gate at each backoff threshold and verify correct call routing.
- The dashboard MUST display MTD spend, projected month-end spend, current backoff level, and remaining budget in real time.

### C.10 Anti-patterns

- **DO NOT** include cost data in the prompts sent to Opus or Sonnet. Models do not need to know what they cost. Showing them this data creates a structural incentive to manipulate call frequency that we explicitly do not want.
- **DO NOT** use environment variables for `MONTHLY_BUDGET_USD` or any `MAX_*` constant. They live in code and require a code review to change.
- **DO NOT** trust Opus's morning rubric to specify the daily escalation budget without server-side capping. Apply `min(opus_authorized, MAX_ESCALATIONS_PER_DAY)`.
- **DO NOT** allow the 1.3× variance buffer to be tuned by Opus or Sonnet. It is a code constant.

---

## D. Self-Learning Watcher Rubric

### D.1 What the rubric is

A watcher rubric is a structured set of escalation triggers that tells Sonnet when to escalate to Opus. It is generated by Opus each morning during the daily L1+L2 call, scoped to today's market state and active theses, and expires the next morning.

The rubric is not free-form. It is JSON conforming to a schema (Section D.3) that the Sonnet watcher prompt knows how to evaluate.

### D.2 Why generate it daily

A static escalation rubric would either be too generic (escalate on too much, blowing the budget) or too narrow (miss obvious escalation conditions in changing regimes). A rubric written each morning with full context — today's regime, active theses, open positions, upcoming macro events — produces tighter, more useful triggers.

The rubric is also the surface where the system learns. Each morning, before generating today's rubric, Opus reviews how yesterday's rubric performed: which triggers fired, whether each escalation was actionable, what got missed. The corrections are stored alongside the new rubric, producing a written audit trail of how the rubric evolves over time.

### D.3 Rubric schema

Stored in the `watcher_rubrics` table as a JSON column. Schema:

```json
{
  "rubric_id": "uuid",
  "created_at_eval_id": "fk to evaluations",
  "active_from": "ISO timestamp",
  "active_until": "ISO timestamp",
  "escalation_budget_authorized": 1,
  "triggers": [
    {
      "id": "btc-breakout",
      "type": "price_threshold",
      "asset": "BTC",
      "condition": "above",
      "value": 69200,
      "with_volume_above": "1.5x_20d_avg",
      "urgency": "immediate",
      "rationale": "Breakout above resistance with volume would confirm the bull thesis from this morning's regime call."
    },
    {
      "id": "eth-pectra-news",
      "type": "news_keyword",
      "keywords_required_all": ["Pectra", "delay"],
      "urgency": "next_cycle",
      "rationale": "Pectra delay news would invalidate the active ETH accumulation thesis."
    },
    {
      "id": "stop-proximity",
      "type": "stop_proximity",
      "applies_to": "all_open_positions",
      "distance_pct": 1.5,
      "urgency": "immediate",
      "rationale": "Standing trigger so Opus can decide whether to trail, exit early, or hold."
    }
  ],
  "no_escalation_guidance": "BTC trading $68,800–$69,400 with no volume anomaly is normal consolidation; do not escalate. Routine drift on alts within ±2% on no news is normal; do not escalate.",
  "max_escalations_authorized": 1
}
```

Supported `type` values for triggers (extend as needed; agents adding new types must update both the rubric generator prompt and the Sonnet watcher prompt):

- `price_threshold` — asset crosses a level, optionally with volume condition.
- `news_keyword` — search results contain specified keywords (single, all-of, or any-of variants).
- `stop_proximity` — open position is within N% of its stop or take-profit.
- `pnl_swing` — total portfolio or single-position P&L moves N% in a single watcher window.
- `regime_drift` — observed conditions diverge from morning regime call (specific named indicators).
- `correlation_break` — asset decorrelates from BTC (used for alts).
- `time_window` — specific event (CPI print, FOMC, scheduled token unlock) is within N hours.

### D.4 App-level fallback triggers (Opus cannot disable these)

Independent of the daily rubric, the app evaluates these on every Sonnet watcher call. Opus may add narrower triggers; it cannot remove or override these.

- Any held position moves >3% in a single watcher window: escalate.
- Any held position is within 1% of its stop-limit price: escalate.
- Total portfolio P&L moves >2% in a single watcher window: escalate.
- Any tradeable asset (BTC/ETH/SOL or active tertiary) moves >5% since last evaluation: escalate (this is v1.0 §7's emergency rule, kept and reframed as a watcher fallback).
- Sonnet's response includes `discretionary_escalation: true` with a written reason: escalate (gives Sonnet a single escape hatch for genuinely novel situations the rubric did not anticipate).

These count against the daily escalation budget the same way rubric-driven escalations do. If the budget is exhausted, even fallback triggers go to `suppressed_escalations`. The Coinbase stop-limit orders are the actual safety net, not the fallback escalations.

### D.4.1 App-level Sonnet wake-up triggers (Opus cannot modify these)

The fallback triggers in D.4 wake **Opus** directly on severe conditions. The wake-up triggers below wake **Sonnet** between scheduled watcher windows on developing conditions. Sonnet then evaluates the rubric and decides whether to escalate further to Opus.

This closes the visibility gap between the 06:00, 14:00, and 22:00 UTC scheduled checks, where the system would otherwise be blind to anything below the D.4 thresholds for up to 8 hours.

These triggers are hardcoded in app code. They are NOT in the daily rubric. They are NOT modifiable by Opus or by Sonnet. To change one, modify code, code-review the change, and increment the strategy version.

The five wake-up triggers:

1. **Position move (intermediate)** — any held position moves ≥2% in either direction within a 1-hour window. Below the D.4 fallback threshold (3%), but worth a Sonnet check to evaluate whether the move is developing.

2. **Volume spike** — any tradeable asset (BTC/ETH/SOL or active tertiary) prints 1-hour volume ≥2× its 20-day hourly average. Volume often precedes price; catching the spike means Sonnet can flag a setup forming before the price move is half over.

3. **News keyword hit** — the app's news polling (RSS, web search, or whatever the news source is) detects a keyword from the active rubric outside scheduled windows. Triggers a Sonnet evaluation rather than waiting for the next scheduled watcher to find it.

4. **BTC dominance shift** — BTC.D moves ≥0.5% in a 4-hour rolling window. BTC.D moves are slow and meaningful; a 0.5% shift can change the alt thesis enough to warrant a check.

5. **Stop-limit fill on Coinbase** — when a stop-limit fires on the exchange and a position closes, the system immediately wakes Sonnet to evaluate whether to re-enter (fakeout case), update theses, or accept the exit. This MUST NOT wait for the next scheduled watcher.

#### Wake-up dispatch flow

When a wake-up trigger fires:

1. The app logs the wake-up event to `wakeup_trigger_log` immediately, regardless of whether dispatch succeeds.
2. The budget gate is checked. If `MAX_SONNET_WAKEUPS_PER_DAY`, `MAX_SONNET_WAKEUPS_PER_MONTH`, or the monthly budget cap would be exceeded, the wake-up is logged with `was_dispatched: false` and `suppression_reason`. No call is made.
3. If allowed, Sonnet is called with the slim watcher data package (Section E.2), with the wake-up context appended: trigger type, condition value, observed value, asset (if applicable).
4. Sonnet evaluates the active rubric and the wake-up context together, returning the standard watcher output (Section F.3). It may escalate to Opus or note-and-continue.
5. The wake-up log row is updated with the Sonnet evaluation reference.

#### Wake-up triggers DO NOT replace scheduled watchers

The 06:00, 14:00, and 22:00 UTC scheduled Sonnet watchers continue to run regardless of whether wake-ups fired between them. A wake-up at 16:30 does not satisfy the 22:00 scheduled watcher.

The 06:00 UTC watcher is special: it runs as part of the daily Opus call (the watcher rubric and review are generated alongside Opus's L1+L2 output). Wake-ups before 06:00 UTC may run, but the actual rubric refresh happens at 06:00.

#### Trigger debouncing

Each trigger MUST debounce to prevent storms:

- **Position move** and **Volume spike**: minimum 30 minutes between wake-ups for the same asset and trigger type. A second 2% move on BTC within 30 minutes of the first wake-up does not re-trigger.
- **News keyword**: minimum 15 minutes between wake-ups for the same keyword.
- **BTC dominance**: minimum 60 minutes between wake-ups (BTC.D moves are slow; consecutive wake-ups indicate noise, not signal).
- **Stop-limit fill**: no debounce. Every fill triggers a wake-up. (These are rare and always meaningful.)

Debounce state is stored in `system_state` keys (e.g., `last_wakeup_position_move_BTC_at`) and persists across restarts.

#### Pruning and observability

After 30 days of operation, the operator MUST review the `wakeup_trigger_log` table and assess each trigger by escalation rate (how often the wake-up resulted in Sonnet escalating to Opus) and actionable rate (how often the resulting Opus call took action). If a trigger has a 0% escalation rate over 30+ wake-ups, it's noise. Either tighten the threshold in code or remove the trigger.

This is the only mechanism by which the wake-up trigger list shrinks. Coded triggers do NOT self-modify. They are pruned by the operator based on observed data, with code review.

#### Acceptance criteria

- Every wake-up trigger MUST log to `wakeup_trigger_log` before any other action, even if dispatch is suppressed.
- Debounce state MUST persist across restarts (stored in `system_state`).
- A test MUST verify that a wake-up trigger does not re-fire within its debounce window.
- A test MUST verify that the daily and monthly wake-up caps are enforced.
- The dashboard MUST surface each wake-up trigger and its current state (last fired, debounce remaining, escalation rate to date).

#### Anti-patterns

- **DO NOT** add new wake-up triggers without code review and operator approval. The list is intentionally short.
- **DO NOT** let the wake-up triggers be modifiable from the dashboard at runtime. They are code constants.
- **DO NOT** skip the debounce check. A volatile asset can produce 20 wake-ups in 10 minutes without it.
- **DO NOT** wake Opus directly from a wake-up trigger. Wake-ups always go through Sonnet first. The whole point is the cheap intermediate evaluation.
- **DO NOT** add wake-up triggers that depend on data Sonnet doesn't have access to in the slim package (e.g., on-chain metrics that are only fetched in the full Opus package).

### D.5 The morning review

The morning Opus call MUST receive, as part of its data package, a `watcher_review` section:

```json
"watcher_review": {
  "yesterday_rubric": { ... full rubric from yesterday ... },
  "escalation_log": [
    {
      "timestamp": "...",
      "watcher_window": "14:00 UTC | 22:00 UTC | off_cycle",
      "triggered_by": "btc-breakout | fallback:price_move_3pct | discretionary",
      "sonnet_reasoning": "string",
      "opus_response_summary": "Confirmed entry at $69,180, 30% allocation, conviction 76",
      "opus_action_taken": "trade_entered | stop_modified | position_exited | no_action | thesis_updated",
      "outcome_was_actionable": true
    }
  ],
  "suppressed_escalations": [
    {
      "timestamp": "...",
      "trigger_id": "...",
      "reason_suppressed": "daily_budget_exhausted | monthly_budget_exhausted",
      "sonnet_assessment": "string",
      "asset_state_at_suppression": { ... }
    }
  ],
  "missed_signals_in_hindsight": [
    {
      "timestamp": "...",
      "event": "string description of what happened",
      "would_have_been_actionable": true,
      "reason_missed": "no rubric trigger covered this | trigger fired but resolved before next watcher | other"
    }
  ],
  "escalation_count_used_yesterday": 2,
  "escalation_count_authorized_yesterday": 3,
  "actionable_rate_yesterday": 0.50,
  "actionable_rate_7d": 0.43,
  "actionable_rate_30d": 0.51
}
```

The `outcome_was_actionable` field is set by Opus, not Sonnet. Sonnet says "I think this warrants escalation"; Opus, after evaluating, marks whether its decision actually changed anything. Trade entered, stop moved, position exited, or thesis updated = actionable. Reviewed and held = not actionable. This is the only ground truth signal the system has for rubric quality.

### D.6 Opus's morning corrections output

The morning Opus output MUST include `watcher_corrections`:

```json
"watcher_corrections": {
  "rubric_changes_from_yesterday": [
    {
      "trigger_id": "eth-pectra-news",
      "change": "tightened | loosened | added | removed | merged",
      "old_value": { ... },
      "new_value": { ... },
      "reasoning": "Yesterday this fired on a roundup article that mentioned the upgrade without timeline content. Requiring a delay-related second keyword should eliminate the false positive."
    }
  ],
  "rubric_size_check": {
    "active_trigger_count": 6,
    "max_allowed": 8,
    "overfit_flags": [
      { "trigger_id": "btc-breakout", "tightened_count_30d": 5, "recommendation": "rebuild from scratch using observed catalyst patterns" }
    ]
  },
  "guidance_to_sonnet": "When a news trigger has multi-keyword conditions, all keywords must appear in the same article, not across separate articles in the same window. Read for substantive content, not surface mentions.",
  "escalation_budget_today": 1,
  "budget_reasoning": "Holding at 1 despite yesterday's 0/1 use. Today has CPI at 12:30 UTC which raises the probability of legitimate escalations."
}
```

### D.7 Hard caps on rubric self-modification

These are enforced by the app, not by Opus:

- `MAX_ACTIVE_TRIGGERS_PER_RUBRIC = 8`. If Opus's output specifies 9+, the app keeps the first 8 in priority order and logs an error.
- A trigger that has been tightened 4+ times in 30 days MUST either be merged with another trigger or rebuilt from scratch in the next morning's rubric. This is detected by the app and surfaced in `watcher_review.overfit_flags`.
- `escalation_budget_today` is capped at `MAX_ESCALATIONS_PER_DAY` (Section C.5). If Opus authorizes more, the app silently caps.
- Fallback triggers in D.4 cannot be modified by Opus.

### D.8 Connection to v1.0 §13 strategy review

Every 5 trades or 30 days, the v1.0 §13 strategy review runs. As of v2, that review MUST also evaluate:

- **Rubric efficacy by source:** Did trades originating from watcher escalations perform better, worse, or the same as trades originating from scheduled morning Opus calls? Compute realized P&L net of fees, segmented by trade source. If escalation-triggered trades systematically underperform by >0.5% on average, flag the rubric system for structural review (not just trigger tweaks).
- **Actionable rate trend:** Is the 30-day rolling actionable rate stable, improving, or deteriorating? A deteriorating trend with no regime change is a sign of rubric drift.
- **Suppressed escalation cost:** Of escalations suppressed for budget reasons, how many would have been actionable in hindsight? If >3 suppressed-and-would-have-been-actionable in a 30-day window, the daily budget is too tight and the operator should be alerted.

### D.9 Acceptance criteria

- The `watcher_rubrics` table MUST have a row for every UTC day from system start onward, even if the rubric is empty (first day, post-failure recovery, etc.).
- The Sonnet watcher prompt MUST programmatically read the active rubric and evaluate triggers — it MUST NOT rewrite or interpret triggers freely.
- A test MUST verify that a malformed rubric (invalid trigger type, missing required field) causes the rubric to be rejected at write time, not at evaluation time.
- A test MUST verify that the app-level fallback triggers in D.4 fire correctly even when the active rubric is empty.

### D.10 Anti-patterns

- **DO NOT** let Opus rewrite the trigger types/schema dynamically. New types require code changes to the Sonnet watcher prompt.
- **DO NOT** let the rubric reference data the Sonnet watcher does not have access to (e.g., on-chain metrics that are only fetched in the Opus data package). The rubric must be evaluable from the watcher data package alone.
- **DO NOT** let the rubric grow unbounded. Hard cap at 8 triggers. If Opus wants more, it must remove or merge.
- **DO NOT** treat Sonnet's `discretionary_escalation` as free. It still counts against the daily budget. Sonnet should use it only when truly novel conditions arise.

---

## E. Data Packages — Modifications to v1.0 §14

### E.1 Two packages now exist

v1.0 §14 specified one data package shape. v2 has two:

- **Opus full package:** Used for the daily L1+L2, watcher escalations, emergency evals, post-restart evals, and strategy reviews. This is the v1.0 §14 package (sections A through H), with two additions for the daily call only: `watcher_review` (per Section D.5 of this supplement) and the active rubric for self-reference.
- **Sonnet watcher package:** Slim. Used for 14:00 and 22:00 UTC checkpoints. See E.2.

### E.2 Sonnet watcher package contents

The Sonnet package MUST contain:

- **Active rubric** (the `watcher_rubrics` row for today)
- **Open positions snapshot** (subset of v1.0 §14.A — positions only, plus current price and distance-to-stop for each)
- **Tradeable asset prices** for BTC, ETH, SOL (and any active tertiary): current price, percent change since 06:00 UTC, percent change since last watcher window
- **Volume data** for tradeable assets: current 1-hour volume vs. 20-day average
- **Recent news scan** (last 6 hours, web search, scoped to keywords from the active rubric — not a free-form search)
- **The morning Opus output for today** (regime, theses, new trade decisions) — passed as cached context so Sonnet has continuity
- **Escalation budget remaining** (so Sonnet's reasoning is bounded)

The Sonnet package MUST NOT contain:

- Full price history (weekly/daily/4h candles) — Sonnet doesn't need it; it's evaluating against today's rubric.
- Full trade history — Sonnet isn't deciding entries/exits.
- Full strategy parameters — Sonnet doesn't modify them.
- API spend data — not relevant to the watcher decision.

### E.3 Caching strategy

Aggressive prompt caching is mandatory. Without it the budget cap is unattainable.

| Content | Cache duration | Notes |
|---|---|---|
| System prompt for Opus daily call | 1 hour | Stable across all calls in a day |
| System prompt for Sonnet watcher | 1 hour | Stable |
| The strategy doc (v1.0) as reference context | 1 hour | Stable; refreshed daily |
| Asset universe + indicator schemas | 1 hour | Stable; very rare changes |
| Today's morning Opus output | 1 hour | Cached after morning call; consumed by 14:00 and 22:00 watchers |
| Long-horizon candle data (weekly, 90d daily) | 5 minutes | Refreshed each morning; cache hit on emergency/escalation calls within the day |

Cache write/read tokens MUST be tracked in `api_spend` (separate columns from base input tokens) so cost analysis remains accurate.

### E.4 Data package size discipline

To stay within budget, agents implementing the data package MUST:

- **Compress candle arrays.** Use compact CSV-style strings in JSON, not arrays of OHLCV objects. Saves 50%+ tokens on price data.
- **Send long-horizon data only on Layer 1 calls.** Weekly candles, 90-day daily candles, and full trade history go in the morning package only. Off-cycle Opus calls (escalations, emergencies) get the slim package plus what's specifically relevant to the trigger.
- **Compute indicators app-side.** Send the resulting values, not raw arrays for the model to compute. (This is already in v1.0 §14.C.)
- **Trim trade history.** Last 20 trades for routine calls; full history only for strategy reviews.

### E.5 Acceptance criteria

- Every Opus call other than the daily L1+L2 MUST use the slim data package unless the call is a strategy review.
- Token counts for each package shape MUST be measured in tests and tracked in `api_spend` so drift is detectable.
- Cache hit rates MUST be reported on the dashboard. A drop in cache hit rate indicates either prompt structure changed (intentional or otherwise) or cache TTL is misconfigured.

---

## F. Decision Output Formats — Additions to v1.0 §15

### F.1 Daily Opus output (v1.0 §15 + extensions)

The daily 06:00 UTC Opus call output extends v1.0 §15's "Daily Evaluation" shape. The `layer_1` and `layer_2` blocks remain as specified in v1.0. Two new top-level blocks are added:

```json
{
  "timestamp": "...",
  "strategy_version": "1.0",
  "layer_1": { ... unchanged from v1.0 §15 ... },
  "layer_2": { ... unchanged from v1.0 §15 ... },
  "watcher_directives": { ... see Section D.3 — today's rubric ... },
  "watcher_corrections": { ... see Section D.6 — review of yesterday's rubric ... }
}
```

### F.2 Off-cycle Opus output (escalation, emergency, post-restart)

A slimmer shape — no `layer_1`, no `watcher_directives`, no `watcher_corrections`. Just `layer_2` (existing positions, new trades) plus:

```json
{
  "timestamp": "...",
  "trigger_context": {
    "trigger_id": "btc-breakout | fallback:price_move_3pct | emergency_5pct | post_restart",
    "sonnet_reasoning": "...",
    "asset_state_at_trigger": { ... }
  },
  "outcome_was_actionable": true,
  "layer_2": { ... v1.0 §15 layer_2 block ... }
}
```

`outcome_was_actionable` MUST be set to true if any of: a trade was entered, a stop was modified, a position was exited, a thesis was updated. False if Opus reviewed and held.

### F.3 Sonnet watcher output

```json
{
  "timestamp": "...",
  "watcher_window": "14:00 UTC | 22:00 UTC",
  "rubric_id": "uuid",
  "evaluated_triggers": [
    {
      "trigger_id": "btc-breakout",
      "fired": false,
      "current_value": 68950,
      "threshold_value": 69200,
      "notes": "BTC at $68,950, no breakout"
    }
  ],
  "fallback_triggers_evaluated": [ ... same shape ... ],
  "escalate": false,
  "trigger_id": null,
  "reason": "All triggers within normal range. BTC consolidating per morning rubric guidance. No escalation.",
  "discretionary_escalation": false,
  "discretionary_reason": null
}
```

If `escalate: true`, the `trigger_id` MUST reference an actual trigger from the active rubric or app-level fallbacks. If `discretionary_escalation: true`, `trigger_id` is `"discretionary"` and `discretionary_reason` MUST be a non-empty string.

The Sonnet output MUST NOT contain trade decisions, regime classifications, thesis updates, or strategy parameter changes. If it does, the response is rejected as malformed.

### F.4 Acceptance criteria

- All Opus and Sonnet outputs MUST be validated against JSON schemas at parse time. Malformed outputs cause an error, not silent fallback.
- The app MUST persist every output to the `evaluations` table (or a dedicated `watcher_evaluations` table for Sonnet) with full reasoning preserved.

---

## G. Database Schema Additions

These are additions to v1.0 §20. Existing tables are unchanged.

### G.1 `watcher_rubrics`

```
id                    uuid primary key
created_at_eval_id    fk to evaluations.id
active_from           timestamp with time zone
active_until          timestamp with time zone
escalation_budget     integer (0..MAX_ESCALATIONS_PER_DAY)
rubric                jsonb (per Section D.3 schema)
replaced_by_rubric_id uuid nullable, fk to watcher_rubrics.id
created_at            timestamp default now()
```

Index on `(active_from, active_until)` for "find rubric active at time T" queries.

### G.2 `escalations`

```
id                       uuid primary key
timestamp                timestamp with time zone
rubric_id                fk to watcher_rubrics.id
watcher_window           text ('06:00' | '14:00' | '22:00' | 'off_cycle')
trigger_id               text (rubric trigger id, 'fallback:*', or 'discretionary')
sonnet_reasoning         text
sonnet_evaluation_id     fk to watcher_evaluations.id
was_suppressed           boolean
suppression_reason       text nullable
opus_evaluation_id       fk to evaluations.id nullable
opus_action_taken        text nullable ('trade_entered' | 'stop_modified' | 'position_exited' | 'no_action' | 'thesis_updated')
outcome_was_actionable   boolean nullable (set by Opus)
reviewed_in_eval_id      fk to evaluations.id nullable (set when next morning's review processes this)
```

### G.3 `suppressed_escalations`

This is a logical view of `escalations` where `was_suppressed = true`, but it's also written out as a denormalized table for fast querying in the morning review data package. Schema mirrors `escalations`.

### G.4 `api_spend`

```
id                  uuid primary key
timestamp           timestamp with time zone
model               text ('claude-opus-4-7' | 'claude-sonnet-4-6')
call_type           text (one of the call types from Section C.3)
input_tokens        integer
cache_read_tokens   integer
cache_write_tokens  integer
output_tokens       integer
web_search_count    integer default 0
computed_cost_usd   numeric(10, 6)
related_eval_id     fk to evaluations.id nullable
related_watcher_id  fk to watcher_evaluations.id nullable
month               text (YYYY-MM, generated column for fast monthly aggregation)
```

Index on `(month)` for budget gate queries. Index on `(timestamp DESC)` for dashboard.

### G.5 `watcher_evaluations`

Sonnet's outputs deserve their own table separate from `evaluations` (which is for Opus). Same general shape as `evaluations`:

```
id                uuid primary key
timestamp         timestamp with time zone
trigger_source    text ('scheduled_06' | 'scheduled_14' | 'scheduled_22' |
                       'wakeup_position_move' | 'wakeup_volume_spike' |
                       'wakeup_news_keyword' | 'wakeup_btc_dominance' |
                       'wakeup_stop_filled')
rubric_id         fk to watcher_rubrics.id
data_package_hash text
sonnet_response   jsonb
escalated         boolean
escalation_id     fk to escalations.id nullable
strategy_version  text
```

The `trigger_source` field replaces v2's earlier `window` field. Scheduled watchers populate `scheduled_*` values; wake-up calls populate `wakeup_*` values. This makes it queryable: "of all `wakeup_volume_spike` calls in the last 30 days, what percentage escalated to Opus and how many of those resulted in actionable trades?"

### G.6 `wakeup_trigger_log`

Every wake-up trigger fire is logged here, regardless of whether the resulting Sonnet call was dispatched or suppressed.

```
id                       uuid primary key
timestamp                timestamp with time zone
trigger_type             text ('position_move' | 'volume_spike' | 'news_keyword' |
                              'btc_dominance' | 'stop_filled')
asset                    text nullable (e.g., 'BTC', 'ETH'; null for non-asset triggers)
condition_threshold      jsonb (the threshold the trigger is configured with)
observed_value           jsonb (what was observed that caused the fire)
was_dispatched           boolean (true if Sonnet was actually called)
suppression_reason       text nullable ('budget' | 'debounce' | 'daily_cap' | 'monthly_cap')
sonnet_evaluation_id     fk to watcher_evaluations.id nullable
escalated_to_opus        boolean nullable (set when the resulting watcher call completes)
opus_action_taken        text nullable (set if escalated; copied from the resulting escalation's outcome)
```

Index on `(timestamp DESC)` for dashboard. Index on `(trigger_type, timestamp DESC)` for "show me the last 30 days of position_move wake-ups."

### G.7 Modifications to existing tables

- `system_state`: add keys `escalations_remaining_today` (integer), `budget_backoff_level` (integer 0..3), `next_scheduled_check_at` (timestamp), `next_check_type` ('opus_daily' | 'sonnet_watcher_14' | 'sonnet_watcher_22'), and one debounce timestamp key per wake-up trigger × asset combination (e.g., `last_wakeup_position_move_BTC_at`, `last_wakeup_volume_spike_ETH_at`, `last_wakeup_news_keyword_at`, `last_wakeup_btc_dominance_at`).
- `evaluations`: add columns `watcher_review_input` (jsonb nullable), `watcher_corrections_output` (jsonb nullable). These are populated only on the daily Opus call.
- `pending_timers`: add new `type` value `'watcher_check'` for scheduling Sonnet watchers.

### G.8 Acceptance criteria

- A migration script MUST create all new tables and columns idempotently.
- Foreign keys MUST be enforced at the database level, not in app code only.
- A nightly cleanup job MAY archive `api_spend` and `wakeup_trigger_log` rows older than 90 days to a cold table, but MUST NOT delete them.

---

## H. Phase Rollout Protocol

### H.1 Phase 1: Paper trading

The system MUST run in paper trading mode for 60 consecutive calendar days before Phase 2 is even considered. Paper trading mode is set via `system_state.paper_trading_mode = true` and can only be flipped to `false` via the dashboard with a confirmation modal.

During paper trading:
- All Opus and Sonnet calls happen normally with real data.
- All hypothetical orders are logged to the `positions` and `orders` tables with `paper = true`.
- Real Coinbase orders are NOT placed.
- API spend is real and counts against the monthly cap.

This is an extension of v1.0 §23's paper trading phase. v2 makes the duration explicit (60 days, not "at least 2-4 weeks") and adds pre-committed go-live criteria below.

### H.2 Pre-committed Phase 2 go-live criteria

These criteria MUST be met for at least 14 consecutive days within the 60-day paper trading window before transitioning to live trading. They are pre-committed to prevent goalpost moving. Modifying them after paper trading begins requires written justification logged in `strategy_modifications` AND operator confirmation.

- **Hypothetical win rate ≥ 50%** over at least 10 closed paper trades.
- **Average paper win > average paper loss** (computed on closed trades only, gross of fees).
- **Net of fees, paper P&L > 0** for the 30-day rolling window at evaluation time.
- **Watcher actionable rate ≥ 35%** averaged over the last 14 days.
- **Regime detection accuracy ≥ 60%** in hindsight (regimes assessed by Opus that proved directionally correct in retrospective evaluation).
- **Zero suppressed-and-would-have-been-actionable escalations** in the last 7 days. (If this is failing repeatedly, the daily escalation budget needs to be raised — but raising the budget requires the human operator's explicit approval and may push monthly spend toward the cap.)
- **Operator has read at least 10 daily Opus reasoning outputs and assessed them as coherent.** This is a manual qualitative gate.

### H.3 Phase 2: Live, half-size

When Phase 1 criteria are met and the operator flips paper mode off:

- Position sizes are **half** of what v1.0 §10 specifies. A 30% allocation becomes 15%. A 45% (high conviction) allocation becomes 22.5%.
- Hard guardrails are unchanged (max 50% single position, 30% min cash, 70% max deployment, etc.). Half-sizing is applied within those.
- Phase 2 runs for at least 60 days.

### H.4 Phase 3 go-live criteria (full sizing)

To transition from Phase 2 (half-size) to Phase 3 (full size per v1.0 §10):

- **Realized win rate ≥ 50%** over at least 10 closed live trades.
- **Realized P&L net of fees AND net of API costs > 0** for the most recent 30-day window.
- **No hard circuit breaker triggers.**
- **No more than one soft circuit breaker trigger.**
- **System has survived at least one regime change** detected and acted on by Opus.

### H.5 Phase 0: Failure

If at any time during Phase 1 or Phase 2 the system experiences a hard circuit breaker trigger ($300 floor), the system halts. The operator reviews logs, identifies the failure mode, decides whether to restart with a modified strategy or to convert to BTC core hold per v1.0 §16's accountability clause.

If after 60 days of Phase 1 paper trading the go-live criteria in H.2 are not met, do not proceed to Phase 2. Either iterate on the strategy in paper, or accept that the system does not produce alpha and convert to BTC core hold.

### H.6 Acceptance criteria

- The dashboard MUST display each go-live criterion with its current value, the threshold, and a pass/fail indicator.
- A test MUST verify that flipping `paper_trading_mode = false` is rejected if the H.2 criteria are not currently met. The operator can override with explicit confirmation, but the rejection happens by default.

---

## I. Failure Modes and Mitigations

### I.1 Rubric over-tightening drift

**Failure:** Each false positive prompts Opus to tighten the firing trigger. Over weeks, triggers accumulate conditions and become so specific they only fire on yesterday's exact pattern. The system stops missing things it has seen and starts missing everything else.

**Mitigation:** The `overfit_flags` mechanism in Section D.6. Triggers tightened 4+ times in 30 days are flagged for rebuild from scratch. The morning Opus call MUST process flagged triggers — either rebuilding them or merging them with related triggers.

### I.2 Rubric complexity bloat

**Failure:** Each missed signal adds a new trigger. After 60 days, the rubric has 25 triggers. Edge cases multiply, debugging becomes intractable.

**Mitigation:** `MAX_ACTIVE_TRIGGERS_PER_RUBRIC = 8` in code. Adding a 9th requires removing or merging an existing one. This forces prioritization.

### I.3 Feedback loop poisoning

**Failure:** Opus's `outcome_was_actionable` judgment is itself an Opus judgment. If Opus is systematically wrong about which signals are actionable in hindsight, the rubric optimizes for the wrong target. There is no external ground truth except realized P&L, which is delayed and noisy.

**Mitigation:** v1.0 §13 strategy review (every 5 trades) must include rubric efficacy by trade source per Section D.8. If escalation-triggered trades systematically underperform scheduled-eval trades, the rubric system itself needs structural review, not trigger tweaks.

### I.4 Implicit incentive to call Opus more often

**Failure:** Opus, asked to define when it should be invoked, may write broad rubrics because more context → better decisions, from its perspective. The entity choosing the trigger threshold doesn't pay the bill.

**Mitigation:** Server-side caps in Section C.5. Daily and monthly escalation limits are hardcoded. Opus's authorized budget is `min(opus_authorized, hardcoded_ceiling)`. Cost data is NEVER shown to Opus or Sonnet (Section C.10 anti-pattern).

### I.5 Sonnet over-escalates

**Failure:** Sonnet interprets borderline cases as escalation-worthy more often than Opus would have, burning the daily budget on non-actionable calls.

**Mitigation:** Pattern shows up as low actionable rate. Opus tightens triggers in the next morning's rubric. If actionable rate stays below 35% for 14+ days despite rubric corrections, the prompt to Sonnet itself needs revision (an operator-level intervention, not an Opus self-correction).

### I.6 Sonnet under-escalates

**Failure:** Sonnet is too conservative or misinterprets rubric conditions, missing legitimate escalation events.

**Mitigation:** App-level fallback triggers in D.4 cannot be disabled. Discretionary escalation provides Sonnet an escape hatch. Opus reviews missed signals each morning and adds triggers or broadens existing ones.

### I.7 Cache invalidation cascade

**Failure:** A change to the system prompt or strategy doc invalidates all caches; the next 24 hours of API calls run at full uncached prices, blowing the daily budget on a single bad day.

**Mitigation:** System prompt and strategy doc changes MUST be deployed during a planned maintenance window. The deploy script MUST warn if MTD spend × (cache_uncached_multiplier) would exceed the cap. Cache structure should be designed so that small content changes don't invalidate the whole cached prefix — keep the most-edited content (today's data) at the end of the prompt, after the stable cached prefix.

### I.8 Database lost or corrupted

**Failure:** The Postgres database is the only persistent state. If the rubric/escalation/spend tables are lost, the system loses everything it has learned.

**Mitigation:** Daily automated backups of the Postgres database to a separate location. The `watcher_rubrics`, `escalations`, and `api_spend` tables are critical state — the same priority as `positions` and `orders`. Document this in the runbook.

### I.9 The model is unavailable

**Failure:** Anthropic API is down or rate-limited during a scheduled call.

**Mitigation:** Same retry pattern as v1.0 §19's exchange failure handling. Five-minute retries for 30 minutes. After 30 minutes, log a missed evaluation and skip. Open positions are protected by Coinbase stop-limits regardless. If the API is unreachable for >2 hours and there are open positions, alert the operator (same threshold as v1.0).

### I.10 Anthropic deprecates the model

**Failure:** `claude-opus-4-7` or `claude-sonnet-4-6` is deprecated or replaced.

**Mitigation:** Model IDs are constants in code, code-reviewed when changed. A deprecation triggers a planned migration: new model is tested in paper mode for 14 days, A/B'd against the current model on identical data packages, before being promoted to live. Strategy version increments on model migration so performance is segmented by model.

### I.11 Wake-up trigger noise

**Failure:** A hardcoded wake-up trigger fires repeatedly on conditions that consistently don't warrant Sonnet escalation. Burns wake-up budget on noise, hits monthly Sonnet wake-up cap, leaves the system blind during legitimate developing conditions later in the month.

**Mitigation:** The `wakeup_trigger_log` table tracks every fire and downstream outcome. The Active Triggers dashboard panel (J.6) flags any wake-up trigger with a 0% escalation rate over 30+ fires. The operator reviews flagged triggers and either tightens thresholds in code or removes the trigger. This is the only mechanism by which the wake-up trigger list shrinks — wake-ups do NOT self-modify. Pruning is operator-driven with code review. The debounce mechanism in D.4.1 is the runtime defense; the dashboard flag is the longer-term defense.

---

## J. Dashboard Additions

These extend v1.0 §25.

### J.1 API Budget Panel

- MTD spend (large number)
- Projected month-end spend (linear extrapolation)
- Remaining budget for the month
- Current backoff level (0–3)
- Spend breakdown by call type (stacked bar, last 30 days)
- Spend breakdown by model (Opus vs Sonnet, last 30 days)
- Cache hit rate (last 7 days, Opus and Sonnet separately)
- Per-call cost trend (line chart, last 30 days, broken out by call type)
- Alert if MTD spend trajectory will exceed cap

### J.2 Watcher Rubric Panel

- Today's active rubric: list of triggers with values, urgency, rationale
- Today's escalation budget remaining
- Yesterday's rubric performance: actionable rate, escalations used, triggers that fired
- 7-day and 30-day rolling actionable rate (line chart)
- Overfit flags (triggers that have been tightened 4+ times in 30 days)
- Rubric trigger count over time (should stay around 5–7, not creep toward 8)

### J.3 Escalation Log Panel

- Scrollable feed of every escalation (fired and suppressed)
- For each: timestamp, window, trigger_id, Sonnet reasoning, suppression status, Opus action taken (if not suppressed), `outcome_was_actionable`
- Filters: by date range, by trigger type, by actionable status, by suppressed status

### J.4 Phase Progress Panel

Specific to Phase 1 paper trading:
- Day N of 60
- Each H.2 go-live criterion with current value, threshold, and pass/fail
- Days remaining until eligible to consider Phase 2 (max 0)

### J.5 Manual Controls Additions

To v1.0 §25's manual controls list, add:
- Adjust monthly budget cap (with operator confirmation; restricted to operator role)
- Force regenerate watcher rubric (dispatches a special Opus call; counts against budget)
- Suspend Sonnet scheduled watchers (skip 14:00/22:00 calls until re-enabled; useful during maintenance)
- Suspend Sonnet wake-up triggers (disable all D.4.1 wake-ups until re-enabled; useful during maintenance or known noisy periods)

### J.6 Active Triggers Panel

This panel makes the system's monitoring posture visible to the operator at all times. At any moment, the operator should be able to see what conditions the system is watching for, what has recently fired, and what is currently in a debounced or suppressed state.

The panel is organized into three sections: **Today's rubric triggers** (Opus-generated, daily), **App-level fallback triggers** (D.4, hardcoded, wake Opus directly), and **App-level wake-up triggers** (D.4.1, hardcoded, wake Sonnet).

For each trigger displayed, show:
- **Trigger ID and type** (e.g., `btc-breakout` / `price_threshold`, or `wakeup_volume_spike` / hardcoded)
- **Current condition state**: the threshold being watched (e.g., "BTC above $69,200 with volume >1.5× 20d avg") and the current observed value (e.g., "BTC at $68,950, volume at 1.1× 20d avg")
- **Status indicator**: one of:
  - 🟢 **Armed** — actively monitored, ready to fire
  - 🟡 **Debouncing** — recently fired, in cooldown window (with countdown to re-arm)
  - 🔴 **Suppressed** — would fire but suppressed (shows reason: budget exhausted, daily cap hit, monthly cap hit)
  - ⚪ **Inactive** — not applicable to current state (e.g., a stop-proximity trigger when no positions are open)
- **Last fired**: timestamp of most recent fire (if any)
- **Fire count today / this month**
- **Escalation rate to date** (for wake-up triggers): % of fires that resulted in Sonnet escalating to Opus
- **Actionable rate to date** (for wake-up and rubric triggers): % of resulting Opus calls that took action

For the rubric triggers section specifically, also show:
- **Rationale** (the human-readable reason Opus included this trigger today)
- **Tightened/loosened delta from yesterday** (if applicable)

For the fallback and wake-up sections, show:
- **A note that these are hardcoded** and require code change + operator approval to modify

#### Recently Fired feed

A separate scrollable feed at the bottom of the panel shows the last 50 trigger fires across all three categories, in reverse chronological order. For each:
- Timestamp
- Trigger ID and category
- Whether it dispatched (Sonnet called, Opus called, or suppressed)
- The downstream outcome (Sonnet escalated / didn't, Opus took action / didn't)

This is the operator's main feedback signal for whether the system is healthily noticing things.

#### Acceptance criteria

- All triggers from all three categories MUST be visible on this panel without filtering.
- The status indicator for each trigger MUST update in near real-time (within 30 seconds of a state change).
- Clicking a trigger MUST surface its full history (every fire, every dispatch decision) in a detail view.
- A wake-up trigger with a 0% escalation rate over 30+ fires MUST be visually flagged for operator review (this is the "this trigger is noise" signal from D.4.1).

---

## K. Agent Team Work Breakdown

For agents implementing this supplement, the work decomposes into roughly the following independent units. Each can be assigned to a separate implementation agent.

### K.1 Database migration agent

**Scope:** Section G.

**Deliverable:** Migration script that creates `watcher_rubrics`, `escalations`, `suppressed_escalations`, `api_spend`, `watcher_evaluations`, `wakeup_trigger_log` tables, and modifies `system_state`, `evaluations`, `pending_timers` per G.7.

**Acceptance:** Migration runs idempotently. Foreign keys enforced. Indexes present. Rollback script exists.

**Dependencies:** None. This goes first.

### K.2 API spend tracking + budget gate agent

**Scope:** Section C.

**Deliverable:** `budget_gate(call_type, estimated_tokens) -> Decision` function. Spend logging on every API call. Backoff state machine. Pricing constants.

**Acceptance:** Test harness verifies behavior at each backoff threshold and at hard cap. Spend rows written within 5 seconds of API response.

**Dependencies:** K.1.

### K.3 Model router agent

**Scope:** Section B (model selection + call type routing).

**Deliverable:** `model_router(call_type) -> (model_id, effort)` function. Per-call-type config. Wrapper around the Anthropic SDK that enforces routing.

**Acceptance:** Test verifies no Sonnet response can result in a placed/modified order. Test verifies daily Opus call runs even when budget would block.

**Dependencies:** K.1, K.2.

### K.4 Sonnet watcher agent

**Scope:** Sections E.2 (slim package), F.3 (output format), B.3/B.4 (escalation flow).

**Deliverable:** Sonnet system prompt. Slim data package builder. Watcher response parser with strict schema validation. Escalation dispatch (calls Opus via the budget gate). Handles both scheduled watchers and wake-up-triggered watchers (the prompt and parser are the same; only the data package context differs).

**Acceptance:** Watcher correctly evaluates rubric triggers programmatically. Discretionary escalation works. Malformed responses are rejected at parse time. Wake-up context is correctly included in the data package when applicable.

**Dependencies:** K.1, K.2, K.3.

### K.4.1 Wake-up trigger agent

**Scope:** Section D.4.1.

**Deliverable:** The five hardcoded wake-up trigger checks, evaluated on the existing price polling loop and the news polling loop. Debounce state persistence in `system_state`. Wake-up dispatch flow (logs to `wakeup_trigger_log`, checks budget, calls Sonnet via K.4 if allowed). Operator-controlled suspend toggle.

**Acceptance:** Each of the five triggers fires on its specified condition and not otherwise. Debounce windows are enforced and persist across restarts. Budget caps (`MAX_SONNET_WAKEUPS_PER_DAY`, `MAX_SONNET_WAKEUPS_PER_MONTH`) are enforced. Suspended state correctly halts all wake-ups. Tests cover storm scenarios (volatile asset producing 20+ events in 10 minutes — debounce must hold).

**Dependencies:** K.1, K.2, K.4.

### K.5 Opus daily call agent

**Scope:** Sections E.1 (full package), F.1 (output format), D.5–D.6 (review and corrections), B.3 (schedule).

**Deliverable:** Opus system prompt for daily call. Full data package builder. Output parser. Persistence of `watcher_directives` and `watcher_corrections` to `watcher_rubrics` and `evaluations`.

**Acceptance:** Daily output is schema-valid. Rubric is persisted before Sonnet's next watcher call. Yesterday's escalation log is correctly assembled into `watcher_review`.

**Dependencies:** K.1, K.2, K.3, K.4.

### K.6 Off-cycle Opus call agent

**Scope:** F.2 (off-cycle output format), B.4 (escalation flow), v1.0 §7 emergency rules.

**Deliverable:** Code paths for watcher escalation calls, emergency 5% calls, post-restart calls, strategy review calls. Each uses the slim data package plus trigger-specific context.

**Acceptance:** Each call type uses correct model + effort + package shape. `outcome_was_actionable` is set correctly.

**Dependencies:** K.1, K.2, K.3.

### K.7 Caching agent

**Scope:** Section E.3.

**Deliverable:** Prompt structure that maximizes cache hits. Cache write/read token tracking in `api_spend`. Dashboard cache hit rate metric.

**Acceptance:** Cache hit rate >70% on input tokens for the daily Opus call after the first day. Cache write tokens correctly logged separately from base input tokens.

**Dependencies:** K.2, K.5.

### K.8 Dashboard agent

**Scope:** Section J.

**Deliverable:** Four new panels (API Budget, Watcher Rubric, Escalation Log, Active Triggers) and the Phase Progress panel. Manual control additions per J.5.

**Acceptance:** All metrics render in real time. Phase Progress panel correctly gates the live-mode toggle. Active Triggers panel surfaces all rubric, fallback, and wake-up triggers with current state and recently-fired feed.

**Dependencies:** K.1, K.2, K.4.1, K.5.

### K.9 Phase rollout enforcement agent

**Scope:** Section H.

**Deliverable:** Pre-commit criteria check on `paper_trading_mode = false` toggle. Half-size enforcement during Phase 2. Phase progress tracking.

**Acceptance:** Toggle is rejected if H.2 criteria not met. Half-size positions during Phase 2 verified by integration test.

**Dependencies:** K.1, K.8.

### K.10 Test harness agent

**Scope:** Cross-cutting.

**Deliverable:** Integration tests covering: budget gate behavior, model routing, escalation flow (fired and suppressed), rubric persistence, cache hit accounting, phase transitions, wake-up trigger firing/debouncing/suppression, wake-up storm scenarios.

**Acceptance:** Test suite passes in CI. Tests cover failure modes from Section I. Wake-up tests verify each of the five trigger types fires correctly, debounces correctly, and respects budget caps.

**Dependencies:** All others.

### K.11 Forensic logging agent

**Scope:** Section N.

**Deliverable:** The five forensic tables (`decision_traces`, `system_state_history`, `app_decisions`, `price_snapshots`, `error_log`). The `redact()` utility used by every component before writing logs. Hooks into existing components: SDK wrapper for AI calls auto-writes `decision_traces`; `system_state_writer` utility writes both current and history; decorator/context manager for `app_decisions`; global exception handler writes `error_log`. The `forensic_query` toolkit (N.) as Postgres views/functions plus a CLI wrapper (`trading-bot-query`). The analysis-agent bundle assembler with schema-validated input/output (N.). Async write queue with critical-error alarm if backlog exceeds 1000 events or 5 minutes.

**Acceptance:** Every Opus/Sonnet call produces a `decision_traces` row within 10 seconds. Every `system_state` write produces a history row (verified by test that no path bypasses the writer utility). The `redact()` test passes — fake credentials injected into log payloads are absent in persisted rows. The `reconstruct_day` query returns a coherent timeline for any 24-hour past window. The `trace_trade` query returns a complete lifecycle for any closed trade. CLI commands documented in the runbook.

**Dependencies:** K.1 (database). Can run in parallel with K.2–K.10.

---

## L. Anti-Patterns Reference

A consolidated list of things agents and the system MUST NOT do, drawn from sections above. Each is here because it is a real mistake that has been considered and rejected.

1. **DO NOT include API cost data in prompts to Opus or Sonnet.** Creates structural incentive to manipulate call frequency.
2. **DO NOT use environment variables for budget caps.** Code constants only, code-reviewed when changed.
3. **DO NOT let Opus authorize an escalation budget above the hardcoded ceiling.** Apply `min(opus, ceiling)`.
4. **DO NOT let Sonnet's response result in a placed/modified order without an Opus call.** Sonnet is read-only with respect to trading.
5. **DO NOT mix models on a single decision.** Either Opus decides or it doesn't.
6. **DO NOT let the watcher rubric grow unbounded.** Hard cap at 8 triggers.
7. **DO NOT let Opus rewrite trigger types/schema dynamically.** New types require code changes.
8. **DO NOT let the rubric reference data Sonnet doesn't have access to.**
9. **DO NOT treat `discretionary_escalation` as free.** It costs the same as any other escalation.
10. **DO NOT bypass the budget gate for any reason except the daily Opus call.**
11. **DO NOT delete `api_spend`, `escalations`, `watcher_rubrics`, or `wakeup_trigger_log` rows.** Archive instead.
12. **DO NOT flip `paper_trading_mode = false` without the H.2 criteria being met.**
13. **DO NOT raise the budget cap, position sizes, or any hard guardrail without operator confirmation.**
14. **DO NOT send the strategy doc itself in every Opus call.** Cache it. (Section E.3)
15. **DO NOT trust Opus's hindsight judgment of `outcome_was_actionable` as ground truth.** Cross-check against realized P&L in strategy reviews.
16. **DO NOT add new wake-up triggers (D.4.1) without code review and operator approval.** The list is intentionally short.
17. **DO NOT make wake-up triggers modifiable from the dashboard at runtime.** Code constants only.
18. **DO NOT skip the wake-up debounce check.** A volatile asset can produce 20+ events in 10 minutes.
19. **DO NOT wake Opus directly from a wake-up trigger.** Wake-ups always go through Sonnet first.
20. **DO NOT defer forensic logging (Section N) to a later phase.** It only helps if running before the problem occurs.
21. **DO NOT log API keys, credentials, or secrets in any forensic table.** Always run through `redact()` first.
22. **DO NOT write directly to `system_state` from any component.** Use the `system_state_writer` utility so the history row is always created.
23. **DO NOT mutate or delete forensic rows.** Forensic data is append-only.
24. **DO NOT let an analysis agent's findings be acted upon without verifiable `evidence_refs`.** Findings without citations are guesses.
25. **DO NOT log forensic data synchronously on the trading critical path.** Async write queue only.

---

## M. Summary of Targets and Caps

For quick reference, the numerical commitments in this supplement:

| Constraint | Value |
|---|---|
| Monthly API budget | $50.00 USD |
| Max Opus calls per day | 4 |
| Max Sonnet calls per day | 7 |
| Max Sonnet wake-ups per day | 4 |
| Max Sonnet wake-ups per month | 90 |
| Max watcher escalations per day | 1 |
| Max watcher escalations per month | 20 |
| Max emergency evaluations per month | 5 |
| Max active triggers per rubric | 8 |
| Number of hardcoded fallback escalation triggers (D.4) | 5 |
| Number of hardcoded wake-up triggers (D.4.1) | 5 |
| Trigger overfit threshold | 4+ tightenings in 30 days |
| Pre-call cost variance buffer | 1.3× |
| Backoff thresholds | 1.10×, 1.25×, 1.40× of linear monthly trajectory |
| Phase 1 paper trading minimum | 60 days |
| Phase 2 half-size minimum | 60 days |
| Go-live hypothetical win rate | ≥ 50% over ≥ 10 trades |
| Go-live actionable rate | ≥ 35% over 14 days |
| Go-live regime detection accuracy | ≥ 60% in hindsight |

---

## N. Forensic Logging and Debug Reconstruction

### N.1 Frame

This section is NOT a debug toggle. There is no "verbose mode" to enable when something goes wrong. By the time you notice something is wrong, the data you need to diagnose it has already passed. Comprehensive logging is **always on**, structured, and queryable. The "debug" affordance is a set of read views and analysis tools over data the system continuously captures.

This section extends v1.0 §18 (Logging Requirements). The trading-side logs from v1.0 (`evaluations`, trade logs) remain. This section adds five forensic tables that capture the *full* state of every decision, plus a query toolkit and an analysis-agent contract for post-hoc investigation.

The motivation is operational: six weeks into running this system, you will encounter a situation you don't understand. "Why did the bot stop entering trades around the 19th?" "Why did Opus's regime call diverge from the indicators that morning?" "Where did $12 of API budget go on Tuesday?" Without forensic data, every such question becomes a guess. With it, every question is answerable.

### N.2 The `decision_traces` table

Captures everything sent to and received from any AI call (Opus or Sonnet), including the rendered prompt, raw API response, tool call traces, and parsing outcomes.

```
id                      uuid primary key
timestamp               timestamp with time zone
call_type               text (matches api_spend.call_type)
model                   text
related_eval_id         fk to evaluations.id nullable
related_watcher_id      fk to watcher_evaluations.id nullable
system_prompt_hash      text (SHA256 of the rendered system prompt)
system_prompt_text      text nullable (stored only when hash differs from prior call)
user_message            text (full data package as sent to the API)
tool_calls              jsonb (every tool invocation: query, response, latency_ms)
raw_response            text (raw API response body, before any parsing)
parsed_response         jsonb (what the app parsed out)
parse_errors            jsonb nullable (set if response was malformed)
input_tokens            integer
output_tokens           integer
cache_read_tokens       integer
cache_write_tokens      integer
latency_ms              integer
http_status             integer
retry_count             integer
```

**Storage discipline:** `system_prompt_text` is written only when the prompt's hash differs from the most recent stored prompt. This prevents re-storing the same 20K-token system prompt on every call. Lookup via hash returns the most recent stored full text.

**Index:** `(timestamp DESC)`, `(call_type, timestamp DESC)`, `(related_eval_id)`, `(system_prompt_hash)`.

### N.3 The `system_state_history` table

`system_state` (per v1.0 §20) is mutable. This parallel append-only table makes every change auditable. Every write to `system_state` triggers a row here.

```
id              uuid primary key
key             text
old_value       jsonb (null for first-time writes)
new_value       jsonb
changed_at      timestamp with time zone
changed_by      text (component that wrote it: 'opus_daily_call', 'budget_gate', 'reconciliation', 'watcher_dispatch', 'manual_dashboard', etc.)
related_eval_id fk to evaluations.id nullable
```

**Index:** `(key, changed_at DESC)`. This makes "what was the value of `current_regime` at 14:23 yesterday" answerable forever.

### N.4 The `app_decisions` table

Decisions made by application code, distinct from AI decisions. The app makes hundreds of these per day; without logging, they're invisible.

```
id              uuid primary key
timestamp       timestamp with time zone
decision_type   text ('budget_gate' | 'model_route' | 'wakeup_debounce' |
                     'escalation_dispatch' | 'order_routing' | 'reconciliation_action' |
                     'circuit_breaker' | 'phase_gate' | 'cache_invalidation' |
                     'backoff_threshold')
inputs          jsonb (everything that went into the decision)
outputs         jsonb (what was decided)
reasoning       text (human-readable explanation, generated by the deciding component)
related_entity  text nullable (e.g., 'order:abc123', 'eval:xyz789', 'wakeup:def456')
```

Examples:
- Budget gate blocks a Sonnet wake-up: `decision_type: 'budget_gate'`, inputs include MTD spend and projected cost, outputs `{"allowed": false, "reason": "monthly_cap"}`.
- Model router selects Sonnet over Opus for a specific call: `decision_type: 'model_route'`, inputs include call_type, outputs the selected model and effort.
- Debounce suppresses a wake-up trigger: `decision_type: 'wakeup_debounce'`, inputs include the trigger and last-fired timestamp, outputs `{"dispatched": false, "remaining_debounce_seconds": 1247}`.

**Index:** `(timestamp DESC)`, `(decision_type, timestamp DESC)`, `(related_entity)`.

### N.5 The `price_snapshots` table

Captures market state at every decision point. Coinbase tick history is queryable now; in 6 months it may be rate-limited or behind a paywall. Snapshot at the moment of decision.

```
id              uuid primary key
timestamp       timestamp with time zone
trigger_event   text ('eval_start' | 'order_placed' | 'wakeup_fired' |
                     'reconciliation_check' | 'manual_snapshot' | 'price_poll')
related_entity  text nullable
btc_price       numeric
eth_price       numeric
sol_price       numeric
btc_dominance   numeric
fear_greed      integer nullable
prices_full     jsonb (all tradeable assets, including any active tertiary)
```

**Capture rules:**
- One row at the start of every Opus and Sonnet call.
- One row at every order placement, modification, or cancellation.
- One row at every wake-up trigger fire (regardless of dispatch).
- One row at every boot reconciliation check.
- One row from the routine price polling loop every 5 minutes (independent of any other event).

**Index:** `(timestamp DESC)`, `(trigger_event, timestamp DESC)`.

### N.6 The `error_log` table

Every caught exception, retry attempt, and degraded-mode fallback. When you debug a problem six weeks later, this is where you start.

```
id                  uuid primary key
timestamp           timestamp with time zone
severity            text ('info' | 'warning' | 'error' | 'critical')
component           text (which module raised it)
error_class         text (exception class name)
message             text
traceback           text nullable
context             jsonb (what the component was doing — relevant local state)
related_entity      text nullable
recovered           boolean (did the system continue successfully)
recovery_action     text nullable (what was done to recover)
```

**Severity guidance:**
- `info`: routine recoverable conditions worth noting (e.g., "Coinbase API returned 503, retry succeeded on attempt 2")
- `warning`: anomalous conditions that didn't break anything (e.g., "Sonnet response missing optional field, defaulted")
- `error`: a single operation failed but the system continued (e.g., "Web search tool timed out, evaluation completed without it")
- `critical`: system halted or entered degraded mode (e.g., "Database unreachable, all evaluations skipped")

**Index:** `(timestamp DESC)`, `(severity, timestamp DESC)`, `(component, timestamp DESC)`.

### N.7 Forensic query toolkit

Having the data is necessary but not sufficient. Future-you, or any analysis agent, needs canonical query patterns rather than reverse-engineering schemas under pressure. Implement these as Postgres views or stored procedures, exposed through a CLI:

**`reconstruct_decision(eval_id)`** — Given any Opus or Sonnet evaluation ID, return: the full prompt and data package sent (from `decision_traces`), the raw response, what the app did with it (from `app_decisions`), the price state at that moment (from `price_snapshots`), any errors during processing (from `error_log`), and downstream effects within the next 30 minutes (orders placed, theses changed, rubrics updated). Returns a single JSON document.

**`trace_trade(trade_id)`** — Full lifecycle of a single trade: the evaluation that decided to enter, the rubric and watcher state at that moment, the order placement, every reconciliation that touched it, every evaluation that decided to hold/exit, the closing fill, the post-trade assessment. Returns a chronological event timeline.

**`reconstruct_day(date)`** — Everything that happened on a calendar day in chronological order: evaluations (Opus and Sonnet), watcher checks, wake-up fires, escalations, orders, errors, state changes. Single timeline. This is what the operator reads when they wake up to "something weird happened yesterday."

**`compare_evaluations(eval_id_a, eval_id_b)`** — Diff two evaluations. What was different about the data package, the model output, and the resulting actions. Useful for "why did Opus decide X yesterday and Y today on similar conditions."

**`escalation_postmortem(escalation_id)`** — Was this escalation actionable? What did Sonnet see, what did Opus see, what was the eventual P&L outcome? Useful for tuning rubrics.

**`session_replay(start_time, end_time)`** — Returns the full event log between two timestamps as a JSON document an analysis agent can read end-to-end.

**`budget_breakdown(month)`** — For a calendar month, return spend by call type, by model, by day, plus a list of every blocked or suppressed call with reason. Answers "where did the money go."

**`state_at(key, timestamp)`** — Returns the value of any `system_state` key at any past timestamp, by reading `system_state_history`. Answers "what was the regime when Opus made decision X."

CLI exposure example:

```
$ trading-bot-query reconstruct_decision eval_abc123 --output json
$ trading-bot-query reconstruct_day 2026-05-01 --format timeline
$ trading-bot-query trace_trade trade_xyz789
$ trading-bot-query budget_breakdown 2026-05
$ trading-bot-query state_at current_regime '2026-05-01T14:23:00Z'
```

### N.8 Analysis agent contract

For the case where an AI agent reads the data to find problems and propose fixes: define an analysis context bundle. Don't point the agent at the raw database — that wastes tokens and produces unfocused output.

The bundle is a structured JSON document the agent consumes:

```json
{
  "analysis_request": {
    "question": "Why did the system underperform BTC by 4% in week 3 (May 15–21)?",
    "time_range": { "start": "2026-05-15", "end": "2026-05-21" },
    "context_to_provide": [
      "evaluations_in_range",
      "trades_closed_in_range_with_outcomes",
      "daily_benchmark_deltas",
      "regime_classifications_and_changes",
      "rubric_versions_active_during_period",
      "errors_severity_warning_or_above",
      "escalations_with_outcomes",
      "state_changes_for_keys",
      "wake_up_trigger_summary"
    ],
    "state_keys_of_interest": ["current_regime", "target_exposure_pct", "peak_value_usd", "consecutive_underperf_days"]
  }
}
```

The bundle assembler reads each `context_to_provide` key, queries the appropriate forensic table(s), and assembles a single JSON document scoped to the time range. The analysis agent reads this bundle and produces:

```json
{
  "findings": [
    {
      "claim": "string description of what was found",
      "evidence_refs": ["eval:abc", "trade:xyz", "error:def"],
      "severity": "informational | concern | critical"
    }
  ],
  "recommendations": [
    {
      "recommendation": "string",
      "rationale": "string",
      "supporting_evidence_refs": ["..."]
    }
  ]
}
```

**Citation requirement.** Every claim the agent makes MUST cite specific row IDs (eval_id, trade_id, error_id, etc.) from the forensic tables. The operator can then verify each claim by running `reconstruct_decision(eval_id)` on the cited rows. Findings without citations are rejected — they're guesses.

**Bundle scoping.** Don't pass the full database to the analysis agent. Pass only what's relevant to the question. This is also where the cost discipline from Section C matters: an unscoped analysis agent reading a month of forensic data can burn $5+ in API costs on a single investigation.

### N.9 What NOT to log

Comprehensive logging is good. Indiscriminate logging is bad. Specifically:

- **Never store API keys, credentials, or secrets in any forensic table.** Every component that writes a log MUST run inputs through a `redact()` utility that strips known-sensitive patterns (Anthropic API keys, Coinbase API keys/secrets, anything matching credential regex patterns).
- **Never store full HTTP response bodies from Coinbase non-trading endpoints** (e.g., ticker streams). Store the parsed price + timestamp in `price_snapshots`. The raw responses are noise.
- **Never re-store cached prompt content per call.** Use the hash-and-reference pattern in `decision_traces.system_prompt_text` (Section N.2).
- **Never store full raw web search article text in `tool_calls`.** Store the queries, the URLs returned, and any structured extraction. Article text can balloon storage by 10x with little forensic value.
- **Never log financial information about the human operator** (bank accounts, tax IDs, etc.). The system shouldn't have access to any of these in the first place; defense in depth is a redact rule that flags it if seen.

### N.10 Storage growth expectations

Rough estimate at full operation:

| Table | Rows/month | Avg row size | Monthly growth |
|---|---|---|---|
| `decision_traces` | ~150 | 10–50 KB | 2–7 MB |
| `system_state_history` | ~500 | ~1 KB | ~500 KB |
| `app_decisions` | ~3,000 | ~2 KB | ~6 MB |
| `price_snapshots` | ~10,000 (driven by 5-min poll) | ~1 KB | ~10 MB |
| `error_log` | 100–500 | ~5 KB | 0.5–2.5 MB |
| **Total** | | | **~19–26 MB/month** |

After 12 months of operation: ~250–300 MB. DigitalOcean's smallest managed Postgres tier handles this trivially. Do NOT archive any forensic data for at least 12 months. After 12 months, archive (don't delete) to a cold storage bucket if storage is a concern.

### N.11 Implementation patterns

**Hooks, not manual calls.** Components should not have to remember to write forensic logs. Implement:

- A wrapper around the Anthropic SDK that automatically writes to `decision_traces` for every call.
- A `system_state_writer` utility that all components use (instead of writing directly to `system_state`); it writes both the current value and the history row.
- A decorator or context manager for `app_decisions` that captures inputs, outputs, and reasoning.
- A global exception handler that writes to `error_log` for every uncaught exception.

If forensic logging requires component authors to remember anything, it will get skipped.

**Async writes.** Forensic log writes MUST NOT block the critical path of trading decisions. Write asynchronously (queue + background worker) with a maximum 30-second delay between event and persistence. If the queue backs up beyond 1000 events or 5 minutes of lag, raise a `critical` error.

**Atomic with the action they describe.** A row in `app_decisions` saying "budget gate blocked the call" must be written before the call is actually blocked, in the same transaction. Otherwise a crash between log and action produces a phantom decision.

### N.12 Acceptance criteria

- Every Opus and Sonnet API call produces a row in `decision_traces` within 10 seconds.
- Every write to `system_state` produces a corresponding row in `system_state_history`. A test verifies no path can write to `system_state` without producing a history row.
- Every budget gate, model route, debounce check, and circuit breaker decision produces a row in `app_decisions`.
- A `redact()` test injects fake credentials matching common patterns (Anthropic keys, Coinbase keys, generic API token patterns) into log payloads and verifies they are absent in the persisted rows.
- The `reconstruct_day` query returns a chronologically-sorted timeline with no gaps for any 24-hour period after the system has been running.
- The `trace_trade` query returns a complete lifecycle for any closed trade, including all evaluations that touched it.
- The CLI tool `trading-bot-query` is documented in the runbook with examples for every named query in N.7.
- The analysis agent contract includes a schema-validated bundle assembler that the operator can invoke from the dashboard or CLI.

### N.13 Anti-patterns

1. **DO NOT** treat forensic logging as a "phase 2" feature to add later. It only helps you if it has been running before the problem occurred. Implement before Phase 1 paper trading begins.
2. **DO NOT** rely on application-level memory (in-memory caches, Python dicts) as the source of truth for any decision. If it's not in the database, it didn't happen.
3. **DO NOT** mutate or delete forensic rows. Forensic data is append-only. Schema migrations that alter old rows must preserve a copy.
4. **DO NOT** let an analysis agent's findings short-circuit human review. The agent surfaces patterns; the operator decides what to fix. Findings without verifiable evidence_refs are rejected.
5. **DO NOT** log sensitive data in plaintext anywhere. Even if no one reads it, a database dump is a data breach.
6. **DO NOT** skip the async write pattern. Synchronous logging on the critical path will degrade trading performance during high-volume periods.
7. **DO NOT** compress or alter `system_prompt_text` storage in ways that break hash lookup. The hash-and-reference pattern is fragile if implemented wrong.

### N.14 Connection to existing v1.0 logging

v1.0 §18 specifies `evaluation logs` and `trade logs`. Those still apply. The forensic tables in this section are *additive* — they don't replace v1.0 logging, they augment it.

In particular: v1.0's trade log (in the `positions` and `trades` tables per §20) contains the structured outcome data — entry/exit prices, P&L, conviction, reasoning. The forensic tables contain the *full operational context* — the prompts that were sent, the prices at that moment, the errors that occurred, the state values that informed the decision.

When investigating a trade, start with `trace_trade(trade_id)`, which joins both layers and returns a complete picture.

---

## O. End Notes

The trading strategy in v1.0 is the substance. This supplement is the scaffolding. If the substance is wrong, no amount of scaffolding makes it right. If the substance is right, this scaffolding gives it a chance to be tested honestly within a bounded budget.

Two things to remember as you implement:

**The "learning" in this system lives in the database, not in any model's weights.** Each morning's Opus call is a fresh instance reading yesterday's history. If `watcher_rubrics`, `escalations`, `api_spend`, or any of the forensic tables in Section N get corrupted, wiped, or migrated badly, the system loses everything it has learned and you lose the ability to investigate when something goes wrong. Treat all of these as critical state. Back them up.

**The architecture won't save a strategy that doesn't work.** If 60 days of paper trading doesn't meet the H.2 go-live criteria, the answer is not more API spend or a more elaborate watcher rubric. The answer is v1.0 §16's accountability clause: pause active trading, default to BTC core hold. Respect that exit. It is the most important rule in either document.
