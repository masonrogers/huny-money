import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { stateWriter, stateRead } from "@/lib/db/utils";
import { historyForKey, valueAt } from "@/lib/db/queries/system_state_history";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

describe.skipIf(!integrationEnabled)("integration: stateWriter atomicity + history", () => {
  beforeEach(async () => {
    await resetIntegration();
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  it("writes state + history row in same transaction", async () => {
    await stateWriter({ key: "test_key", value: "v1", changedBy: "test" });
    expect(await stateRead<string>("test_key")).toBe("v1");
    const history = await historyForKey("test_key");
    expect(history).toHaveLength(1);
    expect(history[0]!.newValue).toBe("v1");
    expect(history[0]!.oldValue).toBeNull();
    expect(history[0]!.changedBy).toBe("test");
  });

  it("appends history rows on each subsequent write", async () => {
    await stateWriter({ key: "k", value: 1, changedBy: "test" });
    await stateWriter({ key: "k", value: 2, changedBy: "test" });
    await stateWriter({ key: "k", value: 3, changedBy: "test" });
    expect(await stateRead<number>("k")).toBe(3);
    const history = await historyForKey("k");
    expect(history).toHaveLength(3);
    // Newest first
    expect(history[0]!.newValue).toBe(3);
    expect(history[1]!.newValue).toBe(2);
    expect(history[2]!.newValue).toBe(1);
  });

  it("captures old → new value diff per write", async () => {
    await stateWriter({ key: "regime", value: "bull", changedBy: "test" });
    await stateWriter({ key: "regime", value: "chop", changedBy: "test" });
    const history = await historyForKey("regime");
    expect(history[0]!.oldValue).toBe("bull");
    expect(history[0]!.newValue).toBe("chop");
  });

  it("valueAt returns the value as of a timestamp (forensic query)", async () => {
    await stateWriter({ key: "regime", value: "bull", changedBy: "test" });
    await new Promise((r) => setTimeout(r, 50));
    const before = new Date();
    await new Promise((r) => setTimeout(r, 50));
    await stateWriter({ key: "regime", value: "bear", changedBy: "test" });

    expect(await valueAt("regime", before)).toBe("bull");
    expect(await valueAt("regime", new Date())).toBe("bear");
  });
});
