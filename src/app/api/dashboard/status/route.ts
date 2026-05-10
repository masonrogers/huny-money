import { stateRead } from "@/lib/db/utils";
import { safeDashboardHandler } from "@/lib/api/safe-handler";

export interface DashboardStatusPayload {
  mode: "paper" | "live";
  modeChangePending: boolean;
  phase: "paper" | "half" | "full" | "paused" | "halted" | null;
  regime: "bull" | "chop" | "bear" | null;
  daysInRegime: number | null;
  paused: boolean;
  /** Plain-English explanation of why trading is paused (set by auto-pauses). */
  pausedReason: string | null;
  /** True if the BTC underperformance gate set the current pause. */
  pausedByBtcUnderperfGate: boolean;
  lastBootAt: string | null;
  lastEvalAt: string | null;
  dbReady: boolean;
}

export async function GET() {
  return safeDashboardHandler<DashboardStatusPayload>(
    "api.dashboard.status",
    {
      mode: "paper",
      modeChangePending: false,
      phase: null,
      regime: null,
      daysInRegime: null,
      paused: false,
      pausedReason: null,
      pausedByBtcUnderperfGate: false,
      lastBootAt: null,
      lastEvalAt: null,
      dbReady: false,
    },
    async () => {
      const [
        paperFlag,
        modePending,
        phase,
        regime,
        daysInRegime,
        paused,
        pausedReason,
        pausedByGate,
        lastBoot,
        nextEval,
      ] = await Promise.all([
        stateRead<boolean>("paper_mode"),
        stateRead<boolean>("mode_change_pending"),
        stateRead<DashboardStatusPayload["phase"]>("phase"),
        stateRead<DashboardStatusPayload["regime"]>("current_regime"),
        stateRead<number>("days_in_current_regime"),
        stateRead<boolean>("trading_paused"),
        stateRead<string>("trading_paused_reason"),
        stateRead<boolean>("trading_paused_by_btc_underperf_gate"),
        stateRead<string>("last_boot_at"),
        stateRead<string>("next_eval_at"),
      ]);

      return {
        mode: (paperFlag ?? true) ? "paper" : "live",
        modeChangePending: modePending ?? false,
        phase: phase ?? null,
        regime: regime ?? null,
        daysInRegime: daysInRegime ?? null,
        paused: paused ?? false,
        pausedReason: pausedReason ?? null,
        pausedByBtcUnderperfGate: pausedByGate ?? false,
        lastBootAt: lastBoot,
        lastEvalAt: nextEval,
        dbReady: true,
      };
    },
  );
}
