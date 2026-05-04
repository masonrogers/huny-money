import { evaluationsByCallTypeSince } from "@/lib/db/queries/evaluations";
import { activeTriggersAt } from "@/lib/db/queries/triggers";
import { safeDashboardHandler } from "@/lib/api/safe-handler";
import type { MorningBrief } from "@/lib/ai/schemas";

export interface TodayPayload {
  brief: MorningBrief | null;
  briefAt: string | null;
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
    { brief: null, briefAt: null, activeTriggers: [], dbReady: false },
    async () => {
      const since = new Date(Date.now() - 36 * 3600 * 1000);
      const briefs = await evaluationsByCallTypeSince("morning", since);
      const latest = briefs[0]; // sorted desc

      const triggers = await activeTriggersAt(new Date());

      return {
        brief: (latest?.parsedResponse as MorningBrief | null) ?? null,
        briefAt: latest?.timestamp.toISOString() ?? null,
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
