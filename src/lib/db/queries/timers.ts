import { eq, and, sql, asc } from 'drizzle-orm';
import { db } from '../index';
import { pendingTimers } from '../schema';

type Timer = typeof pendingTimers.$inferSelect;

export async function createTimer(data: {
  type: string;
  target_time: Date;
  related_order_id?: number;
  related_entity?: string;
}): Promise<Timer> {
  const [row] = await db
    .insert(pendingTimers)
    .values({
      type: data.type,
      targetTime: data.target_time,
      relatedOrderId: data.related_order_id,
      relatedEntity: data.related_entity,
    })
    .returning();
  return row;
}

export async function getDueTimers(): Promise<Timer[]> {
  return db
    .select()
    .from(pendingTimers)
    .where(
      and(
        eq(pendingTimers.status, 'pending'),
        sql`${pendingTimers.targetTime} <= now()`
      )
    )
    .orderBy(asc(pendingTimers.targetTime));
}

export async function markTimerCompleted(id: number): Promise<void> {
  await db
    .update(pendingTimers)
    .set({ status: 'completed' })
    .where(eq(pendingTimers.id, id));
}

export async function markTimerExpired(id: number): Promise<void> {
  await db
    .update(pendingTimers)
    .set({ status: 'expired' })
    .where(eq(pendingTimers.id, id));
}

export async function getPendingTimersForOrder(
  orderId: number
): Promise<Timer[]> {
  return db
    .select()
    .from(pendingTimers)
    .where(
      and(
        eq(pendingTimers.status, 'pending'),
        eq(pendingTimers.relatedOrderId, orderId)
      )
    );
}
