import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { evaluations, errors } from "@/lib/db/schema";
import { stateRead } from "@/lib/db/utils";
import { closedAltCycleCountSinceForCurrentMode } from "@/lib/db/queries/positions";
import { mostRecentSnapshot } from "@/lib/db/queries/price_snapshots";
import { computeBenchmarkSummary } from "@/lib/orchestration/btc-benchmark";

/**
 * Phase 1 advance criteria computation per STRATEGY.md §6.3.
 *
 * Some criteria are computable from data (hypothetical P&L vs BTC, closed
 * alt cycle count, hard-violation count). Others require operator judgment
 * (regime detection accuracy in retrospective, "reasoning is coherent",
 * "no insane incidents") — those return `null` until the operator confirms
 * via the dashboard.
 *
 * Output is the set of criteria with current value + threshold + pass/fail.
 * The dashboard renders this directly. The toggle gate aggregates them.
 */

export interface CriterionResult {
  id: string;
  description: string;
  /** Current measured value (string for display flexibility). */
  currentValue: string | null;
  /** Threshold the criterion must meet. */
  threshold: string;
  /** true=pass, false=fail, null=requires operator confirmation. */
  pass: boolean | null;
  /** Operator-confirmation key in `state` (if applicable). */
  operatorKey?: string;
}

export interface Phase1CriteriaSnapshot {
  computedAt: Date;
  windowDays: number;
  results: CriterionResult[];
  /** Convenience: true if ALL criteria pass (no nulls, no fails). */
  allPass: boolean;
}

const WINDOW_DAYS = 60;

export async function computePhase1Criteria(
  now: Date = new Date(),
): Promise<Phase1CriteriaSnapshot> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600_000);
  const sinceIso = since.toISOString();

  const results: CriterionResult[] = [];

  // ── Closed alt cycle trades (≥ 2) ──────────────────────────────────
  const altClosed = await closedAltCycleCountSinceForCurrentMode(since);
  results.push({
    id: "alt_cycle_trades",
    description: "≥ 2 closed alt cycle trades with documented reasoning",
    currentValue: String(altClosed),
    threshold: "≥ 2",
    pass: altClosed >= 2,
  });

  // ── Hard guardrail violations (must be 0) ──────────────────────────
  const hardViolationsRow = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(errors)
    .where(
      sql`${errors.severity} IN ('error', 'critical')
          AND ${errors.timestamp} >= ${sinceIso}
          AND ${errors.component} ILIKE '%execution%'`,
    );
  const hardViolations = Number(hardViolationsRow[0]?.count ?? 0);
  results.push({
    id: "no_hard_violations",
    description: "Zero hard guardrail violations in the 60d window",
    currentValue: String(hardViolations),
    threshold: "= 0",
    pass: hardViolations === 0,
  });

  // ── Hypothetical P&L vs BTC (≥ 3% over 60d) ────────────────────────
  // Source of truth: btc-benchmark module reads equity snapshots from
  // system_state_history + BTC prices from price_snapshots. Returns null
  // for windows where the bot is younger than the window — no fabrication.
  const benchmark = await computeBenchmarkSummary({
    now,
    currentBtcPriceUsd: (await currentBtcPriceFromSnapshot()) ?? 0,
  });
  const delta60d = benchmark.rolling60dDeltaPct;
  results.push({
    id: "outperform_btc_3pct",
    description: "Hypothetical performance > BTC hold by ≥ 3% over 60d",
    currentValue:
      delta60d != null
        ? `${delta60d.toFixed(2)}%`
        : benchmark.startingCapitalUsd == null
          ? "no_starting_capital"
          : "insufficient_history",
    threshold: "≥ 3%",
    pass: delta60d != null ? delta60d >= 3 : null,
  });

  // ── Operator-judged criteria ───────────────────────────────────────
  results.push({
    id: "regime_accuracy_60",
    description: "Regime detection accuracy ≥ 60% in retrospective evaluation",
    currentValue: null,
    threshold: "≥ 60%",
    pass: await operatorConfirm("phase1_regime_accuracy_confirmed"),
    operatorKey: "phase1_regime_accuracy_confirmed",
  });
  results.push({
    id: "bear_exit_test",
    description: "Bear regime exits worked correctly in ≥ 1 detected/simulated downturn",
    currentValue: null,
    threshold: "operator confirms",
    pass: await operatorConfirm("phase1_bear_exit_confirmed"),
    operatorKey: "phase1_bear_exit_confirmed",
  });
  results.push({
    id: "briefs_read_coherent",
    description: "Operator has read ≥ 10 morning briefs and judged them coherent",
    currentValue: await briefCountString(sinceIso),
    threshold: "≥ 10",
    pass: await operatorConfirm("phase1_briefs_coherent_confirmed"),
    operatorKey: "phase1_briefs_coherent_confirmed",
  });
  results.push({
    id: "no_insane_incidents",
    description: "Zero 'the bot wanted to do something insane' incidents",
    currentValue: null,
    threshold: "operator confirms",
    pass: await operatorConfirm("phase1_no_insane_incidents_confirmed"),
    operatorKey: "phase1_no_insane_incidents_confirmed",
  });

  const allPass = results.every((r) => r.pass === true);

  return {
    computedAt: now,
    windowDays: WINDOW_DAYS,
    results,
    allPass,
  };
}

async function operatorConfirm(stateKey: string): Promise<boolean | null> {
  const v = await stateRead<boolean>(stateKey);
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

async function currentBtcPriceFromSnapshot(): Promise<number | null> {
  const snap = await mostRecentSnapshot();
  if (snap?.btcPrice == null) return null;
  const n = Number(snap.btcPrice);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function briefCountString(sinceIso: string): Promise<string> {
  const row = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(evaluations)
    .where(sql`${evaluations.callType} = 'morning' AND ${evaluations.timestamp} >= ${sinceIso}`);
  return String(row[0]?.count ?? 0);
}
