# Huny Money — Build Plan v1.0

**Companion to:** `STRATEGY.md` (the spec).
**Purpose:** Sequence the implementation into discrete, validatable phases with clear dependencies, salvage decisions, and operator gates.

This document says *how and in what order* to build what `STRATEGY.md` specifies. If a conflict arises, `STRATEGY.md` wins on what; this doc wins on sequencing.

---

## Approach

10 sequenced phases. The critical path is sequential through Phase 9; the frontend (Phase 6+) starts in parallel after the data layer (Phase 1) lands. Each phase has a **validation gate** — do not advance until the gate passes.

Estimated wall-clock for the critical path with one developer + AI assistance: **~5–7 weeks to start of paper trading**. The 30-day paper window (Phase 10) and the 30-day half-size live window add another ~9 weeks before full-size live, per `STRATEGY.md §6.3`.

---

## Salvage decision

The existing repo has working code for several proven concerns. Salvage these — copy as reference into the new structure, then adapt as needed:

- **Coinbase JWT client** (`src/lib/coinbase/client.ts`) — EC → PKCS#8 conversion is non-trivial and works
- **Auth/session middleware** — jose-based JWT session cookie, route protection
- **WebSocket ticker hook** (`src/lib/hooks/use-coinbase-ticker.ts`) — public Coinbase Exchange WS with reconnect
- **App startup pattern** (`instrumentation.ts`) — Next.js 16 instrumentation hook
- **DigitalOcean app spec** — build/run commands, health check pattern
- **Drizzle setup** — config, lazy-init proxy pattern, runtime schema push

**Do NOT salvage:**
- Trading engine (`src/lib/engine/`) — different architecture
- Existing dashboard pages — entirely new design
- Database schema — entirely new tables
- AI prompts and data package builders — new prompts for the new model split

**Recommended approach:** branch the existing code to `archive/v1`, then wipe `main` and rebuild from scratch. Keeps v1 accessible for reference without polluting the new repo.

---

## Phase 0 — Pre-implementation decisions (S, ~1 day)

- [ ] Confirm salvage list above
- [ ] Confirm tech stack: Next.js 16, Tailwind v4, shadcn/ui, Drizzle, Postgres on DO, Anthropic SDK, Coinbase REST direct
- [ ] Branch existing main to `archive/v1` and push
- [ ] Wipe `main`, initialize fresh project skeleton
- [ ] Carry over `.env.local` (all credentials retained)
- [ ] Operator approves the wipe before deletion

**Gate:** fresh repo skeleton committed to `main`; `archive/v1` branch exists on remote.

---

## Phase 1 — Foundation (M, ~4 days)

The data layer and the core write utilities everything else depends on. Comprehensive logging is built in from day one — not added later.

**Deliverables:**
- Project skeleton: Next.js 16 App Router, Tailwind v4, TypeScript strict
- Drizzle config + lazy DB init (proxy-based, deferred until first use)
- All 12 tables in `src/lib/db/schema.ts` with foreign keys
- `paper_mode` column on `positions` and `orders` is `NOT NULL` (per `STRATEGY.md §13.3`)
- State table includes mode-split keys (`peak_value_paper_usd`, `peak_value_live_usd`, etc., per `STRATEGY.md §7.1`)
- `npx drizzle-kit push --force` runs successfully against DO Postgres
- Query helpers in `src/lib/db/queries/` (one file per table). Two helpers for positions/orders:
  - `positionsForCurrentMode()` and `ordersForCurrentMode()` — defaults, mode-filtered
  - `positionsAllModes()` and `ordersAllModes()` — explicit, rare, used only by analytics/diagnostics
- CI lint rule: any direct query of `positions` or `orders` outside the helpers fails the build
- **`state_writer(key, value, changed_by, related_eval_id?)`** — atomic write to `state` + `system_state_history` row in same transaction
- **`app_decision_logger(type, inputs, outputs, reasoning, related_entity?)`** — every app-level decision goes through this
- **`price_snapshot_writer(trigger_event, related_entity?)`** — fetches current prices and writes to `price_snapshots`
- **`error_logger(severity, component, error, context, recovered, recovery_action?)`** — global exception handler hook
- **`redact(payload)`** utility — strips Anthropic key prefixes, Coinbase key patterns, generic credential patterns from anything written to logs
- Lazy-initialized config (env var validation deferred to first use, crashes loudly on missing)
- Structured logger (JSON to stdout)

**Tests:**
- `state_writer` always creates a history row (no path bypasses) — verified by integration test
- `redact()` removes injected fake credentials of common patterns
- All 12 tables can be written and queried
- Foreign keys enforced at DB level
- CI lint rule rejects a deliberately-introduced direct query of `positions` outside the helpers (test PR validates the rule fires)

**Gate:** schema deploys; all utilities have passing unit tests; redact suite passes; lint rule rejects bypass attempts; can write a state value and see history row appear automatically.

---

## Phase 2 — External integrations (M, ~4 days)

Wrap Anthropic and Coinbase. Implement the budget gate.

**Deliverables:**
- Coinbase client (salvaged from existing): auth, accounts, market data, candles, place/get/cancel orders, order book
- TRADE-only permission check at boot: refuses to start if API key has withdrawal permission
- Anthropic SDK wrapper:
  - `callOpus(callType, messages, options)` and `callSonnet(callType, messages, options)`
  - Prompt caching support (1h TTL writes)
  - Per-call cost computation from baked-in pricing constants
  - Auto-write to `evaluations` (with full `prompt_text` + `response_text`) and `api_spend` within 5 seconds of response
- **`budget_gate(callType, estimatedTokens) → ALLOW | BLOCK_DAILY | BLOCK_MONTHLY`** — every API call goes through this
- Gate decisions logged to `app_decisions` automatically
- Web search tool integration (used inside Opus calls only)
- RSS news poller: CoinDesk, The Block, Reuters Crypto, Bloomberg Crypto. Polling loop, keyword matching, dedup across runs.

**Tests:**
- `budget_gate()` blocks correctly at each threshold
- `budget_gate()` always allows daily Opus morning brief even past monthly cap (alerts but allows)
- Anthropic call writes to both `evaluations` and `api_spend` rows with correct cost
- Coinbase JWT auth produces valid token (smoke test against `/accounts`)
- Web search tool returns results
- RSS poller dedupes correctly across restarts

**Gate:** can call Opus with a test prompt, see the response and `api_spend` cost row, verify gate blocks correctly under cap simulation.

---

## Phase 3 — AI orchestration (L, ~10 days)

The core logic. Highest design risk in the project. Spend time on prompts.

**Deliverables:**
- **Opus system prompt** for morning brief (per `STRATEGY.md §5.9`)
- **Sonnet system prompt** for watcher (per §5.9)
- **Full data package builder** for Opus (§5.3)
- **Slim data package builder** for Sonnet (§5.4)
- App-side indicator computation: RSI(14), MACD(12,26,9), BBands(20,2), 50d/200d MA, ATR(14), 20d avg volume, BTC.D
- Compressed candle CSV serializer (compact strings, not arrays of OHLCV objects)
- Response parsers with strict zod schema validation
- Malformed response → log error, no silent fallback
- **Morning brief flow:** assemble package → call Opus → parse → persist watch list to `triggers` → return decisions to executor
- **Sonnet watcher flow:** assemble slim package → call Sonnet → parse → if `escalate: true`, call Opus with escalation context (slim package + trigger context)
- Today's morning brief cached in memory and DB; passed fresh as ~500 token summary to each Sonnet check (NOT relying on prompt cache TTL)
- Watch list expires at next morning's brief

**Tests:**
- Canned morning brief input produces structured response with valid schema
- Canned Sonnet escalation flows through to a (mocked) Opus call
- Malformed Opus response causes an error, not silent fallback
- **No Sonnet response can result in an order action without an intermediate Opus call** (this test is non-negotiable)

**Gate:** can run a manual morning brief end-to-end, see watch list in DB, run a manual Sonnet check, see escalation decision logged. Operator reads the morning brief output and approves coherence.

---

## Phase 4 — Trading execution + paper mode isolation (L, ~10 days)

Place orders. Manage position state. **Paper mode is a first-class deliverable, not a flag** — it is architected for safety per `STRATEGY.md §13`.

This phase is sized larger than the original ~7 days because the executor split, query helper enforcement, and cross-mode safety tests are non-trivial. Don't shortcut them.

### 4A. Executor architecture (the safety core)

**Deliverables:**
- `src/lib/execution/interface.ts` — `OrderExecutor` interface (placeLimitBuy, placeStopLimit, placeTakeProfit, placeMarketExit, cancelOrder, getOrderStatus)
- `src/lib/execution/live-executor.ts` — calls Coinbase order endpoints; **only file in the entire codebase that imports the Coinbase client's `placeOrder`/`cancelOrder` methods**
- `src/lib/execution/paper-executor.ts` — simulates orders against real prices; imports zero code from `live-executor.ts`
- `src/lib/execution/factory.ts` — called once at boot; reads `state.paper_mode`, returns the appropriate executor; **never re-reads the mode flag at runtime**
- `src/lib/execution/market-data.ts` — shared price/candle reader used by both executors
- File-level static analysis: `live-executor.ts` is the ONLY file allowed to import the Coinbase client's order placement methods (CI rule)

### 4B. Live executor

**Deliverables:**
- Order placement: limit, stop-limit, take-profit, market exit, DCA limit
- Stop adjustment: cancel old stop on Coinbase, place new at adjusted level — atomic w.r.t. position safety. If cancel succeeds but place fails, reconciliation places one immediately on next boot.
- Take-profit staged exit: 50% off at first target; trail remainder per `STRATEGY.md §3.7`
- In-method assertion guarding actual Coinbase calls (defense in depth on top of file isolation)

### 4C. Paper executor

**Deliverables:**
- Receives the same `placeOrder()` calls the live executor would
- Same validation as live (R:R ≥ 2, stop in range, size in range, etc.) — validation logic lives in shared module imported by both
- Generates synthetic order IDs (`paper-{uuid}`)
- Writes to `orders` with `paper_mode = true`
- Simulates fills against **real Coinbase prices** from `market-data.ts` (not a mock feed)
- Simulates stop-limit and take-profit triggers from real price stream
- Computes fees using actual Coinbase fee schedule
- Closes positions when stops/take-profits trigger; computes paper P&L net of simulated fees
- Never makes a network call to Coinbase order/cancel/modification endpoints

### 4D. Mode transition safety

**Deliverables:**
- Toggle endpoint enforces all preconditions from `STRATEGY.md §13.5`:
  - No open positions in either mode
  - No pending orders in either mode
  - All reconciliation completed
  - For paper → live: Phase 1 advance criteria pass
  - Typed-phrase confirmation ("transition to live trading") required, not button click
- Toggle writes new value to `state.paper_mode` AND sets `state.mode_change_pending = true`
- Order placement (paper or live) is BLOCKED from the moment toggle is confirmed until next successful boot
- Boot clears `mode_change_pending = false` after factory has loaded mode

### 4E. Position management + reconciliation

**Deliverables:**
- Position state machine: `planned → entry_pending → open → managed → closing → closed`
- Boot reconciliation (per `STRATEGY.md §6.1`), mode-aware per `STRATEGY.md §13.7`:
  - Paper boot: queries paper rows only, verifies internal consistency
  - Live boot: queries live rows only, reconciles against Coinbase
  - **Cross-mode boot rejection:** boot REFUSES to start if it finds open positions in the OTHER mode, with actionable error message
  - Order status sync from Coinbase (live mode only)
  - Balance reconciliation, >1% discrepancy alerts (live mode only)
  - **Position safety check** — places stop if missing (highest priority; works in both modes against the appropriate order set)
  - Missed evaluation detection
  - 5%+ price move during downtime detection
- Force reconciliation API for manual trigger
- Trade close → compute gross P&L, fees, net P&L, cost basis; write to `positions`

### 4F. Non-negotiable paper mode safety tests

All tests from `STRATEGY.md §13.8` MUST pass before this phase can complete:

- [ ] **No live order in paper mode.** Mock HTTP layer asserts zero Coinbase order endpoint requests during paper-mode end-to-end run.
- [ ] **Mode invariance.** Mutating `state.paper_mode` mid-session does not change the executor's behavior; the executor object is the mode.
- [ ] **Mode transition gate.** All five preconditions enforced (open positions, pending orders, reconciliation, Phase 1 criteria for paper→live, typed-phrase confirmation).
- [ ] **Cross-mode boot rejection.** Plant open paper position, boot in live mode, app refuses to start with actionable error.
- [ ] **Query helper enforcement.** Lint rule from Phase 1 verified to fire on bypass attempts.
- [ ] **Reconciliation isolation.** Both paper and live positions present, paper boot only touches paper rows.
- [ ] **P&L isolation.** Mixed paper+live closed trades, equity curve includes only current-mode trades.
- [ ] **Order endpoint guard.** Static analysis verifies `live-executor.ts` is the only importer of Coinbase order placement methods.

**Gate:** All eight §13.8 tests pass. Operator can paper-trade an entry end-to-end, see the simulated stop and TP in the `orders` table, simulate a fill via the price-poll loop, and see the position close correctly with paper P&L computed. The mode toggle is verified to require typed-phrase confirmation and reject the live transition with open paper positions.

---

## Phase 5 — Wake-up triggers, scheduling, risk (M, ~5 days)

The cron loop, the wake-up triggers, the circuit breakers.

**Deliverables:**
- 5-minute price polling loop (in-process via `setInterval`, restart-safe via DB-stored `state.next_eval_at`)
- **Wake-up trigger 1:** position move >3% in 1h with 30-min debounce per asset
- **Wake-up trigger 2:** stop fill (poll Coinbase order status), no debounce
- **Wake-up trigger 3:** news keyword match from RSS poller, 15-min debounce per keyword
- Wake-up dispatch: log to `wakeups`, check budget, call Sonnet
- Scheduler: in-process loop fires Opus morning brief at 14:00 UTC and Sonnet checks at 18:00/22:00/02:00/06:00/10:00 UTC
- All circuit breakers (each tested individually):
  - Soft (20% drawdown from peak): halve all subsequent sizes
  - Hard ($300 floor): immediate halt + alert
  - Daily loss cap (4% rolling 24h): block new entries
  - Cooldown (2 consecutive losses): 24h block before next entry
  - 60-day BTC underperformance: pause + alert + present operator decision
- Phase gating logic: paper-mode toggle rejected if Phase 1 criteria not met

**Tests:**
- Each of 3 wake-up triggers fires on synthetic condition
- Each wake-up trigger respects debounce across restarts (debounce state in `state` table)
- Hard circuit breaker triggers on $300 sim
- Cooldown blocks entry after 2 consecutive losses
- Phase 1 toggle gate rejects with criteria failing

**Gate:** trigger a synthetic wake-up, see Sonnet called, see escalation decision logged. Trigger synthetic circuit breaker, see appropriate halt.

---

## Phase 6 — Frontend foundation (M, ~5 days; can start parallel after Phase 1)

Design system, navigation, auth. The frontend should look polished from the first commit, not "minimum viable then polish later."

**Deliverables:**
- Next.js App Router structure
- Auth: salvage JWT session pattern, login page (refresh design)
- Middleware: route protection (salvage)
- AppShell: persistent sidebar nav, dark mode by default
- shadcn/ui installed and configured
- Design tokens: semantic color system (success/warning/danger/muted/accent), spacing scale, typography scale
- Common components: card, table, dialog, dropdown, sheet, command palette stub, toast, badge, status indicator, sparkline
- Animation primitives: Framer Motion installed, page transition pattern
- Keyboard shortcut framework (g+letter for nav, cmd+k for command palette)
- Empty state component pattern (informative, not blank)
- SWR setup for data fetching with revalidation

**Validation:** login works, can navigate to a stub for each of the 8 main views, design system feels consistent.

**Gate:** **operator reviews navigation and design feel, approves before content pages are built.** This is a hard checkpoint — fix design issues here before they propagate across 8 pages.

---

## Phase 7 — Frontend views (L, ~12 days; mostly parallel)

Each of the 8 main views from `STRATEGY.md §8.2`. Each is largely independent and can be assigned to parallel agent sessions.

Each view requires: API route(s) for data, the view component, real-time updates where applicable, empty states, loading skeletons.

| Sub-phase | View | Size | Notes |
|---|---|---|---|
| 7.1 | Overview | M, ~2d | Header, ticker strip, equity curve, plan summary, positions, activity, spend, quick actions |
| 7.2 | Today's Plan | M, ~2d | Morning brief beautifully rendered, regime card, trade cards, watch list with live trigger states, discipline check |
| 7.3 | AI Activity | L, ~3d | Most important page. Chronological feed, expandable entries with full prompt/response/reasoning/actions, search, special morning brief cards |
| 7.4 | Positions | M, ~2d | Open position cards with timeline, closed positions table with sort/filter, trade lifecycle view |
| 7.5 | Decisions & Triggers | M, ~2d | Watch list, wake-up history, wake-up stats, app decision stream, state change log |
| 7.6 | Performance | M, ~2d | Equity curve with BTC overlay (Recharts), drawdown, P&L breakdown, R-multiple distribution, fee drag |
| 7.7 | System | M, ~2d | Boot history, error log, API budget detail, cache hit rates, last successful action, phase progress |
| 7.8 | Controls | S, ~1d | Pause/resume, close all, force brief, force reconcile, paper/live toggle (gated), convert to BTC core hold, params view + edit |

**Validation per view:** renders with real data; empty states present and informative; real-time updates work where applicable.

**Gate:** operator reviews each view end-to-end and confirms clarity. Per §8.13 acceptance criteria.

---

## Phase 8 — Real-time + polish (S, ~3 days; mostly throughout Phase 7)

- WebSocket ticker integration (salvage from existing)
- SSE endpoint for live state changes (or 5s polling fallback)
- Page-level animations
- Keyboard shortcuts wired (g+o → Overview, g+a → AI Activity, etc.)
- Command palette (cmd+k) functional with quick navigation and search
- All charts polished (axes, tooltips, legends, dark mode)
- Loading skeletons everywhere
- Toast notifications for state changes (paused, resumed, trade entered, etc.)

**Gate:** operator does a 5-minute click-through and approves polish.

---

## Phase 9 — Integration testing + deployment (M, ~4 days)

End-to-end scenarios. Deploy to DO. Smoke tests in production.

**Deliverables:**
- E2E test scenarios:
  - Morning brief → no action
  - Morning brief → entry → stop hit
  - Morning brief → entry → take profit
  - Morning brief → entry → thesis invalidation exit
  - Regime downgrade → forced exit
  - Force-reconcile picks up missing stop
  - Wake-up trigger fires → Sonnet escalates → Opus enters trade
  - Budget cap exceeded → Sonnet checks suppressed, daily Opus still runs
- **Cross-mode safety E2E scenarios** (per `STRATEGY.md §13`):
  - Paper-mode session runs full AI flow → mock HTTP layer asserts zero Coinbase order calls
  - Mode toggle attempted with open paper positions → rejected with operator-visible reason
  - Mode toggle confirmed → "RESTART REQUIRED" banner appears, order placement blocked, restart loads new mode cleanly
  - Cross-mode boot rejection: live mode boot with planted paper position halts with the actionable error
  - P&L equity curve filters by current mode, never mixes
- Deploy to DO App Platform (existing app ID `e3f67164-bc0f-481e-a17d-cb1a33c3c440`)
- Update DO app spec for new build/run commands if needed
- Verify schema migrations push correctly at runtime
- Verify in-process scheduler runs after deployment
- Smoke tests in production: login, all 8 pages load with real data, ticker updates live, force a morning brief, see it appear in AI Activity within seconds
- Operator final review

**Gate:** operator confirms production deployment is healthy and ready for paper trading.

---

## Phase 10 — Phase 1 paper trading (30 days)

The 30-day paper window from `STRATEGY.md §6.3`.

- All decisions made, all trades simulated against real prices
- Real API costs accrue (this is real money the operator subsidizes)
- Operator monitors via dashboard daily
- Phase 1 advance criteria tracked on Performance + System pages
- Operator reads ≥ 5 morning briefs and judges them coherent

At end of 30 days:
- All Phase 1 criteria pass → advance to Phase 2 (half-size live)
- Any criterion fails → extend paper for another 30 days OR shut down per `STRATEGY.md §6.3`

**No advancing without all criteria passing.** Don't goalpost-move.

---

## Parallelization opportunities

| What can run in parallel |
|---|
| Phase 6 (Frontend foundation) starts after Phase 1 lands — overlaps with Phases 2–5 |
| Phase 7 sub-views can be parallelized across multiple agent sessions (each is independent given the API routes from Phase 7's data layer slice) |
| Phase 8 polish is incremental throughout Phase 7 |
| Within Phase 2: Coinbase wrapper and Anthropic wrapper can be parallel |
| Within Phase 3: Opus prompt drafting and Sonnet prompt drafting can be parallel |
| Test writing in any phase can be parallel with the implementation it tests |

## Critical path

`Phase 0 → 1 → 2 → 3 → 4 → 5 → 9 → 10`

Phases 6, 7, 8 are off the critical path if started in parallel after Phase 1 — they need to land before Phase 9 deployment.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Paper-mode bug places real order** | Low (with isolation) | **Catastrophic** | Phase 4 executor split (file-level isolation); 8 non-negotiable tests in `STRATEGY.md §13.8`; cross-mode E2E scenarios in Phase 9; CI lint rules from Phase 1 |
| **Cross-mode P&L pollution** | Low (with isolation) | High | Mode-split state keys (Phase 1); query helper enforcement (Phase 1 lint rule); P&L isolation test (Phase 4F) |
| Opus prompt produces incoherent regime calls | Medium | High | Phase 3 includes prompt iteration; Phase 1 paper period surfaces issues before live |
| Stop reconciliation has bug → unprotected position | Low | Catastrophic | Test scenarios in Phase 4; integration test in Phase 9; reconciliation logs reviewed at every boot |
| Budget gate has bug → cap exceeded | Low | Medium | Test suite in Phase 2; alert when MTD trajectory hot |
| Frontend slips and delays paper trading start | Medium | Medium | Start frontend in parallel; minimum viable views first per page, polish in Phase 8 |
| Real-time updates don't work reliably | Medium | Low | Fall back to 5s polling if SSE issues |
| Coinbase paper sim diverges from live behavior | High | Medium | Phase 1→2 transition is the verification; expect surprises in first 30d half-size; paper executor uses real prices, not a mock feed |
| Existing repo has hidden dependencies we lose by wiping | Medium | Medium | Branch first, wipe second; reference `archive/v1` as needed |
| AI prompt drift across model versions | Low (we pinned 4.7/4.6) | Medium | Pin model versions in code constants; strategy_version increments on model migration |

---

## Effort sizing summary

| Phase | Size | Wall-clock | On critical path? |
|---|---|---|---|
| 0: Decisions | S | ~1 day | yes |
| 1: Foundation | M | ~4 days | yes |
| 2: Integrations | M | ~4 days | yes |
| 3: AI orchestration | L | ~10 days | yes |
| 4: Trading execution + paper isolation | L | ~10 days | yes |
| 5: Triggers + scheduling + risk | M | ~5 days | yes |
| 6: Frontend foundation | M | ~5 days | parallel after P1 |
| 7: Frontend views | L | ~12 days | parallel; must land before P9 |
| 8: Real-time + polish | S | ~3 days | throughout P7 |
| 9: Integration + deploy | M | ~4 days | yes |
| 10: Paper trading | — | 30 days observation | — |

**Critical path total: ~6–8 weeks** to start of paper trading (Phase 4 grew from 7 to 10 days for paper-mode safety architecture).
**Plus 30 days Phase 1 paper window.**
**Plus 30 days Phase 2 half-size window.**
**First full-size live trade: ~12–14 weeks from start.**

Sizes are rough; actual will depend on prompt iteration time in Phase 3 (the highest-variance phase) and how much frontend polish iteration happens in Phase 8.

---

## Operator gates (where I'll stop and confirm)

These are checkpoints where I'll pause and ask before proceeding:

1. **End of Phase 0:** approve the wipe and skeleton commit
2. **End of Phase 6:** approve frontend design and feel before content pages built
3. **End of Phase 7:** approve each view end-to-end
4. **End of Phase 9:** approve production deployment for paper trading
5. **End of Phase 10:** decide Phase 1 → Phase 2 transition

Any phase can also be paused at the operator's request between phase gates.

---

## What this plan does NOT cover

- **Day-to-day operation runbook.** Once running, how to interpret a regime change alert, how to respond to a circuit breaker trigger, how to investigate a `would_have_been_actionable` suppression. Write after Phase 9, before Phase 10 starts.
- **Strategy iteration playbook.** What to do when paper Phase 1 underperforms — which params to consider tweaking, which prompts to revise. Emerges from Phase 10 observation.
- **Disaster recovery procedures.** DB restore, force-close all positions out-of-band via Coinbase, etc. Document in a separate `RUNBOOK.md` after deployment.

These are operational documents, written from operating experience, not pre-build deliverables.
