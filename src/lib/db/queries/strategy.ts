import { eq, desc } from 'drizzle-orm';
import { db } from '../index';
import { strategyParams, strategyModifications, systemState } from '../schema';

type StrategyParam = typeof strategyParams.$inferSelect;
type StrategyModification = typeof strategyModifications.$inferSelect;
type NewStrategyModification = typeof strategyModifications.$inferInsert;

export async function getStrategyParams(): Promise<StrategyParam[]> {
  return db.select().from(strategyParams);
}

export async function updateParam(
  paramName: string,
  newValue: number,
  version: string,
  reason: string
): Promise<void> {
  await db
    .update(strategyParams)
    .set({
      currentValue: String(newValue),
      versionChanged: version,
      changedReason: reason,
    })
    .where(eq(strategyParams.paramName, paramName));
}

export async function getModificationHistory(): Promise<
  StrategyModification[]
> {
  return db
    .select()
    .from(strategyModifications)
    .orderBy(desc(strategyModifications.timestamp));
}

export async function insertModification(
  data: NewStrategyModification
): Promise<void> {
  await db.insert(strategyModifications).values(data);
}

export async function getCurrentVersion(): Promise<string> {
  const [row] = await db
    .select()
    .from(systemState)
    .where(eq(systemState.key, 'strategy_version'))
    .limit(1);

  return row?.value ?? '1.0';
}

export async function initializeDefaultParams(): Promise<void> {
  const defaults: (typeof strategyParams.$inferInsert)[] = [
    {
      paramName: 'stop_loss_pct',
      currentValue: '0.06',
      defaultValue: '0.06',
      minAllowed: '0.03',
      maxAllowed: '0.10',
    },
    {
      paramName: 'take_profit_multiplier',
      currentValue: '2.0',
      defaultValue: '2.0',
      minAllowed: '1.5',
      maxAllowed: '4.0',
    },
    {
      paramName: 'entry_conviction_threshold',
      currentValue: '60',
      defaultValue: '60',
      minAllowed: '50',
      maxAllowed: '80',
    },
    {
      paramName: 'conviction_exit_threshold',
      currentValue: '50',
      defaultValue: '50',
      minAllowed: '30',
      maxAllowed: '60',
    },
    {
      paramName: 'max_single_position_pct',
      currentValue: '0.50',
      defaultValue: '0.50',
      minAllowed: '0.20',
      maxAllowed: '0.50',
    },
    {
      paramName: 'min_cash_reserve_pct',
      currentValue: '0.30',
      defaultValue: '0.30',
      minAllowed: '0.20',
      maxAllowed: '0.40',
    },
    {
      paramName: 'trailing_stop_activation_pct',
      currentValue: '0.08',
      defaultValue: '0.08',
      minAllowed: '0.05',
      maxAllowed: '0.15',
    },
    {
      paramName: 'trailing_stop_distance_pct',
      currentValue: '0.04',
      defaultValue: '0.04',
      minAllowed: '0.02',
      maxAllowed: '0.08',
    },
  ];

  for (const param of defaults) {
    await db
      .insert(strategyParams)
      .values(param)
      .onConflictDoNothing({ target: strategyParams.paramName });
  }
}
