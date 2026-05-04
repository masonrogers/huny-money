import { recentWakeups } from "@/lib/db/queries/wakeups";
import { recentAppDecisions } from "@/lib/db/queries/app_decisions";
import { recentHistory } from "@/lib/db/queries/system_state_history";
import { activeTriggersAt } from "@/lib/db/queries/triggers";
import { safeDashboardHandler } from "@/lib/api/safe-handler";

export interface DecisionsPayload {
  watchList: Array<{
    id: string;
    triggerId: string;
    asset: string | null;
    conditionText: string;
    rationale: string | null;
    urgency: "immediate" | "next_check";
    timesEvaluated: number;
    timesFired: number;
  }>;
  recentWakeups: Array<{
    id: string;
    timestamp: string;
    triggerType: string;
    asset: string | null;
    dispatched: boolean;
    suppressionReason: string | null;
    escalatedToOpus: boolean | null;
    opusActionTaken: string | null;
  }>;
  recentAppDecisions: Array<{
    id: string;
    timestamp: string;
    decisionType: string;
    reasoning: string;
    relatedEntity: string | null;
  }>;
  recentStateChanges: Array<{
    id: string;
    key: string;
    oldValue: unknown;
    newValue: unknown;
    changedAt: string;
    changedBy: string;
  }>;
  dbReady: boolean;
}

export async function GET() {
  return safeDashboardHandler<DecisionsPayload>(
    "api.dashboard.decisions",
    {
      watchList: [],
      recentWakeups: [],
      recentAppDecisions: [],
      recentStateChanges: [],
      dbReady: false,
    },
    async () => {
      const [triggers, wakeups, decisions, history] = await Promise.all([
        activeTriggersAt(new Date()),
        recentWakeups(50),
        recentAppDecisions(50),
        recentHistory(50),
      ]);
      return {
        watchList: triggers.map((t) => ({
          id: t.id,
          triggerId: t.triggerId,
          asset: t.asset,
          conditionText: t.conditionText,
          rationale: t.rationale,
          urgency: t.urgency,
          timesEvaluated: t.timesEvaluated,
          timesFired: t.timesFired,
        })),
        recentWakeups: wakeups.map((w) => ({
          id: w.id,
          timestamp: w.timestamp.toISOString(),
          triggerType: w.triggerType,
          asset: w.asset,
          dispatched: w.dispatched,
          suppressionReason: w.suppressionReason,
          escalatedToOpus: w.escalatedToOpus,
          opusActionTaken: w.opusActionTaken,
        })),
        recentAppDecisions: decisions.map((d) => ({
          id: d.id,
          timestamp: d.timestamp.toISOString(),
          decisionType: d.decisionType,
          reasoning: d.reasoning,
          relatedEntity: d.relatedEntity,
        })),
        recentStateChanges: history.map((h) => ({
          id: h.id,
          key: h.key,
          oldValue: h.oldValue,
          newValue: h.newValue,
          changedAt: h.changedAt.toISOString(),
          changedBy: h.changedBy,
        })),
        dbReady: true,
      };
    },
  );
}
