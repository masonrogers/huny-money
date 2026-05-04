# Huny Money — v2

Autonomous crypto trading bot. **Currently being rebuilt from scratch.**

## Documents

- [`STRATEGY.md`](./STRATEGY.md) — the trading strategy and architecture spec
- [`BUILD_PLAN.md`](./BUILD_PLAN.md) — sequenced implementation phases

## Status

In Phase 0 → Phase 1 transition. The previous working implementation is preserved on the [`archive/v1`](https://github.com/masonrogers/huny-money/tree/archive/v1) branch and is what is currently deployed on DigitalOcean.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui · Drizzle ORM · Postgres · Anthropic SDK · Coinbase Advanced Trade REST · DigitalOcean App Platform.

## Local development

```bash
cp .env.example .env.local  # then fill in credentials
npm install
npm run dev
```

Dashboard at http://localhost:3000.
