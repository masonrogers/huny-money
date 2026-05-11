import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { stateWriter } from "@/lib/db/utils";
import { bootConstructExecutor } from "@/lib/execution";
import {
  ordersForCurrentMode,
  sumFilledOrderFeesForPositionForCurrentMode,
} from "@/lib/db/queries/orders";
import { openPositionsForCurrentMode } from "@/lib/db/queries/positions";
import { insertEvaluation } from "@/lib/db/queries/evaluations";
import { executeBriefDecisions } from "@/lib/orchestration/decision-executor";
import type { MorningBrief } from "@/lib/ai/schemas";
import { STRATEGY_VERSION } from "@/lib/strategy/constants";
import { integrationEnabled, resetIntegration, teardownIntegration } from "./setup";

/**
 * Insert a placeholder evaluation row and return its id. The decision executor
 * threads `ctx.evaluationId` through stateWriter → system_state_history, which
 * has a FK to evaluations.id, so a string UUID alone isn't enough — the row
 * must actually exist.
 */
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

/**
 * FINDINGS.md #33 — BTC core dca_in and dca_out/exit paths used to place
 * orders without `relatedPositionId`, so `sumFilledOrderFeesForPositionForCurrentMode`
 * returned 0 fees for BTC core trades and every close path's `netPnl` was
 * silently equal to `grossPnl`. This test pins the linkage so any future
 * refactor that drops the post-hoc `updateOrder` (dca_in) or the
 * `placeMarketExit` options arg (dca_out/exit) fails before shipping.
 *
 * Live-verified gap on 2026-05-11 (paper $5k BTC buy: close-all returned
 * `feesUsd: 0` despite cash being correctly debited $30 by the fill).
 */

const TAKER = 0.006;

const { mockState } = vi.hoisted(() => ({
  mockState: { prices: { BTC: 80_000 } as Record<string, number> },
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

function makeBrief(overrides: Partial<MorningBrief> = {}): MorningBrief {
  return {
    regime: "chop",
    regime_evidence: "test evidence",
    regime_changed_from: null,
    btc_core_decision: {
      current_alloc_pct: 0,
      target_alloc_pct: 50,
      action: "dca_in",
      tranches_planned: 1,
      reasoning: "test dca_in into 50% BTC core",
    },
    alt_positions: [],
    alt_entry_candidates: [],
    watch_list: [],
    btc_benchmark_assessment: "test benchmark",
    discipline_check: "test discipline check",
    ...overrides,
  };
}

describe.skipIf(!integrationEnabled)(
  "integration: BTC core orders link to their position (#33)",
  () => {
    beforeEach(async () => {
      await resetIntegration();
      await stateWriter({ key: "paper_mode", value: true, changedBy: "test" });
      await stateWriter({
        key: "starting_capital_paper_usd",
        value: 10_000,
        changedBy: "test",
      });
      mockState.prices = { BTC: 80_000 };
    });
    afterAll(async () => {
      await teardownIntegration();
    });

    it("dca_in: entry order's relatedPositionId == positions[0].id; fees aggregate", async () => {
      const { executor } = await bootConstructExecutor();
      const brief = makeBrief();

      await executeBriefDecisions(brief, {
        evaluationId: await seedEvaluation(),
        accountValueUsd: 10_000,
        cashUsd: 10_000,
        currentPrices: { BTC: 80_000 },
        currentAltExposureUsd: 0,
        currentBtcCoreUsd: 0,
        softBreakerActive: false,
      });

      const positions = await openPositionsForCurrentMode();
      expect(positions).toHaveLength(1);
      const position = positions[0]!;
      expect(position.type).toBe("btc_core");
      expect(position.asset).toBe("BTC");

      const orders = await ordersForCurrentMode();
      expect(orders).toHaveLength(1);
      const entryOrder = orders[0]!;
      expect(entryOrder.type).toBe("dca_limit");
      expect(entryOrder.status).toBe("filled");
      expect(entryOrder.relatedPositionId).toBe(position.id);

      // Fee aggregation must see this order: $5,000 notional * 0.6% taker = $30
      const feesUsd = await sumFilledOrderFeesForPositionForCurrentMode(
        position.id,
      );
      expect(feesUsd).toBeCloseTo(5_000 * TAKER, 4);
      void executor;
    });

    it("dca_in twice: weighted-avg position has BOTH entry orders linked", async () => {
      const { executor } = await bootConstructExecutor();
      // First brief: open BTC core.
      await executeBriefDecisions(makeBrief(), {
        evaluationId: await seedEvaluation(),
        accountValueUsd: 10_000,
        cashUsd: 10_000,
        currentPrices: { BTC: 80_000 },
        currentAltExposureUsd: 0,
        currentBtcCoreUsd: 0,
        softBreakerActive: false,
      });
      const afterFirst = await openPositionsForCurrentMode();
      expect(afterFirst).toHaveLength(1);
      const positionId = afterFirst[0]!.id;

      // Bump price + flip regime to bull so the sizing cap rises to 70% of
      // account ($7,000); current BTC core is $5,000 → +$2,000 delta. Without
      // the regime change the chop sizing cap of $5,000 == current → no order
      // placed, and we wouldn't actually exercise the existingBtcCore branch.
      mockState.prices = { BTC: 82_000 };
      await executeBriefDecisions(
        makeBrief({
          regime: "bull",
          regime_evidence: "bull regime evidence",
          btc_core_decision: {
            current_alloc_pct: 50,
            target_alloc_pct: 70,
            action: "dca_in",
            tranches_planned: 1,
            reasoning: "add to BTC core",
          },
        }),
        {
          evaluationId: await seedEvaluation(),
          accountValueUsd: 10_000,
          cashUsd: 4_970,
          currentPrices: { BTC: 82_000 },
          currentAltExposureUsd: 0,
          currentBtcCoreUsd: 5_000,
          softBreakerActive: false,
        },
      );

      const orders = await ordersForCurrentMode();
      expect(orders).toHaveLength(2);
      // BOTH orders must be linked (regression on the existingBtcCore branch).
      for (const o of orders) {
        expect(o.relatedPositionId).toBe(positionId);
      }
      const feesUsd = await sumFilledOrderFeesForPositionForCurrentMode(positionId);
      // First trade: $5,000 * 0.6% = $30; second trade: $2,000 * 0.6% = $12 → $42
      expect(feesUsd).toBeCloseTo(42, 4);
      void executor;
    });

    it("exit: market-exit order's relatedPositionId == position.id", async () => {
      const { executor } = await bootConstructExecutor();
      // Establish a BTC core position via dca_in.
      await executeBriefDecisions(makeBrief(), {
        evaluationId: await seedEvaluation(),
        accountValueUsd: 10_000,
        cashUsd: 10_000,
        currentPrices: { BTC: 80_000 },
        currentAltExposureUsd: 0,
        currentBtcCoreUsd: 0,
        softBreakerActive: false,
      });
      const opened = await openPositionsForCurrentMode();
      const positionId = opened[0]!.id;

      // Now exit.
      await executeBriefDecisions(
        makeBrief({
          regime: "bear",
          regime_evidence: "bear evidence",
          btc_core_decision: {
            current_alloc_pct: 50,
            target_alloc_pct: 0,
            action: "exit",
            tranches_planned: 1,
            reasoning: "bear regime exit",
          },
        }),
        {
          evaluationId: await seedEvaluation(),
          accountValueUsd: 10_000,
          cashUsd: 4_970,
          currentPrices: { BTC: 80_000 },
          currentAltExposureUsd: 0,
          currentBtcCoreUsd: 5_000,
          softBreakerActive: false,
        },
      );

      const orders = await ordersForCurrentMode();
      // 1 entry (dca_in) + 1 exit (market_exit) = 2 orders, both linked.
      expect(orders).toHaveLength(2);
      for (const o of orders) {
        expect(o.relatedPositionId).toBe(positionId);
      }
      void executor;
    });
  },
);
