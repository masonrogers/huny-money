// Barrel for the Anthropic surface.
//
// Production callers import from here, never directly from the SDK. This
// guarantees that every API call goes through `callClaude` (which writes
// to evaluations + api_spend) and through `budgetGate` (caller's
// responsibility).

export {
  callClaude,
  callOpus,
  callSonnet,
  type ClaudeCallInput,
  type ClaudeCallResult,
  type TriggerSource,
} from "./client";

export {
  budgetGate,
  type CallType,
  type BudgetDecision,
  type BudgetBlockReason,
} from "./budget-gate";

export {
  MODELS,
  PRICING,
  computeCost,
  type ModelId,
  type UsageBreakdown,
  PRE_CALL_ESTIMATE_USD,
  VARIANCE_BUFFER,
  MONTHLY_BUDGET_USD,
  MAX_OPUS_CALLS_PER_DAY,
  MAX_OPUS_CALLS_PER_MONTH,
  MAX_SONNET_SCHEDULED_PER_DAY,
  MAX_SONNET_WAKEUPS_PER_DAY,
  MAX_SONNET_WAKEUPS_PER_MONTH,
} from "./pricing";
