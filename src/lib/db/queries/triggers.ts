import { and, eq, lte, gte, sql, ne, gt } from "drizzle-orm";
import { db } from "../index";
import { triggers } from "../schema";
import type { NewTrigger, Trigger } from "../schema";

export async function insertTrigger(row: NewTrigger): Promise<Trigger> {
  const inserted = await db.insert(triggers).values(row).returning();
  return inserted[0]!;
}

/**
 * Expire all active triggers from any morning evaluation OTHER than the
 * given one. Used by the morning brief flow: a fresh brief implicitly
 * supersedes the previous brief's watch list (per `STRATEGY.md §5.3`
 * "watch list expires at next morning's brief"). The original schema
 * gives each trigger a 26h activeUntil cushion as a fallback safety,
 * but during force-iteration / fast cadence the prior batches stack
 * up and the wakeup cycle sees stale conditions to evaluate.
 *
 * Sets `activeUntil = now` on rows where:
 *   - morningEvalId differs from the new eval, AND
 *   - activeUntil is still in the future (i.e., currently active).
 */
export async function expireTriggersFromPriorBriefs(
  newMorningEvalId: string,
  at: Date,
): Promise<number> {
  const updated = await db
    .update(triggers)
    .set({ activeUntil: at })
    .where(
      and(
        ne(triggers.morningEvalId, newMorningEvalId),
        gt(triggers.activeUntil, at),
      ),
    )
    .returning({ id: triggers.id });
  return updated.length;
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
