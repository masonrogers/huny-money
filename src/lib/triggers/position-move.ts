import { isDebounced } from "./debounce";

/**
 * Wake-up trigger 1: position move >5% in either direction within 4h
 * (60-min debounce per asset). Per STRATEGY.md §5.5.
 *
 * Wider threshold than v2's swing version (3% in 1h) because cycle alts
 * are intentionally volatile — we don't want to wake Sonnet on noise.
 */

export const POSITION_MOVE_THRESHOLD_PCT = 5;
export const POSITION_MOVE_WINDOW_HOURS = 4;

export interface PositionMoveCheckInput {
  asset: string;
  currentPrice: number;
  /** Price observed N hours ago (closest snapshot to (now - 4h)). */
  priceFourHoursAgo: number | null;
}

export interface PositionMoveFire {
  asset: string;
  currentPrice: number;
  priorPrice: number;
  deltaPct: number;
  windowHours: number;
}

/**
 * Determines whether this asset triggered a position-move wake-up.
 * Returns null if no fire (price didn't move enough, or no prior price,
 * or debounce window is still active).
 */
export async function checkPositionMove(
  input: PositionMoveCheckInput,
  now: Date = new Date(),
): Promise<PositionMoveFire | null> {
  if (input.priceFourHoursAgo == null || input.priceFourHoursAgo <= 0) return null;
  // Reject zero/negative current prices too — the wake-up cycle defaults
  // missing tickers to 0 (`prices[a] ?? 0`), which would otherwise compute
  // deltaPct = -100% and fire a spurious wake-up on Coinbase ticker hiccups.
  if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) return null;

  const deltaPct = ((input.currentPrice - input.priceFourHoursAgo) / input.priceFourHoursAgo) * 100;
  if (Math.abs(deltaPct) < POSITION_MOVE_THRESHOLD_PCT) return null;

  const debounce = await isDebounced("position_move", input.asset, now);
  if (debounce.debounced) return null;

  return {
    asset: input.asset,
    currentPrice: input.currentPrice,
    priorPrice: input.priceFourHoursAgo,
    deltaPct,
    windowHours: POSITION_MOVE_WINDOW_HOURS,
  };
}
