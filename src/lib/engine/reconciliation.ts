/**
 * Full reconciliation sequence from Section 22 of the strategy document.
 *
 * Runs on every app start (cold start, restart, crash recovery, deployment).
 * This is the most safety-critical code in the entire system.
 *
 * 8 steps:
 *   1. Health check (DB + Coinbase)
 *   2. Determine context (downtime calculation)
 *   3. Reconcile orders
 *   4. Reconcile balances
 *   5. Verify position safety (stop orders)
 *   6. Check missed evaluations
 *   7. Check emergency thresholds
 *   8. Resume normal operations
 */

import { db } from '@/lib/db/index';
import { systemState } from '@/lib/db/schema';
import { getState, setState } from '@/lib/db/queries/system-state';
import { getPendingOrders, updateOrder } from '@/lib/db/queries/orders';
import {
  getOpenPositions,
  closePosition,
  updatePosition,
  getPositionById,
} from '@/lib/db/queries/positions';
import { getOrdersForPosition } from '@/lib/db/queries/orders';
import { insertReconciliationLog } from '@/lib/db/queries/reconciliation';
import { createAlert } from '@/lib/db/queries/alerts';
import {
  getAccounts,
  getAllBalances,
  getOrder as getCoinbaseOrder,
  getMidPrice,
  placeStopLimitOrder,
} from '@/lib/coinbase';
import { STARTING_CAPITAL, ALL_ASSETS, EMERGENCY_THRESHOLD_PCT } from '@/lib/constants';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ReconciliationResult {
  discrepancies: Array<{
    type: string;
    description: string;
    severity: 'info' | 'warning' | 'critical';
  }>;
  actions: Array<{
    type: string;
    description: string;
  }>;
  missedEvaluation: boolean;
  emergencyTriggered: boolean;
  emergencyAsset?: string;
  emergencyPriceChange?: number;
  emergencyDirection?: string;
}

// ─── Step 1: Health Check ──────────────────────────────────────────────────

async function healthCheck(): Promise<void> {
  // Test DB connectivity
  try {
    await db.select().from(systemState).limit(1);
    console.log('[Reconciliation] DB health check: OK');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Reconciliation] DB health check FAILED: ${message}`);
    await createAlert({
      type: 'reconciliation_discrepancy',
      severity: 'critical',
      message: `Database health check failed during reconciliation: ${message}`,
    }).catch(() => {
      // If we can't even create an alert, the DB is truly down
    });
    throw new Error(`DB health check failed: ${message}`);
  }

  // Test Coinbase connectivity
  try {
    await getAccounts();
    console.log('[Reconciliation] Coinbase health check: OK');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Reconciliation] Coinbase health check FAILED: ${message}`);
    await createAlert({
      type: 'reconciliation_discrepancy',
      severity: 'critical',
      message: `Coinbase API health check failed during reconciliation: ${message}`,
    });
    throw new Error(`Coinbase health check failed: ${message}`);
  }
}

// ─── Step 2: Determine Context ─────────────────────────────────────────────

async function determineContext(): Promise<number | null> {
  const lastBootStr = await getState('last_successful_boot_at');

  if (!lastBootStr) {
    console.log('[Reconciliation] No previous boot recorded. First reconciliation.');
    return null;
  }

  const lastBoot = new Date(lastBootStr);
  const downtimeMs = Date.now() - lastBoot.getTime();
  const downtimeSeconds = Math.floor(downtimeMs / 1000);

  console.log(
    `[Reconciliation] Last boot: ${lastBoot.toISOString()}, downtime: ${downtimeSeconds}s (${(downtimeSeconds / 3600).toFixed(1)}h)`
  );

  return downtimeSeconds;
}

// ─── Step 3: Reconcile Orders ──────────────────────────────────────────────

async function reconcileOrders(
  result: ReconciliationResult
): Promise<void> {
  // Only reconcile live (non-paper) orders against Coinbase
  const pendingOrders = await getPendingOrders(false);
  console.log(`[Reconciliation] Found ${pendingOrders.length} pending orders to reconcile`);

  for (const order of pendingOrders) {
    if (!order.coinbaseOrderId) {
      result.discrepancies.push({
        type: 'order_no_exchange_id',
        description: `Order ${order.id} has no Coinbase order ID`,
        severity: 'warning',
      });
      continue;
    }

    try {
      const cbOrder = await getCoinbaseOrder(order.coinbaseOrderId);

      if (cbOrder.status === 'FILLED') {
        const fillPrice = parseFloat(cbOrder.average_filled_price) || null;
        const fillQuantity = parseFloat(cbOrder.filled_size) || null;
        const fees = parseFloat(cbOrder.total_fees) || 0;

        // Update the order record
        await updateOrder(order.id, {
          status: 'filled',
          filledAt: cbOrder.last_fill_time ? new Date(cbOrder.last_fill_time) : new Date(),
          fillPrice: fillPrice ? String(fillPrice) : undefined,
          fillQuantity: fillQuantity ? String(fillQuantity) : undefined,
        });

        result.actions.push({
          type: 'order_filled',
          description: `Order ${order.id} (${order.type} ${order.asset}) filled at $${fillPrice}`,
        });

        // Handle based on order type
        if (
          (order.type === 'stop_limit' || order.type === 'take_profit') &&
          order.relatedPositionId
        ) {
          // Stop or TP filled while we were down — close the position
          const position = await getPositionById(order.relatedPositionId);
          if (position && position.status === 'open') {
            const entryPrice = Number(position.entryPrice);
            const quantity = Number(position.quantity);
            const exitPrice = fillPrice ?? entryPrice;
            const grossPnl = (exitPrice - entryPrice) * quantity;
            const netPnl = grossPnl - fees;
            const realizedGainLoss = entryPrice > 0
              ? ((exitPrice - entryPrice) / entryPrice) * 100
              : 0;

            await closePosition(order.relatedPositionId, {
              exit_price: String(exitPrice),
              exit_reason: order.type === 'stop_limit' ? 'stop_hit' : 'tp_hit',
              gross_pnl: String(grossPnl),
              net_pnl: String(netPnl),
              fees_paid: String(fees),
              realized_gain_loss: String(realizedGainLoss),
            });

            result.actions.push({
              type: 'position_closed',
              description: `Position ${order.relatedPositionId} (${position.asset}) closed via ${order.type} at $${exitPrice}. P&L: $${netPnl.toFixed(2)}`,
            });

            console.log(
              `[Reconciliation] Position ${order.relatedPositionId} closed: ${order.type} filled at $${exitPrice}, net P&L: $${netPnl.toFixed(2)}`
            );
          }
        } else if (order.type === 'entry_limit' && order.relatedPositionId) {
          // Entry order filled — position should already exist, update it
          const position = await getPositionById(order.relatedPositionId);
          if (position) {
            // Verify the related stop and TP orders are still active
            const positionOrders = await getOrdersForPosition(order.relatedPositionId);
            const stopOrder = positionOrders.find((o) => o.type === 'stop_limit' && o.status === 'pending');
            const tpOrder = positionOrders.find((o) => o.type === 'take_profit' && o.status === 'pending');

            if (!stopOrder) {
              result.discrepancies.push({
                type: 'missing_stop_after_fill',
                description: `Position ${order.relatedPositionId} (${position.asset}) entry filled but no active stop order found`,
                severity: 'critical',
              });
            }
          }

          result.actions.push({
            type: 'entry_filled',
            description: `Entry order ${order.id} for position ${order.relatedPositionId} confirmed filled`,
          });
        }
      } else if (cbOrder.status === 'CANCELLED' || cbOrder.status === 'EXPIRED') {
        await updateOrder(order.id, {
          status: cbOrder.status === 'CANCELLED' ? 'cancelled' : 'expired',
          cancelReason: cbOrder.cancel_message || cbOrder.reject_message || cbOrder.status,
        });

        result.actions.push({
          type: 'order_cancelled',
          description: `Order ${order.id} (${order.type} ${order.asset}) was ${cbOrder.status} on Coinbase`,
        });

        console.log(
          `[Reconciliation] Order ${order.id} was ${cbOrder.status}: ${cbOrder.cancel_message || 'no reason'}`
        );
      } else if (cbOrder.status === 'FAILED') {
        await updateOrder(order.id, {
          status: 'failed',
          cancelReason: cbOrder.reject_reason || cbOrder.reject_message || 'FAILED',
        });

        result.discrepancies.push({
          type: 'order_failed',
          description: `Order ${order.id} (${order.type} ${order.asset}) FAILED on Coinbase: ${cbOrder.reject_message}`,
          severity: 'warning',
        });
      }
      // If still PENDING or OPEN on Coinbase, leave it — it's fine
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Reconciliation] Failed to check order ${order.id}: ${message}`);
      result.discrepancies.push({
        type: 'order_check_failed',
        description: `Could not check order ${order.id} (${order.coinbaseOrderId}) on Coinbase: ${message}`,
        severity: 'warning',
      });
    }
  }
}

// ─── Step 4: Reconcile Balances ────────────────────────────────────────────

async function reconcileBalances(
  result: ReconciliationResult
): Promise<void> {
  try {
    const balances = await getAllBalances(['USD', 'BTC', 'ETH', 'SOL']);
    // Only reconcile live (non-paper) positions against actual balances
    const openPositions = await getOpenPositions(false);

    // Compute expected balances from DB state
    const expectedAssetQuantities: Record<string, number> = {};
    for (const pos of openPositions) {
      const asset = pos.asset.toUpperCase();
      expectedAssetQuantities[asset] =
        (expectedAssetQuantities[asset] ?? 0) + Number(pos.quantity);
    }

    // Compare actual vs expected
    const totalCapitalStr = await getState('peak_portfolio_value');
    const totalCapital = totalCapitalStr ? Number(totalCapitalStr) : STARTING_CAPITAL;
    const discrepancyThreshold = totalCapital * 0.01; // 1% threshold

    for (const asset of ALL_ASSETS) {
      const actualTotal = balances[asset]?.total ?? 0;
      const expectedQuantity = expectedAssetQuantities[asset] ?? 0;

      if (expectedQuantity > 0 || actualTotal > 0) {
        let currentPrice = 0;
        try {
          currentPrice = await getMidPrice(`${asset}-USD`);
        } catch {
          // Can't get price, skip value comparison
          continue;
        }

        const actualValueUsd = actualTotal * currentPrice;
        const expectedValueUsd = expectedQuantity * currentPrice;
        const discrepancyUsd = Math.abs(actualValueUsd - expectedValueUsd);

        if (discrepancyUsd > discrepancyThreshold) {
          result.discrepancies.push({
            type: 'balance_discrepancy',
            description: `${asset} balance discrepancy: actual ${actualTotal.toFixed(8)} ($${actualValueUsd.toFixed(2)}) vs expected ${expectedQuantity.toFixed(8)} ($${expectedValueUsd.toFixed(2)}). Difference: $${discrepancyUsd.toFixed(2)}`,
            severity: 'warning',
          });

          console.warn(
            `[Reconciliation] ${asset} balance discrepancy: $${discrepancyUsd.toFixed(2)} (>${discrepancyThreshold.toFixed(2)} threshold)`
          );
        }
      }
    }

    console.log('[Reconciliation] Balance reconciliation complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Reconciliation] Balance reconciliation failed: ${message}`);
    result.discrepancies.push({
      type: 'balance_check_failed',
      description: `Failed to reconcile balances: ${message}`,
      severity: 'warning',
    });
  }
}

// ─── Step 5: Verify Position Safety ────────────────────────────────────────

async function verifyPositionSafety(
  result: ReconciliationResult
): Promise<void> {
  // Only verify stop orders for live (non-paper) positions
  const openPositions = await getOpenPositions(false);

  for (const position of openPositions) {
    try {
      // Check stop-limit order
      if (position.stopOrderId) {
        try {
          const stopOrder = await getCoinbaseOrder(position.stopOrderId);
          if (stopOrder.status !== 'PENDING' && stopOrder.status !== 'OPEN') {
            console.warn(
              `[Reconciliation] Stop order ${position.stopOrderId} for position ${position.id} (${position.asset}) is ${stopOrder.status}. Placing replacement.`
            );
            await placeEmergencyStop(position, result);
          }
        } catch {
          console.warn(
            `[Reconciliation] Could not verify stop order ${position.stopOrderId} for position ${position.id}. Placing replacement.`
          );
          await placeEmergencyStop(position, result);
        }
      } else {
        // No stop order ID recorded at all — highest priority
        console.error(
          `[Reconciliation] Position ${position.id} (${position.asset}) has NO stop order. Placing immediately.`
        );
        await placeEmergencyStop(position, result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[Reconciliation] Failed to verify safety for position ${position.id}: ${message}`
      );
      result.discrepancies.push({
        type: 'position_safety_failed',
        description: `Could not verify/place stop for position ${position.id} (${position.asset}): ${message}`,
        severity: 'critical',
      });
    }
  }
}

async function placeEmergencyStop(
  position: typeof import('@/lib/db/schema').positions.$inferSelect,
  result: ReconciliationResult
): Promise<void> {
  const stopLoss = Number(position.stopLoss);
  const quantity = Number(position.quantity);
  // Limit price slightly below stop to ensure fill in fast markets
  const limitPrice = stopLoss * 0.995;

  try {
    const response = await placeStopLimitOrder({
      productId: `${position.asset}-USD`,
      side: 'SELL',
      baseSize: quantity.toFixed(8),
      stopPrice: stopLoss.toFixed(2),
      limitPrice: limitPrice.toFixed(2),
      stopDirection: 'STOP_DIRECTION_STOP_DOWN',
    });

    if (response.success) {
      await updatePosition(position.id, {
        stopOrderId: response.order_id,
      });

      result.actions.push({
        type: 'emergency_stop_placed',
        description: `Emergency stop placed for position ${position.id} (${position.asset}) at $${stopLoss.toFixed(2)}. Order ID: ${response.order_id}`,
      });

      console.log(
        `[Reconciliation] Emergency stop placed for position ${position.id} at $${stopLoss}`
      );
    } else {
      throw new Error(response.failure_reason ?? 'Unknown failure');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.discrepancies.push({
      type: 'emergency_stop_failed',
      description: `CRITICAL: Failed to place emergency stop for position ${position.id} (${position.asset}): ${message}`,
      severity: 'critical',
    });

    await createAlert({
      type: 'order_failed',
      severity: 'critical',
      message: `Emergency stop placement failed for ${position.asset} position ${position.id}. Position is UNPROTECTED.`,
      data: { positionId: position.id, asset: position.asset, error: message },
    });
  }
}

// ─── Step 6: Check Missed Evaluations ──────────────────────────────────────

async function checkMissedEvaluations(
  result: ReconciliationResult
): Promise<void> {
  const nextEvalStr = await getState('next_evaluation_at');

  if (!nextEvalStr) {
    console.log('[Reconciliation] No scheduled evaluation found');
    return;
  }

  const nextEval = new Date(nextEvalStr);
  if (nextEval.getTime() < Date.now()) {
    const missedByMs = Date.now() - nextEval.getTime();
    const missedByHours = missedByMs / (1000 * 3600);

    console.log(
      `[Reconciliation] Missed evaluation: was scheduled for ${nextEval.toISOString()} (${missedByHours.toFixed(1)}h ago)`
    );

    result.missedEvaluation = true;
    result.actions.push({
      type: 'missed_evaluation',
      description: `Evaluation missed by ${missedByHours.toFixed(1)} hours. Catch-up evaluation will be triggered.`,
    });
  }
}

// ─── Step 7: Check Emergency Thresholds ────────────────────────────────────

async function checkEmergencyThresholds(
  result: ReconciliationResult
): Promise<void> {
  for (const asset of ALL_ASSETS) {
    try {
      const lastPriceKey = `last_${asset.toLowerCase()}_price_at_eval`;
      const lastPriceStr = await getState(lastPriceKey);

      if (!lastPriceStr) continue;

      const lastPrice = Number(lastPriceStr);
      if (lastPrice <= 0) continue;

      const currentPrice = await getMidPrice(`${asset}-USD`);
      const changePct = (currentPrice - lastPrice) / lastPrice;

      if (Math.abs(changePct) >= EMERGENCY_THRESHOLD_PCT) {
        const direction = changePct > 0 ? 'up' : 'down';

        console.warn(
          `[Reconciliation] Emergency threshold breached: ${asset} moved ${(changePct * 100).toFixed(1)}% since last eval`
        );

        result.emergencyTriggered = true;
        result.emergencyAsset = asset;
        result.emergencyPriceChange = changePct * 100;
        result.emergencyDirection = direction;

        result.discrepancies.push({
          type: 'emergency_threshold',
          description: `${asset} moved ${(changePct * 100).toFixed(1)}% ${direction} since last evaluation ($${lastPrice.toFixed(2)} -> $${currentPrice.toFixed(2)})`,
          severity: 'warning',
        });

        // Only flag the first emergency trigger
        break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[Reconciliation] Failed to check emergency threshold for ${asset}: ${message}`
      );
    }
  }
}

// ─── Step 8: Resume Normal Operations ──────────────────────────────────────

async function resumeOperations(
  downtimeSeconds: number | null,
  result: ReconciliationResult
): Promise<void> {
  // Update last_successful_boot_at
  await setState('last_successful_boot_at', new Date().toISOString());

  // Write reconciliation log
  await insertReconciliationLog({
    downtime_seconds: downtimeSeconds ?? undefined,
    discrepancies_found:
      result.discrepancies.length > 0 ? result.discrepancies : undefined,
    actions_taken: result.actions.length > 0 ? result.actions : undefined,
  });

  console.log(
    `[Reconciliation] Complete: ${result.discrepancies.length} discrepancies, ${result.actions.length} actions taken`
  );
}

// ─── Main reconciliation entry point ───────────────────────────────────────

export async function runFullReconciliation(): Promise<{
  missedEvaluation: boolean;
  emergencyTriggered: boolean;
  emergencyAsset?: string;
  emergencyPriceChange?: number;
  emergencyDirection?: string;
}> {
  console.log('[Reconciliation] Starting full reconciliation sequence...');

  const result: ReconciliationResult = {
    discrepancies: [],
    actions: [],
    missedEvaluation: false,
    emergencyTriggered: false,
  };

  // Step 1: Health check (throws if failed)
  await healthCheck();

  // Step 2: Determine context
  const downtimeSeconds = await determineContext();

  // Step 3: Reconcile orders
  try {
    await reconcileOrders(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Reconciliation] Order reconciliation failed: ${message}`);
    await createAlert({
      type: 'reconciliation_discrepancy',
      severity: 'critical',
      message: `Order reconciliation failed: ${message}`,
    });
  }

  // Step 4: Reconcile balances
  try {
    await reconcileBalances(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Reconciliation] Balance reconciliation failed: ${message}`);
    await createAlert({
      type: 'reconciliation_discrepancy',
      severity: 'warning',
      message: `Balance reconciliation failed: ${message}`,
    });
  }

  // Step 5: Verify position safety (HIGHEST PRIORITY)
  try {
    await verifyPositionSafety(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Reconciliation] Position safety check failed: ${message}`);
    await createAlert({
      type: 'reconciliation_discrepancy',
      severity: 'critical',
      message: `Position safety verification failed: ${message}. Open positions may be UNPROTECTED.`,
    });
  }

  // Step 6: Check missed evaluations
  try {
    await checkMissedEvaluations(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Reconciliation] Missed evaluation check failed: ${message}`);
  }

  // Step 7: Check emergency thresholds
  try {
    await checkEmergencyThresholds(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Reconciliation] Emergency threshold check failed: ${message}`);
  }

  // Step 8: Resume normal operations
  await resumeOperations(downtimeSeconds, result);

  // Create alerts for critical discrepancies
  const criticalDiscrepancies = result.discrepancies.filter(
    (d) => d.severity === 'critical'
  );
  if (criticalDiscrepancies.length > 0) {
    await createAlert({
      type: 'reconciliation_discrepancy',
      severity: 'critical',
      message: `Reconciliation found ${criticalDiscrepancies.length} critical discrepancies`,
      data: criticalDiscrepancies,
    });
  }

  return {
    missedEvaluation: result.missedEvaluation,
    emergencyTriggered: result.emergencyTriggered,
    emergencyAsset: result.emergencyAsset,
    emergencyPriceChange: result.emergencyPriceChange,
    emergencyDirection: result.emergencyDirection,
  };
}
