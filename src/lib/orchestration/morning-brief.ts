import { getCandles, getTicker } from "@/lib/coinbase";
import { stateRead, stateWriter } from "@/lib/db/utils";
import { setCurrentMode } from "@/lib/mode";
import { getExecutor } from "@/lib/execution";
import { runMorningBrief } from "@/lib/ai/flows/morning-brief";
import {
  type OpusMorningPackageInput,
  type AssetPriceData,
  type NewsArticle,
} from "@/lib/ai/packages/opus-morning";
import { assemblePortfolioSnapshot } from "@/lib/ai/portfolio";
import { computeBenchmarkSummary } from "@/lib/orchestration/btc-benchmark";
import {
  executeBriefDecisions,
  type DecisionExecutorResult,
} from "@/lib/orchestration/decision-executor";
import { applyBtcUnderperformanceGate } from "@/lib/risk/btc-underperformance-gate";
import { openPositionsForCurrentMode } from "@/lib/db/queries/positions";
import { pollAllFeeds, matchKeywords } from "@/lib/news";
import {
  CORE_ASSETS,
  CYCLE_WATCHLIST,
  productIdFor,
  type Asset,
} from "@/lib/strategy/constants";
import { log } from "@/lib/logger";
import { withActivity } from "@/lib/activity/tracker";
import type { MorningBrief } from "@/lib/ai/schemas";

/**
 * End-to-end orchestration for a scheduled (or operator-forced) morning
 * brief. Pulls together:
 *   - Portfolio snapshot from DB + current Coinbase balances + BTC price
 *   - Multi-timeframe candles for BTC, ETH, and each watchlist alt
 *   - Recent news from RSS feeds (matched against watchlist + macro keywords)
 *   - Yesterday's brief recap (if available)
 *
 * Then calls runMorningBrief which handles the budget gate, Opus call,
 * schema validation, and watch-list persistence.
 *
 * This is the function the Phase 5 scheduler dispatches at 14:00 UTC and
 * the operator's "force brief" control wires to.
 */

export interface ScheduledBriefResult {
  ok: true;
  brief: MorningBrief;
  evaluationId: string;
  costUsd: number;
  /** Result of executing the brief's trading decisions. */
  execution: DecisionExecutorResult;
}

export interface ScheduledBriefError {
  ok: false;
  error: string;
}

const SECONDS_PER_DAY = 86_400;

export async function runScheduledMorningBrief(): Promise<
  ScheduledBriefResult | ScheduledBriefError
> {
  return withActivity(
    "morning_brief",
    "Morning brief (Opus)",
    () => runScheduledMorningBriefImpl(),
    "Daily 14:00 UTC orchestration: portfolio + candles + news + Opus call",
  );
}

async function runScheduledMorningBriefImpl(): Promise<
  ScheduledBriefResult | ScheduledBriefError
> {
  log.info("Morning brief orchestration starting");

  try {
    // Seed the mode singleton from state (the dashboard routes do the same).
    const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
    setCurrentMode(paperMode ? "paper" : "live");

    // Cash MUST come from the executor — never directly from Coinbase. The
    // paper executor returns synthetic paper cash (starting capital + fills);
    // the live executor returns real USD+USDC. Mixing the two would let the
    // bot's paper-mode plan reference the real wallet — exactly the leak
    // STRATEGY.md §13.6 forbids.
    const executor = getExecutor();
    const cashUsd = await executor.getCashBalanceUsd();
    const btcTicker = await getTicker("BTC-USD");

    // For now we approximate position value as "cash + 0 positions" — Phase 9's
    // full mark-to-market loop fills this in once equity snapshots are wired.
    const portfolio = await assemblePortfolioSnapshot({
      cashUsd,
      positionsValueUsd: 0,
      currentBtcPrice: btcTicker.midPrice,
    });

    // Asset price data for each tracked asset
    const assets = await fetchAssetData([...CORE_ASSETS, ...CYCLE_WATCHLIST]);

    // Recent news matching watchlist keywords + macro terms
    const recentNews = await fetchRecentNews();

    // Rolling 30d/60d performance vs BTC, plus the trailing-underperf-day run
    // that the 60-day circuit breaker watches.
    const benchmark = await computeBenchmarkSummary({
      now: new Date(),
      currentBtcPriceUsd: btcTicker.midPrice,
      currentEquityUsd: portfolio.currentTotalValueUsd,
    });

    const input: OpusMorningPackageInput = {
      timestamp: new Date(),
      portfolio,
      assets,
      btcDominance30dAvg: undefined,
      btcDominanceCurrent: undefined,
      recentNews,
      yesterday: undefined, // populated once we have a previous-day eval reference
      benchmarkSummary: {
        rolling30dDeltaPct: benchmark.rolling30dDeltaPct,
        rolling60dDeltaPct: benchmark.rolling60dDeltaPct,
        consecutiveUnderperfDays: benchmark.consecutiveUnderperfDays,
      },
      behavioral: {
        cooldownActive: false,
        cooldownUntil: null,
        consecutiveLosses: 0,
        consecutiveWins: 0,
        drawdownLevel: "none",
      },
    };

    const result = await runMorningBrief(input);

    // ── 60-day BTC underperformance gate (STRATEGY.md §4.4) ──────────────
    // Run BEFORE executing decisions so the executor's preflight (which
    // reads trading_paused) immediately blocks any orders this brief would
    // have placed if the gate trips.
    await applyBtcUnderperformanceGate(
      {
        systemReturnPct: portfolio.systemReturnPct,
        btcHoldReturnPct:
          portfolio.btcOutperformancePct != null
            ? portfolio.systemReturnPct - portfolio.btcOutperformancePct
            : 0,
        rolling30dDeltaPct: benchmark.rolling30dDeltaPct,
        rolling60dDeltaPct: benchmark.rolling60dDeltaPct,
        consecutiveUnderperfDays: benchmark.consecutiveUnderperfDays,
      },
      result.evaluationId,
    );

    // ── Execute the brief's decisions (BUILD_PLAN.md §4D) ────────────────
    // This is the AI → orders bridge. Pre-flight gates inside the executor
    // refuse to act when paused / halted / hard-floor breached.
    const priceMap: Record<string, number> = {};
    for (const a of assets) priceMap[a.asset.toUpperCase()] = a.currentPrice;
    priceMap.BTC = btcTicker.midPrice;

    const openPositions = await openPositionsForCurrentMode();
    let altExposureUsd = 0;
    let btcCoreUsd = 0;
    for (const p of openPositions) {
      const qty = parseFloat(p.quantity);
      const price = priceMap[p.asset.toUpperCase()];
      const value = price != null && Number.isFinite(price) ? qty * price : 0;
      if (p.type === "alt_cycle") altExposureUsd += value;
      else if (p.type === "btc_core") btcCoreUsd += value;
    }

    const execution = await executeBriefDecisions(result.brief, {
      evaluationId: result.evaluationId,
      accountValueUsd: portfolio.currentTotalValueUsd,
      cashUsd,
      currentPrices: priceMap,
      currentAltExposureUsd: altExposureUsd,
      currentBtcCoreUsd: btcCoreUsd,
      softBreakerActive: false, // wired when soft breaker state is tracked
    });

    log.info("Brief decisions executed", {
      evaluationId: result.evaluationId,
      ran: execution.ran,
      ordersPlaced: execution.ordersPlacedCount,
      totalPlacedUsd: execution.totalPlacedUsd,
      shortCircuit: execution.shortCircuitReason,
    });

    // Persist last_*_price_at_eval for the 5%+ price-move detector.
    await stateWriter({
      key: "last_btc_price_at_eval",
      value: btcTicker.midPrice,
      changedBy: "orchestration.morning-brief",
    });
    const ethTicker = assets.find((a) => a.asset === "ETH");
    if (ethTicker) {
      await stateWriter({
        key: "last_eth_price_at_eval",
        value: ethTicker.currentPrice,
        changedBy: "orchestration.morning-brief",
      });
    }
    const solTicker = assets.find((a) => a.asset === "SOL");
    if (solTicker) {
      await stateWriter({
        key: "last_sol_price_at_eval",
        value: solTicker.currentPrice,
        changedBy: "orchestration.morning-brief",
      });
    }

    // Schedule the next eval at 14:00 UTC tomorrow (rough — the scheduler
    // computes the actual fire time on each tick).
    const nextDay = new Date();
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    nextDay.setUTCHours(14, 0, 0, 0);
    await stateWriter({
      key: "next_eval_at",
      value: nextDay.toISOString(),
      changedBy: "orchestration.morning-brief",
    });

    log.info("Morning brief orchestration complete", {
      evaluationId: result.evaluationId,
      regime: result.brief.regime,
      costUsd: result.costUsd,
    });

    return {
      ok: true,
      brief: result.brief,
      evaluationId: result.evaluationId,
      costUsd: result.costUsd,
      execution,
    };
  } catch (err) {
    const message = (err as Error).message;
    log.error("Morning brief orchestration failed", { error: message });
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Asset data fetcher
// ---------------------------------------------------------------------------

async function fetchAssetData(assets: readonly string[]): Promise<AssetPriceData[]> {
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - 365 * SECONDS_PER_DAY;
  const thirtyDaysAgo = now - 30 * SECONDS_PER_DAY;
  const sevenDaysAgo = now - 7 * SECONDS_PER_DAY;

  const results = await Promise.all(
    assets.map(async (asset) => {
      const productId = productIdFor(asset);
      const isCore = (CORE_ASSETS as readonly string[]).includes(asset.toUpperCase());

      const [daily, fourHour, oneHour, ticker] = await Promise.all([
        getCandles(productId, "ONE_DAY", oneYearAgo, now).catch(() => []),
        isCore
          ? getCandles(productId, "FOUR_HOUR" as never, thirtyDaysAgo, now).catch(() => [])
          : Promise.resolve([]),
        isCore
          ? getCandles(productId, "ONE_HOUR", sevenDaysAgo, now).catch(() => [])
          : Promise.resolve([]),
        getTicker(productId).catch(() => ({ midPrice: 0 })),
      ]);

      return {
        asset: asset.toUpperCase() as Asset,
        daily,
        fourHour: isCore ? fourHour : undefined,
        oneHour: isCore ? oneHour : undefined,
        currentPrice: ticker.midPrice,
      };
    }),
  );

  return results;
}

// ---------------------------------------------------------------------------
// News fetch
// ---------------------------------------------------------------------------

const MACRO_KEYWORDS = [
  "fed",
  "fomc",
  "cpi",
  "inflation",
  "rate cut",
  "rate hike",
  "etf",
  "btc",
  "bitcoin",
  "ethereum",
  "regulation",
  "sec",
];

async function fetchRecentNews(): Promise<NewsArticle[]> {
  try {
    const items = await pollAllFeeds(); // dedup state lives in caller; not needed for one-shot brief
    const allKeywords = [
      ...MACRO_KEYWORDS,
      ...CYCLE_WATCHLIST.map((a) => a.toLowerCase()),
    ];
    const matches = matchKeywords(items, allKeywords);
    return matches.slice(0, 25).map((m) => ({
      feedName: m.item.feedName,
      title: m.item.title,
      link: m.item.link,
      publishedAt: m.item.publishedAt,
      matchedKeywords: m.matchedKeywords,
    }));
  } catch (err) {
    log.warn("News fetch failed during morning brief", { error: (err as Error).message });
    return [];
  }
}
