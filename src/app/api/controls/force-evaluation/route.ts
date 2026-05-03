import { NextResponse } from 'next/server';
import { runEvaluation } from '@/lib/engine/evaluation';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await runEvaluation();
    return NextResponse.json({
      success: true,
      message: 'Evaluation triggered and completed',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /controls/force-evaluation] Error:', message);
    return NextResponse.json(
      { error: 'Evaluation failed', details: message },
      { status: 500 }
    );
  }
}
