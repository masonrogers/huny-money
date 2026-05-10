import { stateRead, stateWriter, appDecisionLogger } from "@/lib/db/utils";
import {
  evaluateBtcUnderperformance,
  type BtcUnderperformanceDecision,
  type BtcUnderperformanceInput,
} from "./circuit-breakers";
import { log } from "@/lib/logger";

/**
 * 60-day BTC underperformance gate (STRATEGY.md §4.4).
 *
 * Pure decision logic lives in `circuit-breakers.evaluateBtcUnderperformance`.
 * This wrapper:
 *   1. Calls the evaluator
 *   2. If shouldPause AND not already paused → writes trading_paused=true
 *      with a human-readable reason key the dashboard can surface
 *   3. Logs the decision to app_decisions either way
 *
 * Called from the morning brief BEFORE executeBriefDecisions so the
 * decision-executor's preflight check (which reads trading_paused) immediately
 * blocks any orders from this brief.
 *
 * Auto-resume is intentional NON-behavior: per STRATEGY.md §4.4 / §6.4 the
 * operator must explicitly decide between resume and convert-to-BTC-hold.
 * If conditions improve while paused, this function logs the improvement
 * but leaves the flag in place.
 */

const PAUSE_REASON_KEY = "trading_paused_reason";
const PAUSED_BY_GATE_KEY = "trading_paused_by_btc_underperf_gate";

export interface ApplyGateResult {
  decision: BtcUnderperformanceDecision;
  /** True iff this call newly set trading_paused=true. */
  newlyPaused: boolean;
  /** True if trading was already paused (by anything) when we ran. */
  wasAlreadyPaused: boolean;
}

export async function applyBtcUnderperformanceGate(
  input: BtcUnderperformanceInput,
  evaluationId?: string,
): Promise<ApplyGateResult> {
  const decision = evaluateBtcUnderperformance(input);
  const wasAlreadyPaused = (await stateRead<boolean>("trading_paused")) === true;

  let newlyPaused = false;

  if (decision.shouldPause && !wasAlreadyPaused) {
    const reason =
      `60-day BTC underperformance: rolling delta ${decision.delta60dPct?.toFixed(2)}% ` +
      `with ${decision.consecutiveUnderperfDays} consecutive days below BTC hold. ` +
      `Per STRATEGY.md §4.4: auto-paused. Operator must decide resume vs convert-to-BTC.`;

    await stateWriter({
      key: "trading_paused",
      value: true,
      changedBy: "risk.btc-underperformance-gate",
      relatedEvalId: evaluationId,
    });
    await stateWriter({
      key: PAUSE_REASON_KEY,
      value: reason,
      changedBy: "risk.btc-underperformance-gate",
      relatedEvalId: evaluationId,
    });
    await stateWriter({
      key: PAUSED_BY_GATE_KEY,
      value: true,
      changedBy: "risk.btc-underperformance-gate",
      relatedEvalId: evaluationId,
    });
    newlyPaused = true;

    log.error("60-DAY BTC UNDERPERFORMANCE GATE TRIPPED — auto-paused", {
      delta60dPct: decision.delta60dPct,
      consecutiveUnderperfDays: decision.consecutiveUnderperfDays,
    });
  }

  await appDecisionLogger({
    decisionType: "circuit_breaker",
    inputs: {
      breaker: "btc_underperformance",
      systemReturnPct: input.systemReturnPct,
      btcHoldReturnPct: input.btcHoldReturnPct,
      rolling30dDeltaPct: input.rolling30dDeltaPct,
      rolling60dDeltaPct: input.rolling60dDeltaPct,
      consecutiveUnderperfDays: input.consecutiveUnderperfDays,
      wasAlreadyPaused,
    },
    outputs: {
      shouldPause: decision.shouldPause,
      shouldFlag30d: decision.shouldFlag30d,
      shouldWarn30d: decision.shouldWarn30d,
      newlyPaused,
    },
    reasoning: decision.shouldPause
      ? newlyPaused
        ? "60d BTC underperformance gate tripped — trading_paused set."
        : "60d BTC underperformance gate tripped but trading was already paused."
      : decision.shouldFlag30d
        ? `30d underperformance ≥ ${5}% — next brief should address why.`
        : decision.shouldWarn30d
          ? `30d underperformance ≥ ${3}% — soft warning.`
          : "Within underperformance tolerance.",
    relatedEntity: evaluationId,
  });

  return { decision, newlyPaused, wasAlreadyPaused };
}
