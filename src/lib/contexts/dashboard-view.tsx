"use client";

import * as React from "react";

/**
 * Dashboard view context.
 *
 * The dashboard view is a PURELY COSMETIC operator preference — which lens
 * the operator looks through. It is NOT the trading mode (which controls
 * what the bot does and is locked to the executor at boot).
 *
 *   "paper"    — show synthetic paper accounting (bot's hypothetical portfolio)
 *   "coinbase" — show real Coinbase wallet (informational, separate ledger)
 *
 * Defaults to whichever mode the bot is actually trading in (so paper-mode
 * boots default to "paper" view) and falls through to "paper" if the trading
 * mode is still loading.
 *
 * Persisted to localStorage so a refresh keeps the operator's choice.
 */

export type DashboardView = "paper" | "coinbase";

interface DashboardViewContextValue {
  view: DashboardView;
  setView: (v: DashboardView) => void;
  /** True if the current view differs from the bot's actual trading mode. */
  isDeviating: boolean;
}

const DashboardViewContext = React.createContext<DashboardViewContextValue | null>(
  null,
);

const STORAGE_KEY = "huny-dashboard-view";

function tradingModeToView(mode: "paper" | "live" | undefined): DashboardView {
  // Live trading → operator's "view = real wallet" expectation maps to coinbase.
  return mode === "live" ? "coinbase" : "paper";
}

export function DashboardViewProvider({
  children,
  tradingMode,
}: {
  children: React.ReactNode;
  /** Bot's actual trading mode — used to derive the default view on first load. */
  tradingMode: "paper" | "live" | undefined;
}) {
  // SSR-safe: default to paper, hydrate from localStorage on mount.
  const [view, setViewState] = React.useState<DashboardView>("paper");
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "paper" || stored === "coinbase") {
      setViewState(stored);
    } else {
      setViewState(tradingModeToView(tradingMode));
    }
    setHydrated(true);
    // We only seed from tradingMode on first hydration. After that, the
    // operator's explicit choice is sticky — they can deviate and we respect it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the operator hasn't yet picked a view (no localStorage entry), keep
  // tracking the trading mode as it loads in.
  React.useEffect(() => {
    if (!hydrated) return;
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "paper" || stored === "coinbase") return;
    setViewState(tradingModeToView(tradingMode));
  }, [tradingMode, hydrated]);

  const setView = React.useCallback((v: DashboardView) => {
    setViewState(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, v);
    }
  }, []);

  const value = React.useMemo<DashboardViewContextValue>(() => {
    return {
      view,
      setView,
      isDeviating:
        tradingMode != null && tradingModeToView(tradingMode) !== view,
    };
  }, [view, setView, tradingMode]);

  return (
    <DashboardViewContext.Provider value={value}>
      {children}
    </DashboardViewContext.Provider>
  );
}

export function useDashboardView(): DashboardViewContextValue {
  const ctx = React.useContext(DashboardViewContext);
  if (!ctx) {
    // Safe fallback so individual components don't blow up if rendered
    // outside the provider (e.g., a unit-test snapshot). The default is
    // "paper" and setView is a no-op.
    return {
      view: "paper",
      setView: () => {},
      isDeviating: false,
    };
  }
  return ctx;
}
