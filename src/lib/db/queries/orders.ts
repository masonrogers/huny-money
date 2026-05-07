import { and, eq, desc } from "drizzle-orm";
import { db } from "../index";
import { orders } from "../schema";
import type { NewOrder, Order } from "../schema";
import { getCurrentMode } from "@/lib/mode";

// Paper-mode fee schedule. Lives here (not in paper-executor) because the
// cash-flow computation needs it but cannot import from paper-executor — that
// would pull the executor singleton into dashboard request paths.
const PAPER_MAKER_FEE_PCT = 0.004;
const PAPER_TAKER_FEE_PCT = 0.006;

/**
 * Mode-aware order queries. See positions.ts for the full rationale.
 *
 * The `orders` table holds rows for both paper and live modes (distinguished
 * by `paper_mode` boolean). Production code MUST use `ordersForCurrentMode()`.
 * `ordersAllModes()` is for analytics/diagnostics ONLY.
 *
 * The CI lint rule (scripts/lint-queries.sh) rejects any direct query of
 * the `orders` table outside this file.
 */

// ---------------------------------------------------------------------------
// Mode-scoped (default)
// ---------------------------------------------------------------------------

export async function ordersForCurrentMode(): Promise<Order[]> {
  const mode = getCurrentMode();
  return db
    .select()
    .from(orders)
    .where(eq(orders.paperMode, mode === "paper"))
    .orderBy(desc(orders.placedAt));
}

export async function pendingOrdersForCurrentMode(): Promise<Order[]> {
  const mode = getCurrentMode();
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.paperMode, mode === "paper"), eq(orders.status, "pending")))
    .orderBy(desc(orders.placedAt));
}

export async function ordersForPositionForCurrentMode(positionId: string): Promise<Order[]> {
  const mode = getCurrentMode();
  return db
    .select()
    .from(orders)
    .where(
      and(eq(orders.paperMode, mode === "paper"), eq(orders.relatedPositionId, positionId)),
    )
    .orderBy(desc(orders.placedAt));
}

export async function orderByCoinbaseIdForCurrentMode(
  coinbaseOrderId: string,
): Promise<Order | null> {
  const mode = getCurrentMode();
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(eq(orders.paperMode, mode === "paper"), eq(orders.coinbaseOrderId, coinbaseOrderId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// All modes (analytics/diagnostics ONLY)
// ---------------------------------------------------------------------------

/**
 * Returns orders across BOTH paper and live modes.
 * Same usage rules as positionsAllModes().
 */
export async function ordersAllModes(): Promise<Order[]> {
  return db.select().from(orders).orderBy(desc(orders.placedAt));
}

export async function pendingOrdersAllModes(): Promise<Order[]> {
  return db
    .select()
    .from(orders)
    .where(eq(orders.status, "pending"))
    .orderBy(desc(orders.placedAt));
}

// ---------------------------------------------------------------------------
// Inserts/updates
// ---------------------------------------------------------------------------

export async function insertOrder(row: NewOrder): Promise<Order> {
  const inserted = await db.insert(orders).values(row).returning();
  return inserted[0]!;
}

export async function updateOrder(id: string, patch: Partial<NewOrder>): Promise<Order | null> {
  const updated = await db.update(orders).set(patch).where(eq(orders.id, id)).returning();
  return updated[0] ?? null;
}

// ---------------------------------------------------------------------------
// Paper cash-flow computation
// ---------------------------------------------------------------------------

export interface PaperCashFlows {
  outflow: number;
  inflow: number;
}

/**
 * Pure summarizer over a list of paper orders. Exported for unit testing —
 * production callers should use {@link paperCashFlowsFromDb}.
 *
 * Fee modeling matches paper-executor.ts: maker rate for limit-style entries
 * and exits (entry_limit, stop_limit, take_profit), taker rate for taker-style
 * fills (dca_limit, market_exit).
 */
export function summarizePaperCashFlows(rows: readonly Order[]): PaperCashFlows {
  let outflow = 0;
  let inflow = 0;
  for (const o of rows) {
    if (o.status !== "filled") continue;
    const fillPriceStr = o.fillPrice ?? o.price;
    const fillQtyStr = o.fillQuantity ?? o.quantity;
    if (!fillPriceStr || !fillQtyStr) continue;
    const fillPrice = Number(fillPriceStr);
    const fillQty = Number(fillQtyStr);
    if (!Number.isFinite(fillPrice) || !Number.isFinite(fillQty)) continue;
    const value = fillPrice * fillQty;
    const isMaker =
      o.type === "entry_limit" || o.type === "stop_limit" || o.type === "take_profit";
    const fees = value * (isMaker ? PAPER_MAKER_FEE_PCT : PAPER_TAKER_FEE_PCT);
    if (o.side === "buy") outflow += value + fees;
    else inflow += value - fees;
  }
  return { outflow, inflow };
}

/** DB-backed wrapper. Reads every filled paper order. */
export async function paperCashFlowsFromDb(): Promise<PaperCashFlows> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.paperMode, true), eq(orders.status, "filled")));
  return summarizePaperCashFlows(rows);
}

/**
 * Pure summarizer: sum of filled SELL fillQuantity per related position.
 * Exported for unit testing — production callers should use
 * {@link filledSellQtyByPositionForCurrentMode}.
 *
 * Used by the equity snapshotter to compute remaining open quantity for
 * positions undergoing laddered exits. Sells fill in-stream but the
 * position row is not closed until next reconciliation (see
 * `wakeup-cycle.ts` — the `void updatePosition` stub). Without subtracting
 * already-sold portions, mark-to-market would double-count the sold legs.
 */
export function summarizeFilledSellQtyByPosition(
  rows: ReadonlyArray<{ positionId: string | null; qty: string | null; status?: string; side?: string }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.positionId || r.qty == null) continue;
    // Defensive when callers pass full rows: only sum filled SELL.
    if (r.status !== undefined && r.status !== "filled") continue;
    if (r.side !== undefined && r.side !== "sell") continue;
    const q = Number(r.qty);
    if (!Number.isFinite(q) || q <= 0) continue;
    map.set(r.positionId, (map.get(r.positionId) ?? 0) + q);
  }
  return map;
}

/** DB-backed wrapper: filled SELL fillQuantity per position, current mode. */
export async function filledSellQtyByPositionForCurrentMode(): Promise<Map<string, number>> {
  const mode = getCurrentMode();
  const rows = await db
    .select({
      positionId: orders.relatedPositionId,
      qty: orders.fillQuantity,
    })
    .from(orders)
    .where(
      and(
        eq(orders.paperMode, mode === "paper"),
        eq(orders.status, "filled"),
        eq(orders.side, "sell"),
      ),
    );
  return summarizeFilledSellQtyByPosition(rows);
}
