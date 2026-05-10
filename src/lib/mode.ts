/**
 * Current execution mode (paper | live).
 *
 * Loaded ONCE at boot from `state.paper_mode` by the executor factory
 * (see STRATEGY.md §13.4). After boot, callers read it via
 * `getCurrentMode()`. The mode is invariant for the session — a flip
 * via the dashboard requires restart to take effect.
 *
 * Tests must call `setCurrentModeForTesting()` in setup. Production
 * code paths that access positions/orders before boot will throw,
 * which is the correct behavior — nothing should query those tables
 * before boot reconciliation completes.
 */

export type Mode = "paper" | "live";

// Hoisted to globalThis so it survives Next.js App Router bundle splitting.
// See note in src/lib/execution/factory.ts.
const GLOBAL_KEY = "__hunyMoneyMode" as const;
type GlobalSlot = { value: Mode | null };
function slot(): GlobalSlot {
  const g = globalThis as unknown as Record<string, GlobalSlot | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { value: null };
  return g[GLOBAL_KEY]!;
}

export function setCurrentMode(mode: Mode): void {
  slot().value = mode;
}

export function getCurrentMode(): Mode {
  const v = slot().value;
  if (v === null) {
    throw new Error(
      "getCurrentMode() called before mode was initialized. " +
        "Mode must be loaded at boot via setCurrentMode(). " +
        "If you're in a test, call setCurrentModeForTesting('paper'|'live') in setup.",
    );
  }
  return v;
}

export function setCurrentModeForTesting(mode: Mode | null): void {
  slot().value = mode;
}

export function isPaperMode(): boolean {
  return getCurrentMode() === "paper";
}

export function isLiveMode(): boolean {
  return getCurrentMode() === "live";
}
