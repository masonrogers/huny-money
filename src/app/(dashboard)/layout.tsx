import { AppShell } from "@/components/app-shell";

/**
 * Dashboard route group layout. Wraps every authenticated page in the
 * AppShell (sidebar + header + main content area).
 *
 * Header props are hardcoded for Phase 6 — Phase 7 wires them to live data
 * via SWR fetching `/api/dashboard/status`.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      mode="paper"
      phase="paper"
      regime="chop"
      daysInRegime={3}
      paused={false}
      modeChangePending={false}
    >
      {children}
    </AppShell>
  );
}
