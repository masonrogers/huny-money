import { and, eq, gte, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { systemStateHistory, priceSnapshots } from "@/lib/db/schema";
import { stateRead } from "@/lib/db/utils";
import { safeDashboardHandler } from "@/lib/api/safe-handler";

/**
 * Equity curve.
 *
 * Source: `last_equity_<mode>_usd` writes in `system_state_history` (one per
 * 5-min wake-up tick) cross-referenced against `price_snapshots` for the
 * matching BTC price, so the view can overlay a synthetic "what if I'd just
 * held BTC" line.
 *
 * BTC equivalent: starting_capital × (currentBTC / btcAtStart). It's the
 * benchmark the bot exists to beat — STRATEGY.md §6.3.
 */

export interface EquityCurvePoint {
  ts: string;
  equity: number;
  btcEquivalent: number | null;
}

export interface EquityCurvePayload {
  mode: "paper" | "live";
  points: EquityCurvePoint[];
  startingCapitalUsd: number | null;
  btcAtStart: number | null;
  dbReady: boolean;
}

const DEFAULT_DAYS = 30;
const MAX_POINTS = 600;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = clampInt(url.searchParams.get("days"), 1, 365, DEFAULT_DAYS);

  return safeDashboardHandler<EquityCurvePayload>(
    "api.dashboard.equity-curve",
    {
      mode: "paper",
      points: [],
      startingCapitalUsd: null,
      btcAtStart: null,
      dbReady: false,
    },
    async () => {
      const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
      const mode: "paper" | "live" = paperMode ? "paper" : "live";
      const suffix = mode;
      const equityKey = `last_equity_${suffix}_usd`;
      const since = new Date(Date.now() - days * 86_400_000);

      const [equityRows, btcRows, startingCapital, btcAtStart] = await Promise.all([
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
          .select({
            ts: priceSnapshots.timestamp,
            btc: priceSnapshots.btcPrice,
          })
          .from(priceSnapshots)
          .where(gte(priceSnapshots.timestamp, since))
          .orderBy(asc(priceSnapshots.timestamp)),
        stateRead<number>(`starting_capital_${suffix}_usd`),
        stateRead<number>(`btc_price_at_start_${suffix}`),
      ]);

      // Build a sparse list of equity points, then nearest-neighbor lookup
      // for BTC price at each timestamp to render a synthetic BTC-hold line.
      const btcSeries = btcRows
        .filter((r) => r.btc != null)
        .map((r) => ({ ts: r.ts.getTime(), btc: Number(r.btc) }))
        .filter((r) => Number.isFinite(r.btc) && r.btc > 0);

      const points: EquityCurvePoint[] = [];
      for (const row of equityRows) {
        const equity = Number(row.value);
        if (!Number.isFinite(equity)) continue;
        const ts = row.ts.getTime();
        const nearestBtc = nearest(btcSeries, ts);
        const btcEquivalent =
          startingCapital != null && btcAtStart != null && btcAtStart > 0 && nearestBtc != null
            ? startingCapital * (nearestBtc / btcAtStart)
            : null;
        points.push({
          ts: row.ts.toISOString(),
          equity,
          btcEquivalent,
        });
      }

      // Down-sample to MAX_POINTS for the chart (the curve writes every 5 min;
      // 30 days × 288 ticks/day = 8640 points raw, way too many to render).
      const sampled = downsampleEvenly(points, MAX_POINTS);

      return {
        mode,
        points: sampled,
        startingCapitalUsd: startingCapital,
        btcAtStart,
        dbReady: true,
      };
    },
  );
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function nearest(series: Array<{ ts: number; btc: number }>, ts: number): number | null {
  if (series.length === 0) return null;
  // Binary search for the closest timestamp.
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (series[mid]!.ts < ts) lo = mid + 1;
    else hi = mid;
  }
  const after = series[lo]!;
  const before = lo > 0 ? series[lo - 1]! : after;
  return Math.abs(after.ts - ts) < Math.abs(before.ts - ts) ? after.btc : before.btc;
}

function downsampleEvenly<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(arr[Math.floor(i * step)]!);
  }
  // Always include the most recent point.
  if (out[out.length - 1] !== arr[arr.length - 1]) {
    out.push(arr[arr.length - 1]!);
  }
  return out;
}
