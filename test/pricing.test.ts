import { describe, it, expect } from "vitest";
import {
  computeCost,
  PRICING,
  MODELS,
  PRE_CALL_ESTIMATE_USD,
  VARIANCE_BUFFER,
  MONTHLY_BUDGET_USD,
} from "@/lib/anthropic/pricing";

describe("computeCost", () => {
  it("computes Opus cost correctly without caching", () => {
    const cost = computeCost(MODELS.OPUS, {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // Opus: $5/M input + $25/M output = $30 for 1M each
    expect(cost).toBe(30);
  });

  it("computes Sonnet cost correctly without caching", () => {
    const cost = computeCost(MODELS.SONNET, {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // Sonnet: $3/M input + $15/M output = $18 for 1M each
    expect(cost).toBe(18);
  });

  it("uses cache_read pricing instead of input pricing", () => {
    const noCache = computeCost(MODELS.OPUS, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const allCached = computeCost(MODELS.OPUS, {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    // Cache read is $0.50/M vs $5/M input — 10x cheaper
    expect(noCache).toBe(5);
    expect(allCached).toBe(0.5);
  });

  it("uses 5m write rate by default", () => {
    const cost = computeCost(MODELS.OPUS, {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
    });
    expect(cost).toBe(PRICING[MODELS.OPUS].cacheWrite5mPerM);
  });

  it("uses 1h write rate when specified", () => {
    const cost = computeCost(MODELS.OPUS, {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
      cacheWriteTtl: "1h",
    });
    expect(cost).toBe(PRICING[MODELS.OPUS].cacheWrite1hPerM);
  });

  it("includes web search cost", () => {
    const cost = computeCost(MODELS.OPUS, {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchCount: 3,
    });
    expect(cost).toBe(0.03); // $0.01 × 3
  });

  it("rounds to 6 decimal places", () => {
    const cost = computeCost(MODELS.SONNET, {
      inputTokens: 1234,
      outputTokens: 567,
      cacheReadTokens: 89,
      cacheWriteTokens: 0,
    });
    // Should be a clean number, not floating point garbage
    const stringForm = cost.toString();
    const decimals = stringForm.split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(6);
  });
});

describe("pricing constants", () => {
  it("monthly budget is $50", () => {
    expect(MONTHLY_BUDGET_USD).toBe(50);
  });

  it("variance buffer is 1.3", () => {
    expect(VARIANCE_BUFFER).toBe(1.3);
  });

  it("estimate × buffer for typical morning Opus call stays well under monthly cap on day 1", () => {
    const morningEstimate = PRE_CALL_ESTIMATE_USD.morning! * VARIANCE_BUFFER;
    expect(morningEstimate).toBeLessThan(1.0);
  });

  it("Sonnet check is at least 10× cheaper than Opus morning", () => {
    expect(PRE_CALL_ESTIMATE_USD.sonnet_check).toBeLessThan(
      PRE_CALL_ESTIMATE_USD.morning! / 10,
    );
  });
});
