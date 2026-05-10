import { evaluationsByCallTypeSince } from "@/lib/db/queries/evaluations";
import { activeTriggersAt } from "@/lib/db/queries/triggers";
import {
  appDecisionsByTypeSince,
  appDecisionsForEntity,
} from "@/lib/db/queries/app_decisions";
import { safeDashboardHandler } from "@/lib/api/safe-handler";
import type { MorningBrief } from "@/lib/ai/schemas";

export interface ExecutionAction {
  asset: string;
  kind: "alt_entry" | "btc_core" | "alt_position";
  /** For alt_position rows: which sub-action (trail_stop / partial_sell / exit). */
  subAction?: "trail_stop" | "partial_sell" | "exit";
  /** Plain-English summary written by decision-executor's reasoning field. */
  reasoning: string;
  /** USD notional of the order (entry size, BTC core delta, or sell value). */
  sizeUsd: number | null;
  price: number | null;
}

export interface TodayPayload {
  brief: MorningBrief | null;
  briefAt: string | null;
  /** Orders the bot actually placed for the latest brief. */
  executionActions: ExecutionAction[];
  activeTriggers: Array<{
    id: string;
    triggerId: string;
    asset: string | null;
    conditionText: string;
    rationale: string | null;
    urgency: "immediate" | "next_check";
    timesEvaluated: number;
    timesFired: number;
    activeUntil: string;
  }>;
  dbReady: boolean;
}

export async function GET() {
  return safeDashboardHandler<TodayPayload>(
    "api.dashboard.today",
    {
      brief: null,
      briefAt: null,
      executionActions: [],
      activeTriggers: [],
      dbReady: false,
    },
    async () => {
      const since = new Date(Date.now() - 36 * 3600 * 1000);
      const briefs = await evaluationsByCallTypeSince("morning", since);
      const latest = briefs[0]; // sorted desc

      const triggers = await activeTriggersAt(new Date());

      // Pull the order_routing decisions logged by decision-executor for this
      // brief's evaluation id. Each row carries the asset (in inputs) and a
      // plain-English reasoning line.
      // Collect order_routing decisions for both the brief itself (alt entries
      // + BTC core, related_entity = evaluation_id) AND for each open alt
      // position (alt position actions, related_entity = position_id).
      const executionActions: ExecutionAction[] = [];
      if (latest) {
        const briefDecisions = await appDecisionsForEntity(latest.id);
        for (const d of briefDecisions) {
          if (d.decisionType !== "order_routing") continue;
          const a = parseExecutionAction(d.inputs, d.outputs, d.reasoning);
          if (a) executionActions.push(a);
        }
        // Alt position actions log against the position id, but their inputs
        // include evaluationId. Find them by scanning recent app_decisions.
        // Lazily: rely on the morning brief's eval id appearing in inputs.
        const allRecent = await appDecisionsByTypeSince(
          "order_routing",
          new Date(Date.now() - 36 * 3600_000),
        );
        for (const d of allRecent) {
          const inputs = d.inputs as Record<string, unknown> | null;
          if (inputs?.evaluationId !== latest.id) continue;
          if (d.relatedEntity === latest.id) continue; // already captured above
          const a = parseExecutionAction(d.inputs, d.outputs, d.reasoning);
          if (a) executionActions.push(a);
        }
      }

      return {
        brief: (latest?.parsedResponse as MorningBrief | null) ?? null,
        briefAt: latest?.timestamp.toISOString() ?? null,
        executionActions,
        activeTriggers: triggers.map((t) => ({
          id: t.id,
          triggerId: t.triggerId,
          asset: t.asset,
          conditionText: t.conditionText,
          rationale: t.rationale,
          urgency: t.urgency,
          timesEvaluated: t.timesEvaluated,
          timesFired: t.timesFired,
          activeUntil: t.activeUntil.toISOString(),
        })),
        dbReady: true,
      };
    },
  );
}

/**
 * Parse an order_routing app_decision row into the dashboard's ExecutionAction
 * shape. Returns null if the row doesn't fit any known shape.
 *
 * Three shapes are produced by decision-executor:
 *   1. alt entry      — inputs.candidate.{asset, ...}; outputs.{effectiveSizeUsd, entryPrice}
 *   2. BTC core       — inputs.decision.{action, ...}; outputs.{deltaUsd, btcPrice}
 *   3. alt position   — inputs.action.{asset, action, ...}; outputs varies per sub-action
 */
function parseExecutionAction(
  rawInputs: unknown,
  rawOutputs: unknown,
  reasoning: string,
): ExecutionAction | null {
  const inputs = rawInputs as Record<string, unknown> | null;
  const outputs = rawOutputs as Record<string, unknown> | null;
  if (!inputs) return null;

  const candidate = inputs.candidate as { asset?: string } | undefined;
  const decisionPart = inputs.decision as { action?: string } | undefined;
  const positionAction = inputs.action as
    | { asset?: string; action?: "trail_stop" | "partial_sell" | "exit" }
    | undefined;

  if (candidate?.asset) {
    return {
      asset: String(candidate.asset).toUpperCase(),
      kind: "alt_entry",
      reasoning,
      sizeUsd: numericOrNull(outputs?.effectiveSizeUsd),
      price: numericOrNull(outputs?.entryPrice),
    };
  }

  if (decisionPart) {
    return {
      asset: "BTC",
      kind: "btc_core",
      reasoning,
      sizeUsd: outputs?.deltaUsd != null ? Math.abs(Number(outputs.deltaUsd)) : null,
      price: numericOrNull(outputs?.btcPrice),
    };
  }

  if (positionAction?.asset && positionAction.action) {
    const sellQty = numericOrNull(outputs?.sellQty);
    const price = numericOrNull(outputs?.price);
    return {
      asset: String(positionAction.asset).toUpperCase(),
      kind: "alt_position",
      subAction: positionAction.action,
      reasoning,
      sizeUsd: sellQty != null && price != null ? sellQty * price : null,
      price: numericOrNull(outputs?.newStop) ?? price,
    };
  }

  return null;
}

function numericOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
