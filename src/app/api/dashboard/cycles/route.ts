import { stateRead } from "@/lib/db/utils";
import { CYCLE_WATCHLIST } from "@/lib/strategy/constants";
import { safeDashboardHandler } from "@/lib/api/safe-handler";

export interface CyclePayload {
  assets: Array<{
    asset: string;
    cycleLowZoneTop: number | null;
    cycleHighZoneBottom: number | null;
    computedAt: string | null;
    isStale: boolean;
  }>;
  dbReady: boolean;
}

export async function GET() {
  return safeDashboardHandler<CyclePayload>(
    "api.dashboard.cycles",
    { assets: [], dbReady: false },
    async () => {
      const assets = await Promise.all(
        CYCLE_WATCHLIST.map(async (asset) => {
          const a = asset.toUpperCase();
          const [low, high, computedAt] = await Promise.all([
            stateRead<number>(`cycle_low_zone_top_${a}`),
            stateRead<number>(`cycle_high_zone_bottom_${a}`),
            stateRead<string>(`cycle_range_computed_at_${a}`),
          ]);
          const isStale =
            !computedAt ||
            Date.now() - new Date(computedAt).getTime() > 25 * 3600 * 1000;
          return {
            asset: a,
            cycleLowZoneTop: low,
            cycleHighZoneBottom: high,
            computedAt: computedAt ?? null,
            isStale,
          };
        }),
      );
      return { assets, dbReady: true };
    },
  );
}
