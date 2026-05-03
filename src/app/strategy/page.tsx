"use client";

import { useStrategy } from "@/lib/hooks/use-api";

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

export default function StrategyPage() {
  const { data, error, isLoading } = useStrategy();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Strategy Parameters</h2>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-900/30 border border-red-700 p-5 text-red-300">
          Failed to load strategy data
        </div>
      ) : data ? (
        <>
          {/* Current Parameters */}
          <div className="rounded-xl bg-gray-800 border border-gray-700 overflow-x-auto">
            <div className="px-5 py-4 border-b border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                Current Parameters
                {data.version && (
                  <span className="ml-2 text-xs font-mono text-gray-500">
                    v{data.version}
                  </span>
                )}
              </h3>
            </div>
            {data.params?.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-left text-gray-400 text-xs uppercase tracking-wider">
                    <th className="px-5 py-3">Parameter</th>
                    <th className="px-5 py-3">Current</th>
                    <th className="px-5 py-3">Default</th>
                    <th className="px-5 py-3">Range</th>
                    <th className="px-5 py-3">Version Changed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {data.params.map(
                    (param: {
                      paramName: string;
                      currentValue: string;
                      defaultValue: string;
                      minAllowed: string;
                      maxAllowed: string;
                      versionChanged: string;
                    }) => {
                      const isModified =
                        param.currentValue !== param.defaultValue;
                      return (
                        <tr
                          key={param.paramName}
                          className={`hover:bg-gray-700/30 transition-colors ${
                            isModified ? "bg-amber-900/10" : ""
                          }`}
                        >
                          <td className="px-5 py-3 font-medium text-white font-mono text-xs">
                            {param.paramName}
                          </td>
                          <td
                            className={`px-5 py-3 font-mono ${
                              isModified
                                ? "text-amber-300 font-medium"
                                : "text-gray-300"
                            }`}
                          >
                            {param.currentValue}
                          </td>
                          <td className="px-5 py-3 font-mono text-gray-500">
                            {param.defaultValue}
                          </td>
                          <td className="px-5 py-3 font-mono text-gray-500 text-xs">
                            {param.minAllowed} - {param.maxAllowed}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-gray-500">
                            {param.versionChanged ?? "--"}
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            ) : (
              <p className="px-5 py-4 text-sm text-gray-500">
                No parameters configured
              </p>
            )}
          </div>

          {/* Modification History */}
          <div className="rounded-xl bg-gray-800 border border-gray-700">
            <div className="px-5 py-4 border-b border-gray-700">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                Modification History
              </h3>
            </div>
            {data.modifications?.length > 0 ? (
              <div className="divide-y divide-gray-700/50">
                {data.modifications.map(
                  (mod: {
                    id: number;
                    fromVersion: string;
                    toVersion: string;
                    timestamp: string;
                    paramsChanged: Record<string, unknown>;
                    reasoning: string;
                    tradeCountAtModification: number;
                    winRateAtModification: string | null;
                  }) => (
                    <div
                      key={mod.id}
                      className="px-5 py-4 hover:bg-gray-700/20 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-gray-300">
                            v{mod.fromVersion}
                          </span>
                          <span className="text-gray-600">-&gt;</span>
                          <span className="text-sm font-mono text-white font-medium">
                            v{mod.toVersion}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {dateFmt.format(new Date(mod.timestamp))}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 mb-2">
                        {mod.reasoning}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>
                          Trades: {mod.tradeCountAtModification}
                        </span>
                        {mod.winRateAtModification && (
                          <span>
                            Win rate:{" "}
                            {Number(
                              mod.winRateAtModification
                            ).toFixed(1)}
                            %
                          </span>
                        )}
                        <span>
                          Changed:{" "}
                          {Object.keys(mod.paramsChanged || {}).join(
                            ", "
                          )}
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-gray-500">
                No modifications recorded
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
