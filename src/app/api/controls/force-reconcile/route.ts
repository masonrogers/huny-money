import { NextResponse } from "next/server";
import { getExecutor, runBootReconciliation } from "@/lib/execution";
import { getTicker } from "@/lib/coinbase";
import { errorLogger } from "@/lib/db/utils";

export async function POST() {
  try {
    const executor = getExecutor();
    const findings = await runBootReconciliation({
      executor,
      fetchCurrentPrices: async () => {
        const [btc, eth, sol] = await Promise.all([
          getTicker("BTC-USD").then((t) => t.midPrice).catch(() => 0),
          getTicker("ETH-USD").then((t) => t.midPrice).catch(() => 0),
          getTicker("SOL-USD").then((t) => t.midPrice).catch(() => 0),
        ]);
        return { BTC: btc, ETH: eth, SOL: sol };
      },
    });

    return NextResponse.json({ ok: true, findings });
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "api.controls.force-reconcile",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
