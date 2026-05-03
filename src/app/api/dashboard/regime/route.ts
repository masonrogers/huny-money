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
      totalValueUsd: Number(s.totalValueUsd),
      btcPrice: Number(s.btcPrice),
      btcHoldValue: Number(s.btcHoldValue),
    }));

    // Get latest regime evidence from history
    const latestRegimeEntry = regimeHistory.length > 0 ? regimeHistory[0] : null;

    return NextResponse.json({
      currentRegime: currentRegime ?? 'ranging',
      regimeEvidence: latestRegimeEntry?.evidence ?? null,
      assessedAt: latestRegimeEntry?.assessedAt ?? null,
      theses: activeTheses,
      history: regimeHistory,
      btcBenchmark,
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
