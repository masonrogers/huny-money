# Huny Money — v3

Autonomous crypto trading bot. **Currently being rebuilt from scratch.**

**Strategy:** Regime-aware BTC core with selective alt cycle entries. The bot defaults to BTC (the structural winner in crypto), goes to cash in confirmed bears (the largest single source of alpha vs. BTC), and adds satellite cycle-trading positions on a curated watchlist of mid-cap alts when conditions favor it.

**Goal:** Beat BTC buy-and-hold over rolling 60-day windows on a $500 USDC account.

## Documents

- [`STRATEGY.md`](./STRATEGY.md) — the trading strategy and architecture spec (v3.0, regime + cycle)
- [`BUILD_PLAN.md`](./BUILD_PLAN.md) — sequenced implementation phases

## Status

In Phase 0 → Phase 1 transition. The previous working implementation (v1, swing-trading) is preserved on the [`archive/v1`](https://github.com/masonrogers/huny-money/tree/archive/v1) branch and is what is currently deployed on DigitalOcean.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui · Drizzle ORM · Postgres · Anthropic SDK · Coinbase Advanced Trade REST · DigitalOcean App Platform.

## Local development

```bash
cp .env.example .env.local  # then fill in credentials
npm install
npm run dev
```

Dashboard at http://localhost:3000.
