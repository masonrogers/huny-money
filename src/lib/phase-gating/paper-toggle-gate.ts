import { computePhase1Criteria } from "./phase1-criteria";

/**
 * Paper-mode toggle gate per STRATEGY.md §6.3.
 *
 * The toggle from paper → live is REJECTED if Phase 1 advance criteria are
 * not currently met. Operator can override with explicit confirmation, but
 * the rejection is the default.
 *
 * This module produces the gate decision; the actual mode-flip happens via
 * `attemptModeTransition` in src/lib/execution/mode-transition.ts. That
 * function calls into here for `phase1CriteriaPass`.
 */

export interface PaperToggleGateDecision {
  pass: boolean;
  failingCriteriaIds: string[];
  pendingCriteriaIds: string[];
  reasoning: string;
}

export async function evaluatePaperToggleGate(): Promise<PaperToggleGateDecision> {
  const snapshot = await computePhase1Criteria();

  const failing = snapshot.results.filter((r) => r.pass === false).map((r) => r.id);
  const pending = snapshot.results.filter((r) => r.pass === null).map((r) => r.id);
  const pass = failing.length === 0 && pending.length === 0;

  return {
    pass,
    failingCriteriaIds: failing,
    pendingCriteriaIds: pending,
    reasoning: pass
      ? "All Phase 1 criteria pass. Paper → live transition allowed (still requires typed-phrase confirmation)."
      : `Phase 1 criteria ${failing.length > 0 ? `failing: ${failing.join(", ")}` : ""}${
          failing.length > 0 && pending.length > 0 ? "; " : ""
        }${pending.length > 0 ? `pending operator confirmation: ${pending.join(", ")}` : ""}.`,
  };
}
