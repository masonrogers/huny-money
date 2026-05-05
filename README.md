# Huny Money — v3

Autonomous crypto trading bot. Phases 1–9 of the v3 rebuild are code-complete.

**Strategy:** Regime-aware BTC core with selective alt cycle entries. The bot defaults to BTC (the structural winner in crypto), goes to cash in confirmed bears (the largest single source of alpha vs. BTC), and adds satellite cycle-trading positions on a curated watchlist of mid-cap alts when conditions favor it.

**Goal:** Beat BTC buy-and-hold over rolling 60-day windows on a $500 USDC account.

## Documents

- [`STRATEGY.md`](./STRATEGY.md) — the trading strategy and architecture spec (v3.0, regime + cycle)
- [`BUILD_PLAN.md`](./BUILD_PLAN.md) — sequenced implementation phases

## Status

Phases 1–9 code complete. The v1 swing-trading implementation is preserved on the [`archive/v1`](https://github.com/masonrogers/huny-money/tree/archive/v1) branch and is currently the deployed version on DigitalOcean App Platform.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui · Drizzle ORM · Postgres · Anthropic SDK · Coinbase Advanced Trade REST · DigitalOcean App Platform.

## Local development

```bash
cp .env.example .env.local  # then fill in credentials
npm install
npm run dev
```

Dashboard at http://localhost:3000.

## Tests

```bash
npm test                          # unit + pure tests (no DB)
RUN_INTEGRATION=1 npm test        # also runs DB integration tests
RUN_LIVE_SMOKE=1 npm test -- coinbase-smoke   # live Coinbase auth + ticker
bash scripts/lint-queries.sh      # CI lint: positions/orders + coinbase/orders isolation
```

## Deployment runbook (operator)

The DigitalOcean app is currently pointed at `archive/v1` (the running v1 paper bot). To switch to v3:

```bash
# 1. Drop the v1 schema (the new schema replaces it on the next push)
source .env.local
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; \
                          GRANT ALL ON SCHEMA public TO doadmin; \
                          GRANT ALL ON SCHEMA public TO public;"

# 2. Push the v3 schema
npx drizzle-kit push --force

# 3. (Optional) Run the integration test suite locally to verify the schema
RUN_INTEGRATION=1 npm test

# 4. Update DO app to deploy from main
source /home/davidr/Desktop/.nibbles-secrets
APP_ID=e3f67164-bc0f-481e-a17d-cb1a33c3c440
# Apply the .do/app.yaml in this repo to the live app via the DO API.
# See ./scripts/deploy.sh (added in Phase 9) or the dashboard.

# 5. Force a deploy
curl -X POST "https://api.digitalocean.com/v2/apps/$APP_ID/deployments" \
  -H "Authorization: Bearer $DO_API_KEY_WRITE" \
  -H "Content-Type: application/json" \
  -d '{"force_build": true}'

# 6. Tail run logs to verify boot succeeded
curl -s "https://api.digitalocean.com/v2/apps/$APP_ID/logs?type=RUN&component_name=web&follow=false" \
  -H "Authorization: Bearer $DO_API_KEY_READONLY" \
  | python3 -c "import sys,json,urllib.request,gzip; \
    d=json.load(sys.stdin); url=d.get('live_url') or d.get('historic_urls',[''])[0]; \
    data=urllib.request.urlopen(url).read(); \
    print((gzip.decompress(data).decode() if data[:2]==b'\\x1f\\x8b' else data.decode('utf-8','replace')).split(chr(10))[-50:])"
```

## Boot sequence

On every server start (per `instrumentation.ts`):

1. Coinbase TRADE-only assertion (refuses to start if withdrawal enabled)
2. First-launch detection — captures starting capital, BTC anchor, default params
3. Executor factory — reads `state.paper_mode`, constructs the immutable executor
4. Reconciliation — cross-mode boot rejection, missing-stop placement, missed-eval detection
5. Clears `state.mode_change_pending` (operator's pending toggle now applied)
6. Starts the in-process scheduler (Opus morning at 14:00 UTC, Sonnet checks at 06/22 UTC, cycle-range job at 00:00 UTC, wake-up checks every 5 min)
