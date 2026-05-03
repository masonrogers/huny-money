import { NextRequest, NextResponse } from 'next/server';
import { getClosedPositions } from '@/lib/db/queries/positions';
import { getState } from '@/lib/db/queries/system-state';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const asset = searchParams.get('asset') ?? undefined;
    const offset = (page - 1) * limit;
    const isPaper = (await getState('paper_trading_mode')) === 'true';

    const closedPositions = await getClosedPositions({ asset, limit, offset, isPaper });

    // Enrich with holdDurationDays for the frontend
    const trades = closedPositions.map((pos) => {
      const holdDurationDays =
        pos.entryTime && pos.exitTime
          ? Math.max(
              0,
              Math.floor(
                (new Date(pos.exitTime).getTime() -
                  new Date(pos.entryTime).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            )
          : 0;

      return {
        ...pos,
        holdDurationDays,
        closedAt: pos.exitTime ? new Date(pos.exitTime).toISOString() : null,
      };
    });

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
