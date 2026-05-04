import { stateWriter } from "@/lib/db/utils";
import { stateRead } from "@/lib/db/utils";
import {
  CYCLE_HIGH_ZONE_BOTTOM_FRACTION,
  CYCLE_LOW_ZONE_TOP_FRACTION,
  CYCLE_RANGE_LOOKBACK_DAYS,
} from "@/lib/strategy/constants";

/**
 * Cycle range computation per STRATEGY.md §3.8.
 *
 * For each watchlist asset:
 *   - Take 180 days of daily closes
 *   - cycle_low_zone_top    = min + 0.30 * (max - min)   (top of bottom 30%)
 *   - cycle_high_zone_bottom = min + 0.75 * (max - min)  (bottom of top 25%)
 *   - current_cycle_position_pct = (current - min) / (max - min) * 100
 *
 * The AI sees the zones in the morning brief and uses them as the default
 * frame for "is this asset at a cycle low" decisions.
 *
 * Range is recomputed nightly at 00:00 UTC by the Phase 5 scheduler. The
 * results are stored in `state` (one set of keys per asset) so the morning
 * brief can read them without recomputing.
 */

export interface CycleRange {
  asset: string;
  min: number;
  max: number;
  cycleLowZoneTop: number;
  cycleHighZoneBottom: number;
  /** Position of `currentPrice` in the range as a percentage [0, 100]. */
  currentCyclePositionPct: number;
  computedAt: string;
}

export interface CycleRangeInput {
  asset: string;
  /** Daily closes, oldest first. Should be at least 180 entries. */
  dailyCloses: readonly number[];
  currentPrice: number;
}

/**
 * Pure computation of cycle range. No DB or I/O.
 */
export function computeCycleRange(input: CycleRangeInput): CycleRange {
  const closes = input.dailyCloses.slice(-CYCLE_RANGE_LOOKBACK_DAYS);
  if (closes.length === 0) {
    throw new Error(`computeCycleRange: no daily closes provided for ${input.asset}`);
  }

  let min = Infinity;
  let max = -Infinity;
  for (const c of closes) {
    if (c < min) min = c;
    if (c > max) max = c;
  }

  const range = max - min;
  const cycleLowZoneTop = min + range * CYCLE_LOW_ZONE_TOP_FRACTION;
  const cycleHighZoneBottom = min + range * CYCLE_HIGH_ZONE_BOTTOM_FRACTION;

  const currentCyclePositionPct =
    range === 0 ? 50 : ((input.currentPrice - min) / range) * 100;

  return {
    asset: input.asset.toUpperCase(),
    min,
    max,
    cycleLowZoneTop,
    cycleHighZoneBottom,
    currentCyclePositionPct,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

/** Persist a cycle range to the `state` table (3 keys per asset). */
export async function persistCycleRange(
  range: CycleRange,
  changedBy: string,
): Promise<void> {
  const a = range.asset.toUpperCase();
  await stateWriter({
    key: `cycle_low_zone_top_${a}`,
    value: range.cycleLowZoneTop,
    changedBy,
  });
  await stateWriter({
    key: `cycle_high_zone_bottom_${a}`,
    value: range.cycleHighZoneBottom,
    changedBy,
  });
  await stateWriter({
    key: `cycle_range_computed_at_${a}`,
    value: range.computedAt,
    changedBy,
  });
}

/** Read a previously-persisted cycle range from `state`. Returns null if absent or stale. */
export async function readPersistedCycleRange(
  asset: string,
  maxAgeHours = 25,
): Promise<{
  cycleLowZoneTop: number;
  cycleHighZoneBottom: number;
  computedAt: string;
} | null> {
  const a = asset.toUpperCase();
  const [low, high, at] = await Promise.all([
    stateRead<number>(`cycle_low_zone_top_${a}`),
    stateRead<number>(`cycle_high_zone_bottom_${a}`),
    stateRead<string>(`cycle_range_computed_at_${a}`),
  ]);
  if (low == null || high == null || at == null) return null;

  const ageHours = (Date.now() - new Date(at).getTime()) / 3_600_000;
  if (ageHours > maxAgeHours) return null;

  return { cycleLowZoneTop: low, cycleHighZoneBottom: high, computedAt: at };
}
