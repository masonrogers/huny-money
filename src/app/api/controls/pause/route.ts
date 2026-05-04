import { NextResponse } from "next/server";
import { stateWriter } from "@/lib/db/utils";
import { errorLogger } from "@/lib/db/utils";
import { log } from "@/lib/logger";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const value = body?.paused !== undefined ? Boolean(body.paused) : true;
    await stateWriter({
      key: "trading_paused",
      value,
      changedBy: "api.controls.pause",
    });
    log.info("Trading pause state updated", { paused: value });
    return NextResponse.json({ ok: true, paused: value });
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "api.controls.pause",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: "Failed to update pause state" }, { status: 500 });
  }
}
