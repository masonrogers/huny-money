/**
 * Pricing constants for Anthropic API calls. Used by `budget_gate` for
 * pre-call estimation and by the SDK wrapper for post-call cost recording.
 *
 * Source: Anthropic public pricing as of April 2026.
 * Updated only by editing this file (and bumping strategy_version).
 *
 * USD per 1M tokens.
 */

export const MODELS = {
  OPUS: "claude-opus-4-7" as const,
  SONNET: "claude-sonnet-4-6" as const,
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWrite5mPerM: number;
  cacheWrite1hPerM: number;
}

export const PRICING: Record<ModelId, ModelPricing> = {
  "claude-opus-4-7": {
    inputPerM: 5.0,
    outputPerM: 25.0,
    cacheReadPerM: 0.5,
    cacheWrite5mPerM: 6.25,
    cacheWrite1hPerM: 10.0,
  },
  "claude-sonnet-4-6": {
    inputPerM: 3.0,
    outputPerM: 15.0,
    cacheReadPerM: 0.3,
    cacheWrite5mPerM: 3.75,
    cacheWrite1hPerM: 6.0,
  },
};

/** Per-search cost for the Anthropic web search tool (rough). */
export const WEB_SEARCH_COST_USD = 0.01;

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

export interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWriteTtl?: "5m" | "1h";
  webSearchCount?: number;
}

export function computeCost(model: ModelId, usage: UsageBreakdown): number {
  const p = PRICING[model];
  const writeRate =
    usage.cacheWriteTtl === "1h" ? p.cacheWrite1hPerM : p.cacheWrite5mPerM;

  const inputCost = (usage.inputTokens / 1_000_000) * p.inputPerM;
  const outputCost = (usage.outputTokens / 1_000_000) * p.outputPerM;
  const cacheReadCost = (usage.cacheReadTokens / 1_000_000) * p.cacheReadPerM;
  const cacheWriteCost = (usage.cacheWriteTokens / 1_000_000) * writeRate;
  const searchCost = (usage.webSearchCount ?? 0) * WEB_SEARCH_COST_USD;

  return Number(
    (inputCost + outputCost + cacheReadCost + cacheWriteCost + searchCost).toFixed(6),
  );
}

// ---------------------------------------------------------------------------
// Pre-call estimates per call type
// ---------------------------------------------------------------------------

/**
 * Pre-call cost estimates for budget gate (USD). These are baked-in heuristics
 * — the actual cost is recorded after each call and these can be tuned over
 * time based on observed averages.
 *
 * The 1.3× variance buffer is applied by `budget_gate`, not here.
 */
export const PRE_CALL_ESTIMATE_USD: Record<string, number> = {
  morning: 0.25,
  sonnet_check: 0.012,
  opus_escalation: 0.2,
  emergency: 0.2,
  review: 0.5,
  post_restart: 0.2,
};

export const VARIANCE_BUFFER = 1.3;

// ---------------------------------------------------------------------------
// Hardcoded caps (per STRATEGY.md §5.6)
// ---------------------------------------------------------------------------

export const MONTHLY_BUDGET_USD = 50.0;

export const MAX_OPUS_CALLS_PER_DAY = 4;
export const MAX_OPUS_CALLS_PER_MONTH = 90;
export const MAX_SONNET_SCHEDULED_PER_DAY = 2;
export const MAX_SONNET_WAKEUPS_PER_DAY = 4;
export const MAX_SONNET_WAKEUPS_PER_MONTH = 60;
