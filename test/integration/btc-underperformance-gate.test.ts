import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { applyBtcUnderperformanceGate } from "@/lib/risk/btc-underperformance-gate";
import { stateRead, stateWriter } from "@/lib/db/utils";
import { setCurrentModeForTesting } from "@/lib/mode";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

/**
 * Integration tests for the BTC underperformance gate wrapper.
 *
 * The pure decision function is covered in test/circuit-breakers-pure.test.ts.
 * Here we exercise the side-effect contract: when the gate trips, it must
 * write trading_paused=true with a populated reason, and on re-runs it must
 * NOT clobber a pause set by other code paths.
 */

describe.skipIf(!integrationEnabled)("integration: btc underperformance gate", () => {
  beforeEach(async () => {
    await resetIntegration();
    setCurrentModeForTesting("paper");
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  const TRIPPING = {
    systemReturnPct: -5,
    btcHoldReturnPct: 5,
    rolling30dDeltaPct: -4,
    rolling60dDeltaPct: -8,
    consecutiveUnderperfDays: 60,
  };

  const PASSING = {
    systemReturnPct: 12,
    btcHoldReturnPct: 8,
    rolling30dDeltaPct: 2,
    rolling60dDeltaPct: 4,
    consecutiveUnderperfDays: 0,
  };

  it("sets trading_paused=true with reason when shouldPause and not already paused", async () => {
    await stateWriter({
      key: "trading_paused",
      value: false,
      changedBy: "test.setup",
    });

    const r = await applyBtcUnderperformanceGate(TRIPPING);

    expect(r.decision.shouldPause).toBe(true);
    expect(r.newlyPaused).toBe(true);
    expect(r.wasAlreadyPaused).toBe(false);
    expect(await stateRead<boolean>("trading_paused")).toBe(true);
    const reason = await stateRead<string>("trading_paused_reason");
    expect(reason).toBeTruthy();
    expect(reason).toContain("BTC");
    expect(await stateRead<boolean>("trading_paused_by_btc_underperf_gate")).toBe(true);
  });

  it("does NOT re-write pause keys when shouldPause but already paused", async () => {
    await stateWriter({
      key: "trading_paused",
      value: true,
      changedBy: "test.setup.manual-pause",
    });
    // Sentinel reason — gate must not overwrite.
    await stateWriter({
      key: "trading_paused_reason",
      value: "manual operator pause",
      changedBy: "test.setup",
    });

    const r = await applyBtcUnderperformanceGate(TRIPPING);

    expect(r.decision.shouldPause).toBe(true);
    expect(r.wasAlreadyPaused).toBe(true);
    expect(r.newlyPaused).toBe(false);
    expect(await stateRead<string>("trading_paused_reason")).toBe("manual operator pause");
    expect(await stateRead<boolean>("trading_paused_by_btc_underperf_gate")).toBeNull();
  });

  it("makes no pause-state writes when within tolerance", async () => {
    await stateWriter({
      key: "trading_paused",
      value: false,
      changedBy: "test.setup",
    });

    const r = await applyBtcUnderperformanceGate(PASSING);

    expect(r.decision.shouldPause).toBe(false);
    expect(r.newlyPaused).toBe(false);
    expect(await stateRead<boolean>("trading_paused")).toBe(false);
    expect(await stateRead<string>("trading_paused_reason")).toBeNull();
  });
});
