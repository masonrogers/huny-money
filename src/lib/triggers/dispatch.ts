import { db } from "@/lib/db";
import { wakeups } from "@/lib/db/schema";
import { errorLogger } from "@/lib/db/utils";
import { log } from "@/lib/logger";
import { markFired, type TriggerKey } from "./debounce";

/**
 * Wake-up dispatcher.
 *
 * Per STRATEGY.md §5.5 + §7.7:
 * 1. Log every wake-up event to `wakeups` (whether dispatched or suppressed)
 * 2. Check budget gate
 * 3. If allowed, call Sonnet via the runSonnetCheck flow (Phase 3)
 * 4. Mark debounce so duplicate signals within the window don't re-fire
 *
 * The Sonnet call itself happens via the AI flow module — this dispatcher
 * only handles the wake-up bookkeeping. The caller passes a
 * `runSonnet` function so this module stays decoupled from the AI flow
 * (and so tests can inject mocks).
 */

export interface WakeupSpec {
  triggerType: "position_move" | "stop_fill" | "news_keyword";
  /** Asset symbol if applicable (BTC, ETH, AERO, etc.) */
  asset?: string;
  /** Free-form payload describing what was observed. */
  observed: Record<string, unknown>;
}

export interface DispatchedWakeup {
  wakeupId: string;
  dispatched: boolean;
  suppressionReason?: string;
}

export type RunSonnetResult =
  | {
      kind: "ran";
      sonnetEvalId: string;
      escalated: boolean;
      opusEvalId?: string;
      opusActionTaken?: string;
    }
  | { kind: "suppressed"; reason: string };

export interface WakeupDispatchDeps {
  /** Caller-provided Sonnet runner. Returns the resulting evaluation id. */
  runSonnet: (ctx: WakeupSpec) => Promise<RunSonnetResult>;
}

export async function dispatchWakeup(
  spec: WakeupSpec,
  deps: WakeupDispatchDeps,
): Promise<DispatchedWakeup> {
  // 1. Log the wake-up event regardless of dispatch outcome.
  const inserted = await db
    .insert(wakeups)
    .values({
      triggerType: spec.triggerType,
      asset: spec.asset ?? null,
      observedValue: spec.observed as Record<string, unknown>,
      dispatched: false, // updated below
    })
    .returning({ id: wakeups.id });
  const wakeupId = inserted[0]!.id;

  // 2. Mark debounce (do this BEFORE the Sonnet call so a slow API doesn't
  //    let a duplicate event leak through).
  if (spec.triggerType === "position_move" && spec.asset) {
    await markFired("position_move", spec.asset);
  } else if (spec.triggerType === "news_keyword" && spec.asset) {
    // For news_keyword, "asset" is actually the matched keyword.
    await markFired("news_keyword", spec.asset);
  }
  // stop_fill has no debounce per §5.5.

  // 3. Call Sonnet (or skip if blocked).
  let result: Awaited<ReturnType<WakeupDispatchDeps["runSonnet"]>>;
  try {
    result = await deps.runSonnet(spec);
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "triggers.dispatch",
      error: err instanceof Error ? err : new Error(String(err)),
      context: { wakeupId, spec },
      recovered: false,
    });
    await db
      .update(wakeups)
      .set({
        dispatched: false,
        suppressionReason: "sonnet_call_failed",
      })
      .where(sqlIdEq(wakeupId));
    return { wakeupId, dispatched: false, suppressionReason: "sonnet_call_failed" };
  }

  if (result.kind === "suppressed") {
    await db
      .update(wakeups)
      .set({ dispatched: false, suppressionReason: result.reason })
      .where(sqlIdEq(wakeupId));
    log.info("Wake-up suppressed", { wakeupId, reason: result.reason, spec });
    return { wakeupId, dispatched: false, suppressionReason: result.reason };
  }

  // result.kind === "ran"
  await db
    .update(wakeups)
    .set({
      dispatched: true,
      sonnetEvalId: result.sonnetEvalId,
      escalatedToOpus: result.escalated,
      opusEvalId: result.opusEvalId ?? null,
      opusActionTaken: result.opusActionTaken ?? null,
    })
    .where(sqlIdEq(wakeupId));

  log.info("Wake-up dispatched", {
    wakeupId,
    triggerType: spec.triggerType,
    escalated: result.escalated,
  });

  return { wakeupId, dispatched: true };
}

// Tiny helper so the dispatch module doesn't need a separate query helper
// just for one-off updates by id. Drizzle's eq is the right tool but the
// import is shared via a small wrapper to keep this file readable.
import { eq } from "drizzle-orm";
function sqlIdEq(id: string) {
  return eq(wakeups.id, id);
}

export type { TriggerKey };
