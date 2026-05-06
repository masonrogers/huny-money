# Huny Money — Autonomous Crypto Trading Bot (v3.0)

## What This Is

Autonomous crypto trading bot powered by Claude AI, deployed on DigitalOcean App Platform. v3 strategy: **regime-aware BTC core + alt cycle overlay**. Defaults to BTC, exits to cash in confirmed bears, adds satellite cycle-trading positions on a curated mid-cap watchlist (AERO, LINK, AAVE, UNI, SOL).

The strategy specification is `STRATEGY.md` (v3.0). The implementation plan is `BUILD_PLAN.md`. Both are the source of truth.

## Goal

Beat BTC buy-and-hold over rolling 60-day windows on a $500 USDC account, net of trading fees.

## Current State

- **Strategy:** `STRATEGY.md` v3.0 — adopted as the active spec
- **Code:** Phases 1–9 + 9.1 complete on `main`. Backend, frontend, all controls, integration tests, boot orchestration, scheduler dispatch.
- **Test suite:** 160/160 unit tests passing. 27 integration tests gated on `RUN_INTEGRATION=1`.
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

### Boot sequence (`src/lib/boot/index.ts`)

1. Coinbase TRADE-only assertion (refuses to start if withdrawal enabled — non-negotiable)
2. First-launch detection — if `state.last_boot_at` is empty, capture starting capital + BTC anchor + default phase=paper
3. `bootConstructExecutor()` — reads `state.paper_mode`, sets the global mode singleton, returns the typed `OrderExecutor`
4. `runBootReconciliation()` — cross-mode rejection, missing-stop placement, missed-eval detection, 5%+ price-move detection during downtime
5. `clearModeChangePendingFlag()` — operator's pending mode toggle now in effect
6. `startScheduler()` — tick loop begins

## Frontend (`src/app/(dashboard)/`)

9 dashboard views matching `STRATEGY.md §8.2`:
- Overview (default landing)
- Today's Plan (live morning brief beautifully rendered)
- AI Activity (every Opus + Sonnet call with full prompt/response, expandable)
- Positions (open + closed, with Coinbase order IDs visible)
- Cycle Position (per-asset zone display)
- Decisions & Triggers (watch list + wakeups + app decisions + state change log)
- Performance (closed trades, win rate, fees, equity placeholder)
- System (API budget, errors, last successful actions, Phase 1 criteria)
- Controls (working pause/resume/force-brief/reconcile/close-all/convert-to-BTC)

Plus auth (`(auth)/login`) with JWT session cookie. Live BTC/ETH/SOL ticker in the header (Coinbase Exchange WS). Cmd+K command palette for navigation + actions. Sonner toasts for state changes (paused, resumed, mode-change-pending banner). Framer Motion page transitions.

**Operator preferences (active):** frontend is max-effort, total visibility (every AI call + app decision + state change inspectable from dashboard), paper mode isolation, API cost is subsidized.

## Tests

- `npm test` — 160 unit tests (no DB needed): redact, mode singleton, config, lint-queries, indicators, cycle range, candle compress, AI schemas, AI prompts, pricing, RSS poller, position sizing, circuit breakers (pure), scheduler schedule, triggers (pure), execution validation, factory keys, isolation
- `RUN_INTEGRATION=1 npm test` — 27 integration tests against the live DB: stateWriter atomicity, budget gate behavior, paper-mode isolation, mode transition gate, circuit breakers
- `RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke` — 3 live-only tests verifying JWT auth + TRADE-only key + BTC ticker fetch
- `bash scripts/lint-queries.sh` — CI rule: positions/orders mode-isolation + coinbase/orders import isolation

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
- Build: `npm run build`. Run: `npx drizzle-kit push --force && npm start`. Health: `/api/healthz` (90s init delay covers boot reconciliation).
- Auto-deploy from `main` is enabled but sometimes flaky — force via API call.

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

1. **Lazy initialization everywhere.** `config.ts`, `db/index.ts`, `anthropic/client.ts` all use Proxy-based lazy loading. Next.js evaluates module scope at build time when env vars aren't available — eager init crashes the build.
2. **`drizzle-kit` is a regular dependency** (not devDependency). Needed at runtime because the run command pushes schema. DO prunes devDeps after build.
3. **`DATABASE_URL` is a DO template reference** (`${db.DATABASE_URL}`). Resolves at runtime, not build time. That's why schema push runs in the run_command not the build_command.
4. **Coinbase EC key → PKCS#8 conversion.** Coinbase CDP keys are EC PEM format but `jose.importPKCS8` requires PKCS#8. Convert via `crypto.createPrivateKey()` before signing. See `src/lib/coinbase/client.ts`.
5. **Paper mode is NOT a flag.** It's a typed executor object loaded once at boot. Mode flips require restart. The lint rule + file-level isolation make "no live order in paper mode" structurally guaranteed, not just runtime-tested.
6. **camelCase everywhere on frontend.** Drizzle returns camelCase; API routes preserve that; views consume that. Don't snake_case any field — `undefined` access bugs are nasty.
7. **Auto-deploy unreliable.** Force via `POST /v2/apps/{id}/deployments {"force_build": true}` if needed.
8. **Next.js 16 middleware deprecation.** Shows warning about renaming `middleware` to `proxy`. Functionality still works; will need updating eventually.
9. **DO Postgres firewall blocks operator psql.** Schema operations run inside the DO app's run_command (`drizzle-kit push --force`).

## What's Next

After successful deploy:
1. Operator validates dashboard end-to-end (login, header live ticker, all 9 views, cmd+K palette, pause/resume)
2. **Phase 10: Phase 1 paper trading** begins — 60 calendar days of observation
3. First morning brief fires at the next 14:00 UTC tick after deploy
4. Operator reads ≥ 10 morning briefs and judges them coherent
5. At 60 days, evaluate Phase 1 advance criteria per `STRATEGY.md §6.3`. If all pass → Phase 2 (half-size live, 60 days). If any fail → extend or shut down.

The bot is built. It now needs to earn the right to trade — first by being coherent in paper, then by beating BTC.
