/**
 * Integration test setup — runs against the live DATABASE_URL with
 * `drizzle-kit push --force` already applied.
 *
 * Skipped in CI by default; opt in with `RUN_INTEGRATION=1`.
 *
 * Each test truncates all tables before running so there's no bleed-over.
 * This is intentionally simple — no separate test schema, no transaction
 * isolation. The DO Postgres charges nothing extra and the operator's
 * machine is the only consumer.
 */

import { sql } from "drizzle-orm";
import { db, __resetDbForTesting } from "@/lib/db";
import { setCurrentModeForTesting } from "@/lib/mode";
import { __resetExecutorForTesting } from "@/lib/execution";

export const integrationEnabled = process.env.RUN_INTEGRATION === "1";

const TABLES = [
  "wakeups",
  "triggers",
  "evaluations",
  "api_spend",
  "errors",
  "system_state_history",
  "app_decisions",
  "price_snapshots",
  "orders",
  "positions",
  "params",
  "state",
] as const;

export async function truncateAll(): Promise<void> {
  // Order matters because of foreign keys; explicitly truncate restart cascade.
  for (const t of TABLES) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`));
  }
}

export async function resetIntegration(): Promise<void> {
  await truncateAll();
  setCurrentModeForTesting(null);
  __resetExecutorForTesting(null);
}

export async function teardownIntegration(): Promise<void> {
  await __resetDbForTesting();
}
