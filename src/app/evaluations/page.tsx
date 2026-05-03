"use client";

import { useState } from "react";
import { useEvaluations } from "@/lib/hooks/use-api";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const typeBadge: Record<string, string> = {
  daily_l1l2: "bg-blue-900/50 text-blue-300 border-blue-700/50",
  swing_l2: "bg-purple-900/50 text-purple-300 border-purple-700/50",
  emergency: "bg-red-900/50 text-red-300 border-red-700/50",
  post_restart: "bg-amber-900/50 text-amber-300 border-amber-700/50",
};

function borderColor(actions: Record<string, unknown> | null): string {
  if (!actions) return "border-l-gray-600";
  const a = actions as {
    new_trades?: unknown[];
    existing_positions?: { action: string }[];
    regime_changed?: boolean;
  };
  if (a.regime_changed) return "border-l-blue-500";
  if (a.new_trades && (a.new_trades as unknown[]).length > 0)
    return "border-l-emerald-500";
  if (
    a.existing_positions &&
    a.existing_positions.some(
      (p: { action: string }) => p.action === "exit"
    )
  )
    return "border-l-red-500";
  return "border-l-gray-600";
}

function summarizeActions(
  actions: Record<string, unknown> | null
): string {
  if (!actions) return "No actions";
  const a = actions as {
    new_trades?: { asset: string }[];
    existing_positions?: { asset: string; action: string }[];
    strategy_notes?: string;
  };
  const parts: string[] = [];
  if (a.new_trades && a.new_trades.length > 0) {
    parts.push(
      `Entered ${a.new_trades.map((t) => t.asset).join(", ")}`
    );
  }
  if (a.existing_positions) {
    const exits = a.existing_positions.filter(
      (p) => p.action === "exit"
    );
    const adjusts = a.existing_positions.filter(
      (p) => p.action !== "hold" && p.action !== "exit"
    );
    if (exits.length > 0) {
      parts.push(`Exited ${exits.map((p) => p.asset).join(", ")}`);
    }
    if (adjusts.length > 0) {
      parts.push(
        `Adjusted ${adjusts.map((p) => p.asset).join(", ")}`
      );
    }
  }
  return parts.length > 0 ? parts.join(" | ") : "No actions taken";
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-700 ${className}`} />
  );
}

export default function EvaluationsPage() {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data, error, isLoading } = useEvaluations(page);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Evaluations</h2>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-900/30 border border-red-700 p-5 text-red-300">
          Failed to load evaluations
        </div>
      ) : data?.evaluations?.length > 0 ? (
        <>
          <div className="space-y-3">
            {data.evaluations.map(
              (ev: {
                id: number;
                timestamp: string;
                type: string;
                opus_response: Record<string, unknown> | null;
                actions_taken: Record<string, unknown> | null;
                strategy_version: string;
              }) => (
                <div
                  key={ev.id}
                  className={`rounded-xl bg-gray-800 border border-gray-700 border-l-4 ${borderColor(
                    ev.actions_taken
                  )} overflow-hidden`}
                >
                  <button
                    onClick={() =>
                      setExpanded(expanded === ev.id ? null : ev.id)
                    }
                    className="w-full text-left px-5 py-4 hover:bg-gray-700/30 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                            typeBadge[ev.type] ||
                            "bg-gray-700 text-gray-300 border-gray-600"
                          }`}
                        >
                          {ev.type.replace(/_/g, " ").toUpperCase()}
                        </span>
                        <span className="text-sm text-gray-300">
                          {dateFmt.format(new Date(ev.timestamp))}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-gray-500">
                          v{ev.strategy_version}
                        </span>
                        <span className="text-gray-500 text-xs">
                          {expanded === ev.id ? "▼" : "▶"}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-400 mt-2">
                      {summarizeActions(ev.actions_taken)}
                    </p>
                  </button>

                  {expanded === ev.id && (
                    <div className="px-5 pb-4 border-t border-gray-700">
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          Claude Response
                        </h4>
                        <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
                          {JSON.stringify(ev.opus_response, null, 2)}
                        </pre>
                      </div>
                      {ev.actions_taken && (
                        <div className="mt-3">
                          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                            Actions Taken
                          </h4>
                          <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">
                            {JSON.stringify(ev.actions_taken, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            )}
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
                disabled={
                  data.total_pages ? page >= data.total_pages : false
                }
                className="px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="text-gray-500">No evaluations found</p>
      )}
    </div>
  );
}
