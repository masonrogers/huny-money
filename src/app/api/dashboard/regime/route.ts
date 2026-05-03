import { NextResponse } from 'next/server';
import { getState } from '@/lib/db/queries/system-state';
import { getRegimeHistory } from '@/lib/db/queries/regime';
import { getActiveTheses } from '@/lib/db/queries/theses';
import { getSnapshots } from '@/lib/db/queries/equity';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [currentRegime, regimeHistory, activeTheses, equitySnapshots] =
      await Promise.all([
        getState('current_regime'),
        getRegimeHistory(30),
        getActiveTheses(),
        getSnapshots(30),
      ]);

    // Extract BTC benchmark data from equity snapshots
    const btcBenchmark = equitySnapshots.map((s) => ({
      timestamp: s.timestamp,
      total_value_usd: Number(s.totalValueUsd),
      btc_price: Number(s.btcPrice),
      btc_hold_value: Number(s.btcHoldValue),
    }));

    return NextResponse.json({
      current_regime: currentRegime ?? 'ranging',
      regime_history: regimeHistory,
      active_theses: activeTheses,
      btc_benchmark: btcBenchmark,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /dashboard/regime] Error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch regime data', details: message },
      { status: 500 }
    );
  }
}
