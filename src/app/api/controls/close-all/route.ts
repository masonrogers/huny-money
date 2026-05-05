import { NextResponse } from "next/server";
import { getExecutor } from "@/lib/execution";
import { openPositionsForCurrentMode, updatePosition } from "@/lib/db/queries/positions";
import { errorLogger, appDecisionLogger } from "@/lib/db/utils";
import { log } from "@/lib/logger";

/**
 * Close-all kill switch per STRATEGY.md §6.4. Market-exits every open
 * position for the current mode. Requires double-confirmation client-side
 * (the dashboard renders the typed-phrase modal).
 *
 * Server-side validation: requires `confirmed: true` AND `confirmedAgain: true`.
 * The dashboard sends both booleans only after both modal screens are
 * confirmed. A request without both is rejected.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const confirmed = body?.confirmed === true && body?.confirmedAgain === true;
    if (!confirmed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Double-confirmation required. Both confirmed:true and confirmedAgain:true.",
        },
        { status: 400 },
      );
    }

    const executor = getExecutor();
    const open = await openPositionsForCurrentMode();

    if (open.length === 0) {
      return NextResponse.json({ ok: true, closed: 0, message: "No open positions" });
    }

    const closed: string[] = [];
    const failed: string[] = [];

    for (const pos of open) {
      try {
        await executor.placeMarketExit(pos.asset, parseFloat(pos.quantity), {
          relatedPositionId: pos.id,
        });
        await updatePosition(pos.id, {
          status: "closed",
          exitTime: new Date(),
          exitReason: "operator_close_all",
        });
        closed.push(pos.id);
      } catch (err) {
        failed.push(pos.id);
        await errorLogger({
          severity: "error",
          component: "api.controls.close-all",
          error: err instanceof Error ? err : new Error(String(err)),
          context: { positionId: pos.id, asset: pos.asset },
          recovered: false,
        }).catch(() => {});
      }
    }

    await appDecisionLogger({
      decisionType: "circuit_breaker",
      inputs: { trigger: "close-all", openCount: open.length },
      outputs: { closed: closed.length, failed: failed.length },
      reasoning: `Operator triggered close-all: ${closed.length} closed, ${failed.length} failed.`,
    });

    log.warn("CLOSE-ALL EXECUTED by operator", {
      closed: closed.length,
      failed: failed.length,
    });

    return NextResponse.json({
      ok: true,
      closed: closed.length,
      failed: failed.length,
      failedIds: failed,
    });
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "api.controls.close-all",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
