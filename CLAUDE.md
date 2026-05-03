# Huny Money - Autonomous Crypto Trading Bot

## What This Is
An autonomous cryptocurrency trading bot powered by Claude AI, deployed on DigitalOcean App Platform. Uses a two-layer evaluation system (daily macro regime assessment + 8-hour swing trade evaluations) to trade BTC, ETH, and SOL on Coinbase Advanced Trade. $500 starting capital in USDC.

The complete strategy specification is in `DEFINITIVE_TRADING_STRATEGY.md` (922 lines). That document is the source of truth for all trading logic.

## Current State (as of 2026-05-03)
- **Live at**: https://huny-money-mfiyo.ondigitalocean.app
- **Login**: Password-protected, password is in `ADMIN_PASSWORD` env var
- **Mode**: Paper trading (simulated). No real trades will execute until switched to live mode via Controls page.
- **Account**: $500.03 USDC on Coinbase (old API key: 88674a25). The portfolio API treats USDC as cash.
- **GitHub**: Private repo at `masonrogers/huny-money`, auto-deploy on push is configured but sometimes doesn't trigger — use `force_build: true` via DO API if needed.

## Stack
- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript
- **CSS**: Tailwind CSS v4
- **ORM**: Drizzle ORM with postgres.js driver
- **Database**: PostgreSQL on DigitalOcean managed cluster `db-postgresql-nyc3-00644`, database name `huny_money`
- **AI**: Anthropic Claude (claude-sonnet-4-20250514) via @anthropic-ai/sdk
- **Exchange**: Coinbase Advanced Trade API v3 with CDP JWT auth (ES256 via jose)
- **Hosting**: DigitalOcean App Platform, basic-xxs ($5/mo), app ID `e3f67164-bc0f-481e-a17d-cb1a33c3c440`
- **Charts**: Recharts (installed but not yet used in dashboard)

## Architecture

### Trading Engine (src/lib/engine/)
- `boot.ts` — Startup: detects first launch vs restart, runs reconciliation
- `evaluation.ts` — Main orchestrator: assembles data package, calls Claude, parses response, validates via risk manager, executes decisions
- `data-package.ts` — Assembles Section 14 data package with portfolio state, multi-timeframe candles, indicators, history
- `risk-manager.ts` — 12+ guardrails: circuit breakers, exposure caps, correlation rules, cooldowns
- `decision-executor.ts` — Maps Claude's output to actions (hold, adjust_stop, take_partial_profit, exit, new trades)
- `trade-executor.ts` — Low-level order placement on Coinbase (limit buy, stop-limit sell, take-profit)
- `reconciliation.ts` — Section 22: health check, order/balance reconciliation, missed evaluation detection
- `regime-detector.ts` — Enforces one-level-at-a-time regime changes
- `strategy-reviewer.ts` — Self-modification: every 5 trades or 30 days, Claude reviews and adjusts parameters
- `price-monitor.ts` — Monitors for 5%+ price moves, triggers emergency evaluations
- `timer-processor.ts` — Processes pending timers (order cancels, DCA fallbacks, API retries)
- `scheduler.ts` — In-process cron via setInterval: timers every 60s, price-check every 5m, evaluate every 8h

### Scheduling
No external cron. `instrumentation.ts` runs `boot.ts` then `scheduler.ts` on server start. The scheduler calls localhost cron API routes with CRON_SECRET bearer auth.

### Database (src/lib/db/)
- 12 tables defined in `schema.ts`: system_state, strategy_params, positions, orders, pending_timers, evaluations, theses, strategy_modifications, regime_history, reconciliation_log, alerts, equity_snapshots
- Schema is pushed to DB at runtime via `npx drizzle-kit push --force` in the run command (not build command, because DATABASE_URL is a DO template reference `${db.DATABASE_URL}` that only resolves at runtime)
- Connection uses lazy Proxy initialization to avoid build-time crashes
- All queries in `src/lib/db/queries/` — 11 query files

### Coinbase Integration (src/lib/coinbase/)
- JWT auth using ES256. The private key comes from Coinbase in EC PEM format (`BEGIN EC PRIVATE KEY`), but jose's `importPKCS8` needs PKCS#8 format. `client.ts` converts via `crypto.createPrivateKey()` before signing.
- The account holds USDC not USD. The portfolio API counts both USD + USDC as cash.
- Automatic retry with exponential backoff on rate limits (429) and server errors (5xx)

### Frontend (src/app/)
- 8 pages + login: Dashboard, Positions, Trades, Evaluations, Regime, Strategy, Reconciliation, Controls
- Auth: JWT session cookie (`huny_session`), 7-day expiry, verified in middleware using jose
- Middleware protects all routes except: /login, /api/auth/*, /api/healthz, /api/cron/*, /_next/*, /favicon*
- `AppShell` component conditionally renders sidebar/header (hidden on /login)
- SWR for data fetching with auto-refresh intervals (15s-60s depending on endpoint)
- Error boundary in `error.tsx` shows actual error messages instead of generic crash page
- All frontend components use camelCase field names (matching Drizzle ORM output). API routes that construct custom response objects must also use camelCase.

### API Routes (src/app/api/)
- **Cron** (3): /evaluate, /timers, /price-check — authenticated via CRON_SECRET
- **Dashboard** (7): /portfolio, /positions, /trades, /evaluations, /regime, /strategy, /reconciliation, /alerts — read-only GET, session auth
- **Controls** (7): /pause, /close-all, /force-evaluation, /toggle-paper, /regime-override, /approve-asset, /force-reconciliation — POST, session auth
- **Auth** (3): /login, /logout, /check
- **Other**: /healthz (public), /debug (session auth, shows DB table status)

## Credentials & Config

### Environment Variables (all in .env.local, gitignored)
- `DATABASE_URL` — PostgreSQL connection string (DO managed cluster)
- `COINBASE_API_KEY` — CDP API key name (organizations/4ecd07ab.../apiKeys/88674a25...)
- `COINBASE_API_SECRET` — EC private key PEM (the old key with the $500 USDC)
- `ANTHROPIC_API_KEY` — Claude API key (sk-ant-api03-...)
- `CRON_SECRET` — Bearer token for internal cron routes
- `APP_SECRET` — JWT signing key for session cookies
- `ADMIN_PASSWORD` — Login password
- `NEXT_PUBLIC_APP_URL` — http://localhost:3000 (optional)

### External Credentials
- **DO API tokens**: `/home/davidr/Desktop/.nibbles-secrets` (DO_API_KEY_WRITE for deploys, DO_API_KEY_READONLY for inspection)
- **Coinbase CDP key file**: `/home/davidr/Downloads/cdp_api_key.json` (old key)
- **Coinbase CDP key file**: `/home/davidr/Downloads/cdp_api_key(1).json` (new key, empty account — don't use)

### DigitalOcean
- **App ID**: e3f67164-bc0f-481e-a17d-cb1a33c3c440
- **App name**: huny-money
- **Service name**: web (important: use "web" not "huny-money" when querying logs)
- **Live URL**: https://huny-money-mfiyo.ondigitalocean.app
- **DB cluster**: db-postgresql-nyc3-00644 (id: aa685c6c-1ac9-48f7-80b4-cd59b347e126)
- **DB name**: huny_money
- **Region**: nyc
- **Instance**: basic-xxs ($5/mo)
- **Build command**: `npm run build`
- **Run command**: `npx drizzle-kit push --force && npm start`
- **Health check**: /api/healthz

## Key Technical Decisions & Gotchas

1. **Lazy initialization everywhere**: config.ts, db/index.ts, ai/client.ts all use Proxy-based lazy loading. Next.js evaluates module scope at build time when env vars aren't available — eager initialization crashes the build.

2. **drizzle-kit is a regular dependency** (not devDependency): Needed at runtime because `drizzle-kit push` runs in the run_command. DO prunes devDependencies after build.

3. **DATABASE_URL is a DO template reference** (`${db.DATABASE_URL}`): Only resolves at runtime, not build time. That's why schema push is in run_command not build_command.

4. **Coinbase EC key → PKCS#8 conversion**: Coinbase CDP keys are EC PEM format but jose needs PKCS#8. Fixed in `client.ts` line 41 via `crypto.createPrivateKey().export()`.

5. **USDC not USD**: The trading account holds USDC. The portfolio API adds both USD and USDC balances as "cash".

6. **camelCase everywhere on frontend**: Drizzle returns camelCase field names. All page components and API responses must use camelCase. This was a major source of bugs — snake_case field access causes `undefined` values that crash React (e.g., `DateTimeFormat.format(new Date(undefined))`).

7. **Auto-deploy unreliable**: DO auto-deploy from GitHub sometimes doesn't trigger. Force deploy via: `curl -X POST "https://api.digitalocean.com/v2/apps/{app_id}/deployments" -H "Authorization: Bearer $DO_API_KEY_WRITE" -H "Content-Type: application/json" -d '{"force_build": true}'`

8. **Next.js 16 middleware deprecation**: Shows warning about renaming `middleware` to `proxy`. Functionality still works, but this will need updating eventually.

9. **Two Coinbase API keys exist**: Key 88674a25 (old, has $500 USDC — THIS IS THE ONE IN USE) and key 7b288729 (new, empty account). Don't switch to the new key.

## What Works
- Dashboard loads with real portfolio data ($500 USDC from Coinbase)
- Login/logout with JWT sessions
- Sidebar navigation across all pages
- Controls page (pause, resume, paper/live toggle, force evaluation, reconciliation, regime override)
- In-process scheduler running cron jobs (timers, price checks, evaluations)
- Boot sequence with reconciliation on restart
- Coinbase API integration (accounts, balances, market data, order placement)
- Error boundary showing meaningful errors instead of generic crash page

## What Hasn't Been Tested Yet
- Live trading mode (only paper mode has been used)
- Actual Claude evaluation cycle (8-hour trigger)
- Order placement and management on Coinbase
- Strategy self-modification
- Emergency evaluation triggers (5%+ price moves)
- All sub-pages with real data (positions, trades, evaluations will be empty until the bot starts trading)

## Development
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run db:push      # Push schema to DB (needs DATABASE_URL)
npm run db:generate  # Generate Drizzle migrations
```

## Deployment
```bash
# Push to GitHub triggers auto-deploy (sometimes)
git push origin main

# Force deploy if auto-deploy doesn't trigger
source /home/davidr/Desktop/.nibbles-secrets
curl -X POST "https://api.digitalocean.com/v2/apps/e3f67164-bc0f-481e-a17d-cb1a33c3c440/deployments" \
  -H "Authorization: Bearer $DO_API_KEY_WRITE" \
  -H "Content-Type: application/json" \
  -d '{"force_build": true}'

# Check deployment status
curl -s "https://api.digitalocean.com/v2/apps/e3f67164-bc0f-481e-a17d-cb1a33c3c440/deployments?page=1&per_page=1" \
  -H "Authorization: Bearer $DO_API_KEY_READONLY" | python3 -c "import sys,json; print(json.load(sys.stdin)['deployments'][0]['phase'])"

# Get runtime logs
curl -s "https://api.digitalocean.com/v2/apps/e3f67164-bc0f-481e-a17d-cb1a33c3c440/logs?type=RUN&component_name=web&follow=false" \
  -H "Authorization: Bearer $DO_API_KEY_READONLY" | python3 -c "
import sys,json,urllib.request,gzip
d=json.load(sys.stdin)
url=d.get('live_url') or d.get('historic_urls',[''])[0]
data=urllib.request.urlopen(url).read()
try: text=gzip.decompress(data).decode()
except: text=data.decode('utf-8','replace')
for l in text.strip().split(chr(10))[-50:]: print(l)
"
```
