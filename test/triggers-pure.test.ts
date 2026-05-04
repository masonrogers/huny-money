import { describe, it, expect } from "vitest";
import {
  POSITION_MOVE_THRESHOLD_PCT,
  POSITION_MOVE_WINDOW_HOURS,
  DEBOUNCE_WINDOW_MS,
} from "@/lib/triggers";

describe("trigger constants match STRATEGY.md §5.5", () => {
  it("position move threshold is 5%", () => {
    expect(POSITION_MOVE_THRESHOLD_PCT).toBe(5);
  });

  it("position move window is 4 hours", () => {
    expect(POSITION_MOVE_WINDOW_HOURS).toBe(4);
  });

  it("position move debounce is 60 minutes", () => {
    expect(DEBOUNCE_WINDOW_MS.position_move).toBe(60 * 60 * 1000);
  });

  it("news keyword debounce is 30 minutes", () => {
    expect(DEBOUNCE_WINDOW_MS.news_keyword).toBe(30 * 60 * 1000);
  });
});
