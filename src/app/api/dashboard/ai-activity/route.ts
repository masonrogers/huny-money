import { recentEvaluations } from "@/lib/db/queries/evaluations";
import { safeDashboardHandler } from "@/lib/api/safe-handler";

export interface AiActivityEntry {
  id: string;
  timestamp: string;
  model: string;
  modelLabel: "Opus" | "Sonnet";
  callType: string;
  triggerSource: string;
  promptText: string;
  responseText: string | null;
  parsedResponse: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  strategyVersion: string;
  suppressed: boolean;
  suppressionReason: string | null;
}

export interface AiActivityPayload {
  entries: AiActivityEntry[];
  dbReady: boolean;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50")));

  return safeDashboardHandler<AiActivityPayload>(
    "api.dashboard.ai-activity",
    { entries: [], dbReady: false },
    async () => {
      const rows = await recentEvaluations(limit);
      return {
        entries: rows.map((e) => ({
          id: e.id,
          timestamp: e.timestamp.toISOString(),
          model: e.model,
          modelLabel: e.model.startsWith("claude-opus") ? "Opus" : "Sonnet",
          callType: e.callType,
          triggerSource: e.triggerSource,
          promptText: e.promptText,
          responseText: e.responseText,
          parsedResponse: e.parsedResponse,
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          cacheReadTokens: e.cacheReadTokens,
          cacheWriteTokens: e.cacheWriteTokens,
          costUsd: e.costUsd != null ? Number(e.costUsd) : null,
          latencyMs: e.latencyMs,
          strategyVersion: e.strategyVersion,
          suppressed: e.suppressed,
          suppressionReason: e.suppressionReason,
        })),
        dbReady: true,
      };
    },
  );
}
