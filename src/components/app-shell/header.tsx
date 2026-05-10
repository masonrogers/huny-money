"use client";

import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { PriceTicker } from "./price-ticker";
import { ActivityIndicator } from "./activity-indicator";
import { useApi } from "@/lib/hooks/api";
import { formatUsd, formatPct } from "@/lib/utils/format";
import type { WalletPayload } from "@/app/api/dashboard/wallet/route";

/**
 * Top header strip — the most prominent element on every page per
 * STRATEGY.md §13.9. Mode badge is large and color-coded (paper=blue,
 * live=red-orange). The "MODE CHANGE PENDING — RESTART REQUIRED" banner
 * appears when state.mode_change_pending is true.
 *
 * Always shows two value badges:
 *   - Paper equity (synthetic) — bot's current paper portfolio value + return %
 *   - Coinbase wallet (real) — your actual wallet total, informational
 * The two are separate ledgers — the bot's paper world never references the
 * real wallet (STRATEGY.md §13.6).
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
  const { data: wallet } = useApi<WalletPayload>("/api/dashboard/wallet", {
    refreshInterval: 30_000,
  });

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

        {/* Value pills — always visible, the two ledgers always shown side by side */}
        <PaperEquityPill wallet={wallet} />
        <CoinbaseWalletPill wallet={wallet} />

        <div className="ml-auto flex items-center gap-3">
          <ActivityIndicator />
          <PriceTicker />
        </div>
      </div>
    </header>
  );
}

function PaperEquityPill({ wallet }: { wallet: WalletPayload | undefined }) {
  const equity = wallet?.paper.equityUsd;
  const ret = wallet?.paper.returnPct;
  const tone = ret == null ? "default" : ret >= 0 ? "success" : "danger";
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-xs"
      title="Synthetic paper portfolio — separate from your real Coinbase wallet."
    >
      <span className="text-[var(--color-text-muted)] uppercase tracking-wider text-[10px]">
        Paper
      </span>
      <span className="tnum font-medium text-[var(--color-text-primary)]">
        {equity != null ? formatUsd(equity) : "—"}
      </span>
      {ret != null && (
        <Badge variant={tone === "success" ? "success" : "danger"} size="sm">
          {formatPct(ret, true)}
        </Badge>
      )}
    </div>
  );
}

function CoinbaseWalletPill({ wallet }: { wallet: WalletPayload | undefined }) {
  const total = wallet?.coinbase.totalUsd;
  const available = wallet?.coinbase.available ?? false;
  const tooltip = available
    ? "Real Coinbase wallet total — informational only. The bot does NOT trade against this in paper mode."
    : wallet?.coinbase.error
      ? `Coinbase snapshot unavailable: ${wallet.coinbase.error}`
      : "Loading Coinbase wallet…";
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-xs"
      title={tooltip}
    >
      <span className="text-[var(--color-text-muted)] uppercase tracking-wider text-[10px]">
        Wallet
      </span>
      <span className="tnum font-medium text-[var(--color-text-primary)]">
        {total != null ? formatUsd(total) : available ? "—" : "·"}
      </span>
    </div>
  );
}
