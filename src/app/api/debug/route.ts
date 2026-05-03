import { NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: Record<string, unknown> = {};

  try {
    const tables = await db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    results.tables = (tables as unknown as Array<{ tablename: string }>).map(r => r.tablename);
  } catch (e) {
    results.tables_error = e instanceof Error ? e.message : String(e);
  }

  try {
    const positions = await db.execute(sql`SELECT count(*) as cnt FROM positions`);
    results.positions_count = (positions as unknown as Array<{ cnt: number }>)[0]?.cnt;
  } catch (e) {
    results.positions_error = e instanceof Error ? e.message : String(e);
  }

  try {
    const sysState = await db.execute(sql`SELECT count(*) as cnt FROM system_state`);
    results.system_state_count = (sysState as unknown as Array<{ cnt: number }>)[0]?.cnt;
  } catch (e) {
    results.system_state_error = e instanceof Error ? e.message : String(e);
  }

  try {
    const sample = await db.execute(
      sql`SELECT key, value FROM system_state WHERE key IN ('current_regime', 'paper_trading_mode', 'trading_paused', 'strategy_version') ORDER BY key`
    );
    results.system_state_sample = sample;
  } catch (e) {
    results.system_state_sample_error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(results);
}
