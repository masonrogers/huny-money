import { describe, it, expect } from "vitest";
import { MorningBriefSchema, SonnetWatcherOutputSchema } from "@/lib/ai";

const validMorningBrief = {
  regime: "chop",
  regime_evidence: "BTC ranging $68k-$70k for 5 days, no break of 50d MA either way",
  regime_changed_from: null,
  btc_core_decision: {
    current_alloc_pct: 50,
    target_alloc_pct: 50,
    action: "hold",
    tranches_planned: null,
    reasoning: "Already at chop target, no change needed",
  },
  alt_positions: [],
  alt_entry_candidates: [],
  watch_list: [
    {
      id: "btc-breakout-up",
      asset: "BTC",
      condition: "BTC closes above $70,200 on 1.5x avg volume",
      rationale: "Breakout would suggest regime upgrade to bull",
      urgency: "next_check",
    },
  ],
  btc_benchmark_assessment: "System +0.3% vs BTC over 30d, on track",
  discipline_check: "Not entering AERO despite low cycle position because no momentum reversal yet",
};

describe("MorningBriefSchema", () => {
  it("accepts valid brief", () => {
    const r = MorningBriefSchema.safeParse(validMorningBrief);
    expect(r.success).toBe(true);
  });

  it("rejects invalid regime", () => {
    const bad = { ...validMorningBrief, regime: "sideways" };
    expect(MorningBriefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects watch_list > 5 items", () => {
    const bad = {
      ...validMorningBrief,
      watch_list: Array.from({ length: 6 }, (_, i) => ({
        id: `t${i}`,
        condition: "x",
        rationale: "y",
        urgency: "next_check" as const,
      })),
    };
    expect(MorningBriefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects alt size > 15%", () => {
    const bad = {
      ...validMorningBrief,
      alt_entry_candidates: [
        {
          asset: "AERO",
          cycle_position_pct: 18,
          momentum_signal: "RSI 32",
          volume_signal: "1.4x",
          conviction: 75,
          size_pct: 20, // exceeds MAX_SINGLE_ALT_PCT
          stop_pct: 12,
          reasoning: "x",
        },
      ],
    };
    expect(MorningBriefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects empty regime evidence", () => {
    const bad = { ...validMorningBrief, regime_evidence: "" };
    expect(MorningBriefSchema.safeParse(bad).success).toBe(false);
  });
});

describe("SonnetWatcherOutputSchema", () => {
  const validSonnet = {
    evaluated: [
      { trigger_id: "btc-breakout-up", fired: false, current: "BTC at 69300, vol 0.9x", notes: null },
    ],
    escalate: false,
    trigger_id: null,
    discretionary_escalation: false,
    discretionary_reason: null,
    summary: "All quiet, no triggers fired.",
  };

  it("accepts valid Sonnet output", () => {
    const r = SonnetWatcherOutputSchema.safeParse(validSonnet);
    expect(r.success).toBe(true);
  });

  it("rejects escalate=true without trigger_id", () => {
    const bad = { ...validSonnet, escalate: true, trigger_id: null };
    const r = SonnetWatcherOutputSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("rejects discretionary_escalation without reason", () => {
    const bad = {
      ...validSonnet,
      escalate: true,
      trigger_id: "discretionary",
      discretionary_escalation: true,
      discretionary_reason: null,
    };
    const r = SonnetWatcherOutputSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });

  it("REJECTS Sonnet output containing trading-decision fields", () => {
    // The non-negotiable test: Sonnet cannot output anything that smells like a trade.
    const forbiddenFields = [
      "place_order",
      "modify_order",
      "cancel_order",
      "buy_order",
      "sell_order",
      "new_trades",
      "close_position",
      "open_position",
      "alt_entry_candidates",
      "btc_core_decision",
    ];
    for (const field of forbiddenFields) {
      const bad = { ...validSonnet, [field]: "anything" };
      const r = SonnetWatcherOutputSchema.safeParse(bad);
      expect(r.success, `field ${field} must be rejected`).toBe(false);
    }
  });
});
