import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiSpend } from "@/lib/db/schema";
import { monthKey, monthlySpendUsd } from "@/lib/db/queries/api_spend";
import { appDecisionLogger } from "@/lib/db/utils";
import { log } from "@/lib/logger";
import {
  MAX_OPUS_CALLS_PER_DAY,
  MAX_OPUS_CALLS_PER_MONTH,
  MAX_SONNET_SCHEDULED_PER_DAY,
  MAX_SONNET_WAKEUPS_PER_DAY,
  MAX_SONNET_WAKEUPS_PER_MONTH,
  MONTHLY_BUDGET_USD,
  PRE_CALL_ESTIMATE_USD,
  VARIANCE_BUFFER,
} from "./pricing";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CallType =
  | "morning"
  | "sonnet_check"
  | "opus_escalation"
  | "emergency"
  | "review"
  | "post_restart";

export type WakeupContext = {
  isWakeupCall: boolean; // true if this Sonnet check was triggered by a wake-up event (vs scheduled)
};

export type BudgetDecision =
  | { allowed: true; reason: "ok"; mtdSpend: number; estimatedCost: number }
  | { allowed: false; reason: BudgetBlockReason; mtdSpend: number; estimatedCost: number };

export type BudgetBlockReason =
  | "monthly_cap"
  | "opus_daily_cap"
  | "opus_monthly_cap"
  | "sonnet_scheduled_daily_cap"
  | "sonnet_wakeup_daily_cap"
  | "sonnet_wakeup_monthly_cap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfMonthUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

async function countCallsSince(model: "claude-opus-4-7" | "claude-sonnet-4-6", since: Date) {
  const rows = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(apiSpend)
    .where(sql`${apiSpend.model} = ${model} AND ${apiSpend.timestamp} >= ${since.toISOString()}`);
  return Number(rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Pre-call budget gate. Every Anthropic API call MUST be preceded by this.
 *
 * The morning Opus brief is NEVER blocked, regardless of monthly cap. If the
 * cap would be exceeded, we still allow the call but emit a critical log so
 * the operator is alerted.
 *
 * All decisions log to `app_decisions` with the inputs (MTD spend, daily counts)
 * and the outputs (allowed + reason). The dashboard surfaces these so the
 * operator can answer "why was this call blocked?"
 */
export async function budgetGate(
  callType: CallType,
  context: WakeupContext = { isWakeupCall: false },
): Promise<BudgetDecision> {
  const month = monthKey();
  const mtdSpend = await monthlySpendUsd(month);
  const estimate = (PRE_CALL_ESTIMATE_USD[callType] ?? 0.5) * VARIANCE_BUFFER;

  const isOpus =
    callType === "morning" ||
    callType === "opus_escalation" ||
    callType === "emergency" ||
    callType === "review" ||
    callType === "post_restart";
  const isSonnet = callType === "sonnet_check";

  // ── Morning Opus brief: always allowed ──
  if (callType === "morning") {
    if (mtdSpend + estimate > MONTHLY_BUDGET_USD) {
      log.error("Morning Opus brief running past monthly budget cap", {
        mtdSpend,
        estimatedCost: estimate,
        cap: MONTHLY_BUDGET_USD,
      });
    }
    return await record(callType, true, "ok", mtdSpend, estimate, context);
  }

  // ── Monthly $ cap (applies to all non-morning calls) ──
  if (mtdSpend + estimate > MONTHLY_BUDGET_USD) {
    return await record(callType, false, "monthly_cap", mtdSpend, estimate, context);
  }

  // ── Per-model daily and monthly caps ──
  if (isOpus) {
    const monthStart = startOfMonthUtc();
    const monthlyCount = await countCallsSince("claude-opus-4-7", monthStart);
    if (monthlyCount >= MAX_OPUS_CALLS_PER_MONTH) {
      return await record(callType, false, "opus_monthly_cap", mtdSpend, estimate, context);
    }

    const dayStart = startOfTodayUtc();
    const dailyCount = await countCallsSince("claude-opus-4-7", dayStart);
    if (dailyCount >= MAX_OPUS_CALLS_PER_DAY) {
      return await record(callType, false, "opus_daily_cap", mtdSpend, estimate, context);
    }
  }

  if (isSonnet) {
    const monthStart = startOfMonthUtc();
    const dayStart = startOfTodayUtc();
    if (context.isWakeupCall) {
      const monthlyWakeups = await countSonnetWakeupsSince(monthStart);
      if (monthlyWakeups >= MAX_SONNET_WAKEUPS_PER_MONTH) {
        return await record(
          callType,
          false,
          "sonnet_wakeup_monthly_cap",
          mtdSpend,
          estimate,
          context,
        );
      }
      const dailyWakeups = await countSonnetWakeupsSince(dayStart);
      if (dailyWakeups >= MAX_SONNET_WAKEUPS_PER_DAY) {
        return await record(
          callType,
          false,
          "sonnet_wakeup_daily_cap",
          mtdSpend,
          estimate,
          context,
        );
      }
    } else {
      // Scheduled Sonnet check (06:00 / 22:00 UTC).
      const dailyScheduled = await countSonnetScheduledSince(dayStart);
      if (dailyScheduled >= MAX_SONNET_SCHEDULED_PER_DAY) {
        return await record(
          callType,
          false,
          "sonnet_scheduled_daily_cap",
          mtdSpend,
          estimate,
          context,
        );
      }
    }
  }

  return await record(callType, true, "ok", mtdSpend, estimate, context);
}

// ---------------------------------------------------------------------------
// Sonnet wake-up vs scheduled differentiation
// ---------------------------------------------------------------------------

// Wake-up Sonnet calls are tagged via the api_spend.callType (still
// "sonnet_check") plus the related evaluation's trigger_source. Counting them
// requires joining api_spend → evaluations. We use a single SQL CTE.

async function countSonnetWakeupsSince(since: Date): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM api_spend a
    JOIN evaluations e ON e.id = a.related_eval_id
    WHERE a.model = 'claude-sonnet-4-6'
      AND a.timestamp >= ${since.toISOString()}
      AND e.trigger_source IN ('wakeup_position_move', 'wakeup_stop_fill', 'wakeup_news')
  `);
  return Number(((rows as unknown[])[0] as { count: number })?.count ?? 0);
}

async function countSonnetScheduledSince(since: Date): Promise<number> {
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM api_spend a
    JOIN evaluations e ON e.id = a.related_eval_id
    WHERE a.model = 'claude-sonnet-4-6'
      AND a.timestamp >= ${since.toISOString()}
      AND e.trigger_source = 'scheduled'
  `);
  return Number(((rows as unknown[])[0] as { count: number })?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Decision recording
// ---------------------------------------------------------------------------

async function record(
  callType: CallType,
  allowed: boolean,
  reason: "ok" | BudgetBlockReason,
  mtdSpend: number,
  estimatedCost: number,
  context: WakeupContext,
): Promise<BudgetDecision> {
  const reasoning = allowed
    ? `Allowed ${callType} call: MTD $${mtdSpend.toFixed(4)} + estimate $${estimatedCost.toFixed(4)} ≤ cap $${MONTHLY_BUDGET_USD}`
    : `Blocked ${callType} call: ${reason} (MTD $${mtdSpend.toFixed(4)}, estimate $${estimatedCost.toFixed(4)}, cap $${MONTHLY_BUDGET_USD})`;

  await appDecisionLogger({
    decisionType: "budget_gate",
    inputs: {
      callType,
      mtdSpend,
      estimatedCost,
      monthlyCap: MONTHLY_BUDGET_USD,
      isWakeupCall: context.isWakeupCall,
    },
    outputs: { allowed, reason },
    reasoning,
  });

  if (allowed) {
    return { allowed: true, reason: "ok", mtdSpend, estimatedCost };
  }
  return { allowed: false, reason: reason as BudgetBlockReason, mtdSpend, estimatedCost };
}
