import { describe, it, expect, beforeEach } from "vitest";
import {
  startActivity,
  endActivity,
  withActivity,
  getActiveActivities,
  getRecentActivities,
  __resetActivityTrackerForTesting,
} from "@/lib/activity/tracker";

beforeEach(() => {
  __resetActivityTrackerForTesting();
});

describe("activity tracker", () => {
  it("starts empty", () => {
    expect(getActiveActivities()).toEqual([]);
    expect(getRecentActivities()).toEqual([]);
  });

  it("startActivity returns an id and lists the entry as active", () => {
    const id = startActivity("ai_call", "Opus: morning", "trigger=scheduled");
    const active = getActiveActivities();
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(id);
    expect(active[0]?.kind).toBe("ai_call");
    expect(active[0]?.label).toBe("Opus: morning");
    expect(active[0]?.detail).toBe("trigger=scheduled");
    expect(active[0]?.status).toBe("running");
    expect(getRecentActivities()).toEqual([]);
  });

  it("endActivity moves entry to recent with duration", async () => {
    const id = startActivity("wakeup_cycle", "Wake-up cycle (5-min tick)");
    await new Promise((r) => setTimeout(r, 5));
    endActivity(id, "completed");
    expect(getActiveActivities()).toEqual([]);
    const recent = getRecentActivities();
    expect(recent).toHaveLength(1);
    expect(recent[0]?.status).toBe("completed");
    expect(recent[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(recent[0]?.endedAt).toBeDefined();
  });

  it("endActivity records error message on failure", () => {
    const id = startActivity("ai_call", "Sonnet: sonnet_check");
    endActivity(id, "failed", "Anthropic API rate-limited");
    const recent = getRecentActivities();
    expect(recent[0]?.status).toBe("failed");
    expect(recent[0]?.errorMessage).toBe("Anthropic API rate-limited");
  });

  it("endActivity on unknown id is a no-op (no throw)", () => {
    expect(() => endActivity("unknown", "completed")).not.toThrow();
  });

  it("endActivity on already-ended id is a no-op", () => {
    const id = startActivity("ai_call", "Opus: morning");
    endActivity(id, "completed");
    endActivity(id, "completed"); // second call
    expect(getRecentActivities()).toHaveLength(1);
  });

  it("getActiveActivities sorts oldest-first", () => {
    const a = startActivity("ai_call", "first");
    // Force a tiny delta so ISO timestamps differ.
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    return wait(2).then(() => {
      const b = startActivity("ai_call", "second");
      const active = getActiveActivities();
      expect(active[0]?.id).toBe(a);
      expect(active[1]?.id).toBe(b);
    });
  });

  it("recent list is bounded at 50", () => {
    for (let i = 0; i < 75; i++) {
      const id = startActivity("ai_call", `call ${i}`);
      endActivity(id, "completed");
    }
    expect(getRecentActivities(100)).toHaveLength(50);
    // Newest-first ordering means "call 74" should be at position 0.
    const all = getRecentActivities(100);
    expect(all[0]?.label).toBe("call 74");
    expect(all[49]?.label).toBe("call 25");
  });

  it("withActivity wraps a successful async fn", async () => {
    const result = await withActivity(
      "ai_call",
      "Opus: morning",
      async () => {
        // Inside the wrapped fn, it should be visible as active.
        expect(getActiveActivities()).toHaveLength(1);
        return 42;
      },
    );
    expect(result).toBe(42);
    expect(getActiveActivities()).toEqual([]);
    expect(getRecentActivities()[0]?.status).toBe("completed");
  });

  it("withActivity records failure and rethrows", async () => {
    await expect(
      withActivity("ai_call", "Opus: morning", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(getActiveActivities()).toEqual([]);
    const recent = getRecentActivities();
    expect(recent[0]?.status).toBe("failed");
    expect(recent[0]?.errorMessage).toBe("boom");
  });

  it("withActivity records non-Error throws as their string form", async () => {
    await expect(
      withActivity("ai_call", "Opus: morning", async () => {
        throw "string-thrown";
      }),
    ).rejects.toBe("string-thrown");
    expect(getRecentActivities()[0]?.errorMessage).toBe("string-thrown");
  });
});
