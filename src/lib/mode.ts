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

let currentMode: Mode | null = null;

export function setCurrentMode(mode: Mode): void {
  currentMode = mode;
}

export function getCurrentMode(): Mode {
  if (currentMode === null) {
    throw new Error(
      "getCurrentMode() called before mode was initialized. " +
        "Mode must be loaded at boot via setCurrentMode(). " +
        "If you're in a test, call setCurrentModeForTesting('paper'|'live') in setup.",
    );
  }
  return currentMode;
}

export function setCurrentModeForTesting(mode: Mode | null): void {
  currentMode = mode;
}

export function isPaperMode(): boolean {
  return getCurrentMode() === "paper";
}

export function isLiveMode(): boolean {
  return getCurrentMode() === "live";
}
