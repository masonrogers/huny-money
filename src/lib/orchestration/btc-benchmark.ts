import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { priceSnapshots, systemStateHistory } from "@/lib/db/schema";
import { stateRead } from "@/lib/db/utils";
import { getCurrentMode } from "@/lib/mode";

/**
 * BTC benchmark: bot equity vs. BTC buy-and-hold.
 *
 * The bot exists to beat BTC over rolling 60-day windows (STRATEGY.md §6.3).
 * This module is the single source of truth for that comparison — consumed by:
 *   1. The morning brief data package (so Opus sees its own track record)
 *   2. The Phase 1 advance-criteria gate (the "≥ 3% over 60d" check)
 *   3. The 60-day BTC underperformance circuit breaker (risk/circuit-breakers)
 *   4. The Performance dashboard (rolling-window stat cards)
 *
 * Source data:
 *   - Equity series: `last_equity_<mode>_usd` rows in `system_state_history`,
 *     written every 5 min by the wake-up cycle's equity snapshotter.
 *   - BTC price series: `price_snapshots.btc_price`, written at the same cadence.
 *   - Inception anchors: `starting_capital_<mode>_usd` + `btc_price_at_start_<mode>`,
 *     captured at first launch.
 *
 * Returns null for any window where the bot is younger than the window —
 * we never fabricate a delta from missing data.
 */

export interface BenchmarkSummary {
  mode: "paper" | "live";
  currentEquityUsd: number | null;
  startingCapitalUsd: number | null;
  currentBtcPriceUsd: number;
  btcPriceAtStart: number | null;
  /** System − BTC return % since inception. */
  cumulativeDeltaPct: number | null;
  /** System 30d return − BTC 30d return. Null if no equity sample 30d ago. */
  rolling30dDeltaPct: number | null;
  /** System 60d return − BTC 60d return. Null if no equity sample 60d ago. */
  rolling60dDeltaPct: number | null;
  /** Trailing run of days where cumulative-from-inception delta < 0. */
  consecutiveUnderperfDays: number;
  diagnostics: {
    equity30dAgo: number | null;
    btc30dAgo: number | null;
    equity60dAgo: number | null;
    btc60dAgo: number | null;
    daysSampledForRun: number;
  };
}

export interface BenchmarkInput {
  now: Date;
  currentBtcPriceUsd: number;
  /** Optional override; defaults to the most recent equity snapshot. */
  currentEquityUsd?: number | null;
}

// ---------------------------------------------------------------------------
// Pure math (exported for tests)
// ---------------------------------------------------------------------------

/** (end/start − 1) × 100. Null if either side is invalid. */
export function returnPct(start: number | null, end: number | null): number | null {
  if (start == null || end == null) return null;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start <= 0) return null;
  return ((end - start) / start) * 100;
}

/** System return − BTC return over the same window. Null if either return is null. */
export function deltaReturnPct(
  equityStart: number | null,
  equityEnd: number | null,
  btcStart: number | null,
  btcEnd: number | null,
): number | null {
  const sys = returnPct(equityStart, equityEnd);
  const btc = returnPct(btcStart, btcEnd);
  if (sys == null || btc == null) return null;
  return sys - btc;
}

/**
 * Count the trailing run of days where the bot's cumulative-from-inception
 * return is below BTC's. Samples must be newest-first, one per day.
 */
export function countConsecutiveUnderperfDays(
  samplesNewestFirst: ReadonlyArray<{ equity: number; btc: number }>,
  startingCapital: number,
  btcAtStart: number,
): number {
  if (startingCapital <= 0 || btcAtStart <= 0) return 0;
  let run = 0;
  for (const s of samplesNewestFirst) {
    const sysRet = (s.equity - startingCapital) / startingCapital;
    const btcRet = (s.btc - btcAtStart) / btcAtStart;
    if (sysRet < btcRet) run++;
    else break;
  }
  return run;
}

// ---------------------------------------------------------------------------
// I/O entry point
// ---------------------------------------------------------------------------

export async function computeBenchmarkSummary(
  input: BenchmarkInput,
): Promise<BenchmarkSummary> {
  const mode = getCurrentMode();
  const suffix = mode === "paper" ? "paper" : "live";
  const equityKey = `last_equity_${suffix}_usd`;

  const [startingCapital, btcAtStart, latestEquityRow] = await Promise.all([
    stateRead<number>(`starting_capital_${suffix}_usd`),
    stateRead<number>(`btc_price_at_start_${suffix}`),
    db
      .select({
        ts: systemStateHistory.changedAt,
        value: systemStateHistory.newValue,
      })
      .from(systemStateHistory)
      .where(eq(systemStateHistory.key, equityKey))
      .orderBy(desc(systemStateHistory.changedAt))
      .limit(1),
  ]);

  const currentEquityUsd =
    input.currentEquityUsd != null
      ? input.currentEquityUsd
      : latestEquityRow[0]?.value != null
        ? Number(latestEquityRow[0].value)
        : null;

  // A non-positive or non-finite current BTC price means "no data". Don't
  // let returnPct treat it as a -100% return. Window deltas become null
  // until a fresh price snapshot lands.
  const haveBtcPrice =
    Number.isFinite(input.currentBtcPriceUsd) && input.currentBtcPriceUsd > 0;
  const currentBtcPriceForMath = haveBtcPrice ? input.currentBtcPriceUsd : null;

  const cumulativeDeltaPct = deltaReturnPct(
    startingCapital,
    currentEquityUsd,
    btcAtStart,
    currentBtcPriceForMath,
  );

  const ts30 = new Date(input.now.getTime() - 30 * 86_400_000);
  const ts60 = new Date(input.now.getTime() - 60 * 86_400_000);

  const [equity30, equity60, btc30, btc60] = await Promise.all([
    equityValueAt(equityKey, ts30),
    equityValueAt(equityKey, ts60),
    btcPriceAt(ts30),
    btcPriceAt(ts60),
  ]);

  const rolling30dDeltaPct = deltaReturnPct(
    equity30,
    currentEquityUsd,
    btc30,
    currentBtcPriceForMath,
  );
  const rolling60dDeltaPct = deltaReturnPct(
    equity60,
    currentEquityUsd,
    btc60,
    currentBtcPriceForMath,
  );

  let consecutiveUnderperfDays = 0;
  let daysSampledForRun = 0;
  if (
    startingCapital != null &&
    btcAtStart != null &&
    startingCapital > 0 &&
    btcAtStart > 0
  ) {
    const samples = await fetchDailySamplesNewestFirst(equityKey, input.now, 90);
    daysSampledForRun = samples.length;
    consecutiveUnderperfDays = countConsecutiveUnderperfDays(
      samples,
      startingCapital,
      btcAtStart,
    );
  }

  return {
    mode,
    currentEquityUsd,
    startingCapitalUsd: startingCapital,
    currentBtcPriceUsd: input.currentBtcPriceUsd,
    btcPriceAtStart: btcAtStart,
    cumulativeDeltaPct,
    rolling30dDeltaPct,
    rolling60dDeltaPct,
    consecutiveUnderperfDays,
    diagnostics: {
      equity30dAgo: equity30,
      btc30dAgo: btc30,
      equity60dAgo: equity60,
      btc60dAgo: btc60,
      daysSampledForRun,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function equityValueAt(equityKey: string, at: Date): Promise<number | null> {
  const rows = await db
    .select({ value: systemStateHistory.newValue })
    .from(systemStateHistory)
    .where(
      and(eq(systemStateHistory.key, equityKey), lte(systemStateHistory.changedAt, at)),
    )
    .orderBy(desc(systemStateHistory.changedAt))
    .limit(1);
  if (rows[0]?.value == null) return null;
  const n = Number(rows[0].value);
  return Number.isFinite(n) ? n : null;
}

async function btcPriceAt(at: Date): Promise<number | null> {
  const rows = await db
    .select({ btc: priceSnapshots.btcPrice })
    .from(priceSnapshots)
    .where(lte(priceSnapshots.timestamp, at))
    .orderBy(desc(priceSnapshots.timestamp))
    .limit(1);
  if (rows[0]?.btc == null) return null;
  const n = Number(rows[0].btc);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * One sample per UTC day, newest first. A day is included only if BOTH
 * the equity series and a price snapshot exist for that day. Within a day,
 * the latest write wins (matches the dashboard's "what was true at 23:59?").
 */
async function fetchDailySamplesNewestFirst(
  equityKey: string,
  now: Date,
  days: number,
): Promise<Array<{ equity: number; btc: number }>> {
  const since = new Date(now.getTime() - days * 86_400_000);

  const [equityRows, btcRows] = await Promise.all([
    db
      .select({
        ts: systemStateHistory.changedAt,
        value: systemStateHistory.newValue,
      })
      .from(systemStateHistory)
      .where(
        and(
          eq(systemStateHistory.key, equityKey),
          gte(systemStateHistory.changedAt, since),
        ),
      )
      .orderBy(asc(systemStateHistory.changedAt)),
    db
      .select({ ts: priceSnapshots.timestamp, btc: priceSnapshots.btcPrice })
      .from(priceSnapshots)
      .where(gte(priceSnapshots.timestamp, since))
      .orderBy(asc(priceSnapshots.timestamp)),
  ]);

  const equityByDay = new Map<string, number>();
  for (const r of equityRows) {
    const n = Number(r.value);
    if (!Number.isFinite(n)) continue;
    equityByDay.set(r.ts.toISOString().slice(0, 10), n);
  }

  const btcByDay = new Map<string, number>();
  for (const r of btcRows) {
    if (r.btc == null) continue;
    const n = Number(r.btc);
    if (!Number.isFinite(n) || n <= 0) continue;
    btcByDay.set(r.ts.toISOString().slice(0, 10), n);
  }

  const days_desc = Array.from(equityByDay.keys()).sort().reverse();
  const samples: Array<{ equity: number; btc: number }> = [];
  for (const day of days_desc) {
    const equity = equityByDay.get(day);
    const btc = btcByDay.get(day);
    if (equity == null || btc == null) continue;
    samples.push({ equity, btc });
  }
  return samples;
}
