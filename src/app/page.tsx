"use client";

import { usePortfolio, useAlerts } from "@/lib/hooks/use-api";
import { useCoinbaseTicker, type TickerData } from "@/lib/hooks/use-coinbase-ticker";
import { useEffect, useRef, useState } from "react";

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

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

const regimeColors: Record<string, string> = {
  strong_bull: "bg-emerald-600 text-emerald-50",
  mild_bull: "bg-emerald-800 text-emerald-100",
  ranging: "bg-yellow-700 text-yellow-100",
  mild_bear: "bg-red-800 text-red-100",
  strong_bear: "bg-red-600 text-red-50",
};

const severityColors: Record<string, string> = {
  info: "border-blue-500 bg-blue-500/10 text-blue-300",
  warning: "border-amber-500 bg-amber-500/10 text-amber-300",
  critical: "border-red-500 bg-red-500/10 text-red-300",
};

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-gray-700 ${className}`} />;
}

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

  const formatted =
    symbol === "BTC"
      ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : symbol === "ETH"
        ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : price.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

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

function LivePriceCard({ symbol, ticker }: { symbol: string; ticker: TickerData | undefined }) {
  const isUp = ticker && ticker.changePct24h >= 0;

  return (
    <div className="rounded-xl bg-gray-800 border border-gray-700 p-5 flex flex-col gap-2">
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
            {pct(ticker.changePct24h)}
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
    </div>
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
      <span className="text-[10px] font-bold text-white">
        {symbol[0]}
      </span>
    </div>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
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

export default function DashboardPage() {
  const { data: portfolio, error: pErr, isLoading: pLoad } = usePortfolio();
  const { data: alertsData, error: aErr, isLoading: aLoad } = useAlerts();
  const { tickers, connected } = useCoinbaseTicker();

  return (
    <div className="space-y-6">
      {/* Live Prices */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <ConnectionDot connected={connected} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <LivePriceCard symbol="BTC" ticker={tickers.BTC} />
        <LivePriceCard symbol="ETH" ticker={tickers.ETH} />
        <LivePriceCard symbol="SOL" ticker={tickers.SOL} />
      </div>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {pLoad ? (
          <>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl bg-gray-800 border border-gray-700 p-5">
                <Skeleton className="h-4 w-24 mb-3" />
                <Skeleton className="h-8 w-32" />
              </div>
            ))}
          </>
        ) : pErr ? (
          <div className="col-span-4 rounded-xl bg-red-900/30 border border-red-700 p-5 text-red-300">
            Failed to load portfolio data
          </div>
        ) : portfolio ? (
          <>
            <div className="rounded-xl bg-gray-800 border border-gray-700 p-5">
              <p className="text-sm text-gray-400 mb-1">Total Value</p>
              <p className="text-2xl font-bold text-white">
                {fmt.format(portfolio.totalValueUsd)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Peak: {fmt.format(portfolio.peakValueUsd)}
              </p>
            </div>
            <div className="rounded-xl bg-gray-800 border border-gray-700 p-5">
              <p className="text-sm text-gray-400 mb-1">Cash Available</p>
              <p className="text-2xl font-bold text-white">
                {fmt.format(portfolio.cashUsd)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Deployable: {fmt.format(portfolio.remainingDeployableUsd)}
              </p>
            </div>
            <div className="rounded-xl bg-gray-800 border border-gray-700 p-5">
              <p className="text-sm text-gray-400 mb-1">Deployed</p>
              <p className="text-2xl font-bold text-white">
                {pct(portfolio.exposurePct).replace("+", "")}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Cap: {pct(portfolio.regimeExposureCapPct).replace("+", "")} | Drawdown:{" "}
                {pct(portfolio.drawdownFromPeakPct).replace("+", "")}
              </p>
            </div>
            <div className="rounded-xl bg-gray-800 border border-gray-700 p-5">
              <p className="text-sm text-gray-400 mb-1">Regime</p>
              <p className="mt-1">
                <span
                  className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
                    regimeColors[portfolio.regime] || "bg-gray-700 text-gray-200"
                  }`}
                >
                  {portfolio.regime?.replace(/_/g, " ").toUpperCase()}
                </span>
              </p>
              {(portfolio.softBreakerActive || portfolio.hardBreakerActive) && (
                <p className="text-xs text-red-400 mt-2">
                  {portfolio.hardBreakerActive
                    ? "Hard breaker active"
                    : "Soft breaker active"}
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>

      {/* System Status + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
            System Status
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Paper Mode</span>
              {portfolio?.paperMode ? (
                <span className="inline-flex items-center rounded-full bg-amber-900/50 border border-amber-600/40 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                  ENABLED
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-emerald-900/50 border border-emerald-600/40 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                  LIVE
                </span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Trading Paused</span>
              {portfolio?.tradingPaused ? (
                <span className="inline-flex items-center rounded-full bg-red-900/50 border border-red-600/40 px-2.5 py-0.5 text-xs font-medium text-red-300">
                  YES
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-gray-700 border border-gray-600 px-2.5 py-0.5 text-xs font-medium text-gray-300">
                  NO
                </span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Strategy Version</span>
              <span className="text-sm text-white font-mono">
                {portfolio?.strategyVersion ?? "--"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Open Positions</span>
              <span className="text-sm text-white font-mono">
                {portfolio?.positions?.length ?? 0}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">
            Recent Alerts
          </h3>
          {aLoad ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : aErr ? (
            <p className="text-sm text-red-400">Failed to load alerts</p>
          ) : alertsData?.alerts?.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {alertsData.alerts.slice(0, 5).map(
                (alert: {
                  id: number;
                  severity: string;
                  type: string;
                  message: string;
                  createdAt: string;
                }) => (
                  <div
                    key={alert.id}
                    className={`rounded-lg border-l-4 p-3 text-sm ${
                      severityColors[alert.severity] ||
                      "border-gray-500 bg-gray-700/50 text-gray-300"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-medium text-xs uppercase">
                        {alert.type.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs opacity-70">
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(alert.createdAt))}
                      </span>
                    </div>
                    <p className="text-xs opacity-80">{alert.message}</p>
                  </div>
                )
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No unacknowledged alerts</p>
          )}
        </div>
      </div>
    </div>
  );
}
