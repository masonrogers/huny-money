import { eq, desc, and } from 'drizzle-orm';
import { db } from '../index';
import { alerts } from '../schema';

type Alert = typeof alerts.$inferSelect;

export async function createAlert(data: {
  type: string;
  severity: string;
  message: string;
  data?: unknown;
}): Promise<Alert> {
  const [row] = await db
    .insert(alerts)
    .values({
      type: data.type,
      severity: data.severity,
      message: data.message,
      data: data.data,
    })
    .returning();
  return row;
}

export async function getAlerts(
  filters?: { acknowledged?: boolean; severity?: string; limit?: number }
): Promise<Alert[]> {
  const conditions = [];

  if (filters?.acknowledged !== undefined) {
    conditions.push(eq(alerts.acknowledged, filters.acknowledged));
  }
  if (filters?.severity) {
    conditions.push(eq(alerts.severity, filters.severity));
  }

  const query = db
    .select()
    .from(alerts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alerts.createdAt));

  if (filters?.limit) {
    query.limit(filters.limit);
  }

  return query;
}

export async function acknowledgeAlert(id: number): Promise<void> {
  await db
    .update(alerts)
    .set({ acknowledged: true })
    .where(eq(alerts.id, id));
}

export async function getUnacknowledgedAlerts(): Promise<Alert[]> {
  return db
    .select()
    .from(alerts)
    .where(eq(alerts.acknowledged, false))
    .orderBy(desc(alerts.createdAt));
}

export async function acknowledgeAllAlerts(): Promise<void> {
  await db
    .update(alerts)
    .set({ acknowledged: true })
    .where(eq(alerts.acknowledged, false));
}
