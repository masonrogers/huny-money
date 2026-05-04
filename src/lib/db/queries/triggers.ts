import { and, eq, lte, gte, sql } from "drizzle-orm";
import { db } from "../index";
import { triggers } from "../schema";
import type { NewTrigger, Trigger } from "../schema";

export async function insertTrigger(row: NewTrigger): Promise<Trigger> {
  const inserted = await db.insert(triggers).values(row).returning();
  return inserted[0]!;
}

export async function activeTriggersAt(at: Date): Promise<Trigger[]> {
  return db
    .select()
    .from(triggers)
    .where(and(lte(triggers.activeFrom, at), gte(triggers.activeUntil, at)));
}

export async function incrementEvaluations(triggerId: string): Promise<void> {
  await db
    .update(triggers)
    .set({ timesEvaluated: sql`${triggers.timesEvaluated} + 1` })
    .where(eq(triggers.id, triggerId));
}

export async function incrementFires(triggerId: string): Promise<void> {
  await db
    .update(triggers)
    .set({ timesFired: sql`${triggers.timesFired} + 1` })
    .where(eq(triggers.id, triggerId));
}
