import { stateWriter, stateRead, appDecisionLogger } from "@/lib/db/utils";
import { openPositionsAllModes } from "@/lib/db/queries/positions";
import { pendingOrdersAllModes } from "@/lib/db/queries/orders";
import { log } from "@/lib/logger";

/**
 * Mode transition safety per STRATEGY.md §13.5.
 *
 * The toggle from paper → live (or live → paper) is gated by these
 * preconditions, ENFORCED SERVER-SIDE. After a successful toggle, the new
 * value is written to `state.paper_mode` AND `state.mode_change_pending`
 * is set to true. The dashboard surfaces "RESTART REQUIRED" prominently
 * and ALL order placement is blocked from this moment until the next boot.
 *
 * The actual mode-change effect happens at boot when the factory reads
 * `state.paper_mode`. Until restart, the in-process executor object remains
 * the previous mode (per §13.4: "the executor IS the mode").
 */

// openPositionsAllModes (from positions.ts) and pendingOrdersAllModes (from
// orders.ts) are the only sanctioned cross-mode reads — they exist precisely
// for this kind of pre-transition safety check.

export type TransitionTarget = "paper" | "live";

export type TransitionRejectionReason =
  | "open_paper_positions"
  | "open_live_positions"
  | "pending_orders"
  | "phase1_criteria_not_met"
  | "missing_typed_phrase"
  | "wrong_typed_phrase"
  | "current_mode_already_target";

export type TransitionResult =
  | { ok: true }
  | { ok: false; reason: TransitionRejectionReason; details?: string };

export interface TransitionAttempt {
  target: TransitionTarget;
  /** Operator-typed confirmation phrase, e.g. "transition to live trading". */
  typedPhrase: string;
  /** True if Phase 1 advance criteria currently pass (caller computes this). */
  phase1CriteriaPass?: boolean;
  /** Operator identifier for the audit log (currently single user, but logged). */
  operatorId?: string;
}

const REQUIRED_PHRASE: Record<TransitionTarget, string> = {
  live: "transition to live trading",
  paper: "transition to paper trading",
};

export async function attemptModeTransition(req: TransitionAttempt): Promise<TransitionResult> {
  const currentMode = ((await stateRead<boolean>("paper_mode")) ?? true) ? "paper" : "live";

  if (currentMode === req.target) {
    return reject(req, "current_mode_already_target", `Already in ${req.target} mode`);
  }

  // Typed phrase
  if (!req.typedPhrase || req.typedPhrase.trim().length === 0) {
    return reject(req, "missing_typed_phrase");
  }
  if (req.typedPhrase.trim().toLowerCase() !== REQUIRED_PHRASE[req.target]) {
    return reject(
      req,
      "wrong_typed_phrase",
      `Expected '${REQUIRED_PHRASE[req.target]}', got '${req.typedPhrase}'`,
    );
  }

  // No open positions in EITHER mode (per §13.5)
  const openAll = await openPositionsAllModes();
  const paperOpen = openAll.filter((p) => p.paperMode).length;
  const liveOpen = openAll.filter((p) => !p.paperMode).length;
  if (paperOpen > 0) {
    return reject(req, "open_paper_positions", `${paperOpen} open paper position(s)`);
  }
  if (liveOpen > 0) {
    return reject(req, "open_live_positions", `${liveOpen} open live position(s)`);
  }

  // No pending orders in either mode
  const pending = await pendingOrdersAllModes();
  if (pending.length > 0) {
    return reject(req, "pending_orders", `${pending.length} pending order(s)`);
  }

  // For paper → live: Phase 1 criteria must pass
  if (req.target === "live" && req.phase1CriteriaPass === false) {
    return reject(req, "phase1_criteria_not_met");
  }

  // All preconditions met — write the new value AND set the pending flag.
  await stateWriter({
    key: "paper_mode",
    value: req.target === "paper",
    changedBy: `mode-transition (operator=${req.operatorId ?? "default"})`,
  });
  await stateWriter({
    key: "mode_change_pending",
    value: true,
    changedBy: `mode-transition (operator=${req.operatorId ?? "default"})`,
  });

  log.warn("MODE TRANSITION SCHEDULED — restart required", {
    from: currentMode,
    to: req.target,
    operator: req.operatorId,
  });

  await appDecisionLogger({
    decisionType: "phase_gate",
    inputs: {
      currentMode,
      target: req.target,
      typedPhraseAccepted: true,
      operator: req.operatorId,
    },
    outputs: {
      transitionScheduled: true,
      restartRequired: true,
    },
    reasoning: `Operator confirmed transition from ${currentMode} to ${req.target}. Toggle takes effect on next boot.`,
  });

  return { ok: true };
}

async function reject(
  req: TransitionAttempt,
  reason: TransitionRejectionReason,
  details?: string,
): Promise<TransitionResult> {
  await appDecisionLogger({
    decisionType: "phase_gate",
    inputs: {
      target: req.target,
      typedPhrase: req.typedPhrase ? "<present>" : "<missing>",
      phase1CriteriaPass: req.phase1CriteriaPass,
      operator: req.operatorId,
    },
    outputs: { transitionScheduled: false, reason },
    reasoning: `Mode transition rejected: ${reason}${details ? ` — ${details}` : ""}`,
  });
  return { ok: false, reason, details };
}

/**
 * Called at boot AFTER the factory has constructed the executor. Clears
 * the pending flag so the dashboard knows the change has taken effect.
 */
export async function clearModeChangePendingFlag(): Promise<void> {
  const pending = await stateRead<boolean>("mode_change_pending");
  if (pending) {
    await stateWriter({
      key: "mode_change_pending",
      value: false,
      changedBy: "boot.factory.clearModeChangePending",
    });
  }
}
