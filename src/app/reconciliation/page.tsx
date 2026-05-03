"use client";

import { useReconciliation } from "@/lib/hooks/use-api";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-700 ${className}`} />
  );
}

export default function ReconciliationPage() {
  const { data, error, isLoading } = useReconciliation();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Reconciliation Log</h2>

      {isLoading ? (
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl bg-red-900/30 border border-red-700 p-5 text-red-300">
          Failed to load reconciliation data
        </div>
      ) : data?.logs?.length > 0 ? (
        <div className="rounded-xl bg-gray-800 border border-gray-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400 text-xs uppercase tracking-wider">
                <th className="px-5 py-3">Boot Time</th>
                <th className="px-5 py-3">Downtime</th>
                <th className="px-5 py-3">Discrepancies</th>
                <th className="px-5 py-3">Actions</th>
                <th className="px-5 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {data.logs.map(
                (log: {
                  id: number;
                  bootAt: string;
                  downtimeSeconds: number | null;
                  discrepanciesFound: unknown[] | null;
                  actionsTaken: unknown[] | null;
                }) => {
                  const discrepancyCount = Array.isArray(
                    log.discrepanciesFound
                  )
                    ? log.discrepanciesFound.length
                    : 0;
                  const actionsCount = Array.isArray(log.actionsTaken)
                    ? log.actionsTaken.length
                    : 0;
                  const hasDiscrepancies = discrepancyCount > 0;

                  return (
                    <tr
                      key={log.id}
                      className={`hover:bg-gray-700/30 transition-colors ${
                        hasDiscrepancies ? "bg-amber-900/10" : ""
                      }`}
                    >
                      <td className="px-5 py-3 text-white font-mono text-xs">
                        {dateFmt.format(new Date(log.bootAt))}
                      </td>
                      <td className="px-5 py-3 text-gray-300">
                        {formatDuration(log.downtimeSeconds)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            hasDiscrepancies
                              ? "bg-amber-900/50 text-amber-300 border border-amber-700/50"
                              : "bg-gray-700 text-gray-400"
                          }`}
                        >
                          {discrepancyCount}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center rounded-full bg-gray-700 px-2.5 py-0.5 text-xs font-medium text-gray-300">
                          {actionsCount}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {hasDiscrepancies && (
                          <details>
                            <summary className="text-xs text-amber-400 cursor-pointer hover:text-amber-300">
                              View discrepancies
                            </summary>
                            <pre className="text-xs text-gray-400 mt-2 bg-gray-900 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                              {JSON.stringify(
                                log.discrepanciesFound,
                                null,
                                2
                              )}
                            </pre>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500">No reconciliation logs found</p>
      )}
    </div>
  );
}
