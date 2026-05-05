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
    return NextResponse.json({
      ok: true,
      message: `Morning brief complete · regime=${result.brief.regime} · $${result.costUsd.toFixed(4)}`,
      evaluationId: result.evaluationId,
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
