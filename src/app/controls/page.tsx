"use client";

import { useState, useCallback } from "react";
import { mutate } from "swr";
import { useSystemStatus } from "@/lib/hooks/use-api";

interface ActionState {
  loading: boolean;
  result: { success: boolean; message: string } | null;
}

function useControlAction() {
  const [state, setState] = useState<ActionState>({
    loading: false,
    result: null,
  });

  const execute = useCallback(
    async (url: string, body?: Record<string, unknown>) => {
      setState({ loading: true, result: null });
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();
        setState({
          loading: false,
          result: {
            success: res.ok,
            message:
              data.message || data.error || (res.ok ? "Success" : "Failed"),
          },
        });
        // Revalidate system status and portfolio data after any control action
        if (res.ok) {
          mutate('/api/dashboard/status');
          mutate('/api/dashboard/portfolio');
        }
      } catch (err) {
        setState({
          loading: false,
          result: {
            success: false,
            message: err instanceof Error ? err.message : "Request failed",
          },
        });
      }
    },
    []
  );

  const clear = useCallback(() => {
    setState({ loading: false, result: null });
  }, []);

  return { ...state, execute, clear };
}

function FeedbackBanner({
  result,
  onDismiss,
}: {
  result: { success: boolean; message: string } | null;
  onDismiss: () => void;
}) {
  if (!result) return null;
  return (
    <div
      className={`rounded-lg px-4 py-2 text-sm flex items-center justify-between ${
        result.success
          ? "bg-emerald-900/40 border border-emerald-700/50 text-emerald-300"
          : "bg-red-900/40 border border-red-700/50 text-red-300"
      }`}
    >
      <span>{result.message}</span>
      <button
        onClick={onDismiss}
        className="ml-3 text-xs opacity-70 hover:opacity-100"
      >
        Dismiss
      </button>
    </div>
  );
}

export default function ControlsPage() {
  const pauseAction = useControlAction();
  const closeAllAction = useControlAction();
  const forceEvalAction = useControlAction();
  const paperAction = useControlAction();
  const reconAction = useControlAction();
  const regimeAction = useControlAction();

  const { data: status } = useSystemStatus();
  const isPaused = status?.tradingPaused ?? false;
  const isPaper = status?.paperMode ?? true;

  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [regimeOverride, setRegimeOverride] = useState("ranging");
  const [regimeReason, setRegimeReason] = useState("");

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Controls</h2>
      <p className="text-sm text-gray-400">
        Manual control actions for the trading system. Use with caution.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* Pause/Resume Trading */}
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Pause / Resume Trading
          </h3>
          <p className="text-xs text-gray-500">
            Pause all automated trading activity. No new entries or exits will be
            executed while paused.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() =>
                pauseAction.execute("/api/controls/pause", {
                  paused: true,
                })
              }
              disabled={pauseAction.loading}
              className={`flex-1 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${
                isPaused
                  ? "bg-red-600 ring-2 ring-red-400"
                  : "bg-red-700 hover:bg-red-600"
              }`}
            >
              {pauseAction.loading ? "..." : "Pause"}
            </button>
            <button
              onClick={() =>
                pauseAction.execute("/api/controls/pause", {
                  paused: false,
                })
              }
              disabled={pauseAction.loading}
              className={`flex-1 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${
                !isPaused
                  ? "bg-emerald-600 ring-2 ring-emerald-400"
                  : "bg-emerald-700 hover:bg-emerald-600"
              }`}
            >
              {pauseAction.loading ? "..." : "Resume"}
            </button>
          </div>
          <FeedbackBanner
            result={pauseAction.result}
            onDismiss={pauseAction.clear}
          />
        </div>

        {/* Close All Positions */}
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Close All Positions
          </h3>
          <p className="text-xs text-gray-500">
            Emergency close of all open positions at market price. This action
            cannot be undone.
          </p>
          {!confirmCloseAll ? (
            <button
              onClick={() => setConfirmCloseAll(true)}
              className="w-full px-4 py-2 rounded-lg bg-red-800 hover:bg-red-700 border border-red-600 text-red-200 text-sm font-medium transition-colors"
            >
              Close All Positions
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-red-400 font-medium">
                Are you sure? This will market-sell all positions.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    closeAllAction.execute("/api/controls/close-all");
                    setConfirmCloseAll(false);
                  }}
                  disabled={closeAllAction.loading}
                  className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold transition-colors disabled:opacity-50"
                >
                  {closeAllAction.loading ? "Closing..." : "CONFIRM"}
                </button>
                <button
                  onClick={() => setConfirmCloseAll(false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <FeedbackBanner
            result={closeAllAction.result}
            onDismiss={closeAllAction.clear}
          />
        </div>

        {/* Force Evaluation */}
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Force Evaluation
          </h3>
          <p className="text-xs text-gray-500">
            Trigger an immediate evaluation cycle outside the normal schedule.
          </p>
          <button
            onClick={() =>
              forceEvalAction.execute("/api/controls/force-evaluation")
            }
            disabled={forceEvalAction.loading}
            className="w-full px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {forceEvalAction.loading ? "Triggering..." : "Trigger Evaluation"}
          </button>
          <FeedbackBanner
            result={forceEvalAction.result}
            onDismiss={forceEvalAction.clear}
          />
        </div>

        {/* Toggle Paper Trading */}
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Paper Trading Mode
          </h3>
          <p className="text-xs text-gray-500">
            Toggle between paper trading (simulated) and live trading mode.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() =>
                paperAction.execute("/api/controls/toggle-paper", {
                  enabled: true,
                })
              }
              disabled={paperAction.loading}
              className={`flex-1 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${
                isPaper
                  ? "bg-amber-600 ring-2 ring-amber-400"
                  : "bg-amber-700 hover:bg-amber-600"
              }`}
            >
              {paperAction.loading ? "..." : "Paper Mode"}
            </button>
            <button
              onClick={() =>
                paperAction.execute("/api/controls/toggle-paper", {
                  enabled: false,
                })
              }
              disabled={paperAction.loading}
              className={`flex-1 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${
                !isPaper
                  ? "bg-emerald-600 ring-2 ring-emerald-400"
                  : "bg-emerald-700 hover:bg-emerald-600"
              }`}
            >
              {paperAction.loading ? "..." : "Live Mode"}
            </button>
          </div>
          <FeedbackBanner
            result={paperAction.result}
            onDismiss={paperAction.clear}
          />
        </div>

        {/* Force Reconciliation */}
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Force Reconciliation
          </h3>
          <p className="text-xs text-gray-500">
            Run a reconciliation check comparing internal state against exchange
            data.
          </p>
          <button
            onClick={() =>
              reconAction.execute("/api/controls/force-reconciliation")
            }
            disabled={reconAction.loading}
            className="w-full px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {reconAction.loading
              ? "Running..."
              : "Run Reconciliation"}
          </button>
          <FeedbackBanner
            result={reconAction.result}
            onDismiss={reconAction.clear}
          />
        </div>

        {/* Regime Override */}
        <div className="rounded-xl bg-gray-800 border border-gray-700 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Regime Override
          </h3>
          <p className="text-xs text-gray-500">
            Manually override the detected market regime. Will be used until the
            next automatic assessment.
          </p>
          <select
            value={regimeOverride}
            onChange={(e) => setRegimeOverride(e.target.value)}
            className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="strong_bull">Strong Bull</option>
            <option value="mild_bull">Mild Bull</option>
            <option value="ranging">Ranging</option>
            <option value="mild_bear">Mild Bear</option>
            <option value="strong_bear">Strong Bear</option>
          </select>
          <input
            type="text"
            placeholder="Reason for override..."
            value={regimeReason}
            onChange={(e) => setRegimeReason(e.target.value)}
            className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() =>
              regimeAction.execute("/api/controls/regime-override", {
                regime: regimeOverride,
                reason: regimeReason,
              })
            }
            disabled={regimeAction.loading || !regimeReason.trim()}
            className="w-full px-4 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {regimeAction.loading ? "Submitting..." : "Override Regime"}
          </button>
          <FeedbackBanner
            result={regimeAction.result}
            onDismiss={regimeAction.clear}
          />
        </div>
      </div>
    </div>
  );
}
