import { desc, eq, and, gte } from "drizzle-orm";
import { db } from "../index";
import { evaluations } from "../schema";
import type { Evaluation, NewEvaluation } from "../schema";

export async function insertEvaluation(row: NewEvaluation): Promise<Evaluation> {
  const inserted = await db.insert(evaluations).values(row).returning();
  return inserted[0]!;
}

export async function recentEvaluations(limit = 50): Promise<Evaluation[]> {
  return db.select().from(evaluations).orderBy(desc(evaluations.timestamp)).limit(limit);
}

export async function evaluationById(id: string): Promise<Evaluation | null> {
  const rows = await db.select().from(evaluations).where(eq(evaluations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function evaluationsByCallTypeSince(
  callType: Evaluation["callType"],
  since: Date,
): Promise<Evaluation[]> {
  return db
    .select()
    .from(evaluations)
    .where(and(eq(evaluations.callType, callType), gte(evaluations.timestamp, since)))
    .orderBy(desc(evaluations.timestamp));
}
