import * as React from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { KeyboardShortcuts } from "./keyboard-shortcuts";

/**
 * AppShell wraps every authenticated page. Sidebar is persistent; header
 * carries mode/regime/phase indicators; main content area scrolls.
 *
 * The header props in production come from a `useAppState()` hook backed by
 * SWR fetching `/api/dashboard/status`. For Phase 6 we accept the props
 * directly so the layout can be exercised before that endpoint exists.
 */

export interface AppShellProps {
  children: React.ReactNode;
  mode: "paper" | "live";
  phase?: "paper" | "half" | "full" | "paused" | "halted";
  regime?: "bull" | "chop" | "bear" | null;
  daysInRegime?: number | null;
  paused?: boolean;
  modeChangePending?: boolean;
}

export function AppShell({ children, ...headerProps }: AppShellProps) {
  return (
    <div className="flex h-svh w-full bg-[var(--color-bg)]">
      <KeyboardShortcuts />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header {...headerProps} />
        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

export { NAV_ITEMS } from "./nav-config";
