import { sql, desc, eq } from "drizzle-orm";
import { db } from "../index";
import { apiSpend } from "../schema";
import type { ApiSpendRow, NewApiSpendRow } from "../schema";

export async function insertApiSpend(row: NewApiSpendRow): Promise<ApiSpendRow> {
  const inserted = await db.insert(apiSpend).values(row).returning();
  return inserted[0]!;
}

/** Total spend in USD for the given calendar month (YYYY-MM). */
export async function monthlySpendUsd(month: string): Promise<number> {
  const result = await db
    .select({ total: sql<string>`COALESCE(SUM(${apiSpend.costUsd}), 0)` })
    .from(apiSpend)
    .where(eq(apiSpend.month, month));
  return Number(result[0]?.total ?? 0);
}

/** Spend rows for the current calendar month. */
export async function spendRowsForMonth(month: string): Promise<ApiSpendRow[]> {
  return db.select().from(apiSpend).where(eq(apiSpend.month, month)).orderBy(desc(apiSpend.timestamp));
}

/** Helper: format a Date as YYYY-MM (UTC). */
export function monthKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
}
