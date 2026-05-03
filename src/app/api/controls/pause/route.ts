import { NextRequest, NextResponse } from 'next/server';
import { setState } from '@/lib/db/queries/system-state';
import { createAlert } from '@/lib/db/queries/alerts';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { paused } = body;

    if (typeof paused !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid request: "paused" must be a boolean' },
        { status: 400 }
      );
    }

    await setState('trading_paused', String(paused));

    await createAlert({
      type: 'emergency_evaluation',
      severity: 'warning',
      message: `Trading ${paused ? 'paused' : 'resumed'} via manual control`,
    });

    return NextResponse.json({
      trading_paused: paused,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /controls/pause] Error:', message);
    return NextResponse.json(
      { error: 'Failed to toggle pause', details: message },
      { status: 500 }
    );
  }
}
