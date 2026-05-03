import { NextResponse } from 'next/server';
import { getOpenPositions, closePosition } from '@/lib/db/queries/positions';
import { getOrdersForPosition, updateOrder } from '@/lib/db/queries/orders';
import { getState } from '@/lib/db/queries/system-state';
import { cancelOrders, placeMarketOrder, getMidPrice } from '@/lib/coinbase';
import { TAKER_FEE } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const paperMode = (await getState('paper_trading_mode')) === 'true';
    const openPositions = await getOpenPositions(paperMode);

    if (openPositions.length === 0) {
      return NextResponse.json({
        closed: 0,
        results: [],
        message: 'No open positions to close',
      });
    }

    const results: Array<{
      positionId: number;
      asset: string;
      success: boolean;
      netPnl?: number;
      error?: string;
    }> = [];

    for (const pos of openPositions) {
      try {
        const quantity = Number(pos.quantity);
        const entryPrice = Number(pos.entryPrice);
        const costBasis = Number(pos.costBasis);
        const productId = `${pos.asset}-USD`;

        // Cancel pending stop/TP orders
        const posOrders = await getOrdersForPosition(pos.id);
        const pendingCoinbaseIds = posOrders
          .filter((o) => o.status === 'pending' && o.coinbaseOrderId)
          .map((o) => o.coinbaseOrderId!);

        if (pendingCoinbaseIds.length > 0 && !paperMode) {
          try {
            await cancelOrders(pendingCoinbaseIds);
          } catch {
            // Best effort cancellation
          }
        }

        // Mark DB orders as cancelled
        for (const o of posOrders.filter((o) => o.status === 'pending')) {
          await updateOrder(o.id, {
            status: 'cancelled',
            cancelReason: 'Position closed via close-all control',
          });
        }

        // Place market sell (or simulate)
        let exitPrice: number;
        if (paperMode) {
          exitPrice = await getMidPrice(productId);
        } else {
          const sellResult = await placeMarketOrder({
            productId,
            side: 'SELL',
            baseSize: String(quantity),
          });

          if (!sellResult.success) {
            throw new Error(
              sellResult.failure_reason ??
                sellResult.error_response?.message ??
                'Market sell failed'
            );
          }

          // Use mid price as approximation; reconciliation will correct
          exitPrice = await getMidPrice(productId);
        }

        // Calculate P&L
        const grossPnl = (exitPrice - entryPrice) * quantity;
        const fees = (costBasis + exitPrice * quantity) * TAKER_FEE;
        const netPnl = grossPnl - fees;

        await closePosition(pos.id, {
          exit_price: String(exitPrice),
          exit_reason: 'manual',
          gross_pnl: grossPnl.toFixed(2),
          net_pnl: netPnl.toFixed(2),
          fees_paid: fees.toFixed(2),
          realized_gain_loss: netPnl.toFixed(2),
        });

        results.push({
          positionId: pos.id,
          asset: pos.asset,
          success: true,
          netPnl: Math.round(netPnl * 100) / 100,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({
          positionId: pos.id,
          asset: pos.asset,
          success: false,
          error: errMsg,
        });
      }
    }

    const closedCount = results.filter((r) => r.success).length;
    return NextResponse.json({
      message: `Closed ${closedCount} of ${results.length} positions`,
      closed: closedCount,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /controls/close-all] Error:', message);
    return NextResponse.json(
      { error: 'Failed to close positions', details: message },
      { status: 500 }
    );
  }
}
