import { stateRead } from "@/lib/db/utils";
import { setCurrentMode } from "@/lib/mode";
import { evaluationsByCallTypeSince } from "@/lib/db/queries/evaluations";
import { openPositionsForCurrentMode } from "@/lib/db/queries/positions";
import { getTickers } from "@/lib/coinbase";
import { getCandles } from "@/lib/coinbase";
import { volumeRatio } from "@/lib/indicators";
import { ohlcFromCandles } from "@/lib/candles/compress";
import { runSonnetCheck } from "@/lib/ai/flows/sonnet-check";
import { type SonnetCheckInput } from "@/lib/ai/packages/sonnet-watcher";
import type { MorningBrief } from "@/lib/ai/schemas";
import { CORE_ASSETS, productIdFor } from "@/lib/strategy/constants";
import { MAX_OPUS_CALLS_PER_DAY } from "@/lib/anthropic";
import { withActivity } from "@/lib/activity/tracker";
import { log } from "@/lib/logger";

/**
 * Scheduled Sonnet checkpoint orchestration. Called by the scheduler at
 * 06:00 and 22:00 UTC.
 *
 * Reads today's morning brief (latest `morning` evaluation), assembles the
 * slim Sonnet package, calls runSonnetCheck (which gates the budget,
 * calls Sonnet, parses, and optionally escalates to Opus).
 *
 * If no morning brief exists yet, the checkpoint is logged as
 * `awaiting_brief` and skipped — Sonnet has no rubric to evaluate
 * without one.
 */

export type SonnetCheckpointResult =
  | { ok: true; sonnetEvalId: string; escalated: boolean; opusEvalId?: string }
  | { ok: false; reason: string };

export async function runScheduledSonnetCheckpoint(): Promise<SonnetCheckpointResult> {
  return withActivity(
    "sonnet_check",
    "Sonnet checkpoint",
    () => runScheduledSonnetCheckpointImpl(),
    "06:00 / 22:00 UTC orchestration: brief recall + slim package + Sonnet call",
  );
}

async function runScheduledSonnetCheckpointImpl(): Promise<SonnetCheckpointResult> {
  log.info("Sonnet checkpoint orchestration starting");

  try {
    const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
    setCurrentMode(paperMode ? "paper" : "live");

    // Find today's morning brief — most recent `morning` evaluation in the
    // last 36 hours (covers the longest brief→checkpoint gap).
    const since = new Date(Date.now() - 36 * 3600_000);
    const briefs = await evaluationsByCallTypeSince("morning", since);
    const latestBrief = briefs[0];

    if (!latestBrief?.parsedResponse) {
      log.warn("Sonnet checkpoint skipped — no recent morning brief");
      return { ok: false, reason: "awaiting_morning_brief" };
    }

    const morningBrief = latestBrief.parsedResponse as MorningBrief;

    // Current prices for everything in play.
    const heldPositions = await openPositionsForCurrentMode();
    const heldAssets = Array.from(new Set(heldPositions.map((p) => p.asset)));
    const allAssets = Array.from(new Set([...CORE_ASSETS, ...heldAssets]));
    const tickers = await getTickers(allAssets.map(productIdFor));
    const prices: Record<string, number> = {};
    for (const a of allAssets) {
      prices[a] = tickers[productIdFor(a)]?.midPrice ?? 0;
    }

    // Live alt position state with cycle zone context.
    const altPositionsLive = await Promise.all(
      heldPositions
        .filter((p) => p.type === "alt_cycle")
        .map(async (p) => {
          const a = p.asset.toUpperCase();
          const currentPrice = prices[a] ?? 0;
          const entry = parseFloat(p.entryPrice);
          const stop = p.stopPrice ? parseFloat(p.stopPrice) : null;

          const [low, high] = await Promise.all([
            stateRead<number>(`cycle_low_zone_top_${a}`),
            stateRead<number>(`cycle_high_zone_bottom_${a}`),
          ]);

          // Position % of range — only meaningful when zones exist.
          let cyclePositionPct: number | null = null;
          if (low != null && high != null) {
            // We don't have min/max stored separately, so use zone bounds as
            // proxy for relative positioning.
            const range = high - low;
            cyclePositionPct = range > 0 ? ((currentPrice - low) / range) * 100 : 50;
          }

          const distanceToStopPct = stop != null && currentPrice > 0
            ? ((currentPrice - stop) / currentPrice) * 100
            : null;

          return {
            asset: p.asset,
            entryPrice: entry,
            currentPrice,
            pnlPct: entry > 0 ? ((currentPrice - entry) / entry) * 100 : 0,
            distanceToStopPct,
            cyclePositionPct,
            cycleLowZoneTop: low ?? null,
            cycleHighZoneBottom: high ?? null,
          };
        }),
    );

    // Volume ratios for held assets (1h vs 20d-avg-hourly proxy).
    const volumeRatios: Record<string, number> = {};
    for (const a of heldAssets) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const hourAgo = now - 3600;
        const tenDaysAgo = now - 10 * 86_400;
        const [recent, baseline] = await Promise.all([
          getCandles(productIdFor(a), "ONE_HOUR", hourAgo, now),
          getCandles(productIdFor(a), "ONE_HOUR", tenDaysAgo, now),
        ]);
        const recentVols = ohlcFromCandles(recent, "newest_first").map((b) => b.volume);
        const baselineVols = ohlcFromCandles(baseline, "newest_first").map((b) => b.volume);
        const ratio = volumeRatio(baselineVols, Math.max(1, recentVols.length), baselineVols.length);
        if (ratio != null) volumeRatios[a] = ratio;
      } catch {
        // skip
      }
    }

    // Today's escalation budget — STRATEGY caps at MAX_OPUS_CALLS_PER_DAY total.
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const opusToday = await evaluationsByCallTypeSince("opus_escalation", startOfToday);
    const escalationsRemainingToday = Math.max(
      0,
      MAX_OPUS_CALLS_PER_DAY - 1 - opusToday.length, // -1 reserves the morning brief slot
    );

    const packageInput: SonnetCheckInput = {
      timestamp: new Date(),
      morningBrief,
      prices,
      altPositionsLive,
      volumeRatios,
      matchedNews: [], // wakeup-driven keyword matches are handled separately;
      // scheduled checkpoints don't re-poll RSS to keep tokens lean
      escalationsRemainingToday,
    };

    const result = await runSonnetCheck({
      packageInput,
      triggerSource: "scheduled",
      isWakeupCall: false,
    });

    if (result.blocked) {
      return { ok: false, reason: result.blockReason ?? "blocked" };
    }

    log.info("Sonnet checkpoint complete", {
      sonnetEvalId: result.sonnetEvaluationId,
      escalated: !!result.escalation,
    });

    return {
      ok: true,
      sonnetEvalId: result.sonnetEvaluationId,
      escalated: !!result.escalation,
      opusEvalId: result.escalation?.opusEvaluationId,
    };
  } catch (err) {
    log.error("Sonnet checkpoint failed", { error: (err as Error).message });
    return { ok: false, reason: (err as Error).message };
  }
}
