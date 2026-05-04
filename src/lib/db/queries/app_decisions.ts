/**
 * `app_decisions` table queries.
 *
 * WRITES go through `appDecisionLogger` in `src/lib/db/utils.ts`.
 * This file exposes READ helpers for the dashboard.
 */

import { desc, eq, and, gte } from "drizzle-orm";
import { db } from "../index";
import { appDecisions } from "../schema";
import type { AppDecisionRow } from "../schema";

export async function recentAppDecisions(limit = 100): Promise<AppDecisionRow[]> {
  return db
    .select()
    .from(appDecisions)
    .orderBy(desc(appDecisions.timestamp))
    .limit(limit);
}

export async function appDecisionsByTypeSince(
  decisionType: AppDecisionRow["decisionType"],
  since: Date,
): Promise<AppDecisionRow[]> {
  return db
    .select()
    .from(appDecisions)
    .where(and(eq(appDecisions.decisionType, decisionType), gte(appDecisions.timestamp, since)))
    .orderBy(desc(appDecisions.timestamp));
}

export async function appDecisionsForEntity(relatedEntity: string): Promise<AppDecisionRow[]> {
  return db
    .select()
    .from(appDecisions)
    .where(eq(appDecisions.relatedEntity, relatedEntity))
    .orderBy(desc(appDecisions.timestamp));
}
