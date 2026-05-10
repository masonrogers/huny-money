"use client";

import { useDashboardView } from "@/lib/contexts/dashboard-view";
import { Eye, FlaskConical, Wallet } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Segmented toggle for the dashboard view (paper vs Coinbase). Cosmetic
 * only — does NOT change the bot's trading mode. The trading-mode toggle
 * lives on the Controls page and requires typed-phrase confirmation +
 * a restart to take effect.
 *
 * Compact + always visible at the top of the header so the operator
 * always knows which lens they're looking through.
 */
export function DashboardViewToggle({
  tradingMode,
}: {
  tradingMode: "paper" | "live" | undefined;
}) {
  const { view, setView, isDeviating } = useDashboardView();

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Eye className="size-3.5 text-[var(--color-text-muted)]" />
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        Viewing
      </span>
      <div
        className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5"
        role="tablist"
        aria-label="Dashboard view"
      >
        <ViewButton
          active={view === "paper"}
          onClick={() => setView("paper")}
          icon={<FlaskConical className="size-3.5" />}
          label="Paper"
          tone="paper"
        />
        <ViewButton
          active={view === "coinbase"}
          onClick={() => setView("coinbase")}
          icon={<Wallet className="size-3.5" />}
          label="Coinbase"
          tone="coinbase"
        />
      </div>
      {isDeviating && tradingMode && (
        <span
          className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning-bg)] text-[var(--color-warning)]"
          title={`The bot is trading in ${tradingMode.toUpperCase()} mode but you're viewing the ${view.toUpperCase()} lens. View is cosmetic; trading is unaffected.`}
        >
          Bot trades {tradingMode}
        </span>
      )}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: "paper" | "coinbase";
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-sm transition-colors",
        active
          ? tone === "paper"
            ? "bg-[var(--color-mode-paper-bg)] text-[var(--color-mode-paper)] border border-[var(--color-mode-paper)]/40"
            : "bg-[var(--color-success-bg)] text-[var(--color-success)] border border-[var(--color-success)]/40"
          : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border border-transparent",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
