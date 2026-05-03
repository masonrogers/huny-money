import {
  getDueTimers,
  markTimerCompleted,
  markTimerExpired,
  createTimer,
} from '@/lib/db/queries/timers';
import {
  getOrderByExchangeId,
  updateOrder,
  updateOrderByExchangeId,
} from '@/lib/db/queries/orders';
import {
  getPositionById,
  updatePosition,
  closePosition,
} from '@/lib/db/queries/positions';
import { createAlert } from '@/lib/db/queries/alerts';
import { getOrder as getCoinbaseOrder, cancelOrders, placeMarketOrder } from '@/lib/coinbase/orders';
import { getTicker } from '@/lib/coinbase/market-data';
import { TAKER_FEE } from '@/lib/constants';
import { getState } from '@/lib/db/queries/system-state';

// ─── Constants ────────────────────────────────────────────────────────────────

/** 60% fill threshold for keeping partial fills */
const PARTIAL_FILL_KEEP_THRESHOLD = 0.60;

/** Max retry window for API retries (30 minutes) */
const API_RETRY_MAX_MS = 30 * 60 * 1000;

/** Delay between API retries (5 minutes) */
const API_RETRY_DELAY_MS = 5 * 60 * 1000;

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function processAllDueTimers(): Promise<{
  processed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  const dueTimers = await getDueTimers();
  let processed = 0;

  for (const timer of dueTimers) {
    try {
      switch (timer.type) {
        case 'order_cancel':
          await processOrderCancelTimer(timer);
          break;
        case 'dca_fallback':
          await processDcaFallbackTimer(timer);
          break;
        case 'api_retry':
          await processApiRetryTimer(timer);
          break;
        case 'evaluation':
          await processEvaluationTimer(timer);
          break;
        default:
          console.warn(`[TimerProcessor] Unknown timer type: ${timer.type}, id=${timer.id}`);
          await markTimerCompleted(timer.id);
          break;
      }
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Timer ${timer.id} (${timer.type}): ${msg}`);
      console.error(`[TimerProcessor] Error processing timer ${timer.id}:`, err);
    }
  }

  if (dueTimers.length > 0) {
    console.log(
      `[TimerProcessor] Processed ${processed}/${dueTimers.length} timers, ${errors.length} errors`,
    );
  }

  return { processed, errors };
}

// ─── Order Cancel Timer ───────────────────────────────────────────────────────

async function processOrderCancelTimer(
  timer: Awaited<ReturnType<typeof getDueTimers>>[number],
): Promise<void> {
  const paperMode = (await getState('paper_trading_mode')) === 'true';

  // Find the related order
  if (!timer.relatedOrderId) {
    console.warn(`[TimerProcessor] order_cancel timer ${timer.id} has no related order`);
    await markTimerCompleted(timer.id);
    return;
  }

  // Get entity info
  const entityInfo = timer.relatedEntity ? JSON.parse(timer.relatedEntity) : {};
  const productId: string = entityInfo.product_id ?? '';

  // Look up the DB order
  const dbOrders = await import('@/lib/db/queries/orders');
  // We need to get the order by its DB id - find it via the related order id
  // The timer stores the DB order id as relatedOrderId
  // We need the coinbase order ID to check on Coinbase
  const { orders } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/lib/db/index');
  const [dbOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, timer.relatedOrderId))
    .limit(1);

  if (!dbOrder) {
    console.warn(`[TimerProcessor] Order ${timer.relatedOrderId} not found in DB`);
    await markTimerCompleted(timer.id);
    return;
  }

  // If already filled or cancelled, nothing to do
  if (dbOrder.status === 'filled' || dbOrder.status === 'cancelled') {
    await markTimerCompleted(timer.id);
    return;
  }

  // Check actual order status on Coinbase
  let coinbaseStatus: string = 'UNKNOWN';
  let filledSize = 0;
  let intendedSize = Number(dbOrder.quantity);
  let avgFillPrice = 0;

  if (!paperMode && dbOrder.coinbaseOrderId) {
    try {
      const cbOrder = await getCoinbaseOrder(dbOrder.coinbaseOrderId);
      coinbaseStatus = cbOrder.status;
      filledSize = parseFloat(cbOrder.filled_size || '0');
      avgFillPrice = parseFloat(cbOrder.average_filled_price || '0');
    } catch (err) {
      console.error(`[TimerProcessor] Error fetching Coinbase order ${dbOrder.coinbaseOrderId}:`, err);
      // If we can't check, mark completed and let reconciliation handle it
      await markTimerCompleted(timer.id);
      return;
    }
  } else {
    // Paper mode: the order was already simulated as filled at creation
    await markTimerCompleted(timer.id);
    return;
  }

  if (coinbaseStatus === 'FILLED') {
    // Order filled, update DB
    await updateOrder(dbOrder.id, {
      status: 'filled',
      filledAt: new Date(),
      fillPrice: String(avgFillPrice),
      fillQuantity: String(filledSize),
    });
    await markTimerCompleted(timer.id);
    return;
  }

  if (coinbaseStatus === 'PENDING' || coinbaseStatus === 'OPEN') {
    // Order still open — check partial fills
    const fillRatio = intendedSize > 0 ? filledSize / intendedSize : 0;

    if (filledSize > 0 && fillRatio >= PARTIAL_FILL_KEEP_THRESHOLD) {
      // Filled >= 60%: keep the partial fill, cancel remainder
      await cancelOrders([dbOrder.coinbaseOrderId!]);

      await updateOrder(dbOrder.id, {
        status: 'filled',
        filledAt: new Date(),
        fillPrice: String(avgFillPrice),
        fillQuantity: String(filledSize),
        cancelReason: `Partial fill kept: ${(fillRatio * 100).toFixed(0)}% filled (>= 60% threshold)`,
      });

      // Update position quantity to match actual fill
      if (entityInfo.position_id) {
        await updatePosition(entityInfo.position_id, {
          quantity: String(filledSize),
          entryPrice: String(avgFillPrice),
          costBasis: String(filledSize * avgFillPrice),
        });
      }

      console.log(
        `[TimerProcessor] Partial fill kept for order ${dbOrder.coinbaseOrderId}: ` +
          `${filledSize}/${intendedSize} (${(fillRatio * 100).toFixed(0)}%)`,
      );
    } else if (filledSize > 0) {
      // Filled < 60%: cancel and exit the partial position
      await cancelOrders([dbOrder.coinbaseOrderId!]);

      await updateOrder(dbOrder.id, {
        status: 'cancelled',
        cancelReason: `Partial fill too small: ${(fillRatio * 100).toFixed(0)}% filled (< 60% threshold)`,
      });

      // Exit the partial position with a market sell
      if (entityInfo.position_id && filledSize > 0) {
        const position = await getPositionById(entityInfo.position_id);
        if (position && position.status === 'open') {
          const effProductId = productId || `${position.asset}-USD`;

          // Cancel stop and TP orders for this position
          const posOrders = await dbOrders.getOrdersForPosition(position.id);
          const pendingIds = posOrders
            .filter((o) => o.status === 'pending' && o.coinbaseOrderId)
            .map((o) => o.coinbaseOrderId!);
          if (pendingIds.length > 0) {
            try {
              await cancelOrders(pendingIds);
            } catch { /* best effort */ }
          }
          for (const o of posOrders.filter((o) => o.status === 'pending')) {
            await updateOrder(o.id, { status: 'cancelled', cancelReason: 'Position closed due to small partial fill' });
          }

          // Market sell the small partial
          try {
            await placeMarketOrder({
              productId: effProductId,
              side: 'SELL',
              baseSize: String(filledSize),
            });
          } catch (sellErr) {
            console.error(`[TimerProcessor] Market sell for partial fill cleanup failed:`, sellErr);
          }

          // Close the position
          const ticker = await getTicker(effProductId);
          const exitPrice = ticker.bestBid > 0 ? ticker.bestBid : ticker.lastPrice;
          const grossPnl = (exitPrice - avgFillPrice) * filledSize;
          const fees = (avgFillPrice * filledSize + exitPrice * filledSize) * TAKER_FEE;
          const netPnl = grossPnl - fees;

          await closePosition(position.id, {
            exit_price: String(exitPrice),
            exit_reason: 'Partial fill below 60% threshold - auto-closed',
            gross_pnl: grossPnl.toFixed(2),
            net_pnl: netPnl.toFixed(2),
            fees_paid: fees.toFixed(2),
            realized_gain_loss: netPnl.toFixed(2),
          });
        }
      }

      console.log(
        `[TimerProcessor] Partial fill too small, exited: order ${dbOrder.coinbaseOrderId}, ` +
          `${filledSize}/${intendedSize} (${(fillRatio * 100).toFixed(0)}%)`,
      );
    } else {
      // No fill at all: just cancel
      await cancelOrders([dbOrder.coinbaseOrderId!]);

      await updateOrder(dbOrder.id, {
        status: 'cancelled',
        cancelReason: 'Entry order not filled within cancel window',
      });

      // Close the position record (no fill = no trade)
      if (entityInfo.position_id) {
        const position = await getPositionById(entityInfo.position_id);
        if (position && position.status === 'open') {
          // Cancel any associated orders
          const posOrders = await dbOrders.getOrdersForPosition(position.id);
          const pendingIds = posOrders
            .filter((o) => o.status === 'pending' && o.coinbaseOrderId)
            .map((o) => o.coinbaseOrderId!);
          if (pendingIds.length > 0) {
            try {
              await cancelOrders(pendingIds);
            } catch { /* best effort */ }
          }
          for (const o of posOrders.filter((o) => o.status === 'pending')) {
            await updateOrder(o.id, { status: 'cancelled', cancelReason: 'Entry order unfilled - position cancelled' });
          }

          await closePosition(position.id, {
            exit_price: '0',
            exit_reason: 'Entry order not filled - cancelled',
            gross_pnl: '0',
            net_pnl: '0',
            fees_paid: '0',
            realized_gain_loss: '0',
          });
        }
      }

      console.log(`[TimerProcessor] Order ${dbOrder.coinbaseOrderId} not filled, cancelled`);
    }
  } else {
    // Order already cancelled/expired on Coinbase
    await updateOrder(dbOrder.id, {
      status: 'cancelled',
      cancelReason: `Coinbase status: ${coinbaseStatus}`,
    });
  }

  await markTimerCompleted(timer.id);
}

// ─── DCA Fallback Timer ───────────────────────────────────────────────────────

async function processDcaFallbackTimer(
  timer: Awaited<ReturnType<typeof getDueTimers>>[number],
): Promise<void> {
  const paperMode = (await getState('paper_trading_mode')) === 'true';
  const entityInfo = timer.relatedEntity ? JSON.parse(timer.relatedEntity) : {};

  if (!timer.relatedOrderId) {
    console.warn(`[TimerProcessor] dca_fallback timer ${timer.id} has no related order`);
    await markTimerCompleted(timer.id);
    return;
  }

  // Get the DB order
  const { orders } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/lib/db/index');
  const [dbOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, timer.relatedOrderId))
    .limit(1);

  if (!dbOrder) {
    await markTimerCompleted(timer.id);
    return;
  }

  // If already filled, nothing to do
  if (dbOrder.status === 'filled') {
    await markTimerCompleted(timer.id);
    return;
  }

  const productId = entityInfo.product_id ?? `${dbOrder.asset}-USD`;

  // Cancel the limit order on Coinbase
  if (!paperMode && dbOrder.coinbaseOrderId) {
    try {
      await cancelOrders([dbOrder.coinbaseOrderId]);
    } catch (err) {
      console.error(`[TimerProcessor] Error cancelling DCA limit order:`, err);
    }
  }

  // Update DB order as cancelled
  await updateOrder(dbOrder.id, {
    status: 'cancelled',
    cancelReason: 'DCA limit order not filled in 2 hours, falling back to market order',
  });

  // Place market order instead
  const quantity = String(dbOrder.quantity);
  let marketOrderId: string;
  let fillPrice: number;

  if (paperMode) {
    const crypto = await import('crypto');
    marketOrderId = `paper-${crypto.randomUUID()}`;
    const ticker = await getTicker(productId);
    fillPrice = ticker.lastPrice;
  } else {
    const marketResult = await placeMarketOrder({
      productId,
      side: dbOrder.side as 'BUY' | 'SELL',
      baseSize: quantity,
    });

    if (!marketResult.success) {
      await createAlert({
        type: 'order_failed',
        severity: 'warning',
        message: `DCA fallback market order failed for ${dbOrder.asset}: ${marketResult.error_response?.message ?? marketResult.failure_reason}`,
      });
      await markTimerCompleted(timer.id);
      return;
    }

    marketOrderId = marketResult.order_id;
    const ticker = await getTicker(productId);
    fillPrice = ticker.lastPrice;
  }

  // Create the market order record
  const { createOrder } = await import('@/lib/db/queries/orders');
  await createOrder({
    coinbaseOrderId: marketOrderId,
    type: 'dca_limit', // Keep original type for tracking
    asset: dbOrder.asset,
    side: dbOrder.side,
    price: String(fillPrice),
    quantity,
    status: paperMode ? 'filled' : 'pending',
    relatedPositionId: dbOrder.relatedPositionId,
    placedAt: new Date(),
    filledAt: paperMode ? new Date() : undefined,
    fillPrice: paperMode ? String(fillPrice) : undefined,
    fillQuantity: paperMode ? quantity : undefined,
  });

  console.log(
    `[TimerProcessor] DCA fallback: replaced limit with market order for ${dbOrder.asset}`,
  );

  await markTimerCompleted(timer.id);
}

// ─── API Retry Timer ──────────────────────────────────────────────────────────

async function processApiRetryTimer(
  timer: Awaited<ReturnType<typeof getDueTimers>>[number],
): Promise<void> {
  const entityInfo = timer.relatedEntity ? JSON.parse(timer.relatedEntity) : {};
  const operation: string = entityInfo.operation ?? 'unknown';
  const createdAt = timer.createdAt?.getTime() ?? Date.now();
  const elapsedMs = Date.now() - createdAt;

  console.log(`[TimerProcessor] API retry: operation=${operation}, elapsed=${(elapsedMs / 1000).toFixed(0)}s`);

  try {
    // Attempt to retry the stored operation
    // Operations are stored as JSON with enough info to re-execute
    if (entityInfo.action === 'place_stop_limit' && entityInfo.params) {
      const { placeStopLimitOrder } = await import('@/lib/coinbase/orders');
      const result = await placeStopLimitOrder(entityInfo.params);

      if (result.success) {
        // Success - update the relevant records
        if (entityInfo.position_id && entityInfo.order_type === 'stop_limit') {
          await updatePosition(entityInfo.position_id, {
            stopOrderId: result.order_id,
          });
        }
        console.log(`[TimerProcessor] API retry succeeded for ${operation}`);
        await markTimerCompleted(timer.id);
        return;
      }
    } else if (entityInfo.action === 'place_limit' && entityInfo.params) {
      const { placeLimitOrder } = await import('@/lib/coinbase/orders');
      const result = await placeLimitOrder(entityInfo.params);

      if (result.success) {
        if (entityInfo.position_id && entityInfo.order_type === 'take_profit') {
          await updatePosition(entityInfo.position_id, {
            tpOrderId: result.order_id,
          });
        }
        console.log(`[TimerProcessor] API retry succeeded for ${operation}`);
        await markTimerCompleted(timer.id);
        return;
      }
    }

    // If we reach here, the operation didn't match or still failed
    throw new Error(`Operation ${operation} still failing`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (elapsedMs < API_RETRY_MAX_MS) {
      // Schedule another retry in 5 minutes
      await createTimer({
        type: 'api_retry',
        target_time: new Date(Date.now() + API_RETRY_DELAY_MS),
        related_order_id: timer.relatedOrderId ?? undefined,
        related_entity: timer.relatedEntity ?? undefined,
      });
      console.log(
        `[TimerProcessor] API retry failed (${msg}), scheduling another in 5 min ` +
          `(${(elapsedMs / 60000).toFixed(1)}/${API_RETRY_MAX_MS / 60000} minutes elapsed)`,
      );
    } else {
      // Past 30-minute window: give up and alert
      await createAlert({
        type: 'order_failed',
        severity: 'critical',
        message: `API retry exhausted after 30 minutes for ${operation}: ${msg}`,
        data: entityInfo,
      });
      console.error(`[TimerProcessor] API retry exhausted for ${operation}: ${msg}`);
      await markTimerExpired(timer.id);
      return;
    }
  }

  await markTimerCompleted(timer.id);
}

// ─── Evaluation Timer ─────────────────────────────────────────────────────────

async function processEvaluationTimer(
  timer: Awaited<ReturnType<typeof getDueTimers>>[number],
): Promise<void> {
  // Evaluation timers are just triggers - flag that an evaluation is needed
  // The actual evaluation is run by the scheduler/cron, not here

  const entityInfo = timer.relatedEntity ? JSON.parse(timer.relatedEntity) : {};

  console.log(
    `[TimerProcessor] Evaluation timer triggered: ${JSON.stringify(entityInfo)}`,
  );

  // Flag that an emergency evaluation is needed
  await import('@/lib/db/queries/system-state').then(({ setState }) =>
    setState('emergency_evaluation_pending', 'true'),
  );

  if (entityInfo.triggers) {
    await createAlert({
      type: 'emergency_evaluation',
      severity: 'warning',
      message: `Emergency evaluation triggered by price movement`,
      data: entityInfo,
    });
  }

  await markTimerCompleted(timer.id);
}
