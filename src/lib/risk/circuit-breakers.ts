import { stateRead, stateWriter, appDecisionLogger } from "@/lib/db/utils";
import {
  closedPositionsForCurrentMode,
  recentClosedAltCyclesForCurrentMode,
} from "@/lib/db/queries/positions";
import { log } from "@/lib/logger";
import {
  HARD_FLOOR_USD,
  SOFT_BREAKER_DRAWDOWN_PCT,
  SOFT_BREAKER_RECOVERY_PCT,
  DAILY_LOSS_CAP_PCT,
  COOLDOWN_DAYS_AFTER_2_LOSSES,
  BTC_UNDERPERFORMANCE_PAUSE_DAYS,
  BTC_UNDERPERFORMANCE_FAIL_PCT,
  BTC_UNDERPERFORMANCE_WARN_PCT,
} from "@/lib/strategy/constants";

/**
 * Circuit breakers per STRATEGY.md §4.
 *
 * Each function is a pure decision: takes the current account state, returns
 * whether the breaker is tripped + reasoning. Persistence (setting the
 * trading_paused flag, halting the bot) is the orchestrator's responsibility
 * — these functions just compute decisions.
 *
 * All decisions log to `app_decisions` so the dashboard can surface them.
 */

// ---------------------------------------------------------------------------
// Hard floor ($300)
// ---------------------------------------------------------------------------

export interface HardFloorDecision {
  halted: boolean;
  currentValueUsd: number;
  floorUsd: number;
  reasoning: string;
}

export async function checkHardFloor(currentValueUsd: number): Promise<HardFloorDecision> {
  const halted = currentValueUsd <= HARD_FLOOR_USD;
  const reasoning = halted
    ? `Account at $${currentValueUsd.toFixed(2)} ≤ hard floor $${HARD_FLOOR_USD}. HALT.`
    : `Account at $${currentValueUsd.toFixed(2)} > hard floor $${HARD_FLOOR_USD}.`;

  await appDecisionLogger({
    decisionType: "circuit_breaker",
    inputs: { breaker: "hard_floor", currentValueUsd, floorUsd: HARD_FLOOR_USD },
    outputs: { halted },
    reasoning,
  });

  if (halted) {
    log.error("HARD CIRCUIT BREAKER TRIGGERED — halting trading", {
      currentValueUsd,
      floorUsd: HARD_FLOOR_USD,
    });
  }

  return { halted, currentValueUsd, floorUsd: HARD_FLOOR_USD, reasoning };
}

// ---------------------------------------------------------------------------
// Soft breaker (20% drawdown from peak)
// ---------------------------------------------------------------------------

export interface SoftBreakerDecision {
  /** True if the soft breaker SHOULD be active given current values. */
  shouldBeActive: boolean;
  drawdownPct: number;
  /** Whether the account has recovered to within 10% of peak (clears the breaker). */
  recovered: boolean;
}

export function evaluateSoftBreaker(
  currentValueUsd: number,
  peakValueUsd: number,
  currentlyActive: boolean,
): SoftBreakerDecision {
  const drawdownPct =
    peakValueUsd > 0 ? ((peakValueUsd - currentValueUsd) / peakValueUsd) * 100 : 0;

  if (currentlyActive) {
    // Hysteresis: stays active until within 10% of peak
    const recovered = drawdownPct <= SOFT_BREAKER_RECOVERY_PCT;
    return {
      shouldBeActive: !recovered,
      drawdownPct,
      recovered,
    };
  }

  // Not currently active: trip if drawdown ≥ 20%
  return {
    shouldBeActive: drawdownPct >= SOFT_BREAKER_DRAWDOWN_PCT,
    drawdownPct,
    recovered: false,
  };
}

// ---------------------------------------------------------------------------
// Daily loss cap (4% rolling 24h)
// ---------------------------------------------------------------------------

export interface DailyLossCapDecision {
  blocked: boolean;
  realizedLossPct: number;
  capPct: number;
}

/**
 * Computes realized loss in the rolling 24-hour window from `positions`
 * table closed trades. Per STRATEGY.md §4.1 — restart-proof by design
 * (computed on demand, no in-memory counter).
 */
export async function checkDailyLossCap(accountValueUsd: number): Promise<DailyLossCapDecision> {
  const since = new Date(Date.now() - 24 * 3600_000);
  // Only the current mode's closed trades count.
  const recentCloses = await closedPositionsForCurrentMode(100);
  const within24h = recentCloses.filter((p) => p.exitTime != null && p.exitTime >= since);

  let realizedLossUsd = 0;
  for (const p of within24h) {
    const pnl = p.netPnlUsd != null ? parseFloat(p.netPnlUsd) : 0;
    if (pnl < 0) realizedLossUsd += -pnl; // sum of losses (positive number)
  }

  const realizedLossPct = accountValueUsd > 0 ? (realizedLossUsd / accountValueUsd) * 100 : 0;
  const blocked = realizedLossPct >= DAILY_LOSS_CAP_PCT;

  await appDecisionLogger({
    decisionType: "circuit_breaker",
    inputs: {
      breaker: "daily_loss_cap",
      realizedLossUsd,
      accountValueUsd,
      windowSinceIso: since.toISOString(),
      tradesIn24h: within24h.length,
    },
    outputs: { blocked, realizedLossPct, capPct: DAILY_LOSS_CAP_PCT },
    reasoning: blocked
      ? `Realized loss ${realizedLossPct.toFixed(2)}% in 24h ≥ cap ${DAILY_LOSS_CAP_PCT}%. New entries blocked until next day.`
      : `Realized loss ${realizedLossPct.toFixed(2)}% in 24h < cap ${DAILY_LOSS_CAP_PCT}%. Entries allowed.`,
  });

  return { blocked, realizedLossPct, capPct: DAILY_LOSS_CAP_PCT };
}

// ---------------------------------------------------------------------------
// Cooldown after 2 consecutive alt cycle losses
// ---------------------------------------------------------------------------

export interface CooldownDecision {
  active: boolean;
  cooldownUntil: Date | null;
  reason: string;
}

/**
 * Per STRATEGY.md §4.3: 2 consecutive losing alt cycles → 14-day block on
 * new alt entries. BTC core management is unaffected.
 *
 * Computed from the last 2 closed alt_cycle positions in the current mode.
 */
export async function checkAltCooldown(): Promise<CooldownDecision> {
  const rows = await recentClosedAltCyclesForCurrentMode(2);

  if (rows.length < 2) {
    return { active: false, cooldownUntil: null, reason: "fewer than 2 closed alt cycles" };
  }

  const losses = rows.filter((p) => p.netPnlUsd != null && parseFloat(p.netPnlUsd) < 0);
  if (losses.length < 2) {
    return {
      active: false,
      cooldownUntil: null,
      reason: "last 2 alt cycles not both losers",
    };
  }

  const mostRecentLossExitTime = rows[0]!.exitTime;
  if (!mostRecentLossExitTime) {
    return { active: false, cooldownUntil: null, reason: "missing exit time on most recent loss" };
  }

  const cooldownUntil = new Date(
    mostRecentLossExitTime.getTime() + COOLDOWN_DAYS_AFTER_2_LOSSES * 24 * 3600_000,
  );
  const active = cooldownUntil.getTime() > Date.now();

  // Persist for fast read (the morning brief reads `state.cooldown_until`).
  if (active) {
    await stateWriter({
      key: "cooldown_until",
      value: cooldownUntil.toISOString(),
      changedBy: "risk.checkAltCooldown",
    });
  } else {
    const existing = await stateRead<string>("cooldown_until");
    if (existing != null) {
      await stateWriter({
        key: "cooldown_until",
        value: null,
        changedBy: "risk.checkAltCooldown.expired",
      });
    }
  }

  return {
    active,
    cooldownUntil,
    reason: active
      ? `2 consecutive alt-cycle losses; cooldown until ${cooldownUntil.toISOString()}`
      : `2 consecutive alt-cycle losses but cooldown window has expired`,
  };
}

// ---------------------------------------------------------------------------
// 60-day BTC underperformance gate
// ---------------------------------------------------------------------------

export interface BtcUnderperformanceDecision {
  /** Bot pauses active trading and presents operator with restart-vs-convert decision. */
  shouldPause: boolean;
  /** Underperformance ≥ 5% in 30d → next morning brief must address why. */
  shouldFlag30d: boolean;
  /** Underperformance ≥ 3% in 30d → soft warning. */
  shouldWarn30d: boolean;
  delta30dPct: number | null;
  delta60dPct: number | null;
  consecutiveUnderperfDays: number;
}

export interface BtcUnderperformanceInput {
  /** System return % cumulative since inception. */
  systemReturnPct: number;
  /** BTC hold return % cumulative since inception. */
  btcHoldReturnPct: number;
  /** Rolling deltas (system − btc) for 30d and 60d windows. May be null if insufficient history. */
  rolling30dDeltaPct: number | null;
  rolling60dDeltaPct: number | null;
  /** Number of consecutive days the system has been below BTC hold. */
  consecutiveUnderperfDays: number;
}

export function evaluateBtcUnderperformance(
  input: BtcUnderperformanceInput,
): BtcUnderperformanceDecision {
  // Stricter rule: 60-day rolling delta < 0 AND consecutive days ≥ 60.
  const shouldPause =
    input.rolling60dDeltaPct != null &&
    input.rolling60dDeltaPct < 0 &&
    input.consecutiveUnderperfDays >= BTC_UNDERPERFORMANCE_PAUSE_DAYS;

  const flag30 =
    input.rolling30dDeltaPct != null &&
    input.rolling30dDeltaPct <= -BTC_UNDERPERFORMANCE_FAIL_PCT;

  const warn30 =
    input.rolling30dDeltaPct != null &&
    input.rolling30dDeltaPct <= -BTC_UNDERPERFORMANCE_WARN_PCT;

  return {
    shouldPause,
    shouldFlag30d: flag30,
    shouldWarn30d: warn30,
    delta30dPct: input.rolling30dDeltaPct,
    delta60dPct: input.rolling60dDeltaPct,
    consecutiveUnderperfDays: input.consecutiveUnderperfDays,
  };
}
