"use client";

import {
  usePortfolio,
  useAlerts,
  usePositions,
  useEvaluations,
  useRegime,
} from "@/lib/hooks/use-api";
import {
  useCoinbaseTicker,
  type TickerData,
} from "@/lib/hooks/use-coinbase-ticker";
import { useEffect, useRef, useState } from "react";

// ─── Formatters ────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const pctSigned = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const pctUnsigned = (v: number) => `${Math.abs(v).toFixed(2)}%`;

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

// ─── Lookups ───────────────────────────────────────────────────────────────────

const REGIME_INFO: Record<
  string,
  { label: string; description: string; color: string; borderColor: string }
> = {
  strong_bull: {
    label: "Strong Bull",
    description:
      "Strong uptrend detected across markets. Aggressive positioning allowed, up to 70% capital deployed.",
    color: "bg-emerald-900/40 text-emerald-200",
    borderColor: "border-emerald-500/50",
  },
  mild_bull: {
    label: "Mild Bull",
    description:
      "Moderate uptrend with some momentum. Standard positioning, up to 50% capital deployed.",
    color: "bg-emerald-900/20 text-emerald-300",
    borderColor: "border-emerald-600/40",
  },
  ranging: {
    label: "Ranging",
    description:
      "Sideways market with no clear trend. Conservative positioning, up to 50% capital deployed. Waiting for directional clarity.",
    color: "bg-yellow-900/20 text-yellow-200",
    borderColor: "border-yellow-600/40",
  },
  mild_bear: {
    label: "Mild Bear",
    description:
      "Moderate downtrend developing. Defensive positioning only, maximum 30% capital deployed.",
    color: "bg-red-900/20 text-red-300",
    borderColor: "border-red-600/40",
  },
  strong_bear: {
    label: "Strong Bear",
    description:
      "Strong downtrend or crisis conditions. Minimal exposure, maximum 10% capital deployed. Capital preservation is priority.",
    color: "bg-red-900/40 text-red-200",
    borderColor: "border-red-500/50",
  },
};

const EVAL_TYPE_LABELS: Record<string, { label: string; description: string }> =
  {
    daily_l1l2: {
      label: "Full Analysis",
      description: "Daily macro regime assessment + trade evaluation",
    },
    swing_l2: {
      label: "Trade Check",
      description: "8-hour swing trade evaluation",
    },
    emergency: {
      label: "Emergency",
      description: "Triggered by a large sudden price movement",
    },
  };

const ALERT_TYPE_LABELS: Record<string, string> = {
  emergency_evaluation: "Emergency Evaluation",
  emergency_threshold: "Price Alert",
  circuit_breaker_hard: "Hard Circuit Breaker",
  regime_change: "Regime Change",
  reconciliation_discrepancy: "Reconciliation Issue",
  strategy_modification: "Strategy Updated",
  order_filled: "Order Filled",
  order_failed: "Order Failed",
  order_cancelled: "Order Cancelled",
  entry_filled: "Entry Filled",
  position_closed: "Position Closed",
  missing_stop_after_fill: "Missing Stop Loss",
  balance_discrepancy: "Balance Mismatch",
  missed_evaluation: "Missed Evaluation",
  emergency_stop_placed: "Emergency Stop Placed",
  emergency_stop_failed: "Emergency Stop Failed",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "border-l-blue-500 bg-blue-500/5",
  warning: "border-l-amber-500 bg-amber-500/5",
  critical: "border-l-red-500 bg-red-500/5",
};

// ─── Evaluation helpers ────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function summarizeEvalDecisions(evalData: any): string {
  if (!evalData?.opusResponse) return "No data available";
  const resp = evalData.opusResponse;

  if (resp.parse_error || resp.raw) return "Could not parse AI response";

  const l2 = resp.layer_2;
  if (!l2) return "Evaluation completed";

  const parts: string[] = [];

  const holds = l2.existing_positions?.filter(
    (p: any) => p.action === "hold"
  )?.length;
  const exits = l2.existing_positions?.filter(
    (p: any) => p.action === "exit"
  )?.length;
  const reduces = l2.existing_positions?.filter(
    (p: any) => p.action === "reduce"
  )?.length;

  if (exits > 0) parts.push(`Exit ${exits} position${exits > 1 ? "s" : ""}`);
  if (reduces > 0)
    parts.push(`Reduce ${reduces} position${reduces > 1 ? "s" : ""}`);
  if (l2.new_trades?.length > 0) {
    const assets = l2.new_trades.map((t: any) => t.asset).join(", ");
    parts.push(`New trade${l2.new_trades.length > 1 ? "s" : ""}: ${assets}`);
  }
  if (holds > 0 && parts.length === 0)
    parts.push("Hold — no changes recommended");
  if (parts.length === 0) parts.push("No positions, no new opportunities found");

  return parts.join(" · ");
}

function getEvalStrategyNotes(evalData: any): string | null {
  const notes = evalData?.opusResponse?.layer_2?.strategy_notes;
  if (!notes || typeof notes !== "string") return null;
  return notes;
}

function getEvalMacroSummary(evalData: any): string | null {
  const summary = evalData?.opusResponse?.layer_1?.macro_summary;
  if (!summary || typeof summary !== "string") return null;
  return summary;
}

function getNextEvalCountdown(lastEvalTime: string | null): string {
  if (!lastEvalTime) return "unknown";
  const last = new Date(lastEvalTime).getTime();
  const interval = 8 * 60 * 60 * 1000;
  const next = last + interval;
  const diff = next - Date.now();

  if (diff <= 0) return "overdue";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `~${hours}h ${mins}m`;
  return `~${mins}m`;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Shared Components ─────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-700 ${className}`} />;
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl bg-gray-800 border border-gray-700 p-5 ${className}`}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
      {children}
    </h3>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="text-center py-6">
      <p className="text-sm font-medium text-gray-400">{title}</p>
      <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
        {description}
      </p>
    </div>
  );
}

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-500">
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"
        }`}
      />
      {connected ? "Live" : "Reconnecting..."}
    </span>
  );
}

function CryptoIcon({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = {
    BTC: "bg-orange-500",
    ETH: "bg-blue-500",
    SOL: "bg-purple-500",
  };
  return (
    <div
      className={`w-6 h-6 rounded-full ${colors[symbol] || "bg-gray-500"} flex items-center justify-center`}
    >
      <span className="text-[10px] font-bold text-white">{symbol[0]}</span>
    </div>
  );
}

function ConvictionBar({ value }: { value: number }) {
  const color =
    value >= 70
      ? "bg-emerald-500"
      : value >= 50
        ? "bg-yellow-500"
        : "bg-gray-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 tabular-nums w-7 text-right">
        {value}
      </span>
    </div>
  );
}

// ─── Live Price Card ───────────────────────────────────────────────────────────

function PriceFlash({ price, symbol }: { price: number; symbol: string }) {
  const prevPrice = useRef(price);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (price > prevPrice.current) setFlash("up");
    else if (price < prevPrice.current) setFlash("down");
    prevPrice.current = price;
    const t = setTimeout(() => setFlash(null), 300);
    return () => clearTimeout(t);
  }, [price]);

  const decimals = symbol === "SOL" ? 3 : 2;
  const formatted = price.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span
      className={`tabular-nums transition-colors duration-300 ${
        flash === "up"
          ? "text-emerald-400"
          : flash === "down"
            ? "text-red-400"
            : "text-white"
      }`}
    >
      ${formatted}
    </span>
  );
}

function LivePriceCard({
  symbol,
  ticker,
}: {
  symbol: string;
  ticker: TickerData | undefined;
}) {
  const isUp = ticker && ticker.changePct24h >= 0;

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CryptoIcon symbol={symbol} />
          <span className="text-sm font-semibold text-gray-300">{symbol}</span>
        </div>
        {ticker && (
          <span
            className={`text-sm font-semibold tabular-nums ${
              isUp ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {pctSigned(ticker.changePct24h)}
          </span>
        )}
      </div>
      <div className="text-3xl font-bold tracking-tight">
        {ticker ? (
          <PriceFlash price={ticker.price} symbol={symbol} />
        ) : (
          <Skeleton className="h-9 w-40" />
        )}
      </div>
      {ticker && (
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span>H {fmtCompact.format(ticker.high24h)}</span>
          <span>L {fmtCompact.format(ticker.low24h)}</span>
          <span>Vol {formatVolume(ticker.volume24h)}</span>
        </div>
      )}
    </Card>
  );
}

// ─── Portfolio & System Section ────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function PortfolioSection({
  portfolio,
  lastEvalTime,
}: {
  portfolio: any;
  lastEvalTime: string | null;
}) {
  if (!portfolio) return null;

  const startingCapital = 500;
  const totalReturn = portfolio.totalValueUsd - startingCapital;
  const totalReturnPct = (totalReturn / startingCapital) * 100;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <SectionTitle>Portfolio</SectionTitle>
        <div className="space-y-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-white">
                {fmt.format(portfolio.totalValueUsd)}
              </span>
              <span
                className={`text-sm font-semibold ${totalReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {pctSigned(totalReturnPct)}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Started with {fmt.format(startingCapital)} · Peak{" "}
              {fmt.format(portfolio.peakValueUsd)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500">Cash</p>
              <p className="text-sm font-semibold text-white">
                {fmt.format(portfolio.cashUsd)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Deployed</p>
              <p className="text-sm font-semibold text-white">
                {pctUnsigned(portfolio.exposurePct)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Exposure Cap</p>
              <p className="text-sm font-semibold text-white">
                {pctUnsigned(portfolio.regimeExposureCapPct)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Drawdown</p>
              <p
                className={`text-sm font-semibold ${portfolio.drawdownFromPeakPct > 10 ? "text-red-400" : "text-white"}`}
              >
                {pctUnsigned(portfolio.drawdownFromPeakPct)}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>System</SectionTitle>
        <div className="space-y-3">
          <Row label="Model" value="Claude Opus 4.7" sub="Extended Thinking" />
          <Row
            label="Mode"
            value={portfolio.paperMode ? "Paper Trading" : "Live Trading"}
            badge={
              portfolio.paperMode
                ? { text: "SIMULATED", color: "text-amber-300 bg-amber-900/50 border-amber-600/40" }
                : { text: "REAL MONEY", color: "text-red-300 bg-red-900/50 border-red-500/60" }
            }
          />
          <Row
            label="Next Evaluation"
            value={getNextEvalCountdown(lastEvalTime)}
          />
          <Row
            label="Strategy"
            value={`v${portfolio.strategyVersion || "1.0"}`}
          />
          <Row
            label="Circuit Breakers"
            value={
              portfolio.hardBreakerActive
                ? "HARD BREAKER ACTIVE"
                : portfolio.softBreakerActive
                  ? "Soft breaker active"
                  : "None"
            }
            valueColor={
              portfolio.hardBreakerActive
                ? "text-red-400"
                : portfolio.softBreakerActive
                  ? "text-amber-400"
                  : "text-gray-300"
            }
          />
          <Row
            label="Status"
            value={portfolio.tradingPaused ? "Paused" : "Active"}
            valueColor={
              portfolio.tradingPaused ? "text-red-400" : "text-emerald-400"
            }
          />
        </div>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  sub,
  badge,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  badge?: { text: string; color: string };
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-400">{label}</span>
      <div className="flex items-center gap-2">
        {badge && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.color}`}
          >
            {badge.text}
          </span>
        )}
        <div className="text-right">
          <span className={`text-sm font-medium ${valueColor || "text-white"}`}>
            {value}
          </span>
          {sub && (
            <span className="block text-[10px] text-gray-500">{sub}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Market Regime Section ─────────────────────────────────────────────────────

function RegimeSection({
  regime,
  regimeData,
}: {
  regime: string | undefined;
  regimeData: any;
}) {
  const info = REGIME_INFO[regime || ""] || {
    label: regime?.replace(/_/g, " ") || "Unknown",
    description: "No regime data available yet.",
    color: "bg-gray-800 text-gray-300",
    borderColor: "border-gray-600",
  };

  return (
    <Card className={`border ${info.borderColor}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <SectionTitle>Market Regime</SectionTitle>
          <span
            className={`inline-flex rounded-full px-3 py-0.5 text-xs font-bold ${info.color}`}
          >
            {info.label}
          </span>
        </div>
        {regimeData?.assessedAt && (
          <span className="text-xs text-gray-500">
            Assessed {timeAgo(regimeData.assessedAt)}
          </span>
        )}
      </div>

      <p className="text-sm text-gray-300 mb-3">{info.description}</p>

      {regimeData?.regimeEvidence && (
        <div className="rounded-lg bg-gray-900/50 p-3">
          <p className="text-xs text-gray-500 mb-1 font-medium">
            AI Assessment
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            {regimeData.regimeEvidence}
          </p>
        </div>
      )}
    </Card>
  );
}

// ─── AI Outlook Section ────────────────────────────────────────────────────────

function AIOutlookSection({
  regimeData,
  latestEval,
}: {
  regimeData: any;
  latestEval: any;
}) {
  const theses = regimeData?.theses;
  const macroSummary = getEvalMacroSummary(latestEval);
  const strategyNotes = getEvalStrategyNotes(latestEval);

  return (
    <Card>
      <div className="flex items-start justify-between mb-4">
        <SectionTitle>AI Outlook</SectionTitle>
        {latestEval && (
          <div className="text-right">
            <span className="text-xs text-gray-500">
              Last evaluation {timeAgo(latestEval.timestamp)}
            </span>
            <span className="block text-[10px] text-gray-600">
              {EVAL_TYPE_LABELS[latestEval.type]?.label || latestEval.type}
            </span>
          </div>
        )}
      </div>

      {latestEval && (
        <div className="rounded-lg bg-gray-900/50 p-3 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-300">
              Latest Decision
            </span>
          </div>
          <p className="text-sm text-gray-300">
            {summarizeEvalDecisions(latestEval)}
          </p>
          {macroSummary && (
            <p className="text-xs text-gray-500 mt-2 leading-relaxed">
              {macroSummary}
            </p>
          )}
          {strategyNotes && (
            <p className="text-xs text-gray-500 mt-1 italic leading-relaxed">
              {strategyNotes}
            </p>
          )}
        </div>
      )}

      {!latestEval && !theses?.length && (
        <EmptyState
          title="No evaluations yet"
          description="The bot is still initializing. The first evaluation will run within 8 hours of startup, analyzing market conditions and building an initial thesis for each asset."
        />
      )}

      {theses?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2">
            Active Theses
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {theses.map(
              (thesis: {
                asset: string;
                thesisText: string;
                conviction: number;
                supportingEvidence: string;
                counterEvidence: string;
              }) => (
                <div
                  key={thesis.asset}
                  className="rounded-lg bg-gray-900/50 p-3"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <CryptoIcon symbol={thesis.asset} />
                    <span className="text-sm font-semibold text-white">
                      {thesis.asset}
                    </span>
                  </div>
                  <p className="text-xs text-gray-300 mb-2 leading-relaxed">
                    {thesis.thesisText}
                  </p>
                  <div className="mb-1">
                    <p className="text-[10px] text-gray-500 mb-0.5">
                      Conviction
                    </p>
                    <ConvictionBar value={thesis.conviction} />
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {!theses?.length && latestEval && (
        <EmptyState
          title="No active theses"
          description="The bot hasn't formed directional views on any assets yet. Theses develop after the daily macro analysis identifies opportunities worth watching."
        />
      )}
    </Card>
  );
}

// ─── Positions Section ─────────────────────────────────────────────────────────

function PositionsSection({ positions }: { positions: any[] | undefined }) {
  if (!positions || positions.length === 0) {
    return (
      <Card>
        <SectionTitle>Open Positions</SectionTitle>
        <EmptyState
          title="No open positions"
          description="The bot is waiting for high-conviction opportunities that align with the current market regime. Positions are only opened when conviction exceeds 60% and risk/reward is at least 2:1."
        />
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Open Positions</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-700">
              <th className="text-left pb-2 font-medium">Asset</th>
              <th className="text-right pb-2 font-medium">Entry</th>
              <th className="text-right pb-2 font-medium">Current</th>
              <th className="text-right pb-2 font-medium">P&L</th>
              <th className="text-right pb-2 font-medium">Stop</th>
              <th className="text-right pb-2 font-medium">Target</th>
              <th className="text-right pb-2 font-medium">Days</th>
              <th className="text-left pb-2 pl-4 font-medium">Thesis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {positions.map((pos: any) => {
              const pnlColor =
                (pos.unrealizedPnlUsd ?? 0) >= 0
                  ? "text-emerald-400"
                  : "text-red-400";
              return (
                <tr key={pos.id}>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <CryptoIcon symbol={pos.asset} />
                      <div>
                        <span className="font-medium text-white">
                          {pos.asset}
                        </span>
                        <span className="block text-[10px] text-gray-500">
                          {pos.type} · {pos.direction}
                          {pos.isPaper && " · paper"}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="text-right text-gray-300 tabular-nums">
                    {fmt.format(pos.entryPrice)}
                  </td>
                  <td className="text-right text-white tabular-nums font-medium">
                    {pos.currentPrice ? fmt.format(pos.currentPrice) : "—"}
                  </td>
                  <td className={`text-right tabular-nums font-medium ${pnlColor}`}>
                    {pos.unrealizedPnlUsd != null ? (
                      <>
                        {fmt.format(pos.unrealizedPnlUsd)}
                        <span className="block text-[10px]">
                          {pctSigned(pos.unrealizedPnlPct ?? 0)}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-right text-gray-400 tabular-nums">
                    {pos.stopLoss ? fmt.format(pos.stopLoss) : "—"}
                  </td>
                  <td className="text-right text-gray-400 tabular-nums">
                    {pos.takeProfitTarget
                      ? fmt.format(pos.takeProfitTarget)
                      : "—"}
                  </td>
                  <td className="text-right text-gray-400 tabular-nums">
                    {pos.daysHeld ?? "—"}
                  </td>
                  <td className="pl-4 max-w-[200px]">
                    <p className="text-xs text-gray-400 truncate">
                      {pos.thesis || pos.catalyst || "—"}
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Recent Activity Section ───────────────────────────────────────────────────

interface ActivityItem {
  id: string;
  time: string;
  type: "evaluation" | "alert";
  label: string;
  description: string;
  severity?: string;
}

function buildActivityFeed(
  evaluations: any[] | undefined,
  alerts: any[] | undefined
): ActivityItem[] {
  const items: ActivityItem[] = [];

  if (evaluations) {
    for (const ev of evaluations.slice(0, 8)) {
      const typeInfo = EVAL_TYPE_LABELS[ev.type] || {
        label: ev.type,
        description: "",
      };
      items.push({
        id: `eval-${ev.id}`,
        time: ev.timestamp,
        type: "evaluation",
        label: typeInfo.label,
        description: summarizeEvalDecisions(ev),
      });
    }
  }

  if (alerts) {
    for (const alert of alerts.slice(0, 8)) {
      items.push({
        id: `alert-${alert.id}`,
        time: alert.createdAt,
        type: "alert",
        label: ALERT_TYPE_LABELS[alert.type] || alert.type.replace(/_/g, " "),
        description: alert.message,
        severity: alert.severity,
      });
    }
  }

  items.sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
  );
  return items.slice(0, 10);
}

function ActivitySection({
  evaluations,
  alerts,
}: {
  evaluations: any[] | undefined;
  alerts: any[] | undefined;
}) {
  const items = buildActivityFeed(evaluations, alerts);

  return (
    <Card>
      <SectionTitle>Recent Activity</SectionTitle>
      {items.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Activity will appear here as the bot runs evaluations, opens positions, and responds to market events."
        />
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex items-start gap-3 rounded-lg px-3 py-2 border-l-2 ${
                item.type === "evaluation"
                  ? "border-l-indigo-500 bg-indigo-500/5"
                  : SEVERITY_STYLES[item.severity || "info"] ||
                    "border-l-gray-500"
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full mt-1 ${
                    item.type === "evaluation"
                      ? "bg-indigo-400"
                      : item.severity === "critical"
                        ? "bg-red-400"
                        : item.severity === "warning"
                          ? "bg-amber-400"
                          : "bg-blue-400"
                  }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-300">
                    {item.label}
                  </span>
                  <span className="text-[10px] text-gray-600 flex-shrink-0">
                    {timeAgo(item.time)}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Dashboard Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: portfolio, error: pErr, isLoading: pLoad } = usePortfolio();
  const { data: alertsData } = useAlerts();
  const {
    data: positionsData,
  } = usePositions("open");
  const { data: evalsData } = useEvaluations();
  const { data: regimeData } = useRegime();
  const { tickers, connected } = useCoinbaseTicker();

  const latestEval = evalsData?.evaluations?.[0] || null;
  const lastEvalTime = latestEval?.timestamp || null;

  return (
    <div className="space-y-5">
      {/* Header + Live Prices */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <ConnectionDot connected={connected} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <LivePriceCard symbol="BTC" ticker={tickers.BTC} />
        <LivePriceCard symbol="ETH" ticker={tickers.ETH} />
        <LivePriceCard symbol="SOL" ticker={tickers.SOL} />
      </div>

      {/* Portfolio + System */}
      {pLoad ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <Skeleton className="h-4 w-20 mb-4" />
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-4 w-48" />
          </Card>
          <Card>
            <Skeleton className="h-4 w-20 mb-4" />
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </Card>
        </div>
      ) : pErr ? (
        <Card>
          <p className="text-sm text-red-400">
            Failed to load portfolio data. The database may be unreachable.
          </p>
        </Card>
      ) : portfolio ? (
        <PortfolioSection
          portfolio={portfolio}
          lastEvalTime={lastEvalTime}
        />
      ) : null}

      {/* Market Regime */}
      <RegimeSection regime={portfolio?.regime} regimeData={regimeData} />

      {/* AI Outlook */}
      <AIOutlookSection regimeData={regimeData} latestEval={latestEval} />

      {/* Open Positions */}
      <PositionsSection positions={positionsData?.positions} />

      {/* Recent Activity */}
      <ActivitySection
        evaluations={evalsData?.evaluations}
        alerts={alertsData?.alerts}
      />
    </div>
  );
}
