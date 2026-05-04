import { describe, it, expect, beforeEach } from "vitest";
import {
  setCurrentMode,
  getCurrentMode,
  isPaperMode,
  isLiveMode,
  setCurrentModeForTesting,
} from "@/lib/mode";

describe("mode", () => {
  beforeEach(() => {
    setCurrentModeForTesting(null);
  });

  it("throws when read before initialization", () => {
    expect(() => getCurrentMode()).toThrow(/before mode was initialized/);
  });

  it("returns 'paper' once set", () => {
    setCurrentMode("paper");
    expect(getCurrentMode()).toBe("paper");
    expect(isPaperMode()).toBe(true);
    expect(isLiveMode()).toBe(false);
  });

  it("returns 'live' once set", () => {
    setCurrentMode("live");
    expect(getCurrentMode()).toBe("live");
    expect(isPaperMode()).toBe(false);
    expect(isLiveMode()).toBe(true);
  });

  it("setCurrentModeForTesting can reset to null (forcing re-init in next test)", () => {
    setCurrentMode("live");
    expect(getCurrentMode()).toBe("live");
    setCurrentModeForTesting(null);
    expect(() => getCurrentMode()).toThrow(/before mode was initialized/);
  });
});
