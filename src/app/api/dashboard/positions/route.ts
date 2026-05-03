import { NextRequest, NextResponse } from 'next/server';
import { getOpenPositions, getClosedPositions } from '@/lib/db/queries/positions';
import { getMidPrice } from '@/lib/coinbase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') ?? 'open';
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    if (status === 'open') {
      const positions = await getOpenPositions();

      // Enrich open positions with current prices
      const enriched = await Promise.all(
        positions.map(async (pos) => {
          let currentPrice = 0;
          try {
            currentPrice = await getMidPrice(`${pos.asset}-USD`);
          } catch {
            currentPrice = Number(pos.entryPrice);
          }

          const quantity = Number(pos.quantity);
          const entryPrice = Number(pos.entryPrice);
          const costBasis = Number(pos.costBasis);
          const positionValue = currentPrice * quantity;
          const unrealizedPnlUsd = positionValue - costBasis;
          const unrealizedPnlPct =
            costBasis > 0 ? (unrealizedPnlUsd / costBasis) * 100 : 0;

          return {
            ...pos,
            currentPrice,
            positionValue,
            unrealizedPnlUsd: Math.round(unrealizedPnlUsd * 100) / 100,
            unrealizedPnlPct: Math.round(unrealizedPnlPct * 100) / 100,
          };
        })
      );

      // Apply pagination manually for open positions
      const paginated = enriched.slice(offset, offset + limit);

      return NextResponse.json({
        positions: paginated,
        total: positions.length,
      });
    } else {
      const positions = await getClosedPositions({ limit, offset });

      return NextResponse.json({
        positions,
        total: positions.length,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /dashboard/positions] Error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch positions', details: message },
      { status: 500 }
    );
  }
}
