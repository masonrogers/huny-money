import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../index';
import { evaluations } from '../schema';

type Evaluation = typeof evaluations.$inferSelect;
type NewEvaluation = typeof evaluations.$inferInsert;

export async function insertEvaluation(
  data: NewEvaluation
): Promise<Evaluation> {
  const [row] = await db.insert(evaluations).values(data).returning();
  return row;
}

export async function getEvaluations(
  filters?: { type?: string; limit?: number; offset?: number }
): Promise<Evaluation[]> {
  const conditions = [];

  if (filters?.type) {
    conditions.push(eq(evaluations.type, filters.type));
  }

  const query = db
    .select()
    .from(evaluations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(evaluations.timestamp));

  if (filters?.limit) {
    query.limit(filters.limit);
  }
  if (filters?.offset) {
    query.offset(filters.offset);
  }

  return query;
}

export async function getLatestEvaluation(): Promise<Evaluation | null> {
  const [row] = await db
    .select()
    .from(evaluations)
    .orderBy(desc(evaluations.timestamp))
    .limit(1);

  return row ?? null;
}

export async function getTodaysEvaluations(): Promise<Evaluation[]> {
  return db
    .select()
    .from(evaluations)
    .where(
      sql`${evaluations.timestamp}::date = (now() at time zone 'utc')::date`
    )
    .orderBy(desc(evaluations.timestamp));
}
