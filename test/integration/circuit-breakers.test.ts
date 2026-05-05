import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  checkHardFloor,
  checkDailyLossCap,
  checkAltCooldown,
} from "@/lib/risk/circuit-breakers";
import { insertPosition } from "@/lib/db/queries/positions";
import { setCurrentModeForTesting } from "@/lib/mode";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

describe.skipIf(!integrationEnabled)("integration: circuit breakers", () => {
  beforeEach(async () => {
    await resetIntegration();
    setCurrentModeForTesting("paper");
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  it("hard floor halts at exactly $300", async () => {
    const r = await checkHardFloor(300);
    expect(r.halted).toBe(true);
  });

  it("hard floor allows at $301", async () => {
    const r = await checkHardFloor(301);
    expect(r.halted).toBe(false);
  });

  it("daily loss cap blocks after 4% of capital realized in 24h", async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000);
    // Plant a closed losing trade with -$25 net pnl in the last 24h
    await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "closed",
      entryPrice: "0.5",
      quantity: "100",
      entryTime: oneHourAgo,
      exitTime: now,
      exitPrice: "0.45",
      netPnlUsd: "-25",
      strategyVersion: "3.0",
      paperMode: true,
    });
    // 4% of $500 = $20 cap → -$25 should block
    const r = await checkDailyLossCap(500);
    expect(r.blocked).toBe(true);
  });

  it("daily loss cap allows below threshold", async () => {
    const now = new Date();
    await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "closed",
      entryPrice: "0.5",
      quantity: "100",
      entryTime: new Date(now.getTime() - 3600_000),
      exitTime: now,
      exitPrice: "0.49",
      netPnlUsd: "-5",
      strategyVersion: "3.0",
      paperMode: true,
    });
    const r = await checkDailyLossCap(500);
    expect(r.blocked).toBe(false);
  });

  it("cooldown activates after 2 consecutive losing alt cycles", async () => {
    const now = new Date();
    // Two consecutive losses
    for (let i = 0; i < 2; i++) {
      await insertPosition({
        asset: "AERO",
        type: "alt_cycle",
        status: "closed",
        entryPrice: "0.5",
        quantity: "100",
        entryTime: new Date(now.getTime() - 7200_000 + i * 3600_000),
        exitTime: new Date(now.getTime() - 3600_000 + i * 3600_000),
        exitPrice: "0.45",
        netPnlUsd: "-5",
        strategyVersion: "3.0",
        paperMode: true,
      });
    }
    const r = await checkAltCooldown();
    expect(r.active).toBe(true);
    expect(r.cooldownUntil).not.toBeNull();
  });

  it("cooldown does not activate when only 1 loss is most recent", async () => {
    const now = new Date();
    await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "closed",
      entryPrice: "0.5",
      quantity: "100",
      entryTime: new Date(now.getTime() - 7200_000),
      exitTime: new Date(now.getTime() - 3600_000),
      exitPrice: "0.55",
      netPnlUsd: "5",
      strategyVersion: "3.0",
      paperMode: true,
    });
    await insertPosition({
      asset: "LINK",
      type: "alt_cycle",
      status: "closed",
      entryPrice: "12",
      quantity: "10",
      entryTime: new Date(now.getTime() - 3600_000),
      exitTime: now,
      exitPrice: "11",
      netPnlUsd: "-10",
      strategyVersion: "3.0",
      paperMode: true,
    });
    const r = await checkAltCooldown();
    expect(r.active).toBe(false);
  });
});
