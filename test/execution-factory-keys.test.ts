import { describe, it, expect } from "vitest";

/**
 * Direct-construction safety: per STRATEGY.md §13.2, the factory is the only
 * sanctioned executor constructor. The `__constructFromFactory(key)` static
 * method requires the secret symbol; calling it with anything else throws.
 *
 * This prevents test code (or production code that takes a shortcut) from
 * accidentally instantiating an executor outside the factory and bypassing
 * the mode-loading + invariance machinery.
 */

describe("LiveExecutor factory-key enforcement", () => {
  it("rejects construction without the factory key", async () => {
    const { LiveExecutor } = await import("@/lib/execution/live-executor");
    const wrongKey = Symbol("wrong");
    expect(() => LiveExecutor.__constructFromFactory(wrongKey)).toThrow(
      /must be constructed via execution\/factory\.ts only/,
    );
  });

  it("accepts construction with the factory key", async () => {
    const { LiveExecutor } = await import("@/lib/execution/live-executor");
    const exec = LiveExecutor.__constructFromFactory(LiveExecutor.__factoryConstructKey);
    expect(exec.mode).toBe("live");
  });
});

describe("PaperExecutor factory-key enforcement", () => {
  it("rejects construction without the factory key", async () => {
    const { PaperExecutor } = await import("@/lib/execution/paper-executor");
    const wrongKey = Symbol("wrong");
    expect(() => PaperExecutor.__constructFromFactory(wrongKey)).toThrow(
      /must be constructed via execution\/factory\.ts only/,
    );
  });

  it("accepts construction with the factory key", async () => {
    const { PaperExecutor } = await import("@/lib/execution/paper-executor");
    const exec = PaperExecutor.__constructFromFactory(PaperExecutor.__factoryConstructKey);
    expect(exec.mode).toBe("paper");
  });
});

describe("CrossModeBootRejection error class", () => {
  it("captures both counts in the error message", async () => {
    const { CrossModeBootRejection } = await import("@/lib/execution/reconciliation");
    const err = new CrossModeBootRejection(2, 0, "live");
    expect(err.foundPaperOpen).toBe(2);
    expect(err.foundLiveOpen).toBe(0);
    expect(err.bootMode).toBe("live");
    expect(err.message).toMatch(/booting in live mode/);
    expect(err.message).toMatch(/2 open position/);
  });

  it("name is 'CrossModeBootRejection' for catchers to discriminate", async () => {
    const { CrossModeBootRejection } = await import("@/lib/execution/reconciliation");
    const err = new CrossModeBootRejection(0, 1, "paper");
    expect(err.name).toBe("CrossModeBootRejection");
  });
});
