# Huny Money — v3

Autonomous crypto trading bot. **v3 is deployed and live in paper mode** at https://huny-money-mfiyo.ondigitalocean.app.

**Strategy:** Regime-aware BTC core with selective alt cycle entries. The bot defaults to BTC (the structural winner in crypto), goes to cash in confirmed bears (the largest single source of alpha vs. BTC), and adds satellite cycle-trading positions on a curated watchlist of mid-cap alts when conditions favor it.

**Goal:** Beat BTC buy-and-hold over rolling 60-day windows on a $500 USDC account.

## Documents

- [`STRATEGY.md`](./STRATEGY.md) — the trading strategy and architecture spec (v3.0, regime + cycle)
- [`BUILD_PLAN.md`](./BUILD_PLAN.md) — sequenced implementation phases
- [`CLAUDE.md`](./CLAUDE.md) — operational reference for the AI agent: architecture, gotchas, controls, status
- [`FINDINGS.md`](./FINDINGS.md) — bug log from the 2026-05-10 force-iteration sweep (30 findings, all closed)

## Status

**v3 LIVE in paper mode** at https://huny-money-mfiyo.ondigitalocean.app. Phase 10 (60-day paper observation window) ready to begin. All 30 findings from the original CI rollout and force-iteration sweep are closed (see `FINDINGS.md`). The v1 swing-trading implementation is preserved on the [`archive/v1`](https://github.com/masonrogers/huny-money/tree/archive/v1) branch.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui · Drizzle ORM (drizzle-kit 0.31.10 + drizzle-orm 0.45.2) · Postgres 18 (DO managed) · Anthropic SDK (Opus 4.7 + Sonnet 4.6) · Coinbase Advanced Trade REST · DigitalOcean App Platform.

## Local development

```bash
cp .env.example .env.local  # then fill in credentials
npm install
npm run dev
```

Dashboard at http://localhost:3000.

## Tests

```bash
npm test                          # 264 unit tests (no DB)
RUN_INTEGRATION=1 npm test        # +35 integration tests (needs Postgres at $DATABASE_URL)
RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke   # 3 live Coinbase auth + ticker tests (local only)
bash scripts/lint-queries.sh      # CI lint: positions/orders + coinbase/orders isolation
npx tsc --noEmit                  # typecheck
npm run lint                      # eslint (7 expected warnings on hydration patterns)
```

Local integration testing uses an ephemeral postgres container — easiest setup:

```bash
docker run -d --rm --name huny-test-pg -e POSTGRES_USER=huny -e POSTGRES_PASSWORD=huny \
  -e POSTGRES_DB=huny_money -p 55432:5432 postgres:16
DATABASE_URL=postgres://huny:huny@localhost:55432/huny_money npx drizzle-kit push --force
DATABASE_URL=postgres://huny:huny@localhost:55432/huny_money \
  COINBASE_API_KEY=stub COINBASE_API_SECRET=stub ANTHROPIC_API_KEY=stub \
  APP_SECRET=stub_app_secret_at_least_32_bytes_long_for_jwt_signing \
  ADMIN_PASSWORD=stub CRON_SECRET=stub \
  RUN_INTEGRATION=1 npm test
docker stop huny-test-pg
```

## Deployment

Auto-deploys from `main` (sometimes flaky — verify with the DO console or via API):

```bash
bash scripts/deploy.sh   # reads ~/Desktop/.nibbles-secrets, forces a build + tails logs
```

The DO run_command is `npx tsx scripts/migrate-v1-to-v3.ts && npx drizzle-kit push --force && npm start`. The migrate script handles the legacy v1→v3 schema reset (no-op once v3 is settled — current state) and an emergency-migrations escape hatch (currently empty; see `CLAUDE.md` gotcha #18).

## Boot sequence

On every server start (per `instrumentation.ts`):

1. Coinbase TRADE-only assertion (refuses to start if withdrawal enabled — non-negotiable)
2. First-launch detection — captures starting capital, BTC anchor, default params
3. Executor factory — reads `state.paper_mode`, constructs the immutable executor (the executor object IS the mode for the session)
4. Reconciliation — cross-mode boot rejection, missing-stop placement, missed-eval detection, downtime price-move detection
5. Clears `state.mode_change_pending` (operator's pending mode toggle now applied)
6. Starts the in-process scheduler (Opus morning at 14:00 UTC, Sonnet checks at 06:00 + 22:00 UTC, cycle-range job at 00:00 UTC, wake-up checks every 5 min)

## CI

GitHub Actions on every push/PR to `main`: typecheck / lint / lint:queries / unit / build / integration (against a Postgres 16 service container). **Zero secrets required** — deploys go via DO auto-deploy or `scripts/deploy.sh`. Live Coinbase smoke tests are local-only.
