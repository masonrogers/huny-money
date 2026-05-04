export type {
  OrderExecutor,
  OrderResult,
  OrderStatus,
  PlaceOptions,
  Asset,
} from "./interface";

export {
  bootConstructExecutor,
  getExecutor,
  __resetExecutorForTesting,
  type BootExecutorResult,
} from "./factory";

export { OrderValidationError, validateOrder, type OrderValidationContext } from "./validation";

export {
  attemptModeTransition,
  clearModeChangePendingFlag,
  type TransitionAttempt,
  type TransitionResult,
  type TransitionRejectionReason,
} from "./mode-transition";

export {
  runBootReconciliation,
  CrossModeBootRejection,
  type ReconciliationFindings,
  type ReconciliationDeps,
} from "./reconciliation";

// Note: LiveExecutor and PaperExecutor classes are intentionally NOT
// exported here. The factory is the only sanctioned constructor path.
// Test code that needs to construct one directly can import from the
// specific files via the __constructFromFactory keys.
