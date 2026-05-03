import { NextResponse } from 'next/server';
import { getMultipleStates } from '@/lib/db/queries/system-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const states = await getMultipleStates([
      'paper_trading_mode',
      'trading_paused',
    ]);

    return NextResponse.json({
      paperMode: states['paper_trading_mode'] === 'true',
      tradingPaused: states['trading_paused'] === 'true',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /dashboard/status] Error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch system status', details: message },
      { status: 500 }
    );
  }
}
