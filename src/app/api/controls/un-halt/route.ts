import { NextResponse } from "next/server";
import { stateRead, stateWriter, errorLogger, appDecisionLogger } from "@/lib/db/utils";
import { setCurrentMode, getCurrentMode } from "@/lib/mode";
import { log } from "@/lib/logger";

/**
 * Un-halt: restore `state.phase` from `"halted"` back to `"paper"`.
 *
 * `convert-to-btc-hold` sets phase=halted as part of its honesty-check
 * shutdown (STRATEGY.md §4.4). CLAUDE.md documents that as "irreversible —
 * restarting active trading after a convert requires the operator to
 * manually flip phase and trading_paused via the database AND restart the
 * bot." This endpoint provides the supervised path back without DB access:
 *
 *   - Paper-mode only. In live mode, `convert-to-btc-hold` represents a
 *     strategic decision that should NOT be undone via a single API call.
 *     The operator stays on the documented manual-DB path for live.
 *   - Typed-phrase confirmation ("resume trading") so it can't fire by
 *     accident.
 *   - Clears the auto-pause provenance keys at the same time, matching the
 *     manual-resume path in `pause` (so stale "paused because X" text
 *     doesn't linger after un-halt).
 *   - Does NOT touch positions/orders. Use `reset-paper` for that — the two
 *     operations are intentionally orthogonal.
 *
 * The bot still needs a process restart to re-load any singleton state
 * affected by the halt, but the next scheduler tick will pick up the new
 * phase and let decision-executor's preflight allow trades again.
 */
const REQUIRED_PHRASE = "resume trading";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const confirmed = body?.confirmed === true;
    const phrase = String(body?.typedPhrase ?? "").trim().toLowerCase();
    if (!confirmed || phrase !== REQUIRED_PHRASE) {
      return NextResponse.json(
        {
          ok: false,
          error: `Confirmation required: confirmed:true + typedPhrase '${REQUIRED_PHRASE}'.`,
        },
        { status: 400 },
      );
    }

    const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
    if (!paperMode) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "un-halt refused: bot is in live mode. Convert-to-btc-hold in live is intentionally irreversible without DB access.",
        },
        { status: 400 },
      );
    }
    setCurrentMode("paper");
    if (getCurrentMode() !== "paper") {
      return NextResponse.json(
        { ok: false, error: "internal: failed to set mode to paper for un-halt" },
        { status: 500 },
      );
    }

    const previousPhase = await stateRead<string>("phase");
    if (previousPhase !== "halted") {
      // No-op if the bot isn't actually halted. Returning 200 + a clear
      // message keeps the route idempotent — the operator can hammer it
      // without breaking anything.
      return NextResponse.json({
        ok: true,
        message: `No-op: state.phase was '${previousPhase ?? "(unset)"}', not 'halted'.`,
        previousPhase,
        newPhase: previousPhase,
      });
    }

    const previousPaused = await stateRead<boolean>("trading_paused");
    const previousPausedReason = await stateRead<string>("trading_paused_reason");

    await stateWriter({
      key: "phase",
      value: "paper",
      changedBy: "api.controls.un-halt",
    });
    await stateWriter({
      key: "trading_paused",
      value: false,
      changedBy: "api.controls.un-halt",
    });
    await stateWriter({
      key: "trading_paused_reason",
      value: null,
      changedBy: "api.controls.un-halt",
    });
    await stateWriter({
      key: "trading_paused_by_btc_underperf_gate",
      value: false,
      changedBy: "api.controls.un-halt",
    });

    await appDecisionLogger({
      decisionType: "circuit_breaker",
      inputs: {
        action: "un_halt",
        previousPhase,
        previousPaused,
        previousPausedReason,
      },
      outputs: {
        newPhase: "paper",
        newPaused: false,
      },
      reasoning:
        "Operator un-halted the bot after a prior convert-to-btc-hold. Phase restored to 'paper'; auto-pause provenance cleared. Positions/orders untouched.",
    });

    log.warn("UN-HALT executed by operator", {
      previousPhase,
      previousPaused,
      previousPausedReason,
    });

    return NextResponse.json({
      ok: true,
      message:
        "Bot un-halted: phase=paper, trading_paused=false. Scheduler will resume trading on its next tick.",
      previousPhase,
      newPhase: "paper",
    });
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "api.controls.un-halt",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
