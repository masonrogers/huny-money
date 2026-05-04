import { NextResponse } from "next/server";
import { attemptModeTransition, type TransitionTarget } from "@/lib/execution/mode-transition";
import { evaluatePaperToggleGate } from "@/lib/phase-gating";

/**
 * Mode toggle endpoint. Per STRATEGY.md §13.5, the toggle requires:
 * 1. typed-phrase confirmation matching the target mode
 * 2. no open positions in either mode
 * 3. no pending orders
 * 4. for paper→live: Phase 1 advance criteria pass
 *
 * After confirmation, writes state.paper_mode + state.mode_change_pending
 * but the change does NOT take effect until next boot (the executor object
 * IS the mode, loaded once at boot).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { target?: string; typedPhrase?: string };
    if (body.target !== "paper" && body.target !== "live") {
      return NextResponse.json(
        { ok: false, error: "target must be 'paper' or 'live'" },
        { status: 400 },
      );
    }
    const target = body.target as TransitionTarget;

    let phase1Pass = true;
    if (target === "live") {
      const gate = await evaluatePaperToggleGate();
      phase1Pass = gate.pass;
    }

    const result = await attemptModeTransition({
      target,
      typedPhrase: body.typedPhrase ?? "",
      phase1CriteriaPass: phase1Pass,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason, details: result.details },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Mode change to ${target} scheduled. Restart required to take effect.`,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
