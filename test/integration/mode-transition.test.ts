import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { stateWriter } from "@/lib/db/utils";
import { attemptModeTransition } from "@/lib/execution/mode-transition";
import { setCurrentModeForTesting } from "@/lib/mode";
import { insertPosition } from "@/lib/db/queries/positions";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

describe.skipIf(!integrationEnabled)("integration: mode transition gate (§13.5)", () => {
  beforeEach(async () => {
    await resetIntegration();
    await stateWriter({ key: "paper_mode", value: true, changedBy: "test" });
    setCurrentModeForTesting("paper");
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  it("rejects without typed phrase", async () => {
    const r = await attemptModeTransition({ target: "live", typedPhrase: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_typed_phrase");
  });

  it("rejects with wrong phrase", async () => {
    const r = await attemptModeTransition({ target: "live", typedPhrase: "yes" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_typed_phrase");
  });

  it("rejects with open paper positions", async () => {
    await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "open",
      entryPrice: "0.5",
      quantity: "100",
      entryTime: new Date(),
      strategyVersion: "3.0",
      paperMode: true,
    });
    const r = await attemptModeTransition({
      target: "live",
      typedPhrase: "transition to live trading",
      phase1CriteriaPass: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("open_paper_positions");
  });

  it("rejects paper→live with Phase 1 criteria failing", async () => {
    const r = await attemptModeTransition({
      target: "live",
      typedPhrase: "transition to live trading",
      phase1CriteriaPass: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("phase1_criteria_not_met");
  });

  it("accepts and writes mode_change_pending when all preconditions met", async () => {
    const r = await attemptModeTransition({
      target: "live",
      typedPhrase: "transition to live trading",
      phase1CriteriaPass: true,
    });
    expect(r.ok).toBe(true);

    const { stateRead } = await import("@/lib/db/utils");
    expect(await stateRead<boolean>("paper_mode")).toBe(false);
    expect(await stateRead<boolean>("mode_change_pending")).toBe(true);
  });

  it("rejects when current mode equals target", async () => {
    const r = await attemptModeTransition({
      target: "paper",
      typedPhrase: "transition to paper trading",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("current_mode_already_target");
  });
});
