# Huny Money — Trading Strategy v3.0 (Regime-Aware BTC Core + Alt Cycle Overlay)

**Status:** Active spec. Replaces v2 (swing-trading) which is preserved on the `archive/v1` branch as historical reference.
**Goal:** Make money on a $500 USDC account at Coinbase, with the explicit aim of **beating BTC buy-and-hold over rolling 60-day windows**.
**Audience:** Operator (David) and the implementation agents.

This document is the single source of truth. There is no companion document.

The core insight: in a swing-trading bot the AI's job is to pick trades; in v3 the AI's job is to **call the regime correctly** (everything else flows from that) and **identify alt cycle entries when conditions are favorable**. The largest source of alpha vs. BTC is not riding bear markets down, not picking better swings.

---

## 1. Goal

**Beat BTC buy-and-hold over rolling 60-day windows on a $500 USDC account, net of trading fees.**

That is the entire goal. Everything in this spec serves it. The benchmark is BTC because BTC is the highest-probability passive crypto strategy; if the bot can't beat the benchmark, it has no reason to exist.

The operator subsidizes the $50/month API cost. If the bot beats BTC, capital is added. If it persistently fails to beat BTC, it converts to BTC core hold and stops active trading.

---

## 2. Core Principles (in priority order)

1. **Don't blow up.** Survive first. The $300 hard floor is sacred.
2. **BTC is the default.** When in doubt, you should be in BTC. The bot requires positive evidence to be anywhere else, not the other way around.
3. **Beat BTC or fold into BTC.** The bot's existence is justified only by outperformance. 60-day rolling underperformance → convert to BTC core hold permanently.
4. **Bear market exits are the primary alpha source.** The single biggest opportunity to beat BTC is not riding bears down. Get this right; everything else is secondary.
5. **Alt cycle trades are satellites, not core.** They add upside; they don't carry the portfolio. A failed alt cycle should hurt but never blow up the bot.
6. **One model per decision.** Opus decides. Sonnet watches and routes. Same as v2.
7. **Total operator visibility, beautifully presented.** Same as v2.
8. **Paper mode is real money.** Same as v2 (full isolation per §13).

---

## 3. The Strategy

### 3.1 Asset universe

**Core (always available):** BTC, ETH

**Cycle alt watchlist:** 4-6 mid-cap alts curated by the operator at startup. Selection criteria:

- $200M+ market cap (liquidity)
- Listed on Coinbase Advanced Trade
- Has demonstrated cyclical price behavior over at least 2 prior cycles
- Has real fundamentals (active users, real protocol revenue, established team)
- Not a memecoin

**Initial recommended watchlist** (operator confirms or adjusts at deploy):
- **AERO** (Aerodrome — Base DEX, the operator's proven cycle asset)
- **LINK** (Chainlink — old reliable, range behavior)
- **AAVE** (DeFi blue chip)
- **UNI** (DEX leader)
- **SOL** (large cap with cycle character)
- One additional operator-pick (INJ, JUP, ENA, LDO, PENDLE, or similar)

**The watchlist is hardcoded in code, modifiable only via deploy + version bump.** No tertiary asset universe. No human-approval-required additions during operation. No AI-driven asset additions.

### 3.2 Three regimes

Daily, Opus classifies BTC into one of three regimes, with full evidence:

| Regime | Description | BTC alloc | Max alt alloc | Cash alloc |
|---|---|---|---|---|
| **Bull** | BTC making higher highs, above 50d MA, supportive macro | 70% | 0-30% | 0-30% |
| **Chop** | Sideways, no clear trend, mixed signals | 50% | 0-30% | 20-50% |
| **Bear** | BTC below 50d MA, distribution signs, hostile macro | **0%** | **0%** | **100%** |

**Bear regime is sacred.** When the AI calls bear, the bot exits everything to USDC. No alt "diversification" in bear. No "but this one trade is special" carveouts. Bear means cash. Period.

Regime can change by one level per day (bull → chop, chop → bear, bull → bull, etc.) unless a circuit breaker fires. A regime change requires written evidence in the morning brief, and the dashboard surfaces both the call and the evidence.

### 3.3 BTC core management

**Bull regime:** Default 70% BTC. Built via 3-5 DCA entries spread over 5-10 days when first entering bull from chop or bear. Held as a single core position. No active management within bull (the position just sits unless regime changes).

**Chop regime:** Default 50% BTC. Same DCA pattern when transitioning down from bull. No active management within chop.

**Bear regime:** Exit BTC entirely over 2-3 days (laddered sells). Hold 100% USDC. Wait.

**Re-entry from bear:** When regime upgrades from bear to chop or bull, DCA back in over 5-10 days. Don't go from 100% USDC to 100% BTC in one transaction — gives buffer if the regime call is wrong.

### 3.4 Alt cycle entries

The bot considers an alt for entry when ALL of the following are true:

1. **Cycle position:** Asset is in the bottom 30% of its 6-month range (the "cycle low zone")
2. **Momentum reversal:** Asset has reclaimed its 20-day MA OR RSI(14) has crossed back above 30 from below
3. **Volume confirmation:** 5-day average volume > 20-day average volume by ≥ 20% (real interest, not random tick)
4. **No invalidation:** No breakdown of the 6-month range floor; no recent fundamental negative (token unlock cliff, exploit, regulatory action, founder departure)
5. **Conviction ≥ 70**
6. **Regime is bull or chop:** **Never enter alts in bear regime, regardless of any condition above**
7. **Position sizing fits:** Adding this alt doesn't push total alt exposure past 30%

When the bot identifies an alt at cycle low with these criteria, it enters via 2 entries spread over 24 hours (ladder in to avoid bottom-tick attempts).

### 3.5 Alt cycle exits

The bot exits an alt position when ANY of:

1. **Cycle high zone reached:** Asset is in top 25% of its 6-month range. **Sell laddered:** 1/3 immediately, 1/3 over next 5-10 days, 1/3 trailed with a moving stop.
2. **Cycle invalidation:** Asset breaks below the 6-month range floor on volume → exit immediately, market order if needed. The cycle is broken; this is "the AERO playbook" failing for that asset and we accept the loss quickly.
3. **Better opportunity:** Another watchlist alt is at a stronger cycle low and we don't have allocation room → rotate (sell weakest position, buy stronger setup)
4. **Regime shift to bear:** Exit ALL alts immediately. No exceptions.
5. **Time decay:** Position has been held for 12 weeks without reaching the upper 50% of range → reassess. If thesis still holds, may extend to 6 months max. After 6 months, force exit regardless of P&L.
6. **Conviction drops below 50** on any morning brief → exit

### 3.6 Position sizing

| Type | Allocation |
|---|---|
| BTC core (bull) | 70% of capital |
| BTC core (chop) | 50% of capital |
| BTC core (bear) | 0% of capital |
| Single alt cycle position | 10-15% of capital |
| Max total alt exposure | 30% of capital |
| Min cash (bull) | 0% (room for full BTC + alts) |
| Min cash (chop) | 20% (more dry powder while BTC isn't running) |
| Min cash (bear) | 100% |

Hard maximum any single position: 70% (BTC core in bull). Alts capped at 15% individually. Min position size: $50 (below this, fees eat the trade).

**At $500 capital, the bot effectively holds 1-2 active alt positions at once.** This is fine — concentration in best setups is preferred over diluted exposure across mediocre ones.

### 3.7 Trailing stops on alt positions

Alt positions don't get tight stops at entry — cycle volatility would whipsaw them out. Instead:

- **Initial soft stop:** 12% below entry. Wider than swing stops because cycles include volatility.
- **Once position is up 25%:** trail stop to breakeven
- **Up 50%:** trail stop to +20%
- **Up 75%:** trail stop to +40%
- **Up 100%:** trail stop to +65%

These are exchange-side stop-limit orders. Same reconciliation rules as v2 — every position must have an active stop on Coinbase; boot reconciliation places one immediately if missing.

**BTC core does NOT get a trailing stop.** BTC core is exited by regime change, not by stop. A 12% drawdown on BTC during a chop regime is normal and not a reason to exit.

### 3.8 Cycle range computation

The "6-month range" for each watchlist asset is computed daily by the app:

- Take 180 days of daily closes
- `cycle_low_zone_top = min + 0.3 × (max - min)` (top of bottom 30%)
- `cycle_high_zone_bottom = min + 0.75 × (max - min)` (bottom of top 25%)
- These boundaries are stored in the `state` table per asset, refreshed nightly at 00:00 UTC

The AI sees these zones in the morning brief data package and uses them as inputs, not as gospel. The AI may decide a "cycle low zone" entry is unwise (e.g., during macro deterioration), and the AI may decide to extend a position past the cycle high zone if a structural narrative is strengthening. But the zones are the default frame.

### 3.9 What the bot does NOT do

- Day trading or hour-to-hour swing trading
- Catalyst-driven swing entries on top of cycle entries (cycle position IS the entry signal)
- Stop-loss-driven exits as a primary tactic for alts (cycle invalidation is the alt exit; trailing stops protect profits only)
- Hold through a confirmed bear regime
- Add new assets to the watchlist without a deploy (no AI-driven additions, no operator-runtime additions)
- Allocate more than 30% to alts in any regime
- Enter alts in bear regime under any circumstance, ever
- Use leverage of any kind

---

## 4. Risk Management

### 4.1 Hard limits (immutable, in code)

- Max single position (BTC): 70% of capital
- Max single alt position: 15% of capital
- Max total alt exposure: 30% of capital
- Min cash by regime: 0% (bull) / 20% (chop) / 100% (bear)
- Min position size: $50
- Required at every alt entry: cycle position confirmation, momentum confirmation, volume confirmation, no invalidation, exchange-side stop
- Daily realized loss cap: 4% of capital in rolling 24h
- $300 account floor: hard halt + alert

These cannot be modified by AI. Code changes require operator review.

### 4.2 Circuit breakers

- **Soft (20% drawdown from peak):** halve all alt position sizes; BTC core is unchanged. Soft breaker resets when account is within 10% of peak.
- **Hard ($300 account value):** halt everything immediately, alert, refuse to resume without manual intervention.

### 4.3 Behavioral controls

- **2 consecutive losing alt cycle trades:** 14-day cooldown before next alt entry. (BTC core is unaffected.) Computed from `positions` on demand.
- **Daily realized loss > 4%:** entry block until next calendar day (UTC).
- **3 consecutive winning alt cycles:** Opus's morning brief includes an explicit overconfidence check.

### 4.4 The BTC benchmark gate (the most important rule in this document)

The bot's existence is justified only by beating BTC. The check is:

- **30-day rolling underperformance > 3%:** morning brief MUST include a written assessment of why
- **30-day rolling underperformance > 5%:** AI is prompted to consider whether the strategy is structurally failing for current conditions
- **60-day rolling underperformance > 0%:** bot **pauses active trading** and presents the operator with two options:
  1. Restart with documented adjustments
  2. **Convert to BTC core hold permanently and stop active trading**

This is the kill switch for the entire strategy. It must fire reliably. The benchmark uses `state.btc_price_at_start_paper` or `_live` as the anchor, computed from current Coinbase price; the bot cannot manipulate either.

If the operator chooses option 2, the bot:
- Closes all alt positions
- Buys BTC with all available USDC
- Halts all active decisions
- Continues to track P&L vs. BTC (which is now zero by construction) and dashboard-only

---

## 5. AI Architecture

### 5.1 Two roles

Same architecture as v2:
- **Decider — Claude Opus 4.7** (`claude-opus-4-7`): regime calls, BTC entry/exit decisions, alt cycle entry/exit decisions, trailing stop adjustments, monthly review. Only model authorized to cause an order action.
- **Watcher — Claude Sonnet 4.6** (`claude-sonnet-4-6`): cheap monitoring. Cannot place, modify, or cancel orders.

A test must verify no Sonnet response can result in an order action without an intervening Opus call.

### 5.2 Schedule

Significantly less frequent than v2 — cycle trading horizon is weeks:

| Time (UTC) | Model | Purpose |
|---|---|---|
| 14:00 | Opus 4.7, max thinking | Daily morning brief: regime call, alt watchlist scan, position management, BTC benchmark assessment |
| 06:00, 22:00 | Sonnet 4.6 | Watch checkpoints (only 2 per day) |
| Event-driven | Sonnet 4.6 | Wake-up on price move, stop fill, or news keyword |
| On Sonnet escalation | Opus 4.7, medium thinking | Action decision |
| Monthly (operator-triggered) | Opus 4.7, max thinking | Strategy review |

### 5.3 Daily morning brief (Opus, ~$0.20-$0.30/call)

**Input package:**
- System prompt (cached, ~3K tokens)
- Portfolio state with mode-correct values (cash, BTC core, alt positions, P&L vs. start, P&L vs. BTC, drawdown from peak, current regime, days in regime, regime history)
- BTC: daily 365d compressed, 4h 30d compressed, 1h 7d compressed; indicators (RSI, MACD, BBands, 50d/200d MA, ATR)
- ETH: daily 365d, 4h 30d compressed; indicators
- BTC dominance (BTC.D) trend with 30d/90d moving averages
- For each watchlist alt: daily 365d compressed, **current cycle position (% of 6-month range)**, 30d volume vs 90d avg, recent news scan
- Recent news (web search inside the call: macro, crypto, sector narratives)
- Yesterday's brief + actions taken + observed outcomes
- Closed trades: last 20 with reasoning
- Active params from `params` table
- **BTC benchmark assessment** (cumulative outperformance, 30d, 60d) — prominent

**Output (JSON, schema-validated):**
```json
{
  "regime": "bull|chop|bear",
  "regime_evidence": "BTC reclaimed 200d MA on 2.1x avg volume, ETF flows +$430M for 5 consecutive days, DXY weakening, no major macro events scheduled",
  "regime_changed_from": "chop",
  "btc_core_decision": {
    "current_alloc_pct": 50,
    "target_alloc_pct": 70,
    "action": "dca_in|hold|dca_out|exit",
    "tranches_planned": 3,
    "reasoning": "..."
  },
  "alt_positions": [
    {
      "asset": "AERO",
      "current_cycle_position_pct": 18,
      "action": "hold|trail_stop|partial_sell|exit",
      "reasoning": "..."
    }
  ],
  "alt_entry_candidates": [
    {
      "asset": "LINK",
      "cycle_position_pct": 22,
      "momentum_signal": "RSI 32, reclaimed 20d MA",
      "volume_signal": "1.4x 20d avg",
      "conviction": 73,
      "size_pct": 12,
      "stop_pct": 12,
      "reasoning": "..."
    }
  ],
  "watch_list": [
    {
      "id": "aero-cycle-high",
      "asset": "AERO",
      "condition": "AERO breaks above $1.10 with volume > 1.5x avg",
      "rationale": "Approaching cycle high zone; first take-profit tranche if confirmed"
    }
  ],
  "btc_benchmark_assessment": "System +1.2% vs BTC +3.8% over last 30d. Underperformance driven by AERO position waiting for cycle high. Not corrective action yet but flagged.",
  "discipline_check": "I am NOT entering UNI today even though it's in cycle low zone because volume is declining. I am NOT taking profits on AERO yet despite +28% because cycle high zone starts at $0.95 and we're at $0.78."
}
```

The `watch_list` is hardcoded max 5 items. Same as v2.

### 5.4 Sonnet checks (~$0.012/call)

Just 2 per day. Sonnet looks for:
- Has any held alt position approached its cycle high zone? (escalate)
- Has any held alt position broken its cycle low zone (invalidation)? (escalate)
- Has BTC moved >5% since morning brief (regime stress test)? (escalate)
- Has any watch list trigger from morning fired? (escalate per rubric)
- Has any major news keyword from active rubric appeared? (escalate)

If escalating: standard Sonnet → Opus dispatch via budget gate.

### 5.5 Wake-up triggers (3 types, hardcoded)

Same architecture as v2 but tuned wider for cycle horizon:

1. **Position move:** Any held position moves >5% in either direction within a 4-hour window (wider than v2's 3% in 1h since cycle alts are intentionally volatile and we don't want noise wakes). Debounce: 60 minutes per asset.
2. **Stop fill:** A stop-limit fired on Coinbase. Wake immediately, no debounce.
3. **News keyword hit:** RSS scan finds a watch_list keyword. Debounce: 30 minutes per keyword.

Wake-up dispatch flow same as v2.

### 5.6 Escalation budget (hardcoded caps)

Lower than v2 due to cadence:

- Max scheduled Sonnet calls/day: **2** (06:00 + 22:00)
- Max event-driven Sonnet wake-ups/day: **4**
- Max event-driven Sonnet wake-ups/month: **60**
- Max Opus calls/day: **4** (1 morning + up to 3 escalations/emergencies)
- Max Opus calls/month: **90**
- Monthly API budget cap: **$50.00 USD**

Estimated monthly cost: **~$15-20** vs v2's ~$27. Substantial buffer for volatile months.

### 5.7 Budget enforcement, caching, anti-patterns

Same as v2 §5.7-§5.8. Cost data NEVER shown to Opus or Sonnet.

### 5.8 System prompt outline

**Opus prompt must emphasize:**
- "BTC is your default position. When in doubt, hold BTC. You require positive evidence to be elsewhere."
- "**Bear regime means cash. There are no exceptions.** No 'this trade is special.' No 'just one alt.' Cash."
- "The benchmark is BTC buy-and-hold. Every decision is implicitly a bet against just holding BTC. If you can't justify the bet, default to BTC."
- "You are NOT a swing trader. You are looking for cycle-scale opportunities measured in weeks to months."
- "Cycle low entry requires evidence the cycle is intact (not breaking down). Don't catch falling knives."
- "Alt cycle exits should be laddered. Don't try to catch the exact top."
- The strategy summary, position sizing, and exit criteria.
- Output schema.

**Sonnet prompt:** same routing-only mandate as v2.

---

## 6. Operations

### 6.1 Boot sequence

Same as v2 §6.1 with one addition:
- After balance reconciliation, verify cycle range computations are current for all watchlist assets (not older than 24 hours). If stale, recompute before any decision-making.

### 6.2 First launch

Same as v2 §6.2 with additions:
- Operator confirms watchlist via dashboard before bot is enabled
- App computes initial 6-month cycle ranges for all watchlist assets
- Records starting capital and BTC anchor price (`state.btc_price_at_start_paper`)
- First Opus morning brief runs immediately to establish regime
- **Do not enter any positions for the first 48 hours.** Observation period.

### 6.3 Phase rollout

**Phase 0: Setup (1-2 days).** Operator confirms watchlist. Initialize cycle ranges. No trades. Dashboard verified.

**Phase 1: Paper (60 calendar days).** Longer than v2's 30 days because regime detection is the alpha source and 30 days is not enough to validate it across changing conditions. Pre-committed advance criteria (any failure = stay in Phase 1 another 30 days OR shut down):

- **Hypothetical performance > BTC hold by ≥ 3% over 60 days** (the strict honesty test)
- **Regime detection accuracy ≥ 60%** (in retrospective evaluation: did Opus's bull/chop/bear calls prove correct in hindsight?)
- **Bear regime exits worked correctly** in at least one detected (or simulated) downturn during the 60 days. If no downturn occurred, this criterion is waived but the operator must explicitly note the lack of bear-regime test data.
- **At least 2 closed alt cycle trades** with documented entry/exit reasoning the operator finds coherent
- **Operator has read ≥ 10 morning briefs and judged them coherent**
- **Zero hard guardrail violations**
- **Zero "the bot wanted to do something insane" incidents**

These criteria are pre-committed. Do not goalpost-move.

**Phase 2: Live, half size (60 days).** Position sizes halved (BTC core 35% in bull, alt positions 5-7.5%). Hard guardrails unchanged. Pre-committed advance criteria:

- Realized performance > BTC hold over 60 days
- Realized P&L net of fees > 0
- ≥ 3 closed real alt cycle trades
- Zero hard circuit breaker triggers
- ≤ 1 soft circuit breaker trigger
- Bear regime test (if encountered): bot exited correctly

**Phase 3: Live, full size.** Per spec sizing.

**Phase 0 (Failure):**
- Hard floor hit ($300): halt forever, operator post-mortem
- 60-day BTC underperformance: pause, present operator with restart vs. convert decision per §4.4
- Phase 1 criteria not met after 90 paper days: shut down or restart with revised strategy

The toggle from `paper_mode = true` to `false` requires operator confirmation AND the app rejects the toggle if Phase 1 criteria are not currently met. Same gate logic as v2.

### 6.4 Kill switches

Same as v2:
- One-button pause
- One-button close-all
- Auto-halt on $300 floor
- Auto-pause on 60-day BTC underperformance
- Convert to BTC core hold (dashboard action with double-confirmation)

---

## 7. Data Schema

Same 12 tables as v2 (state, params, positions, orders, evaluations, triggers, wakeups, api_spend, errors, system_state_history, app_decisions, price_snapshots).

**Differences from v2:**

### 7.1 `state` additions

Per-asset cycle range keys:
```
cycle_low_zone_top_AERO          | numeric (bottom of "not in cycle low" zone)
cycle_high_zone_bottom_AERO      | numeric (bottom of cycle high zone)
cycle_range_computed_at_AERO     | timestamp
cycle_low_zone_top_LINK          | numeric
... (one set per watchlist asset)
```

Plus:
```
days_in_current_regime           | integer
last_regime_change_at            | timestamp
btc_dominance_30d_avg            | numeric (cached for the morning brief)
```

### 7.3 `positions.type` enum

v2: `core | swing`
v3: `btc_core | alt_cycle`

### 7.6 `triggers` table

Same shape as v2. Now generated for both regime stress conditions AND alt cycle conditions (cycle high approach, cycle low invalidation watch).

---

## 8. Dashboard

Same architecture as v2 §8 (multi-page, first-class, total visibility, shadcn/ui, Tailwind v4, Recharts, Framer Motion, dark mode default, keyboard shortcuts).

**Content adjustments from v2:**

### 8.3 Overview view emphasizes:

- **BTC benchmark cumulative performance vs. system** (DOMINANT metric, top of page)
- Phase badge, mode, regime, days in regime, paused/halted state
- Live ticker: BTC + ETH + each watchlist alt
- Equity curve (30d) with BTC benchmark overlay
- BTC core position card
- Active alt positions with cycle progress bars
- Last 5 events
- API spend (less prominent than v2 since cost is lower)

### 8.4 Today's Plan view emphasizes:

- **Regime call + 30-day regime history strip**
- BTC core decision (DCA in / hold / DCA out / exit) with reasoning
- **Alt watchlist with each asset's cycle position visualized as a bar** (cycle low → mid-range → cycle high), color-coded
- Active alt positions with cycle progress, days held, P&L, distance to next decision point
- The "discipline check" prominently displayed
- Today's watch list with current trigger states

### 8.6 Performance view emphasizes:

- **BTC benchmark overlay is the dominant feature**, not a sidebar
- **"Beating BTC over 30d / 60d / all-time" as headline metric** with pass/fail indicator
- Per-asset cycle trade outcomes
- Alt cycle "win rate" (cycles caught vs. cycles missed)
- Bear regime exit performance (how much drawdown was avoided in retrospective)

### 8.7 New sub-section: Cycle Position view

Dedicated view for each watchlist asset:
- 6-month price chart with cycle low zone and cycle high zone shaded
- Current cycle position % marked
- History of bot's entries/exits on this asset overlaid
- Volume profile
- Recent news for this asset

This is the core "cycle trading" instrument the operator uses to evaluate AI judgment.

Other views (AI Activity, Decisions & Triggers, System, Controls) same structure as v2.

---

## 9. Tech Stack

Same as v2 §9:
- Next.js 16, React 19, TypeScript strict, Tailwind v4
- shadcn/ui, Recharts, Framer Motion, SWR
- Drizzle ORM, Postgres on DO
- Anthropic SDK, Coinbase REST direct
- DO App Platform basic-xxs

---

## 10. Acceptance Criteria

Same backend + frontend acceptance criteria as v2 §10, plus:

**Strategy-specific:**
- [ ] Cycle range computation runs nightly and stores correct values per asset
- [ ] Bot refuses to enter alts when regime = bear (verified by integration test)
- [ ] Bot exits all alts when regime transitions to bear (verified by simulated transition)
- [ ] BTC core DCA in/out logic works (verified by simulated regime transition)
- [ ] BTC benchmark calculation is correct and tamper-proof (anchor price stored in `state` at startup, never recomputed)
- [ ] 60-day BTC underperformance gate triggers correctly when crossed

---

## 11. What NOT to Build

Inherits all NOT-BUILD items from v2 §11. Additional v3-specific items:

- **Tighter swing trading on top of cycle trades.** Don't cross strategies. If the bot has an alt cycle position and the AI thinks there's a 2-day swing in BTC, that's noise. Stay focused on the cycle trade.
- **Catalyst-driven entries on top of cycle entries.** Cycle position IS the entry signal. Don't add "but BTC ETF inflows" as a secondary entry trigger; it complicates the model and degrades the cycle discipline.
- **Auto-adding watchlist assets.** The watchlist is hardcoded. Operator-managed via deploy.
- **AI-driven cycle range recalibration.** The 6-month range is mechanical. AI doesn't override it (only interprets it).
- **Re-entry of an alt within 14 days of exit.** If the bot exits on cycle invalidation, it cannot buy back in for at least 14 days. Prevents whipsaw.
- **More than 2 active alt positions at $500 capital size.** Concentration in best setups beats diluted exposure.
- **Hourly Sonnet checks.** Daily + 2 watch checkpoints + event triggers is the cadence. Don't add more "for completeness."

---

## 12. Failure Modes

Most v2 failure modes apply. v3-specific additions:

- **Regime detector calls bear too early:** bot sells in chop, misses next leg up. Mitigation: regime change requires written evidence; pattern of bad calls visible in dashboard; operator can iterate on prompt.
- **Regime detector calls bear too late:** bot rides 50% drawdown before exiting. **This is the single largest risk.** Mitigation: regime transitions can be one-level-per-day (no jumping bull → bear), but the AI must be willing to call chop quickly. Operator monitors regime-call lag during paper phase.
- **Whipsaw across the regime boundary:** bot in/out/in/out around the 200-day MA. Mitigation: regime change requires sustained evidence (not single-day moves); 14-day re-entry cooldown for alts.
- **Alt cycle bag-holding:** bot enters at cycle low, asset never bounces, "cycle invalidation" only fires after 50% loss. Mitigation: 12% initial soft stop; cycle invalidation rule is precise (break of range floor on volume).
- **All watchlist alts in cycle low simultaneously (bear setup):** bot wants to enter many positions but allocation cap (30%) limits to 2-3. Correct behavior — don't override.
- **No watchlist alts ever reach cycle low (extended bull):** bot just holds BTC. This is correct. The bot may underperform by a few percent for not catching alt season, but BTC carries.

---

## 13. Paper Mode Architecture

**Identical to STRATEGY.md v2 §13.** All sub-sections (13.1-13.10) apply unchanged:

- §13.2 Code path isolation (separate live-executor.ts and paper-executor.ts)
- §13.3 Database isolation (paper_mode NOT NULL, query helpers, lint rule)
- §13.4 Mode invariance (loaded once at boot)
- §13.5 Mode transition gates (preconditions + typed-phrase confirmation)
- §13.6 Paper executor behavior
- §13.7 Reconciliation isolation (cross-mode boot rejection)
- §13.8 Eight non-negotiable safety tests
- §13.9 Visual safety in dashboard
- §13.10 What this prevents

This is unchanged because paper mode safety is independent of trading strategy. The same isolation requirements apply whether the bot is doing swing trades or cycle trades.

---

## 14. Closing Note

The bot's edge is **discipline over cycles**. The hardest skills in crypto are (1) going to cash before the bear and (2) buying alt cycle bottoms without panic. A bot that does these two things reliably will beat BTC.

Six things to keep in mind during implementation and operation:

**1. Beat BTC or fold.** The 60-day rolling underperformance check is the most important rule in this document. Honor it. No exceptions, no extensions, no "just one more month."

**2. BTC is the default.** Active positions require positive evidence. Passive BTC does not. The bot should prefer to do nothing.

**3. Bear regime means cash.** Period. No alt "diversification," no "this trade is special," no carveouts. Cash.

**4. Alt cycles are satellites, not core.** They add upside; they don't carry the portfolio. A single failed alt should hurt; it should never blow up the bot.

**5. The frontend is half the deliverable.** Same as v2. Match backend effort with frontend effort.

**6. Paper mode is real money.** Same as v2. Treat the isolation in §13 as critical-path safety.

That's the system.
