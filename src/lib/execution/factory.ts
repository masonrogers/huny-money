import { stateRead } from "@/lib/db/utils";
import { setCurrentMode, type Mode } from "@/lib/mode";
import { log } from "@/lib/logger";
import { LiveExecutor } from "./live-executor";
import { PaperExecutor } from "./paper-executor";
import type { OrderExecutor } from "./interface";

/**
 * Executor factory.
 *
 * Per STRATEGY.md §13.4:
 * - Called ONCE at boot
 * - Reads `state.paper_mode` from the database
 * - Sets the global mode singleton (used by query helpers)
 * - Constructs and returns the appropriate executor
 * - The mode is then INVARIANT for the session
 *
 * Production callers cache the returned executor and pass it through
 * dependency injection. They never call this function again.
 *
 * After this function returns, `state.mode_change_pending` is cleared
 * (the operator's pending toggle has now taken effect).
 */

let constructedExecutor: OrderExecutor | null = null;

export interface BootExecutorResult {
  executor: OrderExecutor;
  mode: Mode;
}

export async function bootConstructExecutor(): Promise<BootExecutorResult> {
  if (constructedExecutor != null) {
    throw new Error(
      "bootConstructExecutor() called twice in the same session. The executor " +
        "is constructed exactly once at boot. If you need to reset for tests, " +
        "use __resetExecutorForTesting().",
    );
  }

  const paperFlag = await stateRead<boolean>("paper_mode");
  // Default to paper if unset (safer fallback for first boot).
  const paper = paperFlag ?? true;
  const mode: Mode = paper ? "paper" : "live";

  log.info("Boot: constructing executor", { mode });

  setCurrentMode(mode);

  if (mode === "paper") {
    constructedExecutor = PaperExecutor.__constructFromFactory(
      PaperExecutor.__factoryConstructKey,
    );
  } else {
    constructedExecutor = LiveExecutor.__constructFromFactory(
      LiveExecutor.__factoryConstructKey,
    );
  }

  return { executor: constructedExecutor, mode };
}

/**
 * Returns the singleton executor constructed at boot. Throws if
 * `bootConstructExecutor` has not been called yet — ensures all production
 * code paths go through boot.
 */
export function getExecutor(): OrderExecutor {
  if (!constructedExecutor) {
    throw new Error(
      "getExecutor(): executor has not been constructed. bootConstructExecutor() " +
        "must be called once at boot before any code path attempts to place orders.",
    );
  }
  return constructedExecutor;
}

/** Tests-only: replace the singleton (or clear it). */
export function __resetExecutorForTesting(replacement?: OrderExecutor | null): void {
  constructedExecutor = replacement ?? null;
}
