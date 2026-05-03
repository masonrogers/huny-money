import { NextResponse } from 'next/server';
import {
  getStrategyParams,
  getModificationHistory,
  getCurrentVersion,
} from '@/lib/db/queries/strategy';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [params, modifications, currentVersion] = await Promise.all([
      getStrategyParams(),
      getModificationHistory(),
      getCurrentVersion(),
    ]);

    return NextResponse.json({
      params,
      modifications,
      version: currentVersion,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /dashboard/strategy] Error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch strategy data', details: message },
      { status: 500 }
    );
  }
}
