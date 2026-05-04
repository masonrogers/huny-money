import {
  ALT_INITIAL_STOP_PCT,
  MAX_BTC_CORE_PCT,
  MAX_SINGLE_ALT_PCT,
  MIN_POSITION_SIZE_USD,
  CYCLE_WATCHLIST,
  CORE_ASSETS,
} from "@/lib/strategy/constants";

/**
 * Order-shape validation shared by both live and paper executors.
 *
 * Both executors run the same validation before accepting an order. This
 * guarantees that paper trading exercises the same constraint logic as
 * live — a key requirement of §13.6 ("same validation as live").
 *
 * Throws on violation. Returns silently on success.
 */

export class OrderValidationError extends Error {
  constructor(message: string) {
    super(`Order validation failed: ${message}`);
    this.name = "OrderValidationError";
  }
}

export interface OrderValidationContext {
  asset: string;
  /** "btc_core" if this order belongs to a BTC core position; "alt_cycle" otherwise. */
  positionType: "btc_core" | "alt_cycle";
  /** Notional value of the order in USD. */
  notionalUsd: number;
  /** Current account total value (used for percentage caps). */
  accountValueUsd: number;
  /** Optional: stop price (for stop-limit / cycle alt entry). */
  stopPrice?: number;
  /** Optional: entry price (for stop% calculation). */
  entryPrice?: number;
}

export function validateOrder(ctx: OrderValidationContext): void {
  // Min position size
  if (ctx.notionalUsd < MIN_POSITION_SIZE_USD) {
    throw new OrderValidationError(
      `Notional $${ctx.notionalUsd.toFixed(2)} below minimum $${MIN_POSITION_SIZE_USD}`,
    );
  }

  // Asset universe
  const allowed = new Set([...CORE_ASSETS, ...CYCLE_WATCHLIST] as readonly string[]);
  if (!allowed.has(ctx.asset.toUpperCase())) {
    throw new OrderValidationError(
      `Asset ${ctx.asset} is not in the configured universe (${CORE_ASSETS.join(",")} core + ${CYCLE_WATCHLIST.join(",")} watchlist)`,
    );
  }

  // Per-position % cap (defense in depth — the AI prompt and zod schema
  // already enforce this, but a code path that bypasses zod validation
  // shouldn't be able to slip a 50% alt position through).
  if (ctx.accountValueUsd > 0) {
    const pct = (ctx.notionalUsd / ctx.accountValueUsd) * 100;
    if (ctx.positionType === "btc_core" && pct > MAX_BTC_CORE_PCT + 0.5) {
      throw new OrderValidationError(
        `BTC core notional ${pct.toFixed(1)}% exceeds cap ${MAX_BTC_CORE_PCT}%`,
      );
    }
    if (ctx.positionType === "alt_cycle" && pct > MAX_SINGLE_ALT_PCT + 0.5) {
      throw new OrderValidationError(
        `Alt cycle notional ${pct.toFixed(1)}% exceeds single-alt cap ${MAX_SINGLE_ALT_PCT}%`,
      );
    }
  }

  // Stop sanity (alt cycle only — BTC core has no stop)
  if (ctx.positionType === "alt_cycle" && ctx.stopPrice != null && ctx.entryPrice != null) {
    if (ctx.stopPrice >= ctx.entryPrice) {
      throw new OrderValidationError(
        `Stop price $${ctx.stopPrice} must be below entry price $${ctx.entryPrice} for a long position`,
      );
    }
    const stopPct = ((ctx.entryPrice - ctx.stopPrice) / ctx.entryPrice) * 100;
    // Alt cycle stops are wider than swing stops (12% default per STRATEGY.md §3.7)
    if (stopPct > ALT_INITIAL_STOP_PCT * 2) {
      throw new OrderValidationError(
        `Stop ${stopPct.toFixed(1)}% below entry exceeds 2× initial stop (${ALT_INITIAL_STOP_PCT * 2}%)`,
      );
    }
  }
}
