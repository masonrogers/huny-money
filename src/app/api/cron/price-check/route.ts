import { NextRequest, NextResponse } from 'next/server';
import { validateCronSecret } from '@/lib/auth';
import { checkEmergencyThresholds } from '@/lib/engine/price-monitor';

export const dynamic = 'force-dynamic';

async function handler(request: NextRequest) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await checkEmergencyThresholds();
    return NextResponse.json({
      success: true,
      triggered: result.triggered,
      triggers: result.triggers,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /cron/price-check] Error:', message);
    return NextResponse.json(
      { error: 'Price check failed', details: message },
      { status: 500 }
    );
  }
}

export const GET = handler;
export const POST = handler;
