import { NextResponse } from 'next/server';
import { runFullReconciliation } from '@/lib/engine/reconciliation';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await runFullReconciliation();
    return NextResponse.json({
      success: true,
      message: 'Reconciliation completed successfully',
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /controls/force-reconciliation] Error:', message);
    return NextResponse.json(
      { error: 'Reconciliation failed', details: message },
      { status: 500 }
    );
  }
}
