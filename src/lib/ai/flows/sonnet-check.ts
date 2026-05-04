import { errorLogger } from "@/lib/db/utils";
import { callSonnet, callOpus, budgetGate, type TriggerSource } from "@/lib/anthropic";
import { buildSonnetWatcherSystemPrompt } from "../prompts/sonnet-watcher";
import { buildSonnetUserMessage, type SonnetCheckInput } from "../packages/sonnet-watcher";
import { SonnetWatcherOutputSchema, type SonnetWatcherOutput } from "../schemas";
import { STRATEGY_VERSION } from "@/lib/strategy/constants";
import { log } from "@/lib/logger";

/**
 * Sonnet watcher check flow with optional escalation to Opus.
 *
 * 1. budgetGate("sonnet_check") — may block on daily/monthly cap
 * 2. callSonnet → parse → strict zod validation
 * 3. If escalate=true: budgetGate("opus_escalation") then callOpus with the
 *    same context plus the escalation reason
 * 4. Returns Sonnet decision + optional Opus escalation result
 *
 * Per STRATEGY.md §5.1: NO Sonnet response can result in an order action
 * without an intervening Opus call. The schema validator rejects any
 * Sonnet output containing trade-decision fields.
 */

export interface SonnetCheckResult {
  sonnetEvaluationId: string;
  sonnetOutput: SonnetWatcherOutput;
  /** True if budget gate blocked this call. */
  blocked: boolean;
  blockReason?: string;
  /** Populated when Sonnet escalated and Opus was called. */
  escalation?: {
    opusEvaluationId: string;
    opusResponseText: string;
    opusParsedJson: unknown | null;
    costUsd: number;
  };
}

export class SonnetSchemaError extends Error {
  constructor(
    message: string,
    public evaluationId: string,
    public rawResponse: string,
    public zodIssues: unknown,
  ) {
    super(message);
    this.name = "SonnetSchemaError";
  }
}

export interface SonnetCheckArgs {
  packageInput: SonnetCheckInput;
  /** Trigger source for the evaluation row. */
  triggerSource: TriggerSource;
  /** Whether this Sonnet check was started by a wake-up (vs scheduled). */
  isWakeupCall: boolean;
}

export async function runSonnetCheck(args: SonnetCheckArgs): Promise<SonnetCheckResult> {
  // 1. Budget gate
  const gate = await budgetGate("sonnet_check", { isWakeupCall: args.isWakeupCall });
  if (!gate.allowed) {
    log.warn("Sonnet check blocked by budget gate", { reason: gate.reason });
    return {
      sonnetEvaluationId: "",
      sonnetOutput: {
        evaluated: [],
        escalate: false,
        trigger_id: null,
        discretionary_escalation: false,
        discretionary_reason: null,
        summary: `BLOCKED: ${gate.reason}`,
      },
      blocked: true,
      blockReason: gate.reason,
    };
  }

  // 2. Call Sonnet
  const systemPrompt = buildSonnetWatcherSystemPrompt();
  const userMessage = buildSonnetUserMessage(args.packageInput);

  const result = await callSonnet({
    triggerSource: args.triggerSource,
    systemPrompt,
    userMessage,
    strategyVersion: STRATEGY_VERSION,
    cache1h: true,
  });

  // 3. Parse + validate (strict — rejects any trading-decision fields)
  if (result.parsedJson == null) {
    await errorLogger({
      severity: "error",
      component: "ai.flows.sonnet-check",
      error: new Error("Sonnet response was not valid JSON"),
      context: { evaluationId: result.evaluationId, rawResponseSample: result.responseText.slice(0, 300) },
      recovered: false,
    });
    throw new SonnetSchemaError(
      "Sonnet response was not valid JSON",
      result.evaluationId,
      result.responseText,
      null,
    );
  }

  const parsed = SonnetWatcherOutputSchema.safeParse(result.parsedJson);
  if (!parsed.success) {
    await errorLogger({
      severity: "error",
      component: "ai.flows.sonnet-check",
      error: new Error(
        `Sonnet schema validation failed: ${parsed.error.message.slice(0, 200)}`,
      ),
      context: {
        evaluationId: result.evaluationId,
        zodIssues: parsed.error.issues,
        rawResponseSample: result.responseText.slice(0, 300),
      },
      recovered: false,
    });
    throw new SonnetSchemaError(
      "Sonnet schema validation failed",
      result.evaluationId,
      result.responseText,
      parsed.error.issues,
    );
  }

  const sonnetOutput = parsed.data;

  log.info("Sonnet check complete", {
    evaluationId: result.evaluationId,
    escalate: sonnetOutput.escalate,
    triggerId: sonnetOutput.trigger_id,
    costUsd: result.costUsd,
  });

  // 4. Escalate if requested
  if (!sonnetOutput.escalate) {
    return {
      sonnetEvaluationId: result.evaluationId,
      sonnetOutput,
      blocked: false,
    };
  }

  const opusGate = await budgetGate("opus_escalation");
  if (!opusGate.allowed) {
    log.warn("Opus escalation blocked by budget gate", {
      reason: opusGate.reason,
      sonnetEvalId: result.evaluationId,
    });
    return {
      sonnetEvaluationId: result.evaluationId,
      sonnetOutput,
      blocked: false,
    };
  }

  // Build the escalation user message: same Sonnet package + Sonnet's reasoning
  // appended so Opus has full context.
  const escalationMessage = `${userMessage}\n\n---\n\n# SONNET ESCALATION\n\nSonnet evaluated the watch list and is escalating to you for an actionable decision.\n\nTrigger that fired: ${sonnetOutput.trigger_id}${sonnetOutput.discretionary_escalation ? ` (DISCRETIONARY: ${sonnetOutput.discretionary_reason})` : ""}\n\nSonnet's evaluation:\n${JSON.stringify(sonnetOutput.evaluated, null, 2)}\n\nSonnet's summary: ${sonnetOutput.summary}\n\nDecide whether to take action (modify position, place new order, exit, hold) given the morning brief context above.`;

  const opusResult = await callOpus({
    callType: "opus_escalation",
    triggerSource: "escalation",
    systemPrompt: buildSonnetWatcherSystemPrompt(), // Opus reads the same context for escalations
    // Note: a future improvement is a dedicated escalation system prompt that
    // reuses the morning Opus prompt's discipline. For now we reuse the
    // morning system prompt context via the message body since the Opus
    // morning prompt is too long for an escalation cache miss.
    userMessage: escalationMessage,
    strategyVersion: STRATEGY_VERSION,
    cache1h: true,
  });

  return {
    sonnetEvaluationId: result.evaluationId,
    sonnetOutput,
    blocked: false,
    escalation: {
      opusEvaluationId: opusResult.evaluationId,
      opusResponseText: opusResult.responseText,
      opusParsedJson: opusResult.parsedJson,
      costUsd: opusResult.costUsd,
    },
  };
}
