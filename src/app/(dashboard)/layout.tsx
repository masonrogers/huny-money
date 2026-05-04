import { LiveAppShell } from "@/components/app-shell/live-app-shell";

/**
 * Dashboard route group layout. Wraps every authenticated page in the
 * AppShell, driven by live data from `/api/dashboard/status` (refreshes
 * every 5 seconds).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <LiveAppShell>{children}</LiveAppShell>;
}
