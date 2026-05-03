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
          const positionValueUsd = currentPrice * quantity;
          const unrealizedPnlUsd = positionValueUsd - costBasis;
          const unrealizedPnlPct =
            costBasis > 0 ? (unrealizedPnlUsd / costBasis) * 100 : 0;
          const daysHeld = pos.entryTime
            ? Math.max(
                0,
                Math.floor(
                  (Date.now() - new Date(pos.entryTime).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              )
            : 0;

          return {
            ...pos,
            currentPrice,
            positionValueUsd,
            unrealizedPnlUsd: Math.round(unrealizedPnlUsd * 100) / 100,
            unrealizedPnlPct: Math.round(unrealizedPnlPct * 100) / 100,
            daysHeld,
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
      const closedPositions = await getClosedPositions({ limit, offset });

      // Enrich closed positions with computed daysHeld
      const enriched = closedPositions.map((pos) => {
        const daysHeld =
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
          daysHeld,
        };
      });

      return NextResponse.json({
        positions: enriched,
        total: enriched.length,
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
