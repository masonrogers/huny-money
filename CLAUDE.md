# Huny Money — Autonomous Crypto Trading Bot (v3.0)

## What This Is

Autonomous crypto trading bot powered by Claude AI, deployed on DigitalOcean App Platform. v3 strategy: **regime-aware BTC core + alt cycle overlay**. Defaults to BTC, exits to cash in confirmed bears, adds satellite cycle-trading positions on a curated mid-cap watchlist (AERO, LINK, AAVE, UNI, SOL).

The strategy specification is `STRATEGY.md` (v3.0). The implementation plan is `BUILD_PLAN.md`. Both are the source of truth.

## Goal

Beat BTC buy-and-hold over rolling 60-day windows on a $500 USDC account, net of trading fees.

## Current State

- **Strategy:** `STRATEGY.md` v3.0 — adopted as the active spec
- **Code:** Phases 1–9 + 9.1 complete + planning→execution loop fully wired.
  Backend, frontend, all controls, decision-executor (the AI brief → orders bridge),
  two-tranche entry ladder, alt position management (trail/partial/exit), 60-day BTC
  underperformance auto-pause gate, BTC benchmark module.
- **Test suite:** 256 unit tests passing. 30 integration tests gated on `RUN_INTEGRATION=1`.
- **DO deployment:** see "Where things stand" below.
- **Trading mode:** paper. Will remain paper for the 60-day Phase 1 window per `STRATEGY.md §6.3`.

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack), React 19
- **Language:** TypeScript strict
- **CSS:** Tailwind CSS v4 with semantic color tokens (`@theme` directive)
- **UI:** shadcn-style primitives + Radix + Framer Motion + sonner + lucide-react
- **ORM:** Drizzle (postgres-js driver, lazy proxy init)
- **DB:** PostgreSQL on DigitalOcean managed cluster `db-postgresql-nyc3-00644`, database `huny_money`
- **AI:** Claude Opus 4.7 (decider) + Claude Sonnet 4.6 (watcher) via `@anthropic-ai/sdk`. Prompt caching (1h TTL).
- **Exchange:** Coinbase Advanced Trade API v3 with CDP JWT auth (ES256 via `jose`, EC → PKCS#8 conversion via `crypto`)
- **Auth:** JWT session cookie via `jose` (single-password, single-user)
- **Hosting:** DigitalOcean App Platform basic-xxs ($5/mo), app ID `e3f67164-bc0f-481e-a17d-cb1a33c3c440`

## Architecture (high-level)

### Trading layers

- **BTC core:** default position when regime is bull (70%) or chop (50%); 0% in bear. Built/exited via DCA over multiple days. No trailing stop — exited only by regime change.
- **Alt cycle satellites:** 0–2 positions on the watchlist (AERO/LINK/AAVE/UNI/SOL). Entry requires all 7 conditions per `§3.4` (cycle low zone + momentum reversal + volume confirmation + no invalidation + conviction ≥ 70 + bull-or-chop regime + size headroom). Exit is laddered at cycle high zone, immediate on cycle invalidation, or forced on regime shift to bear.

### AI orchestration

- **Opus** (`claude-opus-4-7`): morning brief at 14:00 UTC daily. Classifies regime, decides BTC core action, identifies alt entry candidates, generates a max-5-trigger watch list. Max thinking effort.
- **Sonnet** (`claude-sonnet-4-6`): 06:00 + 22:00 UTC scheduled checkpoints + event-driven wake-ups. Routing-only — cannot place/modify/cancel orders. Outputs are validated by zod with `.strict()` rejecting any trading-decision field.
- **Budget gate:** every API call goes through `budgetGate(callType)`. Monthly cap $50 USD, per-model daily/monthly limits. Morning brief is NEVER blocked even past the cap (alerts the operator).

### Paper mode isolation (CRITICAL)

Per `STRATEGY.md §13`, paper mode is treated as a critical-path safety system. The architecture is:

- `src/lib/execution/live-executor.ts` — the ONLY file in the codebase that imports `coinbase/orders`. Enforced by `scripts/lint-queries.sh`.
- `src/lib/execution/paper-executor.ts` — zero imports from the live file. Simulates fills against real Coinbase prices using the actual fee schedule.
- `src/lib/execution/factory.ts` — called once at boot, reads `state.paper_mode`, returns the appropriate executor. The mode is invariant for the session — **the executor object IS the mode**.
- Mode toggle requires typed-phrase confirmation + zero open positions in either mode + zero pending orders + Phase 1 criteria pass (for paper→live). Takes effect on next boot.
- Boot reconciliation refuses to start if it finds open positions in the OTHER mode (`CrossModeBootRejection`).
- **Paper accounting is fully synthetic.** Paper mode never reads the real Coinbase wallet for cash. First-launch seeds `starting_capital_paper_usd = PAPER_STARTING_CAPITAL_USD` ($500 default). The morning brief reads cash via `executor.getCashBalanceUsd()` so paper gets paper cash and live gets live cash; `getAllBalances()` is never called from a mode-agnostic path. Re-anchor in paper mode takes an operator-supplied amount; in live mode reads the real wallet. Reset-paper control wipes paper positions/orders + reseeds.

### Database schema (`src/lib/db/schema.ts`)

12 tables per `STRATEGY.md §7`:
- `state` (singleton key-value), `params` (versioned strategy params)
- `positions`, `orders` (mode-isolated via `paper_mode` NOT NULL column + query helpers + lint rule)
- `evaluations` (every AI call, full prompt + response + parsed)
- `triggers` (today's watch list), `wakeups` (event-driven Sonnet calls)
- `api_spend`, `errors`
- `system_state_history` (every state write — append-only audit), `app_decisions` (every app-level decision), `price_snapshots` (market state at decision points)

### Scheduler (`src/lib/scheduler/`)

In-process scheduler ticks every 60 seconds (no external cron). State persists in `state.last_*_fired_at`. Dispatches:
- 14:00 UTC → `runScheduledMorningBrief()` (Opus full data package)
- 06:00 + 22:00 UTC → `runScheduledSonnetCheckpoint()` (slim package, optional Opus escalation)
- 00:00 UTC → `runCycleRangeJob()` (180-day zones for each watchlist asset)
- Every 5 minutes → `runWakeupCycle()` (poll prices, write snapshot, process paper fills, evaluate 3 wake-up triggers)

### Wake-up triggers (`src/lib/triggers/`)

Per `§5.5`:
- **position_move:** any held position moves >5% in 4h, 60-min debounce per asset
- **stop_fill:** Coinbase order status check detects a fill (or paper executor simulates), no debounce
- **news_keyword:** RSS scan matches an active watch list keyword, 30-min debounce per keyword

Each fire dispatches via `dispatchWakeup` → logs to `wakeups` → budget-gates → calls Sonnet. Debounce state lives in `state` keys (`last_wakeup_<type>_<identifier>_at`) and survives restarts.

### Decision-execution loop (`src/lib/orchestration/`)

The bridge from "Opus produces a brief" to "orders land in the database":

- **`decision-executor.ts`** — consumes `MorningBrief`, runs preflight (paused / halted / hard floor / loss cap / cooldown), then dispatches each decision:
  - **Alt entries** (`alt_entry_candidates`): half-size limit-buy + initial -stop_pct stop now; second tranche queued via `entry-ladder.ts` for ~12h later
  - **BTC core** (`btc_core_decision`): `dca_in` places one tranche; `exit`/`dca_out` market-sells; `hold` no-ops
  - **Alt position management** (`alt_positions`): `hold`/`trail_stop`/`partial_sell`/`exit`; trail_stop ratchets per `ALT_TRAILING_STOP_SCHEDULE` (+25→entry, +50→+20, +75→+40, +100→+65 from entry) and never downgrades; partial_sell drains in 1/3-of-original tranches; exit market-sells remaining + closes position
  - Idempotent per evaluation id (`state.last_executed_brief_eval_id`)
  - Every routing decision logs to `app_decisions` for the dashboard's "Actions taken" panel
- **`entry-ladder.ts`** — second-tranche state lives in `state.pending_entry_ladders`. `processPendingEntryLadders()` fires from the wake-up cycle every 5 min: revalidates (position open, price within ±10% of entry), places tranche 2, cancels old stop, re-places stop on combined qty. Drops the tranche on drift / closed position / placement error.
- **`btc-benchmark.ts`** — single source of truth for "bot vs BTC hold". Reads equity from `system_state_history` + BTC prices from `price_snapshots`. Returns rolling 30/60d delta + cumulative + consecutive-underperf-days. Returns null for windows the bot is younger than rather than fabricating data.
- **`btc-underperformance-gate.ts`** (in `src/lib/risk/`) — wraps `evaluateBtcUnderperformance`. Auto-pauses trading (`state.trading_paused = true` + `trading_paused_reason`) when 60d delta < 0 AND 60+ consecutive underperf days. Decision-executor's preflight reads the flag and refuses to act, so the gate has teeth from the same brief.

### Boot sequence (`src/lib/boot/index.ts`)

1. Coinbase TRADE-only assertion (refuses to start if withdrawal enabled — non-negotiable)
2. First-launch detection — if `state.last_boot_at` is empty, seed paper-mode synthetic capital ($500 default) + BTC anchor from public ticker + default phase=paper
3. `bootConstructExecutor()` — reads `state.paper_mode`, sets the global mode singleton, returns the typed `OrderExecutor`
4. `runBootReconciliation()` — cross-mode rejection, missing-stop placement, missed-eval detection, 5%+ price-move detection during downtime
5. `clearModeChangePendingFlag()` — operator's pending mode toggle now in effect
6. `startScheduler()` — tick loop begins

## Frontend (`src/app/(dashboard)/`)

9 dashboard views matching `STRATEGY.md §8.2`:
- Overview (default landing)
- Today's Plan (live morning brief beautifully rendered + "Actions taken" panel showing each order placed for the latest brief)
- AI Activity (every Opus + Sonnet call with full prompt/response, expandable)
- Positions (open + closed, with Coinbase order IDs visible)
- Cycle Position (per-asset zone display)
- Decisions & Triggers (watch list + wakeups + app decisions + state change log)
- Performance (closed trades, win rate, fees, equity curve, "vs. BTC hold (rolling)" panel with cumulative/30d/60d delta + days-underperforming + Phase 1 criterion badge)
- System (API budget, errors, last successful actions, Phase 1 criteria)
- Controls (pause/resume + auto-pause reason banner / force-brief / reconcile / mode toggle / close-all / convert-to-BTC + paper-mode-only: edit paper balance + reset paper progress; live-mode-only: re-anchor capital from real wallet)

Plus auth (`(auth)/login`) with JWT session cookie. Live BTC/ETH/SOL ticker in the header (Coinbase Exchange WS). Cmd+K command palette for navigation + actions. Sonner toasts for state changes (paused, resumed, mode-change-pending banner). Framer Motion page transitions.

### Dashboard view toggle (cosmetic — NOT trading mode)

There are TWO independent "paper vs live" axes; do not confuse them:

1. **Trading mode** (`state.paper_mode`) — what the bot DOES. Locked to the executor at boot. Toggle requires typed-phrase confirmation + Phase 1 criteria + a restart.
2. **Dashboard view** — what the operator SEES. Pure UX preference, persisted to localStorage. Defaults to whatever the trading mode is. Toggle is on every page header. Has zero side effects on bot behavior.

The view context is `src/lib/contexts/dashboard-view.tsx` (`useDashboardView()` hook). Two values: `"paper"` | `"coinbase"`. When the operator's view differs from the bot's actual trading mode, an amber "Bot trades [mode]" chip appears next to the toggle so the distinction is impossible to miss.

**View-aware pages** (swap content based on view):
- Overview: title + metric grid + equity curve (paper) ↔ Coinbase wallet card; open-positions card (paper) ↔ wallet-holdings summary
- Positions: bot paper positions (paper) ↔ real Coinbase holdings table sorted by value with % of wallet column

**View-agnostic pages** (bot-internal, identical regardless of view): Today's Plan, AI Activity, Decisions, Performance, System, Controls.

The header always renders both value pills (`Paper $X +Y%` and `Wallet $Z`) — the active view's pill is color-tinted; the other is dimmed.

### Wallet endpoint

`/api/dashboard/wallet` is the single source for the header pills + Overview wallet card + Positions Coinbase view. Returns:
- `coinbase`: real wallet snapshot (totalUsd, cashUsd, holdings[]) — server-cached 60s to avoid hammering Coinbase. Serves last good value on transient API failures; surfaces `error` on the payload.
- `paper`: synthetic state (equityUsd from `last_equity_paper_usd`, cashUsd, startingCapitalUsd, returnPct since paper start)

**Operator preferences (active):** frontend is max-effort, total visibility (every AI call + app decision + state change inspectable from dashboard), paper mode isolation, API cost is subsidized. Portfolio value + Coinbase wallet value MUST be visible on every page (header pills); Coinbase wallet detail is one click away on Overview / Positions in coinbase view. Operator gets frustrated if the dashboard hides what should be there.

## Tests

- `npm test` — 256 unit tests (no DB needed): redact, mode singleton, config, lint-queries, indicators, cycle range, candle compress, AI schemas, AI prompts, pricing, RSS poller, position sizing, circuit breakers (pure), scheduler schedule, triggers (pure), execution validation, factory keys, isolation, btc-benchmark math, decision-executor pure helpers (preflight + sizing + trailing-stop ratchet + partial-sell quantity), entry-ladder math
- `RUN_INTEGRATION=1 npm test` — 30 integration tests against the live DB: stateWriter atomicity, budget gate behavior, paper-mode isolation, mode transition gate, circuit breakers, btc-underperformance-gate side-effect contract
- `RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke` — 3 live-only tests verifying JWT auth + TRADE-only key + BTC ticker fetch
- `bash scripts/lint-queries.sh` — CI rule: positions/orders mode-isolation + coinbase/orders import isolation

## CI

**Operator policy: secrets do not leave the local PC.** The only acceptable off-machine destination for any secret is DigitalOcean env vars (where the bot itself runs). CI is therefore a *quality gate only* — no deploy steps that need API keys, no live-API smoke tests in CI.

GitHub Actions on every push/PR to `main` (`.github/workflows/ci.yml`):
- typecheck, lint (`eslint .`), `lint:queries`, unit tests in parallel
- build with stub envs
- integration tests against an ephemeral Postgres 16 service container (`RUN_INTEGRATION=1`)
- **no deploy job** — DO auto-deploys from `main`, or the operator runs `scripts/deploy.sh` locally (which reads `~/Desktop/.nibbles-secrets`)

Anything that needs real credentials runs locally:
- Live Coinbase smoke: `RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke` (needs the funded key `88674a25`, never `7b288729`)
- DO deploy trigger: `bash scripts/deploy.sh`

Local husky hooks: pre-commit runs `lint-staged` (eslint --fix on staged ts/tsx) + `lint:queries`; pre-push runs `typecheck` + `npm test`.

GitHub repo requires **zero secrets** for CI to function.

## Credentials

`.env.local` (gitignored):
- `DATABASE_URL`, `COINBASE_API_KEY`, `COINBASE_API_SECRET`, `ANTHROPIC_API_KEY`
- `APP_SECRET` (JWT session signing key), `ADMIN_PASSWORD`, `CRON_SECRET`
- `NEXT_PUBLIC_APP_URL` (optional)

External:
- `/home/davidr/Desktop/.nibbles-secrets` — DO API tokens (`DO_API_KEY_WRITE`, `DO_API_KEY_READONLY`)
- DO Postgres firewall: only the DO App can connect (no direct psql from operator's machine)

## Coinbase API

- TRADE permission only — boot REFUSES to start if withdrawal is enabled. Non-negotiable security constraint.
- Old key `88674a25` has the $500 USDC. New key `7b288729` is empty — DO NOT use.
- Account holds USDC, not USD. The orchestration layer counts both as cash.
- WebSocket ticker is public (`wss://ws-feed.exchange.coinbase.com`); used for dashboard display only.

## DigitalOcean

- App ID: `e3f67164-bc0f-481e-a17d-cb1a33c3c440`
- App name: `huny-money`, service: `web`
- Live URL: `https://huny-money-mfiyo.ondigitalocean.app`
- Build: `npm run build`
- Run: `npx tsx scripts/migrate-v1-to-v3.ts && npx drizzle-kit push --force && npm start`. The migrate script is idempotent — drops the schema only when v1 tables are present OR the v3 schema is the wrong shape (e.g., before the value-nullable change).
- Health: `/api/healthz` (120s init delay covers migrate + push + boot reconciliation).
- Auto-deploy from `main` is enabled but sometimes flaky — force via API call.
- DO Postgres firewall blocks operator psql; schema operations only run inside the deploy sandbox.

## Development

```bash
cp .env.example .env.local   # fill in credentials
npm install
npm run dev                  # local dev server with Turbopack
npm test                     # unit tests
npm run lint:queries         # mode-isolation lint
npx tsc --noEmit             # type check
```

## Deployment

```bash
bash scripts/deploy.sh
# Or manually:
# 1. Set DO app branch to `main` via the API
# 2. Force a build: POST /v2/apps/{id}/deployments {"force_build": true}
# 3. Tail logs to verify boot succeeds
```

The deploy command runs `drizzle-kit push --force` from inside the DO sandbox (which has DB firewall access). On first deploy of v3 over v1, this creates the new schema; subsequent deploys are idempotent.

## Key Technical Decisions & Gotchas

1. **Opus 4.7+ uses adaptive thinking, NOT `thinking.type: enabled` + `budget_tokens`.** The runtime API rejects the legacy shape with "thinking.type.enabled is not supported for this model. Use thinking.type.adaptive and output_config.effort". The current shape is `thinking: { type: "adaptive" }` + `output_config: { effort: "max"|"high"|"medium"|"low" }`. See `OPUS_EFFORT_BY_CALL_TYPE` in `src/lib/anthropic/client.ts`. Don't reintroduce `budget_tokens`.
2. **All Anthropic calls use streaming.** SDK rejects `messages.create()` for any operation that *could* exceed 10 minutes — Opus + adaptive thinking trips this even on short prompts. We use `sdk().messages.stream(req).finalMessage()` for both Opus and Sonnet.
3. **Lazy initialization everywhere.** `config.ts`, `db/index.ts`, `anthropic/client.ts` all use Proxy-based lazy loading. Next.js evaluates module scope at build time when env vars aren't available — eager init crashes the build.
4. **`drizzle-kit` is a regular dependency** (not devDependency). Needed at runtime because the run command pushes schema. DO prunes devDeps after build.
3. **`DATABASE_URL` is a DO template reference** (`${db.DATABASE_URL}`). Resolves at runtime, not build time. That's why schema push runs in the run_command not the build_command.
4. **Coinbase EC key → PKCS#8 conversion.** Coinbase CDP keys are EC PEM format but `jose.importPKCS8` requires PKCS#8. Convert via `crypto.createPrivateKey()` before signing. See `src/lib/coinbase/client.ts`.
5. **Paper mode is NOT a flag.** It's a typed executor object loaded once at boot. Mode flips require restart. The lint rule + file-level isolation make "no live order in paper mode" structurally guaranteed, not just runtime-tested.
6. **camelCase everywhere on frontend.** Drizzle returns camelCase; API routes preserve that; views consume that. Don't snake_case any field — `undefined` access bugs are nasty.
7. **Auto-deploy unreliable.** Force via `POST /v2/apps/{id}/deployments {"force_build": true}` if needed.
8. **Next.js 16 middleware deprecation.** Shows warning about renaming `middleware` to `proxy`. Functionality still works; will need updating eventually.
9. **DO Postgres firewall blocks operator psql.** Schema operations run inside the DO app's run_command (`drizzle-kit push --force`).
10. **`state.value` is nullable on purpose.** Keys legitimately transition to null (cooldown_until expires, current_regime is "unset" until first morning brief). Same for `system_state_history.new_value`. Don't reintroduce NOT NULL.
11. **RSS User-Agent header must be ASCII.** Em-dashes ("—"), smart quotes, etc. break the http client's header validation. See `src/lib/news/rss-poller.ts`.
12. **Two `paper`/`live` axes — never conflate them.** The trading mode (`state.paper_mode`, locked at boot) controls what the bot does. The dashboard view (`useDashboardView()`, localStorage) controls what the operator sees. Anything that affects bot behavior reads the trading mode; anything that just renders a different lens reads the view.
13. **Paper accounting is fully synthetic.** Paper-mode code paths must NEVER read `getAllBalances()` / `fetchPortfolioSnapshot()`. Cash always flows through `executor.getCashBalanceUsd()` — paper executor returns synthetic, live returns real. Multiple places leaked at various points (boot first-launch, morning-brief cash read, re-anchor); all fixed. **Same applies to position values:** the morning brief used to pass `positionsValueUsd: 0` to the portfolio computation as a Phase 9 TODO that was never finished — making the AI think `current_alloc = 100%` whenever any position was held (#22). Always mark-to-market open positions for any context you send to the AI.
14. **Reuters Crypto RSS is dead** (HTTP 404 on the arc URL). Replaced with Cointelegraph. If a feed starts logging "Status code 404" warnings every 5 min, swap or remove it — `recovered: true` masks it as fine but it floods the Recent activity panel.
15. **Mutable singletons MUST live on `globalThis` (Next 16 App Router bundle splitting).** `src/lib/execution/factory.ts` (`constructedExecutor`), `src/lib/mode.ts` (`currentMode`), `src/lib/activity/tracker.ts` (`active` + `recent`) all do this — see the `slot()` helpers in each. Module-scope `let` does NOT survive — instrumentation runs in one bundle, API routes in others, each gets its own copy with its own `null`. Tripped findings #10, #18 the hard way. Lazy-initializer caches (config, anthropic SDK, postgres pool) are fine as module-scope because each bundle re-init is idempotent and harmless; the invariant is "this module is set ONCE at boot and read elsewhere."
16. **Beware "detector returns flags, caller acts on them" handoffs.** Six findings this session (#11, #15, #22, #25, #29, #30) shared the same root cause — pure logic existed and was tested, but the integration / call site never wired up the action. Comments like "we leave X to the caller" or "dispatched by the boot flow" or "wired when Phase Y" were lies — nobody came back to wire them. When you see one of those comments, verify the action actually happens.
17. **Opus morning brief: `max_tokens` budget covers thinking + output combined.** With `effort: "max"` adaptive thinking, the model uses most of `max_tokens` on thinking. Set the ceiling generously (currently 32k for `morning` + `review`); Anthropic only bills used tokens, so over-provisioning is free. Truncated responses or zero-length-but-still-billed responses are the symptom. See `OPUS_EFFORT_BY_CALL_TYPE`.
18. **drizzle-kit 0.31+ is required against pg18.** DO's managed Postgres `db-postgresql-nyc3-00644` runs pg18, which gives every NOT NULL column a named constraint row in `pg_constraint` (e.g., `orders_id_not_null`). drizzle-kit 0.28 didn't understand these — it generated `ALTER TABLE ... DROP CONSTRAINT` for them, hit `42P16: column "id" is in a primary key`, and silently abandoned the entire diff plan including new column adds. drizzle-kit 0.31.7 fixed the bug (issue #4944). We currently run drizzle-kit 0.31.10 + drizzle-orm 0.45.2. If a future bump touches drizzle, verify against a local `postgres:18` docker container before deploying. The `applyAdditiveMigrations` function in `scripts/migrate-v1-to-v3.ts` is kept as an empty no-op escape hatch — append entries there ONLY if drizzle-kit ever regresses again and a schema change MUST land before `npm start`. Schema.ts is the single source of truth for ordinary additions.

## Operator controls (paper-mode safety surfaces)

- `POST /api/controls/reset-paper` — typed-phrase confirm "reset paper progress". Wipes every paper position + paper order + queued tranches + cooldowns + auto-pause reason; reseeds synthetic capital to operator-supplied amount (default `PAPER_STARTING_CAPITAL_USD = 500`, but the live paper account currently anchors at $10k unless re-anchored). Audit trail (evaluations, app_decisions, history) preserved. **Order-of-deletes matters** (orders → positions, FK constraint).
- `POST /api/controls/re-anchor-capital` — paper mode: takes operator-supplied `startingCapitalUsd`, no real-wallet read. Live mode: snapshots real Coinbase. Resets equity curve / peak / BTC anchor for the current mode. Does NOT touch positions/orders. **Refuses with 409 if any positions are open** — would otherwise corrupt cash + positions-value bookkeeping. Operator must close-all or reset-paper first.
- `POST /api/controls/pause` — toggles `trading_paused`. On manual resume, also clears `trading_paused_reason` + `trading_paused_by_btc_underperf_gate` so stale auto-pause text doesn't linger.
- `deleteAllPositionsForCurrentMode()` / `deleteAllOrdersForCurrentMode()` — only callable from paper mode (assert mode at runtime, on top of the lint rule that confines positions/orders mutations to their query files).

## Status

**Deployed and live** at https://huny-money-mfiyo.ondigitalocean.app in paper mode. Boot succeeds; scheduler ticks; cycle range job runs; wakeup cycle refreshes equity snapshot every 5 min; activity tracker populates; morning brief executes end-to-end with proper position bookkeeping.

**Bug log:** see `FINDINGS.md` at the repo root. As of session 2026-05-10: 30 distinct findings logged. All HIGH/CATASTROPHIC items fixed and verified live across two follow-up sweeps. The bot has materially changed since the original "Phase 9 complete" claim — many paths in that claim were exercised here for the first time and broke. All have entries in `FINDINGS.md` with cause + fix + verification.

**Confirmed working live (post-2026-05-10 session):**
- Boot → executor singleton (across Next App Router bundles via globalThis) → scheduler → 60s tick loop
- Force-brief → Opus (32k max_tokens, lenient JSON parse with trailing-comma recovery) → decision-executor → BTC core position record (insert on first dca_in, update with weighted-avg on subsequent)
- Brief data package now correctly mark-to-markets open positions for `accountValueUsd` (was hardcoded 0, see #22)
- Regime classification persisted to `state.current_regime` + `days_in_current_regime` increments
- Reset-paper (orders → positions delete order)
- Re-anchor-capital (refuses with open positions)
- Pause / resume, force-reconcile, close-all (now computes P&L on close, with ticker-fallback exitPrice for paper-mode pending fills)
- Sonnet scheduled checkpoint fires (06:00 + 22:00 UTC); falls back to latest *successfully-parsed* brief if a recent attempt failed
- Wakeup cycle closes positions on stop_limit / take_profit / market_exit fills (canonical close path, aggregates entry+exit fees)
- Soft circuit breaker (≥20% drawdown halves alt sizes) wired into the brief flow
- Boot reconciliation now dispatches catch-up brief on `missedEvaluation` (was logged-only)
- Equity curve anchored from most recent reset/re-anchor — no more stale pre-reset history
- `orders.feesUsd` column persisted on every paper-executor fill; `sumFilledOrderFeesForPositionForCurrentMode` aggregates entry+exit fees on every close path (close-all, decision-executor BTC + alt exits, wakeup-cycle, convert-to-btc-hold)
- `convert-to-btc-hold` now closes prior positions with full P&L AND inserts a `btc_core` position row backing the BTC buy (FINDINGS #27)

**Not yet exercised live (depend on AI judgment + market dynamics, expected to surface during Phase 10):**
- `dca_out` / `exit` (need regime change to bull or bear)
- Alt entry (need an AI candidate with conviction ≥ 70 + the 7 entry conditions in §3.4)
- Two-tranche entry ladder firing tranche 2 ~12h after tranche 1
- Trail-stop ratchet at +25 / +50 / +75 / +100% (needs profitable alt)
- Wake-up triggers actually firing (need >5% moves on held assets, news matches, or stop fills)
- Sonnet escalation to Opus (needs a wake-up worth escalating)
- 60-day BTC underperformance auto-pause gate (needs 60 days of equity history)
- Live-mode flip (intentionally not exercised — Phase 1 paper window first)
- `convert-to-btc-hold` endpoint (now book-clean per #27 fix; remains an emergency one-shot — fired at most once in the bot's lifetime)
- Live-mode `orders.feesUsd` population (column exists; live-executor needs a reconciliation step to write Coinbase fees on fill — deferred until Phase 2)

**CI:** GitHub Actions runs typecheck / lint / lint:queries / unit / build / integration-against-ephemeral-Postgres on every push/PR. **Zero GH secrets required**: deploys go via DO auto-deploy from main, with manual fallback `bash scripts/deploy.sh` reading `~/Desktop/.nibbles-secrets`. DO auto-deploy is flaky; verify each push actually deployed via the DO console or by checking commit SHA on a deployment.

## What's Next

1. **Read `FINDINGS.md`** if you weren't part of the 2026-05-10 session — most of those bugs would have detonated weeks into Phase 10 with no obvious cause, costing time to diagnose.
2. **Pull the schema-diagnostic output from the next deploy log** (committed in `147eced`) and identify the prod-DB drift causing drizzle-kit's 42P16 redefine attempts. Once known, fix the schema or add a corrective ALTER and remove the diagnostic. The additive-migrations layer (`applyAdditiveMigrations` in the migrate script) stays regardless — it's belt-and-braces.
3. **Start Phase 10 paper window cleanly:** `POST /api/controls/reset-paper` with the desired starting capital, then let the 14:00 UTC scheduled brief drive cadence. Force briefs are fine for spot-checking but use sparingly to keep the AI's regime-day counter and equity curve coherent.
4. Operator reads ≥ 10 morning briefs and judges them coherent.
5. At 60 days, evaluate Phase 1 advance criteria per `STRATEGY.md §6.3`.

The bot is built and now actually works the way the build plan claimed it did. It now needs to earn the right to trade — first by being coherent in paper, then by beating BTC.
