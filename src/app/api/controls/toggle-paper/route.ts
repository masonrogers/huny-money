import { NextRequest, NextResponse } from 'next/server';
import { setState } from '@/lib/db/queries/system-state';
import { createAlert } from '@/lib/db/queries/alerts';
import { STARTING_CAPITAL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid request: "enabled" must be a boolean' },
        { status: 400 }
      );
    }

    await setState('paper_trading_mode', String(enabled));

    // When switching TO paper mode, reset virtual cash and peak value
    if (enabled) {
      await setState('paper_cash_usd', String(STARTING_CAPITAL));
      await setState('paper_peak_value', String(STARTING_CAPITAL));
    }

    await createAlert({
      type: 'emergency_evaluation',
      severity: 'warning',
      message: `Paper trading mode ${enabled ? 'enabled' : 'disabled'} via manual control`,
    });

    return NextResponse.json({
      message: `Paper trading mode ${enabled ? 'enabled' : 'disabled'} successfully`,
      paperTradingMode: enabled,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /controls/toggle-paper] Error:', message);
    return NextResponse.json(
      { error: 'Failed to toggle paper trading mode', details: message },
      { status: 500 }
    );
  }
}
