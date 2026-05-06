import { pgTable, text, timestamp, integer, numeric, boolean, jsonb, uuid, pgEnum, index } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const regimeEnum = pgEnum("regime", ["bull", "chop", "bear"]);
export const phaseEnum = pgEnum("phase", ["paper", "half", "full", "paused", "halted"]);

export const positionTypeEnum = pgEnum("position_type", ["btc_core", "alt_cycle"]);
export const positionStatusEnum = pgEnum("position_status", ["open", "closed"]);
export const positionDirectionEnum = pgEnum("position_direction", ["long"]);

export const orderTypeEnum = pgEnum("order_type", [
  "entry_limit",
  "stop_limit",
  "take_profit",
  "market_exit",
  "dca_limit",
]);
export const orderSideEnum = pgEnum("order_side", ["buy", "sell"]);
export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "filled",
  "partially_filled",
  "cancelled",
  "expired",
]);

export const modelEnum = pgEnum("ai_model", ["claude-opus-4-7", "claude-sonnet-4-6"]);
export const callTypeEnum = pgEnum("call_type", [
  "morning",
  "sonnet_check",
  "opus_escalation",
  "emergency",
  "review",
  "post_restart",
]);
export const triggerSourceEnum = pgEnum("trigger_source", [
  "scheduled",
  "wakeup_position_move",
  "wakeup_stop_fill",
  "wakeup_news",
  "escalation",
]);

export const wakeupTypeEnum = pgEnum("wakeup_type", [
  "position_move",
  "stop_fill",
  "news_keyword",
]);

export const errorSeverityEnum = pgEnum("error_severity", [
  "info",
  "warning",
  "error",
  "critical",
]);

export const appDecisionTypeEnum = pgEnum("app_decision_type", [
  "budget_gate",
  "model_route",
  "wakeup_debounce",
  "escalation_dispatch",
  "order_routing",
  "reconciliation_action",
  "circuit_breaker",
  "phase_gate",
  "cooldown_check",
]);

export const triggerEventEnum = pgEnum("trigger_event", [
  "eval_start",
  "order_placed",
  "wakeup_fired",
  "reconciliation_check",
  "manual_snapshot",
  "price_poll",
]);

export const urgencyEnum = pgEnum("urgency", ["immediate", "next_check"]);

// ---------------------------------------------------------------------------
// 7.1 state — singleton key-value
// ---------------------------------------------------------------------------

export const state = pgTable("state", {
  key: text("key").primaryKey(),
  // Nullable so keys can legitimately transition to null (e.g.,
  // cooldown_until clears when the window expires, current_regime is
  // unset until the first morning brief, etc.).
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 7.2 params — versioned strategy parameters
// ---------------------------------------------------------------------------

export const params = pgTable("params", {
  paramName: text("param_name").primaryKey(),
  currentValue: jsonb("current_value").notNull(),
  minAllowed: jsonb("min_allowed"),
  maxAllowed: jsonb("max_allowed"),
  version: text("version").notNull(),
  changedReason: text("changed_reason"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 7.3 positions
// ---------------------------------------------------------------------------

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asset: text("asset").notNull(),
    type: positionTypeEnum("type").notNull(),
    status: positionStatusEnum("status").notNull(),
    direction: positionDirectionEnum("direction").notNull().default("long"),
    entryPrice: numeric("entry_price", { precision: 20, scale: 8 }).notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
    stopPrice: numeric("stop_price", { precision: 20, scale: 8 }),
    targetPrice: numeric("target_price", { precision: 20, scale: 8 }),
    convictionAtEntry: integer("conviction_at_entry"),
    catalyst: text("catalyst"),
    thesis: text("thesis"),
    entryTime: timestamp("entry_time", { withTimezone: true }).notNull(),
    exitPrice: numeric("exit_price", { precision: 20, scale: 8 }),
    exitTime: timestamp("exit_time", { withTimezone: true }),
    exitReason: text("exit_reason"),
    grossPnlUsd: numeric("gross_pnl_usd", { precision: 20, scale: 8 }),
    feesUsd: numeric("fees_usd", { precision: 20, scale: 8 }),
    netPnlUsd: numeric("net_pnl_usd", { precision: 20, scale: 8 }),
    strategyVersion: text("strategy_version").notNull(),
    regimeAtEntry: regimeEnum("regime_at_entry"),
    stopOrderId: text("stop_order_id"),
    tpOrderId: text("tp_order_id"),
    entryOrderId: text("entry_order_id"),
    paperMode: boolean("paper_mode").notNull(),
  },
  (table) => [
    index("positions_status_paper_mode_idx").on(table.status, table.paperMode),
    index("positions_asset_idx").on(table.asset),
    index("positions_entry_time_idx").on(table.entryTime),
  ],
);

// ---------------------------------------------------------------------------
// 7.4 orders
// ---------------------------------------------------------------------------

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coinbaseOrderId: text("coinbase_order_id").notNull(),
    type: orderTypeEnum("type").notNull(),
    asset: text("asset").notNull(),
    side: orderSideEnum("side").notNull(),
    price: numeric("price", { precision: 20, scale: 8 }),
    quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
    status: orderStatusEnum("status").notNull(),
    relatedPositionId: uuid("related_position_id").references(() => positions.id),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    fillPrice: numeric("fill_price", { precision: 20, scale: 8 }),
    fillQuantity: numeric("fill_quantity", { precision: 20, scale: 8 }),
    cancelReason: text("cancel_reason"),
    paperMode: boolean("paper_mode").notNull(),
  },
  (table) => [
    index("orders_status_paper_mode_idx").on(table.status, table.paperMode),
    index("orders_related_position_idx").on(table.relatedPositionId),
    index("orders_coinbase_id_idx").on(table.coinbaseOrderId),
  ],
);

// ---------------------------------------------------------------------------
// 7.5 evaluations — every AI call
// ---------------------------------------------------------------------------

export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    model: modelEnum("model").notNull(),
    callType: callTypeEnum("call_type").notNull(),
    triggerSource: triggerSourceEnum("trigger_source").notNull(),
    promptText: text("prompt_text").notNull(),
    responseText: text("response_text"),
    parsedResponse: jsonb("parsed_response"),
    actionsTaken: jsonb("actions_taken"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    strategyVersion: text("strategy_version").notNull(),
    suppressed: boolean("suppressed").notNull().default(false),
    suppressionReason: text("suppression_reason"),
  },
  (table) => [
    index("evaluations_timestamp_idx").on(table.timestamp),
    index("evaluations_call_type_idx").on(table.callType, table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// 7.6 triggers — today's watch list from morning brief
// ---------------------------------------------------------------------------

export const triggers = pgTable(
  "triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    morningEvalId: uuid("morning_eval_id")
      .references(() => evaluations.id)
      .notNull(),
    triggerId: text("trigger_id").notNull(),
    asset: text("asset"),
    conditionText: text("condition_text").notNull(),
    rationale: text("rationale"),
    urgency: urgencyEnum("urgency").notNull(),
    activeFrom: timestamp("active_from", { withTimezone: true }).notNull(),
    activeUntil: timestamp("active_until", { withTimezone: true }).notNull(),
    timesEvaluated: integer("times_evaluated").notNull().default(0),
    timesFired: integer("times_fired").notNull().default(0),
  },
  (table) => [
    index("triggers_active_window_idx").on(table.activeFrom, table.activeUntil),
    index("triggers_morning_eval_idx").on(table.morningEvalId),
  ],
);

// ---------------------------------------------------------------------------
// 7.7 wakeups — every event-driven Sonnet wake-up
// ---------------------------------------------------------------------------

export const wakeups = pgTable(
  "wakeups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    triggerType: wakeupTypeEnum("trigger_type").notNull(),
    asset: text("asset"),
    observedValue: jsonb("observed_value").notNull(),
    dispatched: boolean("dispatched").notNull(),
    suppressionReason: text("suppression_reason"),
    sonnetEvalId: uuid("sonnet_eval_id").references(() => evaluations.id),
    escalatedToOpus: boolean("escalated_to_opus"),
    opusEvalId: uuid("opus_eval_id").references(() => evaluations.id),
    opusActionTaken: text("opus_action_taken"),
  },
  (table) => [
    index("wakeups_timestamp_idx").on(table.timestamp),
    index("wakeups_trigger_type_idx").on(table.triggerType, table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// 7.8 api_spend — every API call's cost
// ---------------------------------------------------------------------------

export const apiSpend = pgTable(
  "api_spend",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    model: modelEnum("model").notNull(),
    callType: callTypeEnum("call_type").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    webSearchCount: integer("web_search_count").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    month: text("month").notNull(),
    relatedEvalId: uuid("related_eval_id").references(() => evaluations.id),
  },
  (table) => [
    index("api_spend_month_idx").on(table.month),
    index("api_spend_timestamp_idx").on(table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// 7.9 errors — caught exceptions, retries, recoveries
// ---------------------------------------------------------------------------

export const errors = pgTable(
  "errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    severity: errorSeverityEnum("severity").notNull(),
    component: text("component").notNull(),
    errorClass: text("error_class").notNull(),
    message: text("message").notNull(),
    traceback: text("traceback"),
    context: jsonb("context"),
    recovered: boolean("recovered").notNull(),
    recoveryAction: text("recovery_action"),
  },
  (table) => [
    index("errors_severity_idx").on(table.severity, table.timestamp),
    index("errors_component_idx").on(table.component, table.timestamp),
    index("errors_timestamp_idx").on(table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// 7.10 system_state_history — append-only audit log
// ---------------------------------------------------------------------------

export const systemStateHistory = pgTable(
  "system_state_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    oldValue: jsonb("old_value"),
    // Nullable to mirror state.value — a transition from "set" to "unset"
    // is a real audit-worthy event (cooldown expired, regime cleared).
    newValue: jsonb("new_value"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    changedBy: text("changed_by").notNull(),
    relatedEvalId: uuid("related_eval_id").references(() => evaluations.id),
  },
  (table) => [
    index("ssh_key_changed_at_idx").on(table.key, table.changedAt),
    index("ssh_changed_at_idx").on(table.changedAt),
  ],
);

// ---------------------------------------------------------------------------
// 7.11 app_decisions — every app-level decision
// ---------------------------------------------------------------------------

export const appDecisions = pgTable(
  "app_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    decisionType: appDecisionTypeEnum("decision_type").notNull(),
    inputs: jsonb("inputs").notNull(),
    outputs: jsonb("outputs").notNull(),
    reasoning: text("reasoning").notNull(),
    relatedEntity: text("related_entity"),
  },
  (table) => [
    index("ad_timestamp_idx").on(table.timestamp),
    index("ad_decision_type_idx").on(table.decisionType, table.timestamp),
    index("ad_related_entity_idx").on(table.relatedEntity),
  ],
);

// ---------------------------------------------------------------------------
// 7.12 price_snapshots — market state at decision points
// ---------------------------------------------------------------------------

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    triggerEvent: triggerEventEnum("trigger_event").notNull(),
    relatedEntity: text("related_entity"),
    btcPrice: numeric("btc_price", { precision: 20, scale: 8 }),
    ethPrice: numeric("eth_price", { precision: 20, scale: 8 }),
    solPrice: numeric("sol_price", { precision: 20, scale: 8 }),
    btcDominance: numeric("btc_dominance", { precision: 8, scale: 4 }),
    fearGreed: integer("fear_greed"),
  },
  (table) => [
    index("ps_timestamp_idx").on(table.timestamp),
    index("ps_trigger_event_idx").on(table.triggerEvent, table.timestamp),
  ],
);

// ---------------------------------------------------------------------------
// Type exports for consumers
// ---------------------------------------------------------------------------

export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Evaluation = typeof evaluations.$inferSelect;
export type NewEvaluation = typeof evaluations.$inferInsert;
export type Trigger = typeof triggers.$inferSelect;
export type NewTrigger = typeof triggers.$inferInsert;
export type Wakeup = typeof wakeups.$inferSelect;
export type NewWakeup = typeof wakeups.$inferInsert;
export type ApiSpendRow = typeof apiSpend.$inferSelect;
export type NewApiSpendRow = typeof apiSpend.$inferInsert;
export type ErrorRow = typeof errors.$inferSelect;
export type NewErrorRow = typeof errors.$inferInsert;
export type StateRow = typeof state.$inferSelect;
export type ParamRow = typeof params.$inferSelect;
export type SystemStateHistoryRow = typeof systemStateHistory.$inferSelect;
export type NewSystemStateHistoryRow = typeof systemStateHistory.$inferInsert;
export type AppDecisionRow = typeof appDecisions.$inferSelect;
export type NewAppDecisionRow = typeof appDecisions.$inferInsert;
export type PriceSnapshotRow = typeof priceSnapshots.$inferSelect;
export type NewPriceSnapshotRow = typeof priceSnapshots.$inferInsert;
