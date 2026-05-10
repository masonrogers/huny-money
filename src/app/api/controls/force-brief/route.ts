import { NextResponse } from "next/server";
import { runScheduledMorningBrief } from "@/lib/orchestration/morning-brief";
import { errorLogger } from "@/lib/db/utils";

/**
 * Force-brief endpoint. Runs the full morning-brief orchestration
 * immediately. Counts against the monthly API budget — the dashboard
 * warns the operator if the cap would be exceeded.
 */
export async function POST() {
  try {
    const result = await runScheduledMorningBrief();
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    const ex = result.execution;
    const entryPlaced = ex.altResults.filter((r) => r.outcome.kind === "placed").length;
    const entrySkipped = ex.altResults.filter((r) => r.outcome.kind === "skipped").length;
    const mgmtPlaced = ex.altPositionActions.filter((r) => r.outcome.kind === "placed").length;
    const btcPiece =
      ex.btcCoreResult?.kind === "placed"
        ? ` · BTC core ${ex.btcCoreResult.sizeUsd >= 0 ? "+" : ""}$${Math.abs(ex.btcCoreResult.sizeUsd).toFixed(0)}`
        : "";
    const altEntryPiece =
      entryPlaced > 0 || entrySkipped > 0
        ? ` · entries: ${entryPlaced} placed, ${entrySkipped} skipped`
        : "";
    const altMgmtPiece = mgmtPlaced > 0 ? ` · ${mgmtPlaced} position action(s)` : "";
    const shortCircuitPiece = ex.shortCircuitReason ? ` · execution skipped (${ex.shortCircuitReason})` : "";

    return NextResponse.json({
      ok: true,
      message: `Morning brief complete · regime=${result.brief.regime} · $${result.costUsd.toFixed(4)}${altEntryPiece}${altMgmtPiece}${btcPiece}${shortCircuitPiece}`,
      evaluationId: result.evaluationId,
      execution: ex,
    });
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "api.controls.force-brief",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
