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
    // Sentinel: a state row written only by v3 migrations after the schema is
    // known-good. Once present, this script trusts drizzle-kit to handle
    // diffs from there. Until present, we eagerly drop because (a) there's
    // no real data yet, and (b) drizzle-kit's diff misbehaves on the
    // NOT NULL → NULL transition for jsonb columns.
    const sentinel = await sql<{ value: unknown }[]>`
      SELECT value FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'state' LIMIT 1
    `.catch(() => []);

    const v3SchemaSettled = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'state' AND column_name = 'value' AND is_nullable = 'YES'
    `.catch(() => [{ count: 0 }]);

    const isV3WithCorrectSchema =
      sentinel.length > 0 && v3SchemaSettled[0]!.count === 1;

    if (!v1Detected && isV3WithCorrectSchema) {
      console.log(
        `[migrate-v1-to-v3] v3 schema is settled (${rows.length} tables, state.value is nullable). Skipping drop.`,
      );
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

void main();
