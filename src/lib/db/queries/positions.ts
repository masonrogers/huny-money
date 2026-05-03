import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../index';
import { positions } from '../schema';

type Position = typeof positions.$inferSelect;
type NewPosition = typeof positions.$inferInsert;

export async function createPosition(data: NewPosition): Promise<Position> {
  const [row] = await db.insert(positions).values(data).returning();
  return row;
}

export async function updatePosition(
  id: number,
  data: Partial<Omit<Position, 'id'>>
): Promise<void> {
  await db
    .update(positions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(positions.id, id));
}

export async function closePosition(
  id: number,
  exitData: {
    exit_price: string;
    exit_reason: string;
    gross_pnl: string;
    net_pnl: string;
    fees_paid: string;
    realized_gain_loss: string;
  }
): Promise<void> {
  await db
    .update(positions)
    .set({
      status: 'closed',
      exitTime: new Date(),
      exitPrice: exitData.exit_price,
      exitReason: exitData.exit_reason,
      grossPnl: exitData.gross_pnl,
      netPnl: exitData.net_pnl,
      feesPaid: exitData.fees_paid,
      realizedGainLoss: exitData.realized_gain_loss,
      updatedAt: new Date(),
    })
    .where(eq(positions.id, id));
}

export async function getOpenPositions(isPaper?: boolean): Promise<Position[]> {
  const conditions = [eq(positions.status, 'open')];
  if (isPaper !== undefined) {
    conditions.push(eq(positions.isPaper, isPaper));
  }
  return db
    .select()
    .from(positions)
    .where(and(...conditions));
}

export async function getClosedPositions(
  filters?: { asset?: string; limit?: number; offset?: number; isPaper?: boolean }
): Promise<Position[]> {
  const conditions = [eq(positions.status, 'closed')];

  if (filters?.asset) {
    conditions.push(eq(positions.asset, filters.asset));
  }
  if (filters?.isPaper !== undefined) {
    conditions.push(eq(positions.isPaper, filters.isPaper));
  }

  const query = db
    .select()
    .from(positions)
    .where(and(...conditions))
    .orderBy(desc(positions.exitTime));

  if (filters?.limit) {
    query.limit(filters.limit);
  }
  if (filters?.offset) {
    query.offset(filters.offset);
  }

  return query;
}

export async function getPositionById(
  id: number
): Promise<Position | null> {
  const [row] = await db
    .select()
    .from(positions)
    .where(eq(positions.id, id))
    .limit(1);

  return row ?? null;
}

export async function countOpenPositions(isPaper?: boolean): Promise<number> {
  const conditions = [eq(positions.status, 'open')];
  if (isPaper !== undefined) {
    conditions.push(eq(positions.isPaper, isPaper));
  }
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(positions)
    .where(and(...conditions));

  return row?.count ?? 0;
}

export async function getRecentClosedPositions(
  hours: number,
  isPaper?: boolean
): Promise<Position[]> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const conditions = [
    eq(positions.status, 'closed'),
    sql`${positions.exitTime} >= ${cutoff}`,
  ];
  if (isPaper !== undefined) {
    conditions.push(eq(positions.isPaper, isPaper));
  }

  return db
    .select()
    .from(positions)
    .where(and(...conditions))
    .orderBy(desc(positions.exitTime));
}
