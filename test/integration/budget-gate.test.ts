import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { budgetGate } from "@/lib/anthropic";
import { db } from "@/lib/db";
import { apiSpend } from "@/lib/db/schema";
import { monthKey } from "@/lib/db/queries/api_spend";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

describe.skipIf(!integrationEnabled)("integration: budget gate", () => {
  beforeEach(async () => {
    await resetIntegration();
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  it("allows morning brief on a clean month", async () => {
    const decision = await budgetGate("morning");
    expect(decision.allowed).toBe(true);
  });

  it("ALWAYS allows morning brief even past monthly cap", async () => {
    // Plant ~$60 of fake spend (over the $50 cap)
    await db.insert(apiSpend).values({
      model: "claude-opus-4-7",
      callType: "morning",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: "60.00",
      month: monthKey(),
    });
    const decision = await budgetGate("morning");
    expect(decision.allowed).toBe(true);
  });

  it("blocks Sonnet check past monthly cap", async () => {
    await db.insert(apiSpend).values({
      model: "claude-opus-4-7",
      callType: "morning",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: "60.00",
      month: monthKey(),
    });
    const decision = await budgetGate("sonnet_check");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("monthly_cap");
    }
  });

  it("blocks 5th Opus call of the day", async () => {
    // Plant 4 Opus calls today
    const today = new Date();
    today.setUTCHours(8, 0, 0, 0);
    for (let i = 0; i < 4; i++) {
      await db.insert(apiSpend).values({
        model: "claude-opus-4-7",
        callType: "opus_escalation",
        timestamp: today,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: "0.50",
        month: monthKey(),
      });
    }
    const decision = await budgetGate("opus_escalation");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("opus_daily_cap");
    }
  });
});
