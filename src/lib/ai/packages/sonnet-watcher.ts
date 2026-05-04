import type { MorningBrief } from "../schemas";
import type { Position } from "@/lib/db/schema";

/**
 * Slim data package for Sonnet watcher checks.
 *
 * Per STRATEGY.md §5.4: includes morning brief summary + current prices +
 * active positions vs cycle zones + recent news. Excludes long-horizon
 * candles, full trade history, full strategy params (Sonnet doesn't decide
 * those things — sending them would just burn tokens).
 *
 * The morning brief is passed FRESH (not via prompt cache) as a ~500-token
 * summary. Cache TTL on the system prompt is 1h, but morning → 14:00 / 22:00
 * spans 8h+, so the brief itself is always inlined.
 */

export interface SonnetCheckInput {
  timestamp: Date;
  /** Today's morning brief output (parsed). */
  morningBrief: MorningBrief;
  /** Optional context appended when this Sonnet call was triggered by a wake-up event. */
  wakeupContext?: {
    triggerType: "position_move" | "stop_fill" | "news_keyword";
    asset?: string;
    observed: Record<string, unknown>;
  };
  /** Current prices for relevant assets (BTC/ETH/SOL + held alt symbols). */
  prices: Record<string, number>;
  /** Active alt cycle positions with current zone position. */
  altPositionsLive: Array<{
    asset: string;
    entryPrice: number;
    currentPrice: number;
    pnlPct: number;
    distanceToStopPct: number | null;
    cyclePositionPct: number | null;
    cycleLowZoneTop: number | null;
    cycleHighZoneBottom: number | null;
  }>;
  /** 1h volume vs 20d avg per relevant asset. */
  volumeRatios?: Record<string, number>;
  /** RSS items from the last poll matching watch list keywords. */
  matchedNews: Array<{
    feedName: string;
    title: string;
    link: string;
    matchedKeywords: readonly string[];
  }>;
  /** How many escalations remain in today's budget. */
  escalationsRemainingToday: number;
}

export function buildSonnetSystemPromptContextHeader(): string {
  // Lightweight context header that Sonnet reads alongside its system prompt.
  // The actual prompt is in src/lib/ai/prompts/sonnet-watcher.ts.
  return "Sonnet watcher check.";
}

export function buildSonnetUserMessage(input: SonnetCheckInput): string {
  const sections: string[] = [];

  sections.push(`# WATCHER CHECK — ${input.timestamp.toISOString()}`);
  sections.push(`Escalations remaining today: ${input.escalationsRemainingToday}`);

  if (input.wakeupContext) {
    sections.push(
      `## Wake-up trigger fired\nType: ${input.wakeupContext.triggerType}\n` +
        (input.wakeupContext.asset ? `Asset: ${input.wakeupContext.asset}\n` : "") +
        `Observed: ${JSON.stringify(input.wakeupContext.observed)}`,
    );
  }

  // ── Today's morning brief summary ────────────────────────────────────
  const brief = input.morningBrief;
  const briefBlock: string[] = [];
  briefBlock.push(`Regime: **${brief.regime}** — ${brief.regime_evidence}`);
  briefBlock.push(
    `BTC core: ${brief.btc_core_decision.action} (current ${brief.btc_core_decision.current_alloc_pct}% → target ${brief.btc_core_decision.target_alloc_pct}%) — ${brief.btc_core_decision.reasoning}`,
  );
  if (brief.alt_positions.length > 0) {
    briefBlock.push(
      `Alt positions:\n${brief.alt_positions
        .map(
          (a) =>
            `  - ${a.asset} @ ${a.current_cycle_position_pct.toFixed(0)}% of range → ${a.action}`,
        )
        .join("\n")}`,
    );
  } else {
    briefBlock.push(`Alt positions: none open`);
  }
  briefBlock.push(`Discipline check: ${brief.discipline_check}`);
  sections.push(`## Today's plan (from morning brief)\n${briefBlock.join("\n")}`);

  // ── Watch list (the triggers Sonnet evaluates) ───────────────────────
  if (brief.watch_list.length === 0) {
    sections.push(`## Watch list\n(none — no rubric-driven triggers today)`);
  } else {
    const wl = brief.watch_list
      .map(
        (w) =>
          `- id="${w.id}" ${w.asset ? `[${w.asset}] ` : ""}urgency=${w.urgency}\n  condition: ${w.condition}\n  rationale: ${w.rationale}`,
      )
      .join("\n");
    sections.push(`## Watch list (evaluate each)\n${wl}`);
  }

  // ── Current prices ──────────────────────────────────────────────────
  const priceLines = Object.entries(input.prices).map(([k, v]) => `- ${k}: $${v}`);
  sections.push(`## Current prices\n${priceLines.join("\n")}`);

  // ── Active alt positions with zone context ─────────────────────────
  if (input.altPositionsLive.length > 0) {
    const lines = input.altPositionsLive.map((p) => {
      const stopLine = p.distanceToStopPct != null ? `${p.distanceToStopPct.toFixed(1)}% to stop` : "no stop";
      const zoneLine =
        p.cyclePositionPct != null && p.cycleLowZoneTop != null && p.cycleHighZoneBottom != null
          ? `cycle ${p.cyclePositionPct.toFixed(0)}% (low_zone≤$${p.cycleLowZoneTop.toFixed(4)}, high_zone≥$${p.cycleHighZoneBottom.toFixed(4)})`
          : "cycle unknown";
      return `- ${p.asset}: entry $${p.entryPrice.toFixed(4)}, current $${p.currentPrice.toFixed(4)} (${p.pnlPct >= 0 ? "+" : ""}${p.pnlPct.toFixed(1)}%), ${stopLine}, ${zoneLine}`;
    });
    sections.push(`## Active alt positions\n${lines.join("\n")}`);
  }

  // ── Volume ratios ───────────────────────────────────────────────────
  if (input.volumeRatios && Object.keys(input.volumeRatios).length > 0) {
    const lines = Object.entries(input.volumeRatios).map(
      ([asset, ratio]) => `- ${asset}: 1h vs 20d avg = ${ratio.toFixed(2)}x`,
    );
    sections.push(`## Volume ratios\n${lines.join("\n")}`);
  }

  // ── Matched news ────────────────────────────────────────────────────
  if (input.matchedNews.length > 0) {
    const lines = input.matchedNews.map(
      (n) => `- [${n.feedName}] ${n.title} (matched: ${n.matchedKeywords.join(", ")})\n  ${n.link}`,
    );
    sections.push(`## News matching watch list keywords\n${lines.join("\n")}`);
  }

  sections.push(
    `\n---\nProduce your watcher output now. Respond with the JSON object only — no preamble, no postscript.`,
  );

  return sections.join("\n\n");
}
