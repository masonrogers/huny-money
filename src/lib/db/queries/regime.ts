import { desc } from 'drizzle-orm';
import { db } from '../index';
import { regimeHistory } from '../schema';

type RegimeHistory = typeof regimeHistory.$inferSelect;

export async function insertRegimeAssessment(data: {
  regime: string;
  evidence: string;
}): Promise<void> {
  await db.insert(regimeHistory).values({
    regime: data.regime,
    evidence: data.evidence,
    assessedAt: new Date(),
  });
}

export async function getRegimeHistory(
  limit: number = 20
): Promise<RegimeHistory[]> {
  return db
    .select()
    .from(regimeHistory)
    .orderBy(desc(regimeHistory.assessedAt))
    .limit(limit);
}

export async function getLatestRegime(): Promise<RegimeHistory | null> {
  const [row] = await db
    .select()
    .from(regimeHistory)
    .orderBy(desc(regimeHistory.assessedAt))
    .limit(1);

  return row ?? null;
}
