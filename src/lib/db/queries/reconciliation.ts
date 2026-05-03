import { desc } from 'drizzle-orm';
import { db } from '../index';
import { reconciliationLog } from '../schema';

type ReconciliationLog = typeof reconciliationLog.$inferSelect;

export async function insertReconciliationLog(data: {
  downtime_seconds?: number;
  discrepancies_found?: unknown;
  actions_taken?: unknown;
}): Promise<void> {
  await db.insert(reconciliationLog).values({
    bootAt: new Date(),
    downtimeSeconds: data.downtime_seconds,
    discrepanciesFound: data.discrepancies_found,
    actionsTaken: data.actions_taken,
  });
}

export async function getReconciliationLogs(
  limit: number = 20
): Promise<ReconciliationLog[]> {
  return db
    .select()
    .from(reconciliationLog)
    .orderBy(desc(reconciliationLog.bootAt))
    .limit(limit);
}
