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

// Singleton storage hoisted to globalThis so it survives Next.js App Router
// bundle splitting. Module-scope `let` is per-bundle; instrumentation and
// API route handlers can end up with different copies of this module, each
// with its own null. globalThis is shared across all bundles in the same
// Node process — same pattern Drizzle/Prisma use.
const GLOBAL_KEY = "__hunyMoneyExecutor" as const;
type GlobalSlot = { value: OrderExecutor | null };
function slot(): GlobalSlot {
  const g = globalThis as unknown as Record<string, GlobalSlot | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { value: null };
  return g[GLOBAL_KEY]!;
}

export interface BootExecutorResult {
  executor: OrderExecutor;
  mode: Mode;
}

export async function bootConstructExecutor(): Promise<BootExecutorResult> {
  const s = slot();
  if (s.value != null) {
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
    s.value = PaperExecutor.__constructFromFactory(
      PaperExecutor.__factoryConstructKey,
    );
  } else {
    s.value = LiveExecutor.__constructFromFactory(
      LiveExecutor.__factoryConstructKey,
    );
  }

  return { executor: s.value, mode };
}

/**
 * Returns the singleton executor constructed at boot. Throws if
 * `bootConstructExecutor` has not been called yet — ensures all production
 * code paths go through boot.
 */
export function getExecutor(): OrderExecutor {
  const v = slot().value;
  if (!v) {
    throw new Error(
      "getExecutor(): executor has not been constructed. bootConstructExecutor() " +
        "must be called once at boot before any code path attempts to place orders.",
    );
  }
  return v;
}

/** Tests-only: replace the singleton (or clear it). */
export function __resetExecutorForTesting(replacement?: OrderExecutor | null): void {
  slot().value = replacement ?? null;
}
