/**
 * Strategy constants. Hardcoded per STRATEGY.md §3.1 — modifying these
 * requires a deploy + strategy_version bump.
 */

export const STRATEGY_VERSION = "3.0";

// ---------------------------------------------------------------------------
// Asset universe (STRATEGY.md §3.1)
// ---------------------------------------------------------------------------

export const CORE_ASSETS = ["BTC", "ETH"] as const;

/**
 * Cycle alt watchlist. Operator confirms or adjusts at deploy. Keep at 4-6.
 * Initial recommended set per STRATEGY.md §3.1 — AERO is the operator's
 * proven cycle asset.
 */
export const CYCLE_WATCHLIST = ["AERO", "LINK", "AAVE", "UNI", "SOL"] as const;

/** Combined universe used by the price polling loop and price snapshots. */
export const ALL_ASSETS = [...CORE_ASSETS, ...CYCLE_WATCHLIST] as const;
export type Asset = (typeof ALL_ASSETS)[number];

/** Map asset symbol to Coinbase product ID. */
export function productIdFor(asset: string): string {
  return `${asset}-USD`;
}

// ---------------------------------------------------------------------------
// Regime allocations (STRATEGY.md §3.2 / §3.3 / §3.6)
// ---------------------------------------------------------------------------

export type Regime = "bull" | "chop" | "bear";

export const REGIME_ALLOCATIONS: Record<
  Regime,
  { btcCoreTargetPct: number; maxAltPct: number; minCashPct: number }
> = {
  bull: { btcCoreTargetPct: 70, maxAltPct: 30, minCashPct: 0 },
  chop: { btcCoreTargetPct: 50, maxAltPct: 30, minCashPct: 20 },
  bear: { btcCoreTargetPct: 0, maxAltPct: 0, minCashPct: 100 },
};

// ---------------------------------------------------------------------------
// Position sizing (STRATEGY.md §3.6)
// ---------------------------------------------------------------------------

export const MAX_BTC_CORE_PCT = 70;
export const MAX_SINGLE_ALT_PCT = 15;
export const MAX_TOTAL_ALT_PCT = 30;
export const MIN_POSITION_SIZE_USD = 50;

// ---------------------------------------------------------------------------
// Entry/exit thresholds (STRATEGY.md §3.4 / §3.5 / §3.7)
// ---------------------------------------------------------------------------

export const MIN_ENTRY_CONVICTION = 70;
export const MIN_RR_RATIO = 2; // for swing context only; cycle alts use cycle position
export const ALT_INITIAL_STOP_PCT = 12;

// Cycle range zone definitions (top of bottom 30%, bottom of top 25%)
export const CYCLE_LOW_ZONE_TOP_FRACTION = 0.3;
export const CYCLE_HIGH_ZONE_BOTTOM_FRACTION = 0.75;
export const CYCLE_RANGE_LOOKBACK_DAYS = 180;

// Trailing stop schedule for alt cycle positions (STRATEGY.md §3.7)
export const ALT_TRAILING_STOP_SCHEDULE: ReadonlyArray<{
  triggerProfitPct: number;
  stopPctFromEntry: number;
}> = [
  { triggerProfitPct: 25, stopPctFromEntry: 0 }, // breakeven at +25%
  { triggerProfitPct: 50, stopPctFromEntry: 20 }, // +20% at +50%
  { triggerProfitPct: 75, stopPctFromEntry: 40 }, // +40% at +75%
  { triggerProfitPct: 100, stopPctFromEntry: 65 }, // +65% at +100%
];

// ---------------------------------------------------------------------------
// Time decay (STRATEGY.md §3.5)
// ---------------------------------------------------------------------------

export const ALT_TIME_DECAY_REASSESS_WEEKS = 12;
export const ALT_HARD_MAX_HOLD_WEEKS = 26;
export const ALT_REENTRY_COOLDOWN_DAYS = 14;

// ---------------------------------------------------------------------------
// Risk (STRATEGY.md §4)
// ---------------------------------------------------------------------------

export const HARD_FLOOR_USD = 300;
export const SOFT_BREAKER_DRAWDOWN_PCT = 20;
export const SOFT_BREAKER_RECOVERY_PCT = 10;
export const DAILY_LOSS_CAP_PCT = 4;
export const COOLDOWN_DAYS_AFTER_2_LOSSES = 14;
export const BTC_UNDERPERFORMANCE_PAUSE_DAYS = 60;
export const BTC_UNDERPERFORMANCE_WARN_PCT = 3;
export const BTC_UNDERPERFORMANCE_FAIL_PCT = 5;

// ---------------------------------------------------------------------------
// Watch list cap (STRATEGY.md §5.3)
// ---------------------------------------------------------------------------

export const MAX_WATCHLIST_TRIGGERS = 5;

// ---------------------------------------------------------------------------
// Paper-mode synthetic capital (STRATEGY.md §13.6)
// ---------------------------------------------------------------------------

/**
 * Default starting capital for paper mode. Paper accounting is fully
 * synthetic — it never reads or references the real Coinbase balance.
 * This number defines the size of the hypothetical portfolio the paper
 * executor manages.
 *
 * Operator can override at re-anchor time via the dashboard control.
 */
export const PAPER_STARTING_CAPITAL_USD = 500;
