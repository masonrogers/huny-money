/**
 * `errors` table queries.
 *
 * WRITES MUST go through `errorLogger` from `src/lib/db/utils.ts` so that
 * the structured log line is also emitted and `redact()` is applied.
 *
 * This file exposes only READ helpers.
 */

import { desc, eq, gte, and } from "drizzle-orm";
import { db } from "../index";
import { errors } from "../schema";
import type { ErrorRow } from "../schema";

export async function recentErrors(limit = 100): Promise<ErrorRow[]> {
  return db.select().from(errors).orderBy(desc(errors.timestamp)).limit(limit);
}

export async function errorsBySeveritySince(
  severity: ErrorRow["severity"],
  since: Date,
): Promise<ErrorRow[]> {
  return db
    .select()
    .from(errors)
    .where(and(eq(errors.severity, severity), gte(errors.timestamp, since)))
    .orderBy(desc(errors.timestamp));
}

export async function errorsByComponentSince(
  component: string,
  since: Date,
): Promise<ErrorRow[]> {
  return db
    .select()
    .from(errors)
    .where(and(eq(errors.component, component), gte(errors.timestamp, since)))
    .orderBy(desc(errors.timestamp));
}
