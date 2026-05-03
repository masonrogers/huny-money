"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { useSystemStatus } from "@/lib/hooks/use-api";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";
  const { data: status } = useSystemStatus();

  if (isLoginPage) {
    return <>{children}</>;
  }

  const paperMode = status?.paperMode ?? true;
  const tradingPaused = status?.tradingPaused ?? false;

  return (
    <>
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen ml-56">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-700 bg-gray-900/95 backdrop-blur px-6 py-3">
          <h1 className="text-xl font-bold tracking-tight text-white">
            Huny Money
          </h1>
          <div className="flex items-center gap-3">
            {paperMode ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-900/50 border border-amber-600/40 px-3 py-1 text-xs font-medium text-amber-300">
                PAPER MODE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-900/50 border border-red-500/60 px-3 py-1 text-xs font-bold text-red-300">
                LIVE MODE
              </span>
            )}
            {tradingPaused ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-900/50 border border-red-600/40 px-3 py-1 text-xs font-medium text-red-300">
                Trading Paused
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-800 border border-gray-600/40 px-3 py-1 text-xs font-medium text-gray-300">
                System Active
              </span>
            )}
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </>
  );
}
