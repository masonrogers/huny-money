import { db } from "@/lib/db";
import { triggers } from "@/lib/db/schema";
import { expireTriggersFromPriorBriefs } from "@/lib/db/queries/triggers";
import { errorLogger } from "@/lib/db/utils";
import { callOpus, budgetGate } from "@/lib/anthropic";
import { buildOpusMorningSystemPrompt } from "../prompts/opus-morning";
import { buildOpusMorningUserMessage, type OpusMorningPackageInput } from "../packages/opus-morning";
import { MorningBriefSchema, type MorningBrief } from "../schemas";
import { STRATEGY_VERSION, MAX_WATCHLIST_TRIGGERS } from "@/lib/strategy/constants";
import { log } from "@/lib/logger";

/**
 * End-to-end Opus morning brief flow.
 *
 * 1. budgetGate("morning") — never blocked, but logs decision
 * 2. Build system prompt + user message from input package
 * 3. callOpus({ callType: "morning", ... }) — writes evaluations + api_spend
 * 4. Parse response with strict zod validation
 * 5. Persist watch list to `triggers` table (active until next morning brief)
 * 6. Return parsed brief + evaluation id for the caller
 *
 * Malformed Opus responses cause an error — no silent fallback per BUILD_PLAN
 * Phase 3 acceptance.
 */

export interface MorningBriefResult {
  brief: MorningBrief;
  evaluationId: string;
  costUsd: number;
  latencyMs: number;
}

export class MorningBriefSchemaError extends Error {
  constructor(
    message: string,
    public evaluationId: string,
    public rawResponse: string,
    public zodIssues: unknown,
  ) {
    super(message);
    this.name = "MorningBriefSchemaError";
  }
}

export async function runMorningBrief(
  input: OpusMorningPackageInput,
): Promise<MorningBriefResult> {
  // 1. Gate (always allowed for morning brief, but logged for audit)
  await budgetGate("morning");

  // 2. Assemble prompts
  const systemPrompt = buildOpusMorningSystemPrompt();
  const userMessage = buildOpusMorningUserMessage(input);

  log.info("Opus morning brief — calling", {
    promptLength: userMessage.length,
    assets: input.assets.map((a) => a.asset),
  });

  // 3. Call Opus (max thinking, 1h cache on system prompt)
  const result = await callOpus({
    callType: "morning",
    triggerSource: "scheduled",
    systemPrompt,
    userMessage,
    strategyVersion: STRATEGY_VERSION,
    cache1h: true,
  });

  // 4. Parse + validate
  if (result.parsedJson == null) {
    await errorLogger({
      severity: "error",
      component: "ai.flows.morning-brief",
      error: new Error("Opus morning brief response was not valid JSON"),
      context: { evaluationId: result.evaluationId, rawResponseSample: result.responseText.slice(0, 500) },
      recovered: false,
    });
    throw new MorningBriefSchemaError(
      "Opus morning brief response was not valid JSON",
      result.evaluationId,
      result.responseText,
      null,
    );
  }

  const parsed = MorningBriefSchema.safeParse(result.parsedJson);
  if (!parsed.success) {
    await errorLogger({
      severity: "error",
      component: "ai.flows.morning-brief",
      error: new Error(
        `Opus morning brief schema validation failed: ${parsed.error.message.slice(0, 200)}`,
      ),
      context: {
        evaluationId: result.evaluationId,
        zodIssues: parsed.error.issues,
        rawResponseSample: result.responseText.slice(0, 500),
      },
      recovered: false,
    });
    throw new MorningBriefSchemaError(
      "Opus morning brief schema validation failed",
      result.evaluationId,
      result.responseText,
      parsed.error.issues,
    );
  }

  const brief = parsed.data;

  // Defense in depth: enforce hard caps even if Opus violated the contract
  // (zod max(5) on watch_list already handles this, but assert anyway).
  if (brief.watch_list.length > MAX_WATCHLIST_TRIGGERS) {
    brief.watch_list.length = MAX_WATCHLIST_TRIGGERS;
  }

  // 5. Persist watch list to `triggers` (active until the next brief).
  // First expire any prior brief's still-active triggers — STRATEGY.md §5.3
  // says watch list expires at next morning's brief, but the original schema
  // gave each trigger a 26h cushion. Without explicit expiry, force-iterated
  // briefs stack up dozens of stale conditions for the wakeup cycle to
  // evaluate (FINDINGS.md #19).
  const activeFrom = input.timestamp;
  const activeUntil = new Date(activeFrom.getTime() + 26 * 3600 * 1000); // 26h cushion fallback

  await expireTriggersFromPriorBriefs(result.evaluationId, activeFrom);

  if (brief.watch_list.length > 0) {
    await db.insert(triggers).values(
      brief.watch_list.map((w) => ({
        morningEvalId: result.evaluationId,
        triggerId: w.id,
        asset: w.asset ?? null,
        conditionText: w.condition,
        rationale: w.rationale,
        urgency: w.urgency,
        activeFrom,
        activeUntil,
      })),
    );
  }

  log.info("Opus morning brief — complete", {
    evaluationId: result.evaluationId,
    regime: brief.regime,
    altCandidates: brief.alt_entry_candidates.length,
    watchListSize: brief.watch_list.length,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
  });

  return {
    brief,
    evaluationId: result.evaluationId,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
  };
}
