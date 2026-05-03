import { NextRequest, NextResponse } from 'next/server';
import { validateCronSecret } from '@/lib/auth';
import { runEvaluation } from '@/lib/engine/evaluation';

export const dynamic = 'force-dynamic';

async function handler(request: NextRequest) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await runEvaluation();
    return NextResponse.json({
      success: true,
      message: 'Evaluation completed',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /cron/evaluate] Error:', message);
    return NextResponse.json(
      { error: 'Evaluation failed', details: message },
      { status: 500 }
    );
  }
}

export const GET = handler;
export const POST = handler;
