import { desc, eq, gte } from "drizzle-orm";
import { db } from "../index";
import { wakeups } from "../schema";
import type { NewWakeup, Wakeup } from "../schema";

export async function insertWakeup(row: NewWakeup): Promise<Wakeup> {
  const inserted = await db.insert(wakeups).values(row).returning();
  return inserted[0]!;
}

export async function recentWakeups(limit = 50): Promise<Wakeup[]> {
  return db.select().from(wakeups).orderBy(desc(wakeups.timestamp)).limit(limit);
}

export async function wakeupsByTypeSince(
  triggerType: Wakeup["triggerType"],
  since: Date,
): Promise<Wakeup[]> {
  return db
    .select()
    .from(wakeups)
    .where(eq(wakeups.triggerType, triggerType))
    .orderBy(desc(wakeups.timestamp));
}

export async function updateWakeup(id: string, patch: Partial<NewWakeup>): Promise<Wakeup | null> {
  const updated = await db.update(wakeups).set(patch).where(eq(wakeups.id, id)).returning();
  return updated[0] ?? null;
}
