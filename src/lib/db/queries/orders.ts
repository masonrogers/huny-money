import { and, eq, desc } from "drizzle-orm";
import { db } from "../index";
import { orders } from "../schema";
import type { NewOrder, Order } from "../schema";
import { getCurrentMode } from "@/lib/mode";

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
