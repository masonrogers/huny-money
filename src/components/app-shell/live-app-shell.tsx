"use client";

import { AppShell } from "./index";
import { StatusWatcher } from "./status-watcher";
import { useApi } from "@/lib/hooks/api";
import { DashboardViewProvider } from "@/lib/contexts/dashboard-view";
import type { DashboardStatusPayload } from "@/app/api/dashboard/status/route";

/**
 * Client wrapper that drives the AppShell from the live `/api/dashboard/status`
 * endpoint. Falls back to safe defaults during the initial fetch so the
 * layout renders immediately.
 *
 * Refreshes every 5 seconds so the operator sees mode changes, regime
 * updates, and pause toggles without a manual refresh.
 *
 * Wraps children in DashboardViewProvider so any page can call
 * useDashboardView() to swap between the paper-portfolio lens and the
 * Coinbase-wallet lens. The view defaults to whatever the bot is actually
 * trading and is sticky to localStorage after the first toggle.
 */
export function LiveAppShell({ children }: { children: React.ReactNode }) {
  const { data } = useApi<DashboardStatusPayload>("/api/dashboard/status", {
    refreshInterval: 5_000,
  });

  return (
    <DashboardViewProvider tradingMode={data?.mode}>
      <AppShell
        mode={data?.mode ?? "paper"}
        phase={data?.phase ?? undefined}
        regime={data?.regime ?? null}
        daysInRegime={data?.daysInRegime ?? null}
        paused={data?.paused ?? false}
        modeChangePending={data?.modeChangePending ?? false}
      >
        <StatusWatcher status={data} />
        {children}
      </AppShell>
    </DashboardViewProvider>
  );
}
