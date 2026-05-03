import { eq, inArray } from 'drizzle-orm';
import { db } from '../index';
import { theses } from '../schema';

type Thesis = typeof theses.$inferSelect;
type NewThesis = typeof theses.$inferInsert;

export async function createThesis(data: NewThesis): Promise<Thesis> {
  const [row] = await db.insert(theses).values(data).returning();
  return row;
}

export async function updateThesis(
  id: number,
  data: Partial<Omit<Thesis, 'id'>>
): Promise<void> {
  await db
    .update(theses)
    .set(data)
    .where(eq(theses.id, id));
}

export async function getActiveTheses(): Promise<Thesis[]> {
  return db
    .select()
    .from(theses)
    .where(inArray(theses.status, ['active', 'watching']));
}

export async function invalidateThesis(
  id: number,
  reason: string
): Promise<void> {
  await db
    .update(theses)
    .set({
      status: 'invalidated',
      invalidationReason: reason,
    })
    .where(eq(theses.id, id));
}
