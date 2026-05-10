import { evaluationsByCallTypeSince } from "@/lib/db/queries/evaluations";
import { activeTriggersAt } from "@/lib/db/queries/triggers";
import { appDecisionsForEntity } from "@/lib/db/queries/app_decisions";
import { safeDashboardHandler } from "@/lib/api/safe-handler";
import type { MorningBrief } from "@/lib/ai/schemas";

export interface ExecutionAction {
  asset: string;
  /** "alt_entry" | "btc_core" */
  kind: "alt_entry" | "btc_core";
  /** Plain-English summary written by decision-executor's reasoning field. */
  reasoning: string;
  /** USD notional of the order (entry size, or BTC core delta). */
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
      const executionActions: ExecutionAction[] = [];
      if (latest) {
        const decisions = await appDecisionsForEntity(latest.id);
        for (const d of decisions) {
          if (d.decisionType !== "order_routing") continue;
          const inputs = d.inputs as Record<string, unknown> | null;
          const outputs = d.outputs as Record<string, unknown> | null;
          const candidate = inputs?.candidate as { asset?: string } | undefined;
          const decisionPart = inputs?.decision as { action?: string } | undefined;
          const asset = candidate?.asset
            ? String(candidate.asset).toUpperCase()
            : decisionPart
              ? "BTC"
              : "?";
          const kind: ExecutionAction["kind"] = candidate ? "alt_entry" : "btc_core";
          const sizeUsd =
            (outputs?.effectiveSizeUsd as number | undefined) ??
            (outputs?.deltaUsd as number | undefined) ??
            null;
          const price =
            (outputs?.entryPrice as number | undefined) ??
            (outputs?.btcPrice as number | undefined) ??
            null;
          executionActions.push({
            asset,
            kind,
            reasoning: d.reasoning,
            sizeUsd: sizeUsd != null ? Math.abs(Number(sizeUsd)) : null,
            price: price != null ? Number(price) : null,
          });
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
