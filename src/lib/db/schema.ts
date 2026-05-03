import {
  pgTable,
  text,
  timestamp,
  numeric,
  serial,
  integer,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// ─── system_state ───────────────────────────────────────────────────────────
export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── strategy_params ────────────────────────────────────────────────────────
export const strategyParams = pgTable('strategy_params', {
  paramName: text('param_name').primaryKey(),
  currentValue: numeric('current_value'),
  defaultValue: numeric('default_value'),
  minAllowed: numeric('min_allowed'),
  maxAllowed: numeric('max_allowed'),
  versionChanged: text('version_changed'),
  changedReason: text('changed_reason'),
});

// ─── positions ──────────────────────────────────────────────────────────────
export const positions = pgTable(
  'positions',
  {
    id: serial('id').primaryKey(),
    asset: text('asset').notNull(),
    type: text('type').notNull(),
    status: text('status').default('open').notNull(),
    direction: text('direction').default('long').notNull(),
    entryPrice: numeric('entry_price').notNull(),
    quantity: numeric('quantity').notNull(),
    entryTime: timestamp('entry_time', { withTimezone: true }).notNull(),
    exitPrice: numeric('exit_price'),
    exitTime: timestamp('exit_time', { withTimezone: true }),
    stopLoss: numeric('stop_loss').notNull(),
    takeProfitTarget: numeric('take_profit_target').notNull(),
    convictionAtEntry: integer('conviction_at_entry').notNull(),
    currentConviction: integer('current_conviction').notNull(),
    catalyst: text('catalyst'),
    thesis: text('thesis'),
    reasoning: text('reasoning'),
    exitReason: text('exit_reason'),
    grossPnl: numeric('gross_pnl'),
    netPnl: numeric('net_pnl'),
    feesPaid: numeric('fees_paid').default('0'),
    costBasis: numeric('cost_basis').notNull(),
    realizedGainLoss: numeric('realized_gain_loss'),
    strategyVersion: text('strategy_version').notNull(),
    regimeAtEntry: text('regime_at_entry').notNull(),
    stopOrderId: text('stop_order_id'),
    tpOrderId: text('tp_order_id'),
    entryOrderId: text('entry_order_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('positions_status_idx').on(table.status),
    index('positions_asset_idx').on(table.asset),
  ]
);

// ─── orders ─────────────────────────────────────────────────────────────────
export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    coinbaseOrderId: text('coinbase_order_id').unique(),
    type: text('type').notNull(),
    asset: text('asset').notNull(),
    side: text('side').notNull(),
    price: numeric('price'),
    quantity: numeric('quantity').notNull(),
    status: text('status').default('pending').notNull(),
    relatedPositionId: integer('related_position_id').references(() => positions.id),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
    filledAt: timestamp('filled_at', { withTimezone: true }),
    fillPrice: numeric('fill_price'),
    fillQuantity: numeric('fill_quantity'),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('orders_status_idx').on(table.status),
    index('orders_coinbase_order_id_idx').on(table.coinbaseOrderId),
  ]
);

// ─── pending_timers ─────────────────────────────────────────────────────────
export const pendingTimers = pgTable(
  'pending_timers',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    targetTime: timestamp('target_time', { withTimezone: true }).notNull(),
    status: text('status').default('pending').notNull(),
    relatedOrderId: integer('related_order_id').references(() => orders.id),
    relatedEntity: text('related_entity'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('pending_timers_status_idx').on(table.status),
  ]
);

// ─── evaluations ────────────────────────────────────────────────────────────
export const evaluations = pgTable(
  'evaluations',
  {
    id: serial('id').primaryKey(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    type: text('type').notNull(),
    dataPackageHash: text('data_package_hash'),
    opusResponse: jsonb('opus_response').notNull(),
    actionsTaken: jsonb('actions_taken'),
    strategyVersion: text('strategy_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('evaluations_type_idx').on(table.type),
    index('evaluations_timestamp_idx').on(table.timestamp),
  ]
);

// ─── theses ─────────────────────────────────────────────────────────────────
export const theses = pgTable(
  'theses',
  {
    id: serial('id').primaryKey(),
    asset: text('asset').notNull(),
    thesisText: text('thesis_text').notNull(),
    status: text('status').default('active').notNull(),
    conviction: integer('conviction').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }).notNull(),
    invalidationReason: text('invalidation_reason'),
    supportingEvidence: jsonb('supporting_evidence').default('[]'),
    counterEvidence: jsonb('counter_evidence').default('[]'),
    performanceToDatePct: numeric('performance_to_date_pct'),
  },
  (table) => [
    index('theses_asset_idx').on(table.asset),
    index('theses_status_idx').on(table.status),
  ]
);

// ─── strategy_modifications ─────────────────────────────────────────────────
export const strategyModifications = pgTable('strategy_modifications', {
  id: serial('id').primaryKey(),
  fromVersion: text('from_version').notNull(),
  toVersion: text('to_version').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  paramsChanged: jsonb('params_changed').notNull(),
  reasoning: text('reasoning').notNull(),
  tradeCountAtModification: integer('trade_count_at_modification').notNull(),
  winRateAtModification: numeric('win_rate_at_modification'),
  btcBenchmarkDeltaAtModification: numeric('btc_benchmark_delta_at_modification'),
});

// ─── regime_history ─────────────────────────────────────────────────────────
export const regimeHistory = pgTable(
  'regime_history',
  {
    id: serial('id').primaryKey(),
    regime: text('regime').notNull(),
    evidence: text('evidence').notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull(),
    wasCorrect: boolean('was_correct'),
  },
  (table) => [
    index('regime_history_assessed_at_idx').on(table.assessedAt),
  ]
);

// ─── reconciliation_log ─────────────────────────────────────────────────────
export const reconciliationLog = pgTable('reconciliation_log', {
  id: serial('id').primaryKey(),
  bootAt: timestamp('boot_at', { withTimezone: true }).notNull(),
  downtimeSeconds: integer('downtime_seconds'),
  discrepanciesFound: jsonb('discrepancies_found'),
  actionsTaken: jsonb('actions_taken'),
});

// ─── alerts ─────────────────────────────────────────────────────────────────
export const alerts = pgTable(
  'alerts',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(),
    severity: text('severity').default('info').notNull(),
    message: text('message').notNull(),
    data: jsonb('data'),
    acknowledged: boolean('acknowledged').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('alerts_type_idx').on(table.type),
    index('alerts_acknowledged_idx').on(table.acknowledged),
  ]
);

// ─── equity_snapshots ───────────────────────────────────────────────────────
export const equitySnapshots = pgTable(
  'equity_snapshots',
  {
    id: serial('id').primaryKey(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    totalValueUsd: numeric('total_value_usd').notNull(),
    cashUsd: numeric('cash_usd').notNull(),
    deployedUsd: numeric('deployed_usd').notNull(),
    btcPrice: numeric('btc_price').notNull(),
    btcHoldValue: numeric('btc_hold_value').notNull(),
  },
  (table) => [
    index('equity_snapshots_timestamp_idx').on(table.timestamp),
  ]
);
