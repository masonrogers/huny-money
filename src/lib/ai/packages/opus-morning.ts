import type { PortfolioSnapshot } from "../portfolio";
import type { Candle } from "@/lib/coinbase";
import { serializeCandles, closesFromCandles, ohlcFromCandles } from "@/lib/candles/compress";
import { rsi, macd, bollinger, sma, atr, avgVolume } from "@/lib/indicators";
import { computeCycleRange, type CycleRange } from "@/lib/cycle/range";
import { CYCLE_WATCHLIST, CORE_ASSETS } from "@/lib/strategy/constants";

/**
 * Builds the user message that gets sent to Opus for the daily morning brief.
 *
 * The system prompt (cached at 1h TTL) carries the strategy. This message
 * carries today's *data*: portfolio state, indicators, cycle positions,
 * recent news, yesterday's outcomes.
 *
 * Caller fetches all the raw data (candles, prices, news, portfolio) and
 * passes it in. This function does the assembly + indicator computation +
 * compression. It is pure — no I/O.
 */

export interface AssetPriceData {
  asset: string;
  /** Daily candles oldest first, ~365 days. */
  daily: Candle[];
  /** 4h candles oldest first, ~30 days (BTC/ETH only). */
  fourHour?: Candle[];
  /** 1h candles oldest first, ~7 days (BTC/ETH only). */
  oneHour?: Candle[];
  currentPrice: number;
}

export interface NewsArticle {
  feedName: string;
  title: string;
  link: string;
  publishedAt?: Date | null;
  matchedKeywords?: readonly string[];
}

export interface YesterdayOutcome {
  briefSummary: string; // 2-4 sentences from yesterday's brief
  actionsTaken: string[]; // ["Entered AERO at $0.48 (size 12%)", "Held BTC core at 70%"]
  outcomeSummary: string; // "AERO closed +3.2%, BTC unchanged. Watch list trigger 'aero-cycle-high' did not fire."
}

export interface OpusMorningPackageInput {
  timestamp: Date;
  portfolio: PortfolioSnapshot;
  /** BTC, ETH, and each watchlist alt. */
  assets: AssetPriceData[];
  btcDominance30dAvg?: number;
  btcDominanceCurrent?: number;
  recentNews: NewsArticle[];
  yesterday?: YesterdayOutcome;
  benchmarkSummary: {
    rolling30dDeltaPct: number | null;
    rolling60dDeltaPct: number | null;
    consecutiveUnderperfDays: number;
  };
  /** Current cooldown / phase / paused flags from `state`. */
  behavioral: {
    cooldownActive: boolean;
    cooldownUntil?: string | null;
    consecutiveLosses: number;
    consecutiveWins: number;
    drawdownLevel: "none" | "soft" | "hard";
  };
}

// ---------------------------------------------------------------------------
// Indicator extraction per asset
// ---------------------------------------------------------------------------

interface AssetIndicatorBlock {
  asset: string;
  currentPrice: number;
  rsi14Daily: number | null;
  rsi14_4h: number | null;
  macdDaily: { macd: number; signal: number; histogram: number } | null;
  bbandsDaily: { upper: number; middle: number; lower: number; bandwidth: number } | null;
  sma50Daily: number | null;
  sma200Daily: number | null;
  atr14Daily: number | null;
  avgVolume20d: number | null;
  recentVolumeRatio: number | null; // 5d avg / 20d avg
  cycleRange?: CycleRange;
}

function buildIndicatorBlock(asset: AssetPriceData, isWatchlist: boolean): AssetIndicatorBlock {
  const dailyClosesAsc = closesFromCandles(asset.daily, "oldest_first");
  const dailyOhlc = ohlcFromCandles(asset.daily, "oldest_first");
  const dailyVolumes = dailyOhlc.map((b) => b.volume);

  const fourHourCloses = asset.fourHour ? closesFromCandles(asset.fourHour, "oldest_first") : [];

  const recent5d = avgVolume(dailyVolumes, 5);
  const baseline20d = avgVolume(dailyVolumes, 20);
  const ratio = recent5d != null && baseline20d != null && baseline20d > 0 ? recent5d / baseline20d : null;

  let cycleRange: CycleRange | undefined;
  if (isWatchlist && dailyClosesAsc.length > 0) {
    cycleRange = computeCycleRange({
      asset: asset.asset,
      dailyCloses: dailyClosesAsc,
      currentPrice: asset.currentPrice,
    });
  }

  return {
    asset: asset.asset,
    currentPrice: asset.currentPrice,
    rsi14Daily: rsi(dailyClosesAsc, 14),
    rsi14_4h: fourHourCloses.length > 0 ? rsi(fourHourCloses, 14) : null,
    macdDaily: macd(dailyClosesAsc),
    bbandsDaily: bollinger(dailyClosesAsc),
    sma50Daily: sma(dailyClosesAsc, 50),
    sma200Daily: sma(dailyClosesAsc, 200),
    atr14Daily: atr(dailyOhlc, 14),
    avgVolume20d: baseline20d,
    recentVolumeRatio: ratio,
    cycleRange,
  };
}

// ---------------------------------------------------------------------------
// User message construction
// ---------------------------------------------------------------------------

export function buildOpusMorningUserMessage(input: OpusMorningPackageInput): string {
  const sections: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────
  sections.push(`# MORNING BRIEF — ${input.timestamp.toISOString()}`);
  sections.push(`Mode: **${input.portfolio.mode.toUpperCase()}**`);

  // ── Portfolio state ──────────────────────────────────────────────────
  const p = input.portfolio;
  const portfolioBlock: string[] = [];
  portfolioBlock.push(`Total value: $${p.currentTotalValueUsd.toFixed(2)}`);
  portfolioBlock.push(`Cash (USDC): $${p.cashUsd.toFixed(2)}`);
  if (p.startingCapitalUsd != null) {
    portfolioBlock.push(
      `Starting capital: $${p.startingCapitalUsd.toFixed(2)} (return: ${p.systemReturnPct.toFixed(2)}%)`,
    );
  }
  if (p.btcOutperformancePct != null) {
    const sign = p.btcOutperformancePct >= 0 ? "+" : "";
    portfolioBlock.push(`vs BTC hold (cumulative): ${sign}${p.btcOutperformancePct.toFixed(2)}%`);
  }
  portfolioBlock.push(`Drawdown from peak: ${p.drawdownFromPeakPct.toFixed(2)}%`);
  portfolioBlock.push(`Current regime (carried in from yesterday): ${p.currentRegime ?? "<unset>"}`);
  if (p.daysInCurrentRegime != null) {
    portfolioBlock.push(`Days in current regime: ${p.daysInCurrentRegime}`);
  }
  sections.push(`## Portfolio state\n${portfolioBlock.join("\n")}`);

  // ── BTC benchmark ────────────────────────────────────────────────────
  const b = input.benchmarkSummary;
  const benchLines: string[] = [];
  if (b.rolling30dDeltaPct != null)
    benchLines.push(`30-day rolling vs BTC: ${b.rolling30dDeltaPct.toFixed(2)}%`);
  if (b.rolling60dDeltaPct != null)
    benchLines.push(`60-day rolling vs BTC: ${b.rolling60dDeltaPct.toFixed(2)}%`);
  benchLines.push(`Consecutive days underperforming BTC: ${b.consecutiveUnderperfDays}`);
  sections.push(`## BTC benchmark\n${benchLines.join("\n")}`);

  // ── Behavioral state ─────────────────────────────────────────────────
  const beh = input.behavioral;
  sections.push(
    `## Behavioral state\nCooldown active: ${beh.cooldownActive}${beh.cooldownActive && beh.cooldownUntil ? ` until ${beh.cooldownUntil}` : ""}\n` +
      `Consecutive losing alt cycles: ${beh.consecutiveLosses}\n` +
      `Consecutive winning alt cycles: ${beh.consecutiveWins}\n` +
      `Drawdown level: ${beh.drawdownLevel}`,
  );

  // ── Open positions ──────────────────────────────────────────────────
  if (p.openPositions.length === 0) {
    sections.push(`## Open positions\n(none)`);
  } else {
    const lines = p.openPositions.map((pos) => {
      const entry = parseFloat(pos.entryPrice);
      return (
        `- ${pos.asset} (${pos.type}): qty=${pos.quantity}, entry=$${entry.toFixed(2)}, ` +
        `stop=${pos.stopPrice ?? "—"}, target=${pos.targetPrice ?? "—"}, ` +
        `entered=${pos.entryTime.toISOString()}, conviction_at_entry=${pos.convictionAtEntry ?? "—"}`
      );
    });
    sections.push(`## Open positions\n${lines.join("\n")}`);
  }

  // ── BTC.D ────────────────────────────────────────────────────────────
  if (input.btcDominanceCurrent != null) {
    sections.push(
      `## BTC dominance\nCurrent: ${input.btcDominanceCurrent.toFixed(2)}%` +
        (input.btcDominance30dAvg != null
          ? `\n30-day average: ${input.btcDominance30dAvg.toFixed(2)}%`
          : ""),
    );
  }

  // ── Per-asset technicals + cycle position ──────────────────────────
  const assetSections: string[] = [];
  for (const a of input.assets) {
    const isWatchlist = (CYCLE_WATCHLIST as readonly string[]).includes(a.asset.toUpperCase());
    const ind = buildIndicatorBlock(a, isWatchlist);

    const lines: string[] = [];
    lines.push(`### ${a.asset}`);
    lines.push(`current_price: ${a.currentPrice}`);
    if (ind.cycleRange) {
      const c = ind.cycleRange;
      const inLowZone = a.currentPrice <= c.cycleLowZoneTop;
      const inHighZone = a.currentPrice >= c.cycleHighZoneBottom;
      const zone = inLowZone ? "CYCLE LOW ZONE" : inHighZone ? "CYCLE HIGH ZONE" : "mid-range";
      lines.push(
        `cycle_range: 6mo low=$${c.min.toFixed(4)}, high=$${c.max.toFixed(4)}, ` +
          `low_zone_top=$${c.cycleLowZoneTop.toFixed(4)}, ` +
          `high_zone_bottom=$${c.cycleHighZoneBottom.toFixed(4)}`,
      );
      lines.push(
        `cycle_position: ${c.currentCyclePositionPct.toFixed(1)}% of range — **${zone}**`,
      );
    }
    if (ind.rsi14Daily != null) lines.push(`rsi14_daily: ${ind.rsi14Daily.toFixed(2)}`);
    if (ind.rsi14_4h != null) lines.push(`rsi14_4h: ${ind.rsi14_4h.toFixed(2)}`);
    if (ind.macdDaily) {
      lines.push(
        `macd_daily: macd=${ind.macdDaily.macd.toFixed(4)}, ` +
          `signal=${ind.macdDaily.signal.toFixed(4)}, hist=${ind.macdDaily.histogram.toFixed(4)}`,
      );
    }
    if (ind.bbandsDaily) {
      lines.push(
        `bbands_daily: middle=${ind.bbandsDaily.middle.toFixed(2)}, ` +
          `upper=${ind.bbandsDaily.upper.toFixed(2)}, lower=${ind.bbandsDaily.lower.toFixed(2)}, ` +
          `bandwidth=${(ind.bbandsDaily.bandwidth * 100).toFixed(2)}%`,
      );
    }
    if (ind.sma50Daily != null) lines.push(`sma50_daily: ${ind.sma50Daily.toFixed(2)}`);
    if (ind.sma200Daily != null) lines.push(`sma200_daily: ${ind.sma200Daily.toFixed(2)}`);
    if (ind.atr14Daily != null) lines.push(`atr14_daily: ${ind.atr14Daily.toFixed(4)}`);
    if (ind.avgVolume20d != null) lines.push(`avg_volume_20d: ${Math.round(ind.avgVolume20d)}`);
    if (ind.recentVolumeRatio != null) {
      lines.push(`volume_ratio_5d_vs_20d: ${ind.recentVolumeRatio.toFixed(2)}x`);
    }

    // Compressed candles (only for core assets — alts get cycle position only).
    if ((CORE_ASSETS as readonly string[]).includes(a.asset.toUpperCase())) {
      lines.push(`\ndaily_candles_oldest_first (last 90):\n\`\`\`csv\n${serializeCandles(a.daily.slice(-90))}\n\`\`\``);
      if (a.fourHour) {
        lines.push(`\nfour_hour_candles_oldest_first (last 30d):\n\`\`\`csv\n${serializeCandles(a.fourHour)}\n\`\`\``);
      }
    } else {
      // Watchlist alts: just last 60d daily, the cycle context is the focus.
      lines.push(`\ndaily_candles_oldest_first (last 60):\n\`\`\`csv\n${serializeCandles(a.daily.slice(-60))}\n\`\`\``);
    }

    assetSections.push(lines.join("\n"));
  }
  sections.push(`## Asset data\n\n${assetSections.join("\n\n")}`);

  // ── Recent news ──────────────────────────────────────────────────────
  if (input.recentNews.length > 0) {
    const newsLines = input.recentNews.slice(0, 25).map((n) => {
      const kw = n.matchedKeywords && n.matchedKeywords.length > 0 ? ` [matched: ${n.matchedKeywords.join(", ")}]` : "";
      const ts = n.publishedAt ? ` (${n.publishedAt.toISOString()})` : "";
      return `- ${n.feedName}${ts}: ${n.title}${kw}\n  ${n.link}`;
    });
    sections.push(`## Recent news (last 24h scoped to crypto/macro)\n${newsLines.join("\n")}`);
  } else {
    sections.push(`## Recent news\n(no items in the polling window)`);
  }

  // ── Yesterday recap ──────────────────────────────────────────────────
  if (input.yesterday) {
    sections.push(
      `## Yesterday recap\nBrief summary:\n${input.yesterday.briefSummary}\n\n` +
        `Actions taken:\n${input.yesterday.actionsTaken.map((a) => `- ${a}`).join("\n")}\n\n` +
        `Outcomes observed:\n${input.yesterday.outcomeSummary}`,
    );
  }

  // ── Closed trade history (last 20) ──────────────────────────────────
  if (p.closedPositions.length > 0) {
    const lines = p.closedPositions.slice(0, 20).map((pos) => {
      const entry = parseFloat(pos.entryPrice);
      const exit = pos.exitPrice ? parseFloat(pos.exitPrice) : null;
      const pct = exit != null ? ((exit - entry) / entry) * 100 : null;
      return (
        `- ${pos.asset} (${pos.type}): ` +
        `entry=$${entry.toFixed(4)}, exit=${exit ? `$${exit.toFixed(4)}` : "—"}, ` +
        `${pct != null ? `${pct.toFixed(2)}%, ` : ""}` +
        `reason=${pos.exitReason ?? "—"}`
      );
    });
    sections.push(`## Recent closed trades\n${lines.join("\n")}`);
  }

  // ── Closing instruction ──────────────────────────────────────────────
  sections.push(
    `\n---\nProduce your morning brief now. Respond with the JSON object only — no preamble, no postscript.`,
  );

  return sections.join("\n\n");
}
