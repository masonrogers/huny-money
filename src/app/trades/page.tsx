"use client";

import { useState } from "react";
import { useTrades } from "@/lib/hooks/use-api";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pnlColor = (v: number) =>
  v >= 0 ? "text-emerald-400" : "text-red-400";

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-700 ${className}`} />
  );
}

export default function TradesPage() {
  const [page, setPage] = useState(1);
  const { data, error, isLoading } = useTrades(page);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Trade History</h2>

      {isLoading ? (
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-900/30 border border-red-700 p-5 text-red-300">
          Failed to load trades
        </div>
      ) : data?.trades?.length > 0 ? (
        <>
          <div className="rounded-xl bg-gray-800 border border-gray-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-gray-400 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Entry</th>
                  <th className="px-4 py-3">Exit</th>
                  <th className="px-4 py-3">Gross P&L</th>
                  <th className="px-4 py-3">Net P&L</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Exit Reason</th>
                  <th className="px-4 py-3">Version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {data.trades.map(
                  (trade: {
                    id: number;
                    asset: string;
                    type: string;
                    entry_price: number;
                    exit_price: number;
                    gross_pnl: number;
                    net_pnl: number;
                    hold_duration_days: number;
                    exit_reason: string;
                    strategy_version: string;
                    closed_at: string;
                  }) => (
                    <tr
                      key={trade.id}
                      className="hover:bg-gray-700/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-white">
                        {trade.asset}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            trade.type === "core"
                              ? "bg-blue-900/50 text-blue-300"
                              : "bg-purple-900/50 text-purple-300"
                          }`}
                        >
                          {trade.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-300">
                        {fmt.format(trade.entry_price)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-300">
                        {fmt.format(trade.exit_price)}
                      </td>
                      <td
                        className={`px-4 py-3 font-mono font-medium ${pnlColor(
                          trade.gross_pnl
                        )}`}
                      >
                        {fmt.format(trade.gross_pnl)}
                      </td>
                      <td
                        className={`px-4 py-3 font-mono font-medium ${pnlColor(
                          trade.net_pnl
                        )}`}
                      >
                        {fmt.format(trade.net_pnl)}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {trade.hold_duration_days}d
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {trade.exit_reason?.replace(/_/g, " ") || "--"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {trade.strategy_version}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Page {page}
              {data.total_pages ? ` of ${data.total_pages}` : ""}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={data.total_pages ? page >= data.total_pages : false}
                className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-gray-500">No trades found</p>
      )}
    </div>
  );
}
