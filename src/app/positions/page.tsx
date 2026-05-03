"use client";

import { useState } from "react";
import { usePositions } from "@/lib/hooks/use-api";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

const pnlColor = (v: number) =>
  v >= 0 ? "text-emerald-400" : "text-red-400";

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-700 ${className}`} />
  );
}

export default function PositionsPage() {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const { data, error, isLoading } = usePositions(tab);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Positions</h2>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab("open")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === "open"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Open Positions
        </button>
        <button
          onClick={() => setTab("closed")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === "closed"
              ? "bg-gray-700 text-white"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Closed Positions
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-3"
            >
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-900/30 border border-red-700 p-5 text-red-300">
          Failed to load positions
        </div>
      ) : tab === "open" ? (
        /* Open Positions Grid */
        data?.positions?.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {data.positions.map(
              (pos: {
                id: number;
                asset: string;
                type: string;
                entryPrice: number;
                currentPrice: number;
                unrealizedPnlUsd: number;
                unrealizedPnlPct: number;
                stopLoss: number;
                takeProfitTarget: number;
                currentConviction: number;
                convictionAtEntry: number;
                daysHeld: number;
                costBasis: number;
                positionValueUsd: number;
                thesis: string | null;
              }) => (
                <div
                  key={pos.id}
                  className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-4"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-white">
                        {pos.asset}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          pos.type === "core"
                            ? "bg-blue-900/50 text-blue-300 border border-blue-700/50"
                            : "bg-purple-900/50 text-purple-300 border border-purple-700/50"
                        }`}
                      >
                        {pos.type.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {pos.daysHeld}d held
                    </span>
                  </div>

                  {/* Prices */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500 text-xs">Entry</p>
                      <p className="text-gray-200 font-mono">
                        {fmt.format(pos.entryPrice)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Current</p>
                      <p className="text-gray-200 font-mono">
                        {fmt.format(pos.currentPrice)}
                      </p>
                    </div>
                  </div>

                  {/* P&L */}
                  <div className="flex items-center justify-between bg-gray-900/50 rounded-lg p-3">
                    <span className="text-xs text-gray-500">Unrealized P&L</span>
                    <div className="text-right">
                      <span
                        className={`text-lg font-bold ${pnlColor(
                          pos.unrealizedPnlUsd
                        )}`}
                      >
                        {fmt.format(pos.unrealizedPnlUsd)}
                      </span>
                      <span
                        className={`ml-2 text-sm ${pnlColor(
                          pos.unrealizedPnlPct
                        )}`}
                      >
                        {pct(pos.unrealizedPnlPct)}
                      </span>
                    </div>
                  </div>

                  {/* Stop / TP */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500 text-xs">Stop Loss</p>
                      <p className="text-red-400 font-mono">
                        {fmt.format(pos.stopLoss)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Take Profit</p>
                      <p className="text-emerald-400 font-mono">
                        {fmt.format(pos.takeProfitTarget)}
                      </p>
                    </div>
                  </div>

                  {/* Conviction */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-500">Conviction</span>
                      <span className="text-gray-300 font-mono">
                        {pos.currentConviction}/100
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          pos.currentConviction >= 70
                            ? "bg-emerald-500"
                            : pos.currentConviction >= 40
                            ? "bg-yellow-500"
                            : "bg-red-500"
                        }`}
                        style={{
                          width: `${Math.min(pos.currentConviction, 100)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Value */}
                  <div className="text-xs text-gray-500 flex justify-between">
                    <span>Size: {fmt.format(pos.positionValueUsd)}</span>
                    <span>Cost: {fmt.format(pos.costBasis)}</span>
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <p className="text-gray-500">No open positions</p>
        )
      ) : /* Closed Positions Table */
      data?.positions?.length > 0 ? (
        <div className="rounded-xl bg-gray-800 border border-gray-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Entry</th>
                <th className="px-4 py-3">Exit</th>
                <th className="px-4 py-3">P&L</th>
                <th className="px-4 py-3">Exit Reason</th>
                <th className="px-4 py-3">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {data.positions.map(
                (pos: {
                  id: number;
                  asset: string;
                  type: string;
                  entryPrice: number;
                  exitPrice: number;
                  netPnl: number;
                  exitReason: string;
                  daysHeld: number;
                }) => (
                  <tr
                    key={pos.id}
                    className="hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {pos.asset}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          pos.type === "core"
                            ? "bg-blue-900/50 text-blue-300"
                            : "bg-purple-900/50 text-purple-300"
                        }`}
                      >
                        {pos.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-300">
                      {fmt.format(pos.entryPrice)}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-300">
                      {pos.exitPrice ? fmt.format(pos.exitPrice) : "--"}
                    </td>
                    <td
                      className={`px-4 py-3 font-mono font-medium ${pnlColor(
                        pos.netPnl
                      )}`}
                    >
                      {pos.netPnl != null ? fmt.format(pos.netPnl) : "--"}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {pos.exitReason?.replace(/_/g, " ") || "--"}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {pos.daysHeld}d
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500">No closed positions</p>
      )}
    </div>
  );
}
