import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { evaluations, apiSpend } from "@/lib/db/schema";
import { monthKey } from "@/lib/db/queries/api_spend";
import { errorLogger } from "@/lib/db/utils";
import { redact } from "@/lib/utils/redact";
import { log } from "@/lib/logger";
import { MODELS, type ModelId, computeCost, type UsageBreakdown } from "./pricing";
import type { CallType } from "./budget-gate";

// ---------------------------------------------------------------------------
// SDK singleton
// ---------------------------------------------------------------------------

let cachedSdk: Anthropic | null = null;

function sdk(): Anthropic {
  if (!cachedSdk) {
    cachedSdk = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }
  return cachedSdk;
}

/** For tests. */
export function __resetAnthropicSdk(client?: Anthropic): void {
  cachedSdk = client ?? null;
}

// ---------------------------------------------------------------------------
// Call inputs and output
// ---------------------------------------------------------------------------

export type TriggerSource =
  | "scheduled"
  | "wakeup_position_move"
  | "wakeup_stop_fill"
  | "wakeup_news"
  | "escalation";

export interface ClaudeCallInput {
  model: ModelId;
  callType: CallType;
  triggerSource: TriggerSource;
  /** Stable system prompt. Cached at 1h TTL by default. */
  systemPrompt: string;
  /** Dynamic per-call user message. Not cached. */
  userMessage: string;
  /** Enable extended thinking with the given token budget. Opus only. */
  thinking?: { budgetTokens: number };
  /** Max output tokens (must cover thinking + response when thinking is enabled). */
  maxTokens: number;
  /** Optional Anthropic tools (e.g., web search). */
  tools?: Anthropic.Messages.ToolUnion[];
  /** Strategy version that produced this call (for audit). */
  strategyVersion: string;
  /** Whether to use 1h cache TTL on the system prompt (vs 5m default). */
  cache1h?: boolean;
}

export interface ClaudeCallResult {
  evaluationId: string;
  responseText: string;
  parsedJson: unknown | null;
  usage: UsageBreakdown;
  costUsd: number;
  latencyMs: number;
  stopReason: string | null;
}

// ---------------------------------------------------------------------------
// Core caller
// ---------------------------------------------------------------------------

/**
 * The single sanctioned entrypoint for any Anthropic API call.
 *
 * - Constructs the API request with prompt caching on the system prompt
 * - Times the call
 * - Persists the full prompt + response to `evaluations` AND the cost
 *   breakdown to `api_spend` within 5 seconds
 * - Returns parsed JSON if the response body is valid JSON
 *
 * The CALLER is responsible for invoking `budgetGate(callType)` first and
 * handling the block decision. This wrapper assumes the gate already
 * approved.
 */
export async function callClaude(input: ClaudeCallInput): Promise<ClaudeCallResult> {
  const start = Date.now();

  // Build the system prompt as a content block with cache_control so that
  // the long stable prefix is cached for subsequent calls.
  const cacheControl: Anthropic.Messages.CacheControlEphemeral = input.cache1h
    ? { type: "ephemeral", ttl: "1h" }
    : { type: "ephemeral" };

  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: "text",
      text: input.systemPrompt,
      cache_control: cacheControl,
    },
  ];

  const requestBody: Anthropic.Messages.MessageStreamParams = {
    model: input.model,
    max_tokens: input.maxTokens,
    system: systemBlocks,
    messages: [{ role: "user", content: input.userMessage }],
  };

  if (input.thinking) {
    requestBody.thinking = {
      type: "enabled",
      budget_tokens: input.thinking.budgetTokens,
    };
  }
  if (input.tools && input.tools.length > 0) {
    requestBody.tools = input.tools;
  }

  // Use streaming for ALL Anthropic calls — the SDK rejects non-streaming
  // create() for any request that *could* exceed 10 minutes. Opus with
  // extended thinking trips this even on short prompts. Streaming has the
  // same final message shape; we just await `finalMessage()` to collect it.
  let message: Anthropic.Messages.Message;
  try {
    const stream = sdk().messages.stream(requestBody);
    message = await stream.finalMessage();
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    await errorLogger({
      severity: "error",
      component: "anthropic.client",
      error: e,
      context: { model: input.model, callType: input.callType },
      recovered: false,
    });
    throw e;
  }

  const latencyMs = Date.now() - start;

  // Extract the text content (Opus may also include thinking blocks; ignore those).
  const textBlocks = message.content.filter(
    (b): b is Anthropic.Messages.TextBlock => b.type === "text",
  );
  const responseText = textBlocks.map((b) => b.text).join("\n");

  let parsedJson: unknown | null = null;
  try {
    parsedJson = JSON.parse(responseText);
  } catch {
    // Not all responses are JSON. Caller validates schema if expected.
    parsedJson = null;
  }

  const usage: UsageBreakdown = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheWriteTtl: input.cache1h ? "1h" : "5m",
    webSearchCount: 0, // TODO: count web search tool calls when wired up
  };

  const costUsd = computeCost(input.model, usage);

  // Persist the evaluation + spend rows. Wrap in try/catch so a DB error
  // doesn't lose the API response — caller still gets the result, but
  // operator is alerted via errorLogger.
  let evaluationId = "";
  try {
    const evalRow = await db
      .insert(evaluations)
      .values({
        model: input.model,
        callType: input.callType,
        triggerSource: input.triggerSource,
        promptText: redact(`SYSTEM:\n${input.systemPrompt}\n\nUSER:\n${input.userMessage}`),
        responseText: redact(responseText),
        parsedResponse: parsedJson as Anthropic.Messages.Message | null,
        actionsTaken: null, // populated later by the orchestrator if action is taken
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costUsd: costUsd.toString(),
        latencyMs,
        strategyVersion: input.strategyVersion,
        suppressed: false,
      })
      .returning({ id: evaluations.id });
    evaluationId = evalRow[0]!.id;

    await db.insert(apiSpend).values({
      model: input.model,
      callType: input.callType,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      webSearchCount: usage.webSearchCount ?? 0,
      costUsd: costUsd.toString(),
      month: monthKey(),
      relatedEvalId: evaluationId,
    });

    log.info(`Anthropic call recorded`, {
      model: input.model,
      callType: input.callType,
      costUsd,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
    });
  } catch (err) {
    await errorLogger({
      severity: "critical",
      component: "anthropic.client",
      error: err instanceof Error ? err : new Error(String(err)),
      context: { model: input.model, callType: input.callType, evaluationId, costUsd },
      recovered: false,
      recoveryAction: "API response was returned to caller but evaluation/api_spend not persisted",
    });
  }

  return {
    evaluationId,
    responseText,
    parsedJson,
    usage,
    costUsd,
    latencyMs,
    stopReason: message.stop_reason ?? null,
  };
}

// ---------------------------------------------------------------------------
// Convenience wrappers — pick model + thinking budget by call type
// ---------------------------------------------------------------------------

const OPUS_THINKING_BY_CALL_TYPE: Partial<
  Record<CallType, { budgetTokens: number; maxTokens: number }>
> = {
  morning: { budgetTokens: 16_000, maxTokens: 25_000 },
  review: { budgetTokens: 16_000, maxTokens: 25_000 },
  opus_escalation: { budgetTokens: 6_000, maxTokens: 12_000 },
  emergency: { budgetTokens: 6_000, maxTokens: 12_000 },
  post_restart: { budgetTokens: 6_000, maxTokens: 12_000 },
};

export interface OpusCallShortInput {
  callType: CallType;
  triggerSource: TriggerSource;
  systemPrompt: string;
  userMessage: string;
  strategyVersion: string;
  tools?: Anthropic.Messages.ToolUnion[];
  cache1h?: boolean;
}

export async function callOpus(input: OpusCallShortInput): Promise<ClaudeCallResult> {
  const t = OPUS_THINKING_BY_CALL_TYPE[input.callType] ?? {
    budgetTokens: 6_000,
    maxTokens: 12_000,
  };
  return callClaude({
    model: MODELS.OPUS,
    callType: input.callType,
    triggerSource: input.triggerSource,
    systemPrompt: input.systemPrompt,
    userMessage: input.userMessage,
    thinking: { budgetTokens: t.budgetTokens },
    maxTokens: t.maxTokens,
    tools: input.tools,
    strategyVersion: input.strategyVersion,
    cache1h: input.cache1h ?? true,
  });
}

export interface SonnetCallShortInput {
  triggerSource: TriggerSource;
  systemPrompt: string;
  userMessage: string;
  strategyVersion: string;
  cache1h?: boolean;
}

export async function callSonnet(input: SonnetCallShortInput): Promise<ClaudeCallResult> {
  return callClaude({
    model: MODELS.SONNET,
    callType: "sonnet_check",
    triggerSource: input.triggerSource,
    systemPrompt: input.systemPrompt,
    userMessage: input.userMessage,
    maxTokens: 4_000, // no extended thinking on watcher
    strategyVersion: input.strategyVersion,
    cache1h: input.cache1h ?? true,
  });
}
