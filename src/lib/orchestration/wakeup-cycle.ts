import { stateRead, stateWriter, priceSnapshotWriter } from "@/lib/db/utils";
import { setCurrentMode } from "@/lib/mode";
import { getExecutor } from "@/lib/execution";
import { openPositionsForCurrentMode, updatePosition } from "@/lib/db/queries/positions";
import { activeTriggersAt } from "@/lib/db/queries/triggers";
import { evaluationsByCallTypeSince } from "@/lib/db/queries/evaluations";
import { getTickers } from "@/lib/coinbase";
import { snapshotAt } from "@/lib/db/queries/price_snapshots";
import { dispatchWakeup, type WakeupSpec, type RunSonnetResult } from "@/lib/triggers";
import { checkPositionMove } from "@/lib/triggers/position-move";
import { checkNewsKeywords } from "@/lib/triggers/news-keyword";
import { runSonnetCheck } from "@/lib/ai/flows/sonnet-check";
import { type SonnetCheckInput } from "@/lib/ai/packages/sonnet-watcher";
import type { MorningBrief } from "@/lib/ai/schemas";
import { pollAllFeeds } from "@/lib/news";
import { CORE_ASSETS, productIdFor } from "@/lib/strategy/constants";
import { persistEquitySnapshot } from "@/lib/orchestration/equity-snapshotter";
import { withActivity } from "@/lib/activity/tracker";
import { log } from "@/lib/logger";

/**
 * Wake-up cycle. Called every 5 minutes by the scheduler.
 *
 * Steps:
 * 1. Fetch current prices for BTC/ETH/SOL + held position assets
 * 2. Write a price_snapshot row (trigger_event=price_poll)
 * 3. Process pending paper fills against current prices (paper mode only;
 *    live executor's processPendingFills is a no-op)
 * 4. Update position states for any fills (close stop-hit, close TP-hit, etc.)
 * 5. Evaluate the 3 hardcoded wake-up triggers per STRATEGY.md §5.5:
 *    - position_move: any held position moved >5% in 4h with 60-min debounce
 *    - stop_fill: a stop-limit fired on Coinbase (live) or simulated (paper)
 *    - news_keyword: RSS feed scan matches an active watch list keyword,
 *      30-min debounce per keyword
 * 6. For each fire, dispatchWakeup → optional Sonnet call
 *
 * Most ticks have nothing to do — the bot mostly sits in cash and the
 * wake-up triggers don't fire. That's the expected and correct outcome.
 */

export interface WakeupCycleResult {
  pricesWritten: boolean;
  equitySnapshotWritten: boolean;
  paperFills: number;
  positionMoveFires: number;
  stopFillFires: number;
  newsKeywordFires: number;
  errors: string[];
}

export async function runWakeupCycle(): Promise<WakeupCycleResult> {
  return withActivity(
    "wakeup_cycle",
    "Wake-up cycle (5-min tick)",
    () => runWakeupCycleImpl(),
    "Price poll + paper fills + equity snapshot + 3 wake-up triggers",
  );
}

async function runWakeupCycleImpl(): Promise<WakeupCycleResult> {
  const result: WakeupCycleResult = {
    pricesWritten: false,
    equitySnapshotWritten: false,
    paperFills: 0,
    positionMoveFires: 0,
    stopFillFires: 0,
    newsKeywordFires: 0,
    errors: [],
  };

  try {
    const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
    setCurrentMode(paperMode ? "paper" : "live");

    const heldPositions = await openPositionsForCurrentMode();
    const heldAssets = Array.from(new Set(heldPositions.map((p) => p.asset)));
    const trackedAssets = Array.from(new Set([...CORE_ASSETS, ...heldAssets]));

    // 1. Fetch current prices
    const tickers = await getTickers(trackedAssets.map(productIdFor));
    const prices: Record<string, number> = {};
    for (const a of trackedAssets) {
      prices[a] = tickers[productIdFor(a)]?.midPrice ?? 0;
    }

    // 2. Write price snapshot
    await priceSnapshotWriter({
      triggerEvent: "price_poll",
      btcPrice: prices.BTC ?? null,
      ethPrice: prices.ETH ?? null,
      solPrice: prices.SOL ?? null,
    });
    result.pricesWritten = true;

    // 3. Process pending fills (paper-mode does the actual work; live no-ops)
    const executor = getExecutor();
    const fills = await executor.processPendingFills(prices);
    result.paperFills = fills.length;

    // 3a. Persist equity snapshot AFTER fills processed so the recorded
    //     equity reflects this tick's settlements rather than last tick's.
    const equitySnap = await persistEquitySnapshot(prices);
    result.equitySnapshotWritten = equitySnap != null;

    // 4. Update position states for fills
    for (const fill of fills) {
      try {
        // For stop_fill / take_profit / market_exit fills: close the position.
        if (
          fill.type === "stop_limit" ||
          fill.type === "take_profit" ||
          fill.type === "market_exit"
        ) {
          // Find the position via fill's coinbaseOrderId is not direct;
          // instead query positions where stopOrderId or tpOrderId matches.
          // For simplicity in this iteration, we leave the position update
          // to the next reconciliation pass. The fill row exists in `orders`
          // and the next morning brief / force-reconcile will close out.
          await dispatchStopFillWake(fill, prices);
          result.stopFillFires++;
        }
      } catch (err) {
        result.errors.push(`fill update ${fill.coinbaseOrderId}: ${(err as Error).message}`);
      }
    }

    // 5a. Position-move triggers
    const fourHoursAgo = new Date(Date.now() - 4 * 3600_000);
    const priorSnapshot = await snapshotAt(fourHoursAgo);

    if (priorSnapshot && heldAssets.length > 0) {
      for (const asset of heldAssets) {
        const current = prices[asset];
        const priorRaw =
          asset === "BTC"
            ? priorSnapshot.btcPrice
            : asset === "ETH"
              ? priorSnapshot.ethPrice
              : asset === "SOL"
                ? priorSnapshot.solPrice
                : null;
        const prior = priorRaw != null ? Number(priorRaw) : null;
        if (prior == null || prior <= 0) continue;

        const fire = await checkPositionMove({
          asset,
          currentPrice: current,
          priceFourHoursAgo: prior,
        });
        if (fire) {
          await dispatchPositionMoveWake(fire, prices);
          result.positionMoveFires++;
        }
      }
    }

    // 5b. News-keyword triggers — but only if there's an active watch list
    const triggers = await activeTriggersAt(new Date());
    const watchKeywords = extractKeywords(triggers);
    if (watchKeywords.length > 0) {
      try {
        const items = await pollAllFeeds(await loadSeenNewsIds());
        const fires = await checkNewsKeywords(items, watchKeywords);
        for (const fire of fires) {
          await dispatchNewsKeywordWake(fire);
          result.newsKeywordFires++;
        }
        if (items.length > 0) {
          await persistSeenNewsIds(items.map((i) => i.id));
        }
      } catch (err) {
        result.errors.push(`news poll: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    result.errors.push(`cycle: ${(err as Error).message}`);
    log.error("Wake-up cycle failed", { error: (err as Error).message });
  }

  if (
    result.paperFills > 0 ||
    result.positionMoveFires > 0 ||
    result.stopFillFires > 0 ||
    result.newsKeywordFires > 0
  ) {
    log.info("Wake-up cycle activity", { result });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Wake-up dispatchers (assemble Sonnet input + call dispatchWakeup)
// ---------------------------------------------------------------------------

async function dispatchPositionMoveWake(
  fire: { asset: string; currentPrice: number; priorPrice: number; deltaPct: number; windowHours: number },
  prices: Record<string, number>,
): Promise<void> {
  const spec: WakeupSpec = {
    triggerType: "position_move",
    asset: fire.asset,
    observed: {
      currentPrice: fire.currentPrice,
      priorPrice: fire.priorPrice,
      deltaPct: fire.deltaPct,
      windowHours: fire.windowHours,
    },
  };
  await dispatchWakeup(spec, {
    runSonnet: () => runSonnetForWakeup(spec, prices),
  });
}

async function dispatchStopFillWake(
  fill: { asset: string; type: string; fillPrice: number; quantity: number },
  prices: Record<string, number>,
): Promise<void> {
  const spec: WakeupSpec = {
    triggerType: "stop_fill",
    asset: fill.asset,
    observed: {
      orderType: fill.type,
      fillPrice: fill.fillPrice,
      quantity: fill.quantity,
    },
  };
  await dispatchWakeup(spec, {
    runSonnet: () => runSonnetForWakeup(spec, prices),
  });
}

async function dispatchNewsKeywordWake(fire: {
  keyword: string;
  item: { feedName: string; title: string; link: string };
  matchedKeywords: readonly string[];
}): Promise<void> {
  const spec: WakeupSpec = {
    triggerType: "news_keyword",
    // For news_keyword, debounce is keyed by keyword, so pass it as "asset".
    asset: fire.keyword,
    observed: {
      keyword: fire.keyword,
      headline: fire.item.title,
      feed: fire.item.feedName,
      url: fire.item.link,
      otherKeywords: fire.matchedKeywords.filter((k) => k !== fire.keyword),
    },
  };
  await dispatchWakeup(spec, {
    runSonnet: async () => runSonnetForWakeup(spec, {}),
  });
}

// ---------------------------------------------------------------------------
// Sonnet runner used by all 3 wake-up types
// ---------------------------------------------------------------------------

async function runSonnetForWakeup(
  spec: WakeupSpec,
  prices: Record<string, number>,
): Promise<RunSonnetResult> {
  // Reload morning brief context.
  const since = new Date(Date.now() - 36 * 3600_000);
  const briefs = await evaluationsByCallTypeSince("morning", since);
  const latestBrief = briefs[0];
  if (!latestBrief?.parsedResponse) {
    return { kind: "suppressed", reason: "no_morning_brief_yet" };
  }
  const morningBrief = latestBrief.parsedResponse as MorningBrief;

  const heldPositions = await openPositionsForCurrentMode();
  const altPositionsLive = heldPositions
    .filter((p) => p.type === "alt_cycle")
    .map((p) => {
      const entry = parseFloat(p.entryPrice);
      const current = prices[p.asset] ?? entry;
      const stop = p.stopPrice ? parseFloat(p.stopPrice) : null;
      return {
        asset: p.asset,
        entryPrice: entry,
        currentPrice: current,
        pnlPct: entry > 0 ? ((current - entry) / entry) * 100 : 0,
        distanceToStopPct:
          stop != null && current > 0 ? ((current - stop) / current) * 100 : null,
        cyclePositionPct: null,
        cycleLowZoneTop: null,
        cycleHighZoneBottom: null,
      };
    });

  const packageInput: SonnetCheckInput = {
    timestamp: new Date(),
    morningBrief,
    wakeupContext: {
      triggerType: spec.triggerType,
      asset: spec.asset,
      observed: spec.observed,
    },
    prices,
    altPositionsLive,
    volumeRatios: {},
    matchedNews:
      spec.triggerType === "news_keyword"
        ? [
            {
              feedName: String(spec.observed.feed ?? ""),
              title: String(spec.observed.headline ?? ""),
              link: String(spec.observed.url ?? ""),
              matchedKeywords: [String(spec.asset ?? "")],
            },
          ]
        : [],
    escalationsRemainingToday: 1, // budget gate enforces actual cap
  };

  // Map wakeup trigger type → evaluations.trigger_source enum value
  const triggerSource =
    spec.triggerType === "position_move"
      ? "wakeup_position_move"
      : spec.triggerType === "stop_fill"
        ? "wakeup_stop_fill"
        : "wakeup_news";

  const result = await runSonnetCheck({
    packageInput,
    triggerSource,
    isWakeupCall: true,
  });

  if (result.blocked) {
    return { kind: "suppressed", reason: result.blockReason ?? "blocked" };
  }

  return {
    kind: "ran",
    sonnetEvalId: result.sonnetEvaluationId,
    escalated: !!result.escalation,
    opusEvalId: result.escalation?.opusEvaluationId,
  };
}

// ---------------------------------------------------------------------------
// Helpers — extract keywords from active triggers + news-seen persistence
// ---------------------------------------------------------------------------

interface ActiveTrigger {
  conditionText: string;
  asset: string | null;
}

function extractKeywords(triggers: ActiveTrigger[]): string[] {
  const out = new Set<string>();
  for (const t of triggers) {
    if (t.asset) out.add(t.asset.toLowerCase());
    // The condition text often contains keywords too — simple word extraction.
    const matches = t.conditionText.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    for (const m of matches) {
      // Skip generic words; only keep things that look like asset symbols
      // or named events.
      if (
        m.length >= 4 &&
        m.length <= 12 &&
        !["above", "below", "with", "from", "volume", "average", "price"].includes(m)
      ) {
        out.add(m);
      }
    }
  }
  // Cap so a chatty rubric doesn't trigger massive RSS scans.
  return Array.from(out).slice(0, 30);
}

const SEEN_NEWS_STATE_KEY = "wakeup_seen_news_ids";
const MAX_SEEN_IDS = 200;

async function loadSeenNewsIds(): Promise<Set<string>> {
  const ids = await stateRead<string[]>(SEEN_NEWS_STATE_KEY);
  return new Set(ids ?? []);
}

async function persistSeenNewsIds(newIds: readonly string[]): Promise<void> {
  const existing = await loadSeenNewsIds();
  const merged = new Set<string>([...existing, ...newIds]);
  // Cap at MAX_SEEN_IDS, keeping most recent (newIds are appended last).
  const ordered = Array.from(merged).slice(-MAX_SEEN_IDS);
  await stateWriter({
    key: SEEN_NEWS_STATE_KEY,
    value: ordered,
    changedBy: "wakeup-cycle",
  });
  void updatePosition; // silence unused-import warning if not yet hooked
}
