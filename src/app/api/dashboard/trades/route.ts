import { NextRequest, NextResponse } from 'next/server';
import { getClosedPositions } from '@/lib/db/queries/positions';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const asset = searchParams.get('asset') ?? undefined;
    const offset = (page - 1) * limit;

    const trades = await getClosedPositions({ asset, limit, offset });

    return NextResponse.json({
      trades,
      total: trades.length,
      page,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /dashboard/trades] Error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch trades', details: message },
      { status: 500 }
    );
  }
}
