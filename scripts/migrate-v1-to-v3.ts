/**
 * One-shot v1 → v3 schema migration.
 *
 * Runs as part of the DO deploy `run_command`, BEFORE `drizzle-kit push --force`.
 *
 * The DO Postgres firewall blocks direct connections from outside the app,
 * so we can't drop the v1 schema with `psql` from the operator's machine.
 * Instead this script runs from inside the deploy sandbox.
 *
 * Behavior:
 * - If the public schema contains v1-specific tables (alerts,
 *   equity_snapshots, theses, strategy_modifications, regime_history,
 *   reconciliation_log, pending_timers, strategy_params, system_state) —
 *   drops the entire public schema and recreates it. drizzle-kit then sees
 *   a clean slate.
 * - On subsequent deploys (v3 already present), the v1 tables are absent,
 *   so the script is a no-op — drizzle-kit's diff-based push handles
 *   v3-to-v3 schema changes normally.
 *
 * Idempotent. Safe to run on every deploy.
 */

import postgres from "postgres";

const V1_TABLES = [
  "alerts",
  "equity_snapshots",
  "theses",
  "strategy_modifications",
  "regime_history",
  "reconciliation_log",
  "pending_timers",
  "strategy_params",
  "system_state",
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate-v1-to-v3] DATABASE_URL not set; aborting");
    process.exit(1);
  }

  const sql = postgres(url, {
    ssl: "require",
    connect_timeout: 10,
    idle_timeout: 5,
    max: 1,
  });

  try {
    const rows = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const existing = new Set(rows.map((r) => r.tablename));
    const v1Detected = V1_TABLES.some((t) => existing.has(t));

    // v3-settled signal: state.value column is nullable. That NOT NULL → NULL
    // transition is the one drizzle-kit's diff couldn't apply automatically
    // (jsonb dropping NOT NULL). Once we see the column as nullable, the
    // schema is current shape and drizzle-kit can handle further diffs
    // without a wipe. The previous sentinel query selected `value` from
    // information_schema.tables — that column doesn't exist, the query
    // always threw, .catch returned [], so isV3WithCorrectSchema was always
    // false → schema was dropped on every deploy, wiping all state.
    const v3SchemaSettled = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'state' AND column_name = 'value' AND is_nullable = 'YES'
    `.catch(() => [{ count: 0 }]);

    const isV3WithCorrectSchema = v3SchemaSettled[0]!.count === 1;

    if (!v1Detected && isV3WithCorrectSchema) {
      console.log(
        `[migrate-v1-to-v3] v3 schema is settled (${rows.length} tables, state.value is nullable). Skipping drop.`,
      );
      // Apply idempotent additive column migrations before returning so the
      // running app sees the new shape even when drizzle-kit's push plan
      // chokes on unrelated drift (we hit a 42P16 dropconstraint_internal
      // failure on a feesUsd column add — drizzle-kit generated a redefine
      // plan that tried to drop the orders_pkey, which Postgres refuses).
      await applyAdditiveMigrations(sql);
      return;
    }

    console.log(
      `[migrate-v1-to-v3] Schema needs reset (v1 detected: ${v1Detected}, v3 settled: ${isV3WithCorrectSchema}). Dropping public schema.`,
    );
    console.log(`  current tables: ${Array.from(existing).join(", ") || "(none)"}`);

    await sql.unsafe("DROP SCHEMA public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO doadmin");
    await sql.unsafe("GRANT ALL ON SCHEMA public TO public");

    console.log("[migrate-v1-to-v3] Schema dropped and recreated. drizzle-kit will create v3 tables next.");
  } catch (err) {
    console.error("[migrate-v1-to-v3] Failed:", (err as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

/**
 * Idempotent additive column migrations applied on every v3-settled deploy
 * BEFORE drizzle-kit push runs. Each statement uses IF NOT EXISTS so it's
 * safe to re-run. If drizzle-kit's diff plan can't apply the column add for
 * any reason (e.g., the 42P16 redefine bug we hit on the feesUsd add), the
 * raw ALTER here ensures boot still finds the column.
 *
 * To add a new column to v3:
 *   1. Update the schema in `src/lib/db/schema.ts` as usual
 *   2. Add the equivalent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` here
 *   3. Deploy
 */
async function applyAdditiveMigrations(sql: ReturnType<typeof postgres>): Promise<void> {
  const migrations: Array<{ name: string; statement: string }> = [
    {
      name: "orders.fees_usd",
      statement: `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "fees_usd" numeric(20, 8)`,
    },
  ];
  for (const m of migrations) {
    try {
      await sql.unsafe(m.statement);
      console.log(`[migrate-v1-to-v3] applied additive migration: ${m.name}`);
    } catch (err) {
      console.error(`[migrate-v1-to-v3] additive migration failed (${m.name}):`, (err as Error).message);
      throw err;
    }
  }
}

void main();
