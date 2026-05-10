import { desc } from "drizzle-orm";
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
