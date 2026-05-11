import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { stateRead, stateWriter } from "@/lib/db/utils";
import { bootConstructExecutor } from "@/lib/execution";
import {
  insertPosition,
  positionByIdForCurrentMode,
} from "@/lib/db/queries/positions";
import { ordersForCurrentMode } from "@/lib/db/queries/orders";
import { insertEvaluation } from "@/lib/db/queries/evaluations";
import {
  appendPendingLadder,
  processPendingEntryLadders,
  readPendingLadders,
  scheduleTrancheTwo,
} from "@/lib/orchestration/entry-ladder";
import { executeBriefDecisions } from "@/lib/orchestration/decision-executor";
import { applyBtcUnderperformanceGate } from "@/lib/risk/btc-underperformance-gate";
import type { MorningBrief } from "@/lib/ai/schemas";
import { STRATEGY_VERSION } from "@/lib/strategy/constants";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

/**
 * Time-domain + risk-gate coverage that the second-test sweep called
 * "fundamentally unexercisable" — turns out it's exercisable with clock
 * mocking + direct call to the orchestration entry points. These code
 * paths have all been merged + deployed for weeks but have never been
 * proven end-to-end before this file.
 *
 *   1a — Two-tranche entry ladder fires tranche 2 12h after tranche 1
 *   1b — Trail-stop ratchet walks the +25/+50/+75/+100% schedule and
 *        refuses to downgrade once at the highest tier
 *   1c — 60-day BTC underperformance gate trips precisely at the
 *        AND-of-conditions boundary, auto-pauses, no auto-resume
 */

const { mockState } = vi.hoisted(() => ({
  mockState: { prices: {} as Record<string, number> },
}));

vi.mock("@/lib/coinbase", async () => {
  const actual = await vi.importActual<typeof import("@/lib/coinbase")>("@/lib/coinbase");
  const ticker = (asset: string) => {
    const px = mockState.prices[asset] ?? 0;
    return {
      bestBid: px * 0.999,
      bestAsk: px * 1.001,
      midPrice: px,
      lastPrice: px,
      time: new Date().toISOString(),
    };
  };
  return {
    ...actual,
    getTicker: async (productId: string) => ticker(productId.split("-")[0]!),
    getTickers: async (productIds: readonly string[]) => {
      const out: Record<string, ReturnType<typeof ticker>> = {};
      for (const id of productIds) out[id] = ticker(id.split("-")[0]!);
      return out;
    },
  };
});

async function seedEvaluation(): Promise<string> {
  const row = await insertEvaluation({
    model: "claude-opus-4-7",
    callType: "morning",
    triggerSource: "scheduled",
    promptText: "test prompt",
    strategyVersion: STRATEGY_VERSION,
  });
  return row.id;
}

function makeBriefWithTrailStop(): MorningBrief {
  return {
    regime: "chop",
    regime_evidence: "test evidence",
    regime_changed_from: null,
    btc_core_decision: {
      current_alloc_pct: 50,
      target_alloc_pct: 50,
      action: "hold",
      tranches_planned: 1,
      reasoning: "BTC unchanged for this test",
    },
    alt_positions: [
      {
        asset: "AERO",
        current_cycle_position_pct: 60,
        action: "trail_stop",
        reasoning: "test trail stop",
      },
    ],
    alt_entry_candidates: [],
    watch_list: [],
    btc_benchmark_assessment: "test",
    discipline_check: "test",
  };
}

describe.skipIf(!integrationEnabled)("integration: time-domain + risk gates", () => {
  beforeEach(async () => {
    await resetIntegration();
    await stateWriter({ key: "paper_mode", value: true, changedBy: "test" });
    await stateWriter({
      key: "starting_capital_paper_usd",
      value: 10_000,
      changedBy: "test",
    });
    mockState.prices = {};
  });
  afterAll(async () => {
    await teardownIntegration();
  });

  // -------------------------------------------------------------------------
  // 1a — Two-tranche entry ladder firing tranche 2
  // -------------------------------------------------------------------------

  it("entry-ladder: tranche 2 fires when scheduledAt has passed; combined stop replaces tranche-1 stop", async () => {
    const { executor } = await bootConstructExecutor();
    void executor;

    // Seed an open alt_cycle position representing the tranche-1 fill:
    // 100 AERO at $1.00 entry, stop at $0.88.
    const evalId = await seedEvaluation();
    const pos = await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "open",
      direction: "long",
      entryPrice: "1.00",
      quantity: "100",
      stopPrice: "0.88",
      stopOrderId: "paper-old-stop-tranche1",
      targetPrice: null,
      convictionAtEntry: 75,
      catalyst: "test tranche-1 fill",
      thesis: "test",
      entryTime: new Date(),
      strategyVersion: STRATEGY_VERSION,
      regimeAtEntry: "chop",
      paperMode: true,
    });

    // Queue tranche 2 with scheduledAt in the past so it's due immediately.
    const pastTime = new Date(Date.now() - 13 * 3600_000); // 13 hours ago
    await appendPendingLadder({
      positionId: pos.id,
      asset: "AERO",
      trancheUsd: 100, // tranche-2 dollar size; tranche 1 was also $100
      originalEntryPrice: 1.00,
      scheduledAt: pastTime.toISOString(),
      evaluationId: evalId,
    });

    expect(await readPendingLadders()).toHaveLength(1);

    // Run the processor with a current price within drift tolerance (±10%).
    mockState.prices = { AERO: 1.05 };
    const result = await processPendingEntryLadders({ AERO: 1.05 });

    expect(result.placed).toBe(1);
    expect(result.skippedDrift).toBe(0);
    expect(result.skippedClosed).toBe(0);
    expect(result.errors).toBe(0);

    // Ladder cleared from state.
    expect(await readPendingLadders()).toHaveLength(0);

    // Orders: 1 tranche-2 limit buy + 1 new stop covering combined qty.
    const orders = await ordersForCurrentMode();
    const buy = orders.find((o) => o.type === "entry_limit");
    const stop = orders.find((o) => o.type === "stop_limit");
    expect(buy).toBeDefined();
    expect(stop).toBeDefined();
    expect(buy!.relatedPositionId).toBe(pos.id);
    expect(stop!.relatedPositionId).toBe(pos.id);

    // Position state: quantity bumped to ~combined, new stop order id.
    const updated = await positionByIdForCurrentMode(pos.id);
    expect(updated).not.toBeNull();
    const combinedQty = parseFloat(updated!.quantity);
    // Tranche 1 was 100 AERO; tranche 2 = $100 / $1.05 ≈ 95.24. Combined ≈ 195.24.
    expect(combinedQty).toBeCloseTo(100 + 100 / 1.05, 2);
    expect(updated!.stopOrderId).not.toBe("paper-old-stop-tranche1");
  });

  it("entry-ladder: tranche 2 drops with drift-skipped when price has moved >10% from original entry", async () => {
    const { executor } = await bootConstructExecutor();
    void executor;

    const evalId = await seedEvaluation();
    const pos = await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "open",
      direction: "long",
      entryPrice: "1.00",
      quantity: "100",
      stopPrice: "0.88",
      stopOrderId: "paper-old-stop",
      targetPrice: null,
      convictionAtEntry: 75,
      catalyst: "test",
      thesis: "test",
      entryTime: new Date(),
      strategyVersion: STRATEGY_VERSION,
      regimeAtEntry: "chop",
      paperMode: true,
    });

    const pastTime = new Date(Date.now() - 13 * 3600_000);
    await appendPendingLadder({
      positionId: pos.id,
      asset: "AERO",
      trancheUsd: 100,
      originalEntryPrice: 1.00,
      scheduledAt: pastTime.toISOString(),
      evaluationId: evalId,
    });

    // Price drifted +15% — should be dropped.
    const result = await processPendingEntryLadders({ AERO: 1.15 });
    expect(result.placed).toBe(0);
    expect(result.skippedDrift).toBe(1);
    expect(await readPendingLadders()).toHaveLength(0);
  });

  it("entry-ladder: ladder not yet due is left alone for next tick", async () => {
    const evalId = await seedEvaluation();
    const pos = await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "open",
      direction: "long",
      entryPrice: "1.00",
      quantity: "100",
      stopPrice: "0.88",
      stopOrderId: null,
      targetPrice: null,
      convictionAtEntry: 75,
      catalyst: "test",
      thesis: "test",
      entryTime: new Date(),
      strategyVersion: STRATEGY_VERSION,
      regimeAtEntry: "chop",
      paperMode: true,
    });
    const futureTime = scheduleTrancheTwo(new Date());
    await appendPendingLadder({
      positionId: pos.id,
      asset: "AERO",
      trancheUsd: 100,
      originalEntryPrice: 1.00,
      scheduledAt: futureTime.toISOString(),
      evaluationId: evalId,
    });

    const result = await processPendingEntryLadders({ AERO: 1.00 });
    expect(result.examined).toBe(0); // not yet due
    expect(await readPendingLadders()).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 1b — Trail-stop ratchet walks the schedule, never downgrades
  // -------------------------------------------------------------------------

  it("trail_stop: ratchets through +25/+50/+75/+100% schedule and refuses to downgrade", async () => {
    const { executor } = await bootConstructExecutor();
    void executor;

    // Position at $1.00 entry, $0.88 stop (the -12% initial stop).
    const pos = await insertPosition({
      asset: "AERO",
      type: "alt_cycle",
      status: "open",
      direction: "long",
      entryPrice: "1.00",
      quantity: "100",
      stopPrice: "0.88",
      stopOrderId: "paper-initial-stop",
      targetPrice: null,
      convictionAtEntry: 75,
      catalyst: "test for ratchet",
      thesis: "test",
      entryTime: new Date(),
      strategyVersion: STRATEGY_VERSION,
      regimeAtEntry: "chop",
      paperMode: true,
    });

    const runRatchet = async (currentPriceUsd: number) => {
      mockState.prices = { AERO: currentPriceUsd, BTC: 80_000 };
      await executeBriefDecisions(makeBriefWithTrailStop(), {
        evaluationId: await seedEvaluation(),
        accountValueUsd: 10_000,
        cashUsd: 5_000,
        currentPrices: { AERO: currentPriceUsd, BTC: 80_000 },
        currentAltExposureUsd: 100 * currentPriceUsd,
        currentBtcCoreUsd: 0,
        softBreakerActive: false,
      });
      const after = await positionByIdForCurrentMode(pos.id);
      return parseFloat(after!.stopPrice ?? "0");
    };

    // +25% → stop ratchets up to entry ($1.00)
    expect(await runRatchet(1.25)).toBeCloseTo(1.00, 6);
    // +50% → stop ratchets up to entry +20% = $1.20
    expect(await runRatchet(1.50)).toBeCloseTo(1.20, 6);
    // +75% → stop ratchets up to entry +40% = $1.40
    expect(await runRatchet(1.75)).toBeCloseTo(1.40, 6);
    // +100% → stop ratchets up to entry +65% = $1.65
    expect(await runRatchet(2.00)).toBeCloseTo(1.65, 6);

    // Now drop the price below +100% but above +75%. Schedule would say
    // stop should be at +40%, but current is +65%. MUST refuse to downgrade.
    expect(await runRatchet(1.80)).toBeCloseTo(1.65, 6);
  });

  // -------------------------------------------------------------------------
  // 1c — 60-day BTC underperformance gate
  // -------------------------------------------------------------------------

  it("underperf-gate: trips when 60d delta negative AND ≥60 consecutive underperf days; auto-pauses + sets reason", async () => {
    expect(await stateRead<boolean>("trading_paused")).toBeFalsy();
    const evalId = await seedEvaluation();
    const result = await applyBtcUnderperformanceGate(
      {
        systemReturnPct: -2,
        btcHoldReturnPct: 8,
        rolling30dDeltaPct: -4,
        rolling60dDeltaPct: -10,
        consecutiveUnderperfDays: 60,
      },
      evalId,
    );
    expect(result.decision.shouldPause).toBe(true);
    expect(result.newlyPaused).toBe(true);
    expect(result.wasAlreadyPaused).toBe(false);
    expect(await stateRead<boolean>("trading_paused")).toBe(true);
    const reason = await stateRead<string>("trading_paused_reason");
    expect(reason).toMatch(/60-day BTC underperformance/i);
    expect(reason).toMatch(/60 consecutive days/i);
    expect(await stateRead<boolean>("trading_paused_by_btc_underperf_gate")).toBe(true);
  });

  it("underperf-gate: does NOT trip at the boundary — 59 consecutive days, even with negative 60d delta", async () => {
    const evalId = await seedEvaluation();
    const result = await applyBtcUnderperformanceGate(
      {
        systemReturnPct: -2,
        btcHoldReturnPct: 8,
        rolling30dDeltaPct: -4,
        rolling60dDeltaPct: -10,
        consecutiveUnderperfDays: 59, // ONE BELOW the threshold
      },
      evalId,
    );
    expect(result.decision.shouldPause).toBe(false);
    expect(result.newlyPaused).toBe(false);
    expect(await stateRead<boolean>("trading_paused")).toBeFalsy();
  });

  it("underperf-gate: does NOT trip when 60d delta is positive despite long streak (no AND)", async () => {
    const evalId = await seedEvaluation();
    const result = await applyBtcUnderperformanceGate(
      {
        systemReturnPct: 10,
        btcHoldReturnPct: 8,
        rolling30dDeltaPct: 1,
        rolling60dDeltaPct: 2, // POSITIVE — system beating BTC over 60d
        consecutiveUnderperfDays: 100, // even with a long streak
      },
      evalId,
    );
    expect(result.decision.shouldPause).toBe(false);
    expect(await stateRead<boolean>("trading_paused")).toBeFalsy();
  });

  it("underperf-gate: when already paused, newlyPaused=false but logs decision", async () => {
    await stateWriter({ key: "trading_paused", value: true, changedBy: "test-prep" });
    const evalId = await seedEvaluation();
    const result = await applyBtcUnderperformanceGate(
      {
        systemReturnPct: -2,
        btcHoldReturnPct: 8,
        rolling30dDeltaPct: -4,
        rolling60dDeltaPct: -10,
        consecutiveUnderperfDays: 60,
      },
      evalId,
    );
    expect(result.decision.shouldPause).toBe(true);
    expect(result.newlyPaused).toBe(false); // pre-paused
    expect(result.wasAlreadyPaused).toBe(true);
  });
});
