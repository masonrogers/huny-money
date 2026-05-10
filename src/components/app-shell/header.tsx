"use client";

import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { PriceTicker } from "./price-ticker";
import { ActivityIndicator } from "./activity-indicator";

/**
 * Top header strip — the most prominent element on every page per
 * STRATEGY.md §13.9. Mode badge is large and color-coded (paper=blue,
 * live=red-orange). The "MODE CHANGE PENDING — RESTART REQUIRED" banner
 * appears when state.mode_change_pending is true.
 *
 * Live BTC/ETH/SOL prices stream in from the public Coinbase Exchange WS.
 */

export interface HeaderProps {
  mode: "paper" | "live";
  modeChangePending?: boolean;
  phase?: "paper" | "half" | "full" | "paused" | "halted";
  regime?: "bull" | "chop" | "bear" | null;
  daysInRegime?: number | null;
  paused?: boolean;
}

const PHASE_LABEL: Record<NonNullable<HeaderProps["phase"]>, string> = {
  paper: "Phase 1 · Paper",
  half: "Phase 2 · Half-size live",
  full: "Phase 3 · Full live",
  paused: "Paused",
  halted: "Halted",
};

const REGIME_TONE = {
  bull: { tone: "success" as const, label: "Bull" },
  chop: { tone: "warning" as const, label: "Chop" },
  bear: { tone: "danger" as const, label: "Bear" },
};

export function Header(props: HeaderProps) {
  const regimeInfo = props.regime ? REGIME_TONE[props.regime] : null;

  return (
    <header className="surface-2 border-b border-x-0 border-t-0 px-6 py-3 flex flex-col gap-2">
      {/* MODE CHANGE PENDING banner — full width when active so it's impossible to miss */}
      {props.modeChangePending && (
        <div className="flex items-center gap-2 px-3 py-1.5 -mx-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)] text-[var(--color-warning)] text-xs font-medium">
          <StatusDot tone="warning" pulse />
          MODE CHANGE PENDING — RESTART REQUIRED
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <Badge variant={props.mode} size="lg" className="uppercase tracking-wider">
          <StatusDot tone={props.mode} pulse />
          {props.mode}
        </Badge>

        {props.phase && (
          <span className="text-xs text-[var(--color-text-muted)]">
            {PHASE_LABEL[props.phase]}
          </span>
        )}

        {regimeInfo && (
          <Badge variant={regimeInfo.tone} size="md" className="font-medium">
            <StatusDot tone={regimeInfo.tone} />
            {regimeInfo.label}
            {props.daysInRegime != null && (
              <span className="text-[var(--color-text-muted)] tnum">
                · {props.daysInRegime}d
              </span>
            )}
          </Badge>
        )}

        {props.paused && (
          <Badge variant="warning" size="md">
            <StatusDot tone="warning" pulse />
            Paused
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-3">
          <ActivityIndicator />
          <PriceTicker />
        </div>
      </div>
    </header>
  );
}
