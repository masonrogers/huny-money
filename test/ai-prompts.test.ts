import { describe, it, expect } from "vitest";
import { buildOpusMorningSystemPrompt } from "@/lib/ai/prompts/opus-morning";
import { buildSonnetWatcherSystemPrompt } from "@/lib/ai/prompts/sonnet-watcher";
import { CYCLE_WATCHLIST } from "@/lib/strategy/constants";

describe("Opus morning system prompt", () => {
  const prompt = buildOpusMorningSystemPrompt();

  it("declares the goal of beating BTC", () => {
    expect(prompt).toMatch(/beat\s+btc/i);
    expect(prompt).toMatch(/buy.{0,5}hold/i);
  });

  it("emphasizes BTC as default position", () => {
    expect(prompt).toMatch(/btc is the default/i);
  });

  it("emphasizes bear = cash with no exceptions", () => {
    expect(prompt).toMatch(/bear regime is sacred/i);
    expect(prompt).toMatch(/no exceptions/i);
    expect(prompt).toMatch(/bear\s*=\s*100%\s*usdc/i);
  });

  it("emphasizes cycle-not-swing horizon", () => {
    expect(prompt).toMatch(/not a swing trader/i);
    expect(prompt).toMatch(/weeks to months/i);
  });

  it("lists the watchlist assets", () => {
    for (const asset of CYCLE_WATCHLIST) {
      expect(prompt).toContain(asset);
    }
  });

  it("declares the JSON output contract", () => {
    expect(prompt).toMatch(/```json/);
    expect(prompt).toContain("regime_evidence");
    expect(prompt).toContain("btc_core_decision");
    expect(prompt).toContain("watch_list");
    expect(prompt).toContain("discipline_check");
  });

  it("reminds Opus that most outputs should be 'no action'", () => {
    expect(prompt).toMatch(/most morning briefs result in.{0,30}no action/i);
  });
});

describe("Sonnet watcher system prompt", () => {
  const prompt = buildSonnetWatcherSystemPrompt();

  it("explicitly declares routing-only role", () => {
    expect(prompt).toMatch(/routing classifier/i);
    expect(prompt).toMatch(/cannot\s+and\s+must\s+not/i);
  });

  it("forbids placing/modifying/canceling orders", () => {
    // /s flag enables dotAll so . matches newlines (the constraint list has line breaks).
    expect(prompt).toMatch(/cannot.{0,80}place.{0,80}order/is);
    expect(prompt).toMatch(/modify.{0,80}order/is);
    expect(prompt).toMatch(/cancel.{0,80}order/is);
  });

  it("declares forbidden output fields", () => {
    expect(prompt).toContain("new_trades");
    expect(prompt).toContain("alt_entry_candidates");
    expect(prompt).toContain("btc_core_decision");
  });

  it("instructs to escalate sparingly with the 'when in doubt' rule", () => {
    expect(prompt).toMatch(/when in doubt.{0,50}do not escalate/i);
  });

  it("declares the JSON output contract", () => {
    expect(prompt).toMatch(/```json/);
    expect(prompt).toContain("evaluated");
    expect(prompt).toContain("escalate");
    expect(prompt).toContain("trigger_id");
    expect(prompt).toContain("discretionary_escalation");
  });

  it("reminds Sonnet not to second-guess regime", () => {
    expect(prompt).toMatch(/do not second.guess/i);
  });
});
