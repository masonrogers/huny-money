"use client";

import { useRegime } from "@/lib/hooks/use-api";

const regimeStyles: Record<string, { bg: string; text: string; border: string }> = {
  strong_bull: { bg: "bg-emerald-600", text: "text-emerald-50", border: "border-emerald-500" },
  mild_bull: { bg: "bg-emerald-800", text: "text-emerald-100", border: "border-emerald-600" },
  ranging: { bg: "bg-yellow-700", text: "text-yellow-100", border: "border-yellow-600" },
  mild_bear: { bg: "bg-red-800", text: "text-red-100", border: "border-red-600" },
  strong_bear: { bg: "bg-red-600", text: "text-red-50", border: "border-red-500" },
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-700 ${className}`} />
  );
}

function convictionColor(v: number): string {
  if (v >= 70) return "bg-emerald-500";
  if (v >= 40) return "bg-yellow-500";
  return "bg-red-500";
}

export default function RegimePage() {
  const { data, error, isLoading } = useRegime();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Regime & Layer 1</h2>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-900/30 border border-red-700 p-5 text-red-300">
          Failed to load regime data
        </div>
      ) : data ? (
        <>
          {/* Current Regime Card */}
          <div className="rounded-xl bg-gray-800 border border-gray-700 p-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Current Market Regime
            </h3>
            <div className="flex items-center gap-4">
              <span
                className={`rounded-xl px-6 py-3 text-2xl font-bold ${
                  regimeStyles[data.current_regime]?.bg ?? "bg-gray-700"
                } ${regimeStyles[data.current_regime]?.text ?? "text-gray-200"}`}
              >
                {(data.current_regime ?? "unknown")
                  .replace(/_/g, " ")
                  .toUpperCase()}
              </span>
              {data.regime_evidence && (
                <p className="text-sm text-gray-400 max-w-xl">
                  {data.regime_evidence}
                </p>
              )}
            </div>
            {data.assessed_at && (
              <p className="text-xs text-gray-500 mt-3">
                Last assessed: {dateFmt.format(new Date(data.assessed_at))}
              </p>
            )}
          </div>

          {/* Active Theses */}
          <div className="rounded-xl bg-gray-800 border border-gray-700 p-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Active Theses
            </h3>
            {data.theses?.length > 0 ? (
              <div className="space-y-4">
                {data.theses.map(
                  (
                    thesis: {
                      id: number;
                      asset: string;
                      thesis_text: string;
                      status: string;
                      conviction: number;
                      last_reviewed_at: string;
                    },
                    idx: number
                  ) => (
                    <div
                      key={thesis.id ?? idx}
                      className="bg-gray-900/50 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">
                            {thesis.asset}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              thesis.status === "active"
                                ? "bg-emerald-900/50 text-emerald-300"
                                : thesis.status === "watching"
                                ? "bg-amber-900/50 text-amber-300"
                                : "bg-red-900/50 text-red-300"
                            }`}
                          >
                            {thesis.status}
                          </span>
                        </div>
                        <span className="text-sm font-mono text-gray-400">
                          {thesis.conviction}/100
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 mb-3">
                        {thesis.thesis_text}
                      </p>
                      <div className="w-full bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${convictionColor(
                            thesis.conviction
                          )}`}
                          style={{
                            width: `${Math.min(thesis.conviction, 100)}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Last reviewed:{" "}
                        {thesis.last_reviewed_at
                          ? dateFmt.format(
                              new Date(thesis.last_reviewed_at)
                            )
                          : "--"}
                      </p>
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No active theses</p>
            )}
          </div>

          {/* Regime History */}
          <div className="rounded-xl bg-gray-800 border border-gray-700 p-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Regime History
            </h3>
            {data.history?.length > 0 ? (
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-700" />
                <div className="space-y-4">
                  {data.history.map(
                    (
                      entry: {
                        id: number;
                        regime: string;
                        evidence: string;
                        assessed_at: string;
                        was_correct: boolean | null;
                      },
                      idx: number
                    ) => (
                      <div
                        key={entry.id ?? idx}
                        className="relative pl-10"
                      >
                        <div
                          className={`absolute left-2.5 top-1.5 w-3 h-3 rounded-full border-2 ${
                            regimeStyles[entry.regime]?.border ??
                            "border-gray-500"
                          } ${
                            regimeStyles[entry.regime]?.bg ?? "bg-gray-700"
                          }`}
                        />
                        <div className="bg-gray-900/50 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                regimeStyles[entry.regime]?.bg ??
                                "bg-gray-700"
                              } ${
                                regimeStyles[entry.regime]?.text ??
                                "text-gray-200"
                              }`}
                            >
                              {entry.regime
                                .replace(/_/g, " ")
                                .toUpperCase()}
                            </span>
                            <span className="text-xs text-gray-500">
                              {dateFmt.format(
                                new Date(entry.assessed_at)
                              )}
                            </span>
                            {entry.was_correct !== null && (
                              <span
                                className={`text-xs ${
                                  entry.was_correct
                                    ? "text-emerald-400"
                                    : "text-red-400"
                                }`}
                              >
                                {entry.was_correct
                                  ? "Correct"
                                  : "Incorrect"}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">
                            {entry.evidence}
                          </p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No regime history available
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
