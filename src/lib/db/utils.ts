import { eq } from "drizzle-orm";
import { db } from "./index";
import {
  state,
  systemStateHistory,
  appDecisions,
  priceSnapshots,
  errors,
} from "./schema";
import type {
  NewAppDecisionRow,
  NewPriceSnapshotRow,
  NewErrorRow,
  NewSystemStateHistoryRow,
} from "./schema";
import { redact } from "@/lib/utils/redact";
import { log } from "@/lib/logger";

// ---------------------------------------------------------------------------
// state_writer
// ---------------------------------------------------------------------------

type StateWriterInput = {
  key: string;
  value: unknown;
  changedBy: string;
  relatedEvalId?: string;
};

/**
 * Writes a value to the `state` table AND a corresponding row to
 * `system_state_history` in the SAME transaction. This is the only sanctioned
 * way to mutate `state` — direct upserts elsewhere are rejected by the CI
 * lint rule.
 *
 * Why atomic: a crash between the two writes would produce phantom audit
 * entries OR untracked state changes, both of which would corrupt the
 * "what was true at time T?" query that the dashboard depends on.
 *
 * Returns the previous value (null if first-time write) so callers can
 * decide whether to act on the change.
 */
export async function stateWriter(input: StateWriterInput): Promise<unknown | null> {
  const newValueJson = input.value as NewSystemStateHistoryRow["newValue"];

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ value: state.value })
      .from(state)
      .where(eq(state.key, input.key))
      .limit(1);

    const oldValue = existing[0]?.value ?? null;

    if (existing.length === 0) {
      await tx.insert(state).values({
        key: input.key,
        value: newValueJson,
      });
    } else {
      await tx
        .update(state)
        .set({ value: newValueJson, updatedAt: new Date() })
        .where(eq(state.key, input.key));
    }

    await tx.insert(systemStateHistory).values({
      key: input.key,
      oldValue: oldValue as NewSystemStateHistoryRow["oldValue"],
      newValue: newValueJson,
      changedBy: input.changedBy,
      relatedEvalId: input.relatedEvalId ?? null,
    });

    return oldValue;
  });
}

/** Read a single state value. Returns null if not set. */
export async function stateRead<T = unknown>(key: string): Promise<T | null> {
  const rows = await db
    .select({ value: state.value })
    .from(state)
    .where(eq(state.key, key))
    .limit(1);
  return (rows[0]?.value as T | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// app_decision_logger
// ---------------------------------------------------------------------------

type AppDecisionInput = {
  decisionType: NewAppDecisionRow["decisionType"];
  inputs: unknown;
  outputs: unknown;
  reasoning: string;
  relatedEntity?: string;
};

/**
 * Logs an app-level decision (budget gate, model route, debounce check,
 * escalation dispatch, reconciliation action, circuit breaker, phase gate,
 * cooldown). The dashboard surfaces this stream so the operator can answer
 * any "why did the bot do/not do X?" question without log diving.
 *
 * inputs/outputs go through redact() before persistence.
 */
export async function appDecisionLogger(input: AppDecisionInput): Promise<string> {
  const inserted = await db
    .insert(appDecisions)
    .values({
      decisionType: input.decisionType,
      inputs: redact(input.inputs) as NewAppDecisionRow["inputs"],
      outputs: redact(input.outputs) as NewAppDecisionRow["outputs"],
      reasoning: input.reasoning,
      relatedEntity: input.relatedEntity ?? null,
    })
    .returning({ id: appDecisions.id });
  return inserted[0]!.id;
}

// ---------------------------------------------------------------------------
// price_snapshot_writer
// ---------------------------------------------------------------------------

type PriceSnapshotInput = {
  triggerEvent: NewPriceSnapshotRow["triggerEvent"];
  relatedEntity?: string;
  btcPrice?: string | number | null;
  ethPrice?: string | number | null;
  solPrice?: string | number | null;
  btcDominance?: string | number | null;
  fearGreed?: number | null;
};

/**
 * Writes a market state snapshot. Caller provides the prices (Phase 2's
 * Coinbase wrapper supplies them in production). Used at every meaningful
 * decision point so the dashboard can replay context.
 */
export async function priceSnapshotWriter(input: PriceSnapshotInput): Promise<string> {
  const toNumeric = (v: string | number | null | undefined): string | null => {
    if (v === null || v === undefined) return null;
    return typeof v === "number" ? v.toString() : v;
  };

  const inserted = await db
    .insert(priceSnapshots)
    .values({
      triggerEvent: input.triggerEvent,
      relatedEntity: input.relatedEntity ?? null,
      btcPrice: toNumeric(input.btcPrice),
      ethPrice: toNumeric(input.ethPrice),
      solPrice: toNumeric(input.solPrice),
      btcDominance: toNumeric(input.btcDominance),
      fearGreed: input.fearGreed ?? null,
    })
    .returning({ id: priceSnapshots.id });
  return inserted[0]!.id;
}

// ---------------------------------------------------------------------------
// error_logger
// ---------------------------------------------------------------------------

type ErrorLoggerInput = {
  severity: NewErrorRow["severity"];
  component: string;
  error: Error | { name?: string; message: string; stack?: string };
  context?: Record<string, unknown>;
  recovered: boolean;
  recoveryAction?: string;
};

/**
 * Persists a caught exception, retry, or recovery to the `errors` table AND
 * emits a structured log line. Both paths run through redact() so credentials
 * never reach storage or logs.
 *
 * Severity guidance (from STRATEGY.md §7.9):
 * - info: routine recoverable conditions (retry succeeded on attempt 2)
 * - warning: anomalous but didn't break (Sonnet response missing optional field)
 * - error: a single op failed but the system continued
 * - critical: system halted or entered degraded mode
 */
export async function errorLogger(input: ErrorLoggerInput): Promise<string> {
  const errorClass = input.error.name ?? "UnknownError";
  const message = input.error.message ?? String(input.error);
  const traceback = input.error.stack ?? null;
  const safeContext = input.context ? (redact(input.context) as NewErrorRow["context"]) : null;
  const safeMessage = redact(message);
  const safeTraceback = traceback ? redact(traceback) : null;

  const inserted = await db
    .insert(errors)
    .values({
      severity: input.severity,
      component: input.component,
      errorClass,
      message: safeMessage,
      traceback: safeTraceback,
      context: safeContext,
      recovered: input.recovered,
      recoveryAction: input.recoveryAction ?? null,
    })
    .returning({ id: errors.id });

  // Also emit to structured logs so live observers see it immediately.
  const logFn =
    input.severity === "critical" || input.severity === "error"
      ? log.error
      : input.severity === "warning"
        ? log.warn
        : log.info;
  logFn(`[${input.component}] ${errorClass}: ${safeMessage}`, {
    severity: input.severity,
    recovered: input.recovered,
    recoveryAction: input.recoveryAction,
    context: safeContext as Record<string, unknown> | null,
  });

  return inserted[0]!.id;
}
