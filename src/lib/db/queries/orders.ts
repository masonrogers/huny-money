import { eq, and } from 'drizzle-orm';
import { db } from '../index';
import { orders } from '../schema';

type Order = typeof orders.$inferSelect;
type NewOrder = typeof orders.$inferInsert;

export async function createOrder(data: NewOrder): Promise<Order> {
  const [row] = await db.insert(orders).values(data).returning();
  return row;
}

export async function updateOrder(
  id: number,
  data: Partial<Omit<Order, 'id'>>
): Promise<void> {
  await db
    .update(orders)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(orders.id, id));
}

export async function getPendingOrders(isPaper?: boolean): Promise<Order[]> {
  const conditions = [eq(orders.status, 'pending')];
  if (isPaper !== undefined) {
    conditions.push(eq(orders.isPaper, isPaper));
  }
  return db
    .select()
    .from(orders)
    .where(and(...conditions));
}

export async function getOrderByExchangeId(
  coinbaseOrderId: string
): Promise<Order | null> {
  const [row] = await db
    .select()
    .from(orders)
    .where(eq(orders.coinbaseOrderId, coinbaseOrderId))
    .limit(1);

  return row ?? null;
}

export async function getOrdersForPosition(
  positionId: number
): Promise<Order[]> {
  return db
    .select()
    .from(orders)
    .where(eq(orders.relatedPositionId, positionId));
}

export async function updateOrderByExchangeId(
  coinbaseOrderId: string,
  data: Partial<Omit<Order, 'id'>>
): Promise<void> {
  await db
    .update(orders)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(orders.coinbaseOrderId, coinbaseOrderId));
}
