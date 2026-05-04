/**
 * `price_snapshots` table queries.
 *
 * WRITES go through `priceSnapshotWriter` in `src/lib/db/utils.ts`.
 * This file exposes READ helpers.
 */

import { desc, eq, and, gte, lte } from "drizzle-orm";
import { db } from "../index";
import { priceSnapshots } from "../schema";
import type { PriceSnapshotRow } from "../schema";

export async function recentPriceSnapshots(limit = 100): Promise<PriceSnapshotRow[]> {
  return db
    .select()
    .from(priceSnapshots)
    .orderBy(desc(priceSnapshots.timestamp))
    .limit(limit);
}

/** Snapshot closest to (but not after) the given timestamp. */
export async function snapshotAt(at: Date): Promise<PriceSnapshotRow | null> {
  const rows = await db
    .select()
    .from(priceSnapshots)
    .where(lte(priceSnapshots.timestamp, at))
    .orderBy(desc(priceSnapshots.timestamp))
    .limit(1);
  return rows[0] ?? null;
}

export async function snapshotsByEventSince(
  triggerEvent: PriceSnapshotRow["triggerEvent"],
  since: Date,
): Promise<PriceSnapshotRow[]> {
  return db
    .select()
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.triggerEvent, triggerEvent), gte(priceSnapshots.timestamp, since)))
    .orderBy(desc(priceSnapshots.timestamp));
}
