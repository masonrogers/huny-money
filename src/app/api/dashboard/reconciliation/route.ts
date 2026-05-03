import { NextRequest, NextResponse } from 'next/server';
import { getReconciliationLogs } from '@/lib/db/queries/reconciliation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);

    const logs = await getReconciliationLogs(limit);

    return NextResponse.json({
      logs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /dashboard/reconciliation] Error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch reconciliation logs', details: message },
      { status: 500 }
    );
  }
}
