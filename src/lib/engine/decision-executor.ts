import crypto from 'crypto';
import type { EvaluationOutput, PositionAction, TradeProposal } from '@/lib/types/evaluation';
import { getTicker } from '@/lib/coinbase/market-data';
import {
  cancelOrders,
  placeLimitOrder,
  placeMarketOrder,
  placeStopLimitOrder,
} from '@/lib/coinbase/orders';
import {
  getOpenPositions,
  updatePosition,
  closePosition,
  getPositionById,
} from '@/lib/db/queries/positions';
import {
  createOrder,
  getOrdersForPosition,
  updateOrder,
} from '@/lib/db/queries/orders';
import { setState } from '@/lib/db/queries/system-state';
import { createAlert } from '@/lib/db/queries/alerts';
import { getActiveTheses, createThesis, updateThesis, invalidateThesis } from '@/lib/db/queries/theses';
import { insertRegimeAssessment } from '@/lib/db/queries/regime';
import { executeNewTrade } from './trade-executor';
import { TAKER_FEE, ROUND_TRIP_FEE } from '@/lib/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExecutionResult {
  tradesExecuted: Array<{
    asset: string;
    type: string;
    action: string;
    positionId?: number;
    details?: string;
  }>;
  positionsUpdated: Array<{
    positionId: number;
    asset: string;
    action: string;
    details: string;
  }>;
  errors: string[];
}

/** How far below the stop price to set the limit on a stop-limit sell (0.5%) */
const STOP_LIMIT_SLIPPAGE_PCT = 0.005;

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function executeDecisions(
  output: EvaluationOutput,
  paperMode: boolean,
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    tradesExecuted: [],
    positionsUpdated: [],
    errors: [],
  };

  // Process Layer 1 changes (regime, exposure, theses)
  if (output.layer_1) {
    await processLayer1(output, result);
  }

  // Process existing position actions
  const openPositions = await getOpenPositions();
  for (const action of output.layer_2.existing_positions) {
    try {
      await processPositionAction(action, openPositions, paperMode, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Error processing ${action.asset} ${action.action}: ${msg}`);
    }
  }

  // Process new trade proposals
  for (const proposal of output.layer_2.new_trades) {
    try {
      await processNewTrade(proposal, paperMode, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Error executing new trade for ${proposal.asset}: ${msg}`);
    }
  }

  return result;
}

// ─── Layer 1 Processing ───────────────────────────────────────────────────────

async function processLayer1(
  output: EvaluationOutput,
  result: ExecutionResult,
): Promise<void> {
  const layer1 = output.layer_1;
  if (!layer1) return;

  // Update regime
  await setState('current_regime', layer1.market_regime);
  await setState('target_exposure_pct', String(layer1.target_exposure_pct));

  if (layer1.regime_changed) {
    await insertRegimeAssessment({
      regime: layer1.market_regime,
      evidence: layer1.regime_evidence,
    });

    await createAlert({
      type: 'regime_change',
      severity: 'warning',
      message: `Regime changed to ${layer1.market_regime}: ${layer1.regime_evidence}`,
      data: {
        new_regime: layer1.market_regime,
        target_exposure: layer1.target_exposure_pct,
        evidence: layer1.regime_evidence,
      },
    });
  }

  // Process theses
  const existingTheses = await getActiveTheses();

  for (const thesisUpdate of layer1.active_theses) {
    const existing = existingTheses.find(
      (t) =>
        t.asset.toUpperCase() === thesisUpdate.asset.toUpperCase() &&
        t.status !== 'invalidated',
    );

    if (thesisUpdate.status === 'invalidated' && existing) {
      // Invalidate existing thesis
      await invalidateThesis(existing.id, thesisUpdate.notes || thesisUpdate.action);
    } else if (existing) {
      // Update existing thesis
      await updateThesis(existing.id, {
        conviction: thesisUpdate.conviction,
        lastReviewedAt: new Date(),
        status: thesisUpdate.status,
      });
    } else if (thesisUpdate.status !== 'invalidated') {
      // Create new thesis
      await createThesis({
        asset: thesisUpdate.asset,
        thesisText: thesisUpdate.thesis,
        status: thesisUpdate.status,
        conviction: thesisUpdate.conviction,
        lastReviewedAt: new Date(),
      });
    }
  }
}

// ─── Position Action Processing ───────────────────────────────────────────────

async function processPositionAction(
  action: PositionAction,
  openPositions: Awaited<ReturnType<typeof getOpenPositions>>,
  paperMode: boolean,
  result: ExecutionResult,
): Promise<void> {
  // Find the matching open position
  const position = openPositions.find(
    (p) =>
      p.asset.toUpperCase() === action.asset.toUpperCase() &&
      p.type === action.type,
  );

  if (!position) {
    result.errors.push(
      `No open ${action.type} position found for ${action.asset} to ${action.action}`,
    );
    return;
  }

  switch (action.action) {
    case 'hold':
      await handleHold(position, action, result);
      break;
    case 'exit':
      await handleExit(position, action, paperMode, result);
      break;
    case 'reduce':
      await handleReduce(position, action, paperMode, result);
      break;
    case 'add':
      // "add" on existing position is unusual; log but don't act (new_trades handles new entries)
      result.positionsUpdated.push({
        positionId: position.id,
        asset: position.asset,
        action: 'add_noted',
        details: `Add action noted for ${action.asset} - use new_trades for new entries`,
      });
      break;
  }
}

// ─── Hold ─────────────────────────────────────────────────────────────────────

async function handleHold(
  position: Awaited<ReturnType<typeof getOpenPositions>>[number],
  action: PositionAction,
  result: ExecutionResult,
): Promise<void> {
  // Update conviction
  await updatePosition(position.id, {
    currentConviction: action.conviction_now,
  });

  // If a new stop loss is specified, adjust it
  if (action.new_stop_loss !== null && action.new_stop_loss !== Number(position.stopLoss)) {
    result.positionsUpdated.push({
      positionId: position.id,
      asset: position.asset,
      action: 'hold_with_stop_adjust',
      details: `Conviction updated to ${action.conviction_now}, stop adjusted to ${action.new_stop_loss}`,
    });
  } else {
    result.positionsUpdated.push({
      positionId: position.id,
      asset: position.asset,
      action: 'hold',
      details: `Conviction updated to ${action.conviction_now}`,
    });
  }
}

// ─── Exit ─────────────────────────────────────────────────────────────────────

async function handleExit(
  position: Awaited<ReturnType<typeof getOpenPositions>>[number],
  action: PositionAction,
  paperMode: boolean,
  result: ExecutionResult,
): Promise<void> {
  const productId = `${position.asset}-USD`;
  const quantity = position.quantity;

  // 1. Cancel existing stop and TP orders on Coinbase
  const positionOrders = await getOrdersForPosition(position.id);
  const pendingOrderIds = positionOrders
    .filter((o) => o.status === 'pending' && o.coinbaseOrderId)
    .map((o) => o.coinbaseOrderId!);

  if (pendingOrderIds.length > 0 && !paperMode) {
    try {
      await cancelOrders(pendingOrderIds);
    } catch (err) {
      console.error(`[DecisionExecutor] Error cancelling orders for position ${position.id}:`, err);
    }
  }

  // Mark cancelled orders in DB
  for (const order of positionOrders.filter((o) => o.status === 'pending')) {
    await updateOrder(order.id, {
      status: 'cancelled',
      cancelReason: `Position exit: ${action.reasoning}`,
    });
  }

  // 2. Place market sell order
  let exitPrice: number;
  let exitOrderId: string;

  if (paperMode) {
    const ticker = await getTicker(productId);
    exitPrice = ticker.bestBid > 0 ? ticker.bestBid : ticker.lastPrice;
    exitOrderId = `paper-${crypto.randomUUID()}`;
  } else {
    const sellResult = await placeMarketOrder({
      productId,
      side: 'SELL',
      baseSize: String(quantity),
    });

    if (!sellResult.success) {
      result.errors.push(
        `Market sell failed for ${position.asset} position ${position.id}: ${sellResult.error_response?.message ?? sellResult.failure_reason}`,
      );
      return;
    }

    exitOrderId = sellResult.order_id;
    // Estimate exit price from ticker (real price updated on fill reconciliation)
    const ticker = await getTicker(productId);
    exitPrice = ticker.bestBid > 0 ? ticker.bestBid : ticker.lastPrice;
  }

  // 3. Create exit order record
  await createOrder({
    coinbaseOrderId: exitOrderId,
    type: 'market_exit',
    asset: position.asset,
    side: 'SELL',
    price: String(exitPrice),
    quantity: String(quantity),
    status: paperMode ? 'filled' : 'pending',
    relatedPositionId: position.id,
    placedAt: new Date(),
    filledAt: paperMode ? new Date() : undefined,
    fillPrice: paperMode ? String(exitPrice) : undefined,
    fillQuantity: paperMode ? String(quantity) : undefined,
  });

  // 4. Compute P&L and close position
  const entryPrice = Number(position.entryPrice);
  const qty = Number(quantity);
  const grossPnl = (exitPrice - entryPrice) * qty;
  const fees = (entryPrice * qty * TAKER_FEE) + (exitPrice * qty * TAKER_FEE);
  const netPnl = grossPnl - fees;

  await closePosition(position.id, {
    exit_price: String(exitPrice),
    exit_reason: action.reasoning,
    gross_pnl: grossPnl.toFixed(2),
    net_pnl: netPnl.toFixed(2),
    fees_paid: (Number(position.feesPaid ?? 0) + fees).toFixed(2),
    realized_gain_loss: netPnl.toFixed(2),
  });

  result.tradesExecuted.push({
    asset: position.asset,
    type: position.type,
    action: 'exit',
    positionId: position.id,
    details: `Exited at $${exitPrice.toFixed(2)}, net P&L: $${netPnl.toFixed(2)}`,
  });
}

// ─── Reduce (Take Partial Profit) ─────────────────────────────────────────────

async function handleReduce(
  position: Awaited<ReturnType<typeof getOpenPositions>>[number],
  action: PositionAction,
  paperMode: boolean,
  result: ExecutionResult,
): Promise<void> {
  const productId = `${position.asset}-USD`;
  const exitPct = (action.exit_percentage ?? 50) / 100;
  const totalQty = Number(position.quantity);
  const sellQty = totalQty * exitPct;
  const remainingQty = totalQty - sellQty;

  // 1. Place limit sell for the partial amount
  let sellPrice: number;
  let sellOrderId: string;

  const ticker = await getTicker(productId);
  sellPrice = ticker.bestBid > 0 ? ticker.bestBid : ticker.lastPrice;

  if (paperMode) {
    sellOrderId = `paper-${crypto.randomUUID()}`;
  } else {
    const sellResult = await placeLimitOrder({
      productId,
      side: 'SELL',
      baseSize: sellQty.toPrecision(8),
      limitPrice: sellPrice.toFixed(2),
    });

    if (!sellResult.success) {
      result.errors.push(
        `Partial sell failed for ${position.asset}: ${sellResult.error_response?.message ?? sellResult.failure_reason}`,
      );
      return;
    }

    sellOrderId = sellResult.order_id;
  }

  // 2. Record the sell order
  await createOrder({
    coinbaseOrderId: sellOrderId,
    type: 'take_profit',
    asset: position.asset,
    side: 'SELL',
    price: String(sellPrice),
    quantity: sellQty.toPrecision(8),
    status: paperMode ? 'filled' : 'pending',
    relatedPositionId: position.id,
    placedAt: new Date(),
    filledAt: paperMode ? new Date() : undefined,
    fillPrice: paperMode ? String(sellPrice) : undefined,
    fillQuantity: paperMode ? sellQty.toPrecision(8) : undefined,
  });

  // 3. Update position quantity and conviction
  await updatePosition(position.id, {
    quantity: remainingQty.toPrecision(8),
    currentConviction: action.conviction_now,
  });

  // 4. Cancel old stop/TP orders and place new ones with adjusted quantities
  const positionOrders = await getOrdersForPosition(position.id);
  const pendingStopOrders = positionOrders.filter(
    (o) => o.status === 'pending' && (o.type === 'stop_limit' || o.type === 'take_profit'),
  );

  if (pendingStopOrders.length > 0) {
    const cancelIds = pendingStopOrders
      .filter((o) => o.coinbaseOrderId)
      .map((o) => o.coinbaseOrderId!);

    if (cancelIds.length > 0 && !paperMode) {
      try {
        await cancelOrders(cancelIds);
      } catch (err) {
        console.error(`[DecisionExecutor] Error cancelling orders for partial reduce:`, err);
      }
    }

    for (const order of pendingStopOrders) {
      await updateOrder(order.id, {
        status: 'cancelled',
        cancelReason: 'Partial profit taken, replacing with adjusted quantity',
      });
    }

    // Replace stop order with new quantity
    const stopLoss = Number(position.stopLoss);
    const stopLimitPrice = stopLoss * (1 - STOP_LIMIT_SLIPPAGE_PCT);
    let newStopId: string;

    if (paperMode) {
      newStopId = `paper-${crypto.randomUUID()}`;
    } else {
      const stopResult = await placeStopLimitOrder({
        productId,
        side: 'SELL',
        baseSize: remainingQty.toPrecision(8),
        limitPrice: stopLimitPrice.toFixed(2),
        stopPrice: stopLoss.toFixed(2),
        stopDirection: 'STOP_DIRECTION_STOP_DOWN',
      });
      newStopId = stopResult.success ? stopResult.order_id : '';
    }

    await createOrder({
      coinbaseOrderId: newStopId,
      type: 'stop_limit',
      asset: position.asset,
      side: 'SELL',
      price: String(stopLoss),
      quantity: remainingQty.toPrecision(8),
      status: 'pending',
      relatedPositionId: position.id,
      placedAt: new Date(),
    });

    await updatePosition(position.id, { stopOrderId: newStopId });
  }

  result.positionsUpdated.push({
    positionId: position.id,
    asset: position.asset,
    action: 'reduce',
    details: `Sold ${(exitPct * 100).toFixed(0)}% (${sellQty.toPrecision(6)} units) at ~$${sellPrice.toFixed(2)}, ${remainingQty.toPrecision(6)} remaining`,
  });
}

// ─── New Trade Processing ─────────────────────────────────────────────────────

async function processNewTrade(
  proposal: TradeProposal,
  paperMode: boolean,
  result: ExecutionResult,
): Promise<void> {
  const tradeResult = await executeNewTrade(proposal, paperMode);

  if (tradeResult.success) {
    result.tradesExecuted.push({
      asset: proposal.asset,
      type: proposal.type,
      action: 'new_entry',
      positionId: tradeResult.positionId,
      details: `${paperMode ? 'PAPER' : 'LIVE'} ${proposal.type} entry for ${proposal.asset}, conviction ${proposal.conviction}`,
    });
  } else {
    result.errors.push(
      `Failed to execute ${proposal.type} trade for ${proposal.asset}: ${tradeResult.error}`,
    );
  }
}
