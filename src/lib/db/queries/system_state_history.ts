/**
 * `system_state_history` table queries.
 *
 * WRITES are produced exclusively by `stateWriter` in `src/lib/db/utils.ts`
 * (atomic with the corresponding `state` write). This file exposes READ
 * helpers only — for the dashboard "what was the value at time T?" view.
 */

import { desc, eq, and, lte } from "drizzle-orm";
import { db } from "../index";
import { systemStateHistory } from "../schema";
import type { SystemStateHistoryRow } from "../schema";

export async function historyForKey(key: string, limit = 50): Promise<SystemStateHistoryRow[]> {
  return db
    .select()
    .from(systemStateHistory)
    .where(eq(systemStateHistory.key, key))
    .orderBy(desc(systemStateHistory.changedAt))
    .limit(limit);
}

/** "What was the value of `key` at timestamp `at`?" */
export async function valueAt(key: string, at: Date): Promise<unknown | null> {
  const rows = await db
    .select()
    .from(systemStateHistory)
    .where(and(eq(systemStateHistory.key, key), lte(systemStateHistory.changedAt, at)))
    .orderBy(desc(systemStateHistory.changedAt))
    .limit(1);
  return rows[0]?.newValue ?? null;
}

export async function recentHistory(limit = 100): Promise<SystemStateHistoryRow[]> {
  return db
    .select()
    .from(systemStateHistory)
    .orderBy(desc(systemStateHistory.changedAt))
    .limit(limit);
}
