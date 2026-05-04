import * as React from "react";
import { Toaster } from "sonner";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { CommandPalette } from "./command-palette";
import { PageTransition } from "./page-transition";

/**
 * AppShell wraps every authenticated page. Sidebar is persistent; header
 * carries mode/regime/phase indicators + live ticker; main content area
 * scrolls. The command palette and toast surface mount globally.
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
      <CommandPalette />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          },
        }}
      />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header {...headerProps} />
        <main className="flex-1 overflow-y-auto px-6 py-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}

export { NAV_ITEMS } from "./nav-config";
