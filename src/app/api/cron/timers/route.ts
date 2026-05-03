import { NextRequest, NextResponse } from 'next/server';
import { validateCronSecret } from '@/lib/auth';
import { processAllDueTimers } from '@/lib/engine/timer-processor';

export const dynamic = 'force-dynamic';

async function handler(request: NextRequest) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processAllDueTimers();
    return NextResponse.json({
      success: true,
      processed: result.processed,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /cron/timers] Error:', message);
    return NextResponse.json(
      { error: 'Timer processing failed', details: message },
      { status: 500 }
    );
  }
}

export const GET = handler;
export const POST = handler;
