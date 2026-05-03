import { eq, inArray } from 'drizzle-orm';
import { db } from '../index';
import { systemState } from '../schema';

export async function getState(key: string): Promise<string | null> {
  const row = await db
    .select()
    .from(systemState)
    .where(eq(systemState.key, key))
    .limit(1);

  return row[0]?.value ?? null;
}

export async function setState(key: string, value: string): Promise<void> {
  await db
    .insert(systemState)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getMultipleStates(
  keys: string[]
): Promise<Record<string, string | null>> {
  if (keys.length === 0) return {};

  const rows = await db
    .select()
    .from(systemState)
    .where(inArray(systemState.key, keys));

  const result: Record<string, string | null> = {};
  for (const k of keys) {
    result[k] = rows.find((r) => r.key === k)?.value ?? null;
  }
  return result;
}

export async function initializeDefaults(): Promise<void> {
  const defaults: { key: string; value: string | null }[] = [
    { key: 'trading_paused', value: 'false' },
    { key: 'paper_trading_mode', value: 'true' },
    { key: 'current_regime', value: 'ranging' },
    { key: 'peak_portfolio_value', value: '500' },
    { key: 'starting_capital', value: '500' },
    { key: 'strategy_version', value: '1.0' },
    { key: 'last_successful_boot_at', value: null },
    { key: 'next_evaluation_at', value: null },
    { key: 'approved_tertiary_assets', value: '[]' },
    { key: 'total_trade_count', value: '0' },
    { key: 'last_strategy_review_at', value: null },
    { key: 'paper_cash_usd', value: '500' },
    { key: 'paper_peak_value', value: '500' },
  ];

  for (const { key, value } of defaults) {
    await db
      .insert(systemState)
      .values({ key, value })
      .onConflictDoNothing({ target: systemState.key });
  }
}
