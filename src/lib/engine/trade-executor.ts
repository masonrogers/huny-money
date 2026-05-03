import crypto from 'crypto';
import type { TradeProposal } from '@/lib/types/evaluation';
import { getTicker } from '@/lib/coinbase/market-data';
import {
  placeLimitOrder,
  placeStopLimitOrder,
} from '@/lib/coinbase/orders';
import { createPosition } from '@/lib/db/queries/positions';
import { createOrder } from '@/lib/db/queries/orders';
import { createTimer } from '@/lib/db/queries/timers';
import { getState } from '@/lib/db/queries/system-state';
import { TAKER_FEE } from '@/lib/constants';

// ─── Constants ────────────────────────────────────────────────────────────────

/** How far above the best ask to place a limit buy (0.1%) */
const LIMIT_BUY_OFFSET_PCT = 0.001;

/** How far below the stop price to set the limit on a stop-limit sell (0.5%) */
const STOP_LIMIT_SLIPPAGE_PCT = 0.005;

/** Minutes until an unfilled entry order is auto-cancelled */
const ENTRY_CANCEL_MINUTES = 15;

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function executeNewTrade(
  proposal: TradeProposal,
  paperMode: boolean,
): Promise<{ success: boolean; positionId?: number; error?: string }> {
  const productId = `${proposal.asset}-USD`;

  try {
    // 1. Get current price from Coinbase ticker
    const ticker = await getTicker(productId);
    const currentPrice = ticker.bestAsk > 0 ? ticker.bestAsk : ticker.lastPrice;

    // 2. Calculate limit price (slightly above ask for buys)
    const limitPrice = currentPrice * (1 + LIMIT_BUY_OFFSET_PCT);

    // 3. Calculate quantity from USD size and limit price
    const quantity = proposal.position_size_usd / limitPrice;
    const quantityStr = quantity.toPrecision(8);
    const limitPriceStr = limitPrice.toFixed(2);

    // 4. Get current regime and strategy version
    const regime = (await getState('current_regime')) ?? 'ranging';
    const strategyVersion = (await getState('strategy_version')) ?? '1.0';

    // 5. Place entry limit order
    let entryOrderId: string;
    let fillPrice: number;

    if (paperMode) {
      entryOrderId = `paper-${crypto.randomUUID()}`;
      fillPrice = currentPrice; // Simulate fill at current price
    } else {
      const entryResult = await placeLimitOrder({
        productId,
        side: 'BUY',
        baseSize: quantityStr,
        limitPrice: limitPriceStr,
      });

      if (!entryResult.success) {
        return {
          success: false,
          error: `Entry order failed: ${entryResult.error_response?.message ?? entryResult.failure_reason ?? 'Unknown error'}`,
        };
      }

      entryOrderId = entryResult.order_id;
      fillPrice = limitPrice; // Will be updated on fill
    }

    // 6. Create position record in DB
    const costBasis = quantity * fillPrice;
    const position = await createPosition({
      asset: proposal.asset,
      type: proposal.type,
      status: 'open',
      direction: 'long',
      entryPrice: String(fillPrice),
      quantity: quantityStr,
      entryTime: new Date(),
      stopLoss: String(proposal.stop_loss),
      takeProfitTarget: String(proposal.take_profit_target),
      convictionAtEntry: proposal.conviction,
      currentConviction: proposal.conviction,
      catalyst: proposal.catalyst,
      thesis: proposal.reasoning,
      reasoning: proposal.confirmation,
      costBasis: String(costBasis),
      strategyVersion,
      regimeAtEntry: regime,
      entryOrderId,
      isPaper: paperMode,
      feesPaid: paperMode
        ? String(costBasis * TAKER_FEE)
        : '0', // Real fees updated on fill
    });

    // 7. Create entry order record in DB
    const entryOrder = await createOrder({
      coinbaseOrderId: entryOrderId,
      type: 'entry_limit',
      asset: proposal.asset,
      side: 'BUY',
      price: limitPriceStr,
      quantity: quantityStr,
      status: paperMode ? 'filled' : 'pending',
      relatedPositionId: position.id,
      placedAt: new Date(),
      filledAt: paperMode ? new Date() : undefined,
      fillPrice: paperMode ? String(fillPrice) : undefined,
      fillQuantity: paperMode ? quantityStr : undefined,
      isPaper: paperMode,
    });

    // 8. Place stop-limit sell order
    const stopPrice = proposal.stop_loss;
    const stopLimitPrice = stopPrice * (1 - STOP_LIMIT_SLIPPAGE_PCT);
    let stopOrderId: string;

    if (paperMode) {
      stopOrderId = `paper-${crypto.randomUUID()}`;
    } else {
      const stopResult = await placeStopLimitOrder({
        productId,
        side: 'SELL',
        baseSize: quantityStr,
        limitPrice: stopLimitPrice.toFixed(2),
        stopPrice: stopPrice.toFixed(2),
        stopDirection: 'STOP_DIRECTION_STOP_DOWN',
      });

      if (!stopResult.success) {
        console.error(
          `[TradeExecutor] Stop order failed for position ${position.id}: ${stopResult.error_response?.message ?? stopResult.failure_reason}`,
        );
        stopOrderId = ''; // Will need reconciliation
      } else {
        stopOrderId = stopResult.order_id;
      }
    }

    // 9. Create stop order record in DB
    await createOrder({
      coinbaseOrderId: stopOrderId,
      type: 'stop_limit',
      asset: proposal.asset,
      side: 'SELL',
      price: String(stopPrice),
      quantity: quantityStr,
      status: 'pending',
      relatedPositionId: position.id,
      placedAt: new Date(),
      isPaper: paperMode,
    });

    // 10. Place take-profit limit sell order
    const tpPrice = proposal.take_profit_target;
    // Take 50% at first target per strategy rules
    const tpQuantity = quantity * 0.5;
    let tpOrderId: string;

    if (paperMode) {
      tpOrderId = `paper-${crypto.randomUUID()}`;
    } else {
      const tpResult = await placeLimitOrder({
        productId,
        side: 'SELL',
        baseSize: tpQuantity.toPrecision(8),
        limitPrice: tpPrice.toFixed(2),
      });

      if (!tpResult.success) {
        console.error(
          `[TradeExecutor] Take-profit order failed for position ${position.id}: ${tpResult.error_response?.message ?? tpResult.failure_reason}`,
        );
        tpOrderId = ''; // Will need reconciliation
      } else {
        tpOrderId = tpResult.order_id;
      }
    }

    // 11. Create take-profit order record in DB
    await createOrder({
      coinbaseOrderId: tpOrderId,
      type: 'take_profit',
      asset: proposal.asset,
      side: 'SELL',
      price: String(tpPrice),
      quantity: tpQuantity.toPrecision(8),
      status: 'pending',
      relatedPositionId: position.id,
      placedAt: new Date(),
      isPaper: paperMode,
    });

    // 12. Update position with order IDs
    const { updatePosition } = await import('@/lib/db/queries/positions');
    await updatePosition(position.id, {
      stopOrderId,
      tpOrderId,
    });

    // 13. Create 15-minute cancel timer for the entry order (if not paper mode fill)
    if (!paperMode) {
      const cancelTime = new Date(Date.now() + ENTRY_CANCEL_MINUTES * 60 * 1000);
      await createTimer({
        type: 'order_cancel',
        target_time: cancelTime,
        related_order_id: entryOrder.id,
        related_entity: JSON.stringify({
          position_id: position.id,
          order_type: 'entry_limit',
          asset: proposal.asset,
          product_id: productId,
        }),
      });
    }

    console.log(
      `[TradeExecutor] ${paperMode ? 'PAPER' : 'LIVE'} trade executed: ` +
        `${proposal.asset} ${proposal.type} @ $${fillPrice.toFixed(2)}, ` +
        `qty=${quantityStr}, position_id=${position.id}`,
    );

    return { success: true, positionId: position.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[TradeExecutor] Error executing trade for ${proposal.asset}: ${message}`);
    return { success: false, error: message };
  }
}
