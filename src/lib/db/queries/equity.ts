import { desc, sql } from 'drizzle-orm';
import { db } from '../index';
import { equitySnapshots } from '../schema';

type EquitySnapshot = typeof equitySnapshots.$inferSelect;

export async function insertSnapshot(data: {
  total_value_usd: string;
  cash_usd: string;
  deployed_usd: string;
  btc_price: string;
  btc_hold_value: string;
}): Promise<void> {
  await db.insert(equitySnapshots).values({
    timestamp: new Date(),
    totalValueUsd: data.total_value_usd,
    cashUsd: data.cash_usd,
    deployedUsd: data.deployed_usd,
    btcPrice: data.btc_price,
    btcHoldValue: data.btc_hold_value,
  });
}

export async function getSnapshots(
  limit: number = 100
): Promise<EquitySnapshot[]> {
  return db
    .select()
    .from(equitySnapshots)
    .orderBy(desc(equitySnapshots.timestamp))
    .limit(limit);
}

export async function getSnapshotsSince(
  since: Date
): Promise<EquitySnapshot[]> {
  return db
    .select()
    .from(equitySnapshots)
    .where(sql`${equitySnapshots.timestamp} >= ${since}`)
    .orderBy(desc(equitySnapshots.timestamp));
}
