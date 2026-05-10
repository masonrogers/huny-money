import { NextResponse } from "next/server";
import { getExecutor } from "@/lib/execution";
import { openPositionsForCurrentMode, updatePosition } from "@/lib/db/queries/positions";
import { sumFilledOrderFeesForPositionForCurrentMode } from "@/lib/db/queries/orders";
import { errorLogger, appDecisionLogger } from "@/lib/db/utils";
import { getTickers } from "@/lib/coinbase";
import { productIdFor } from "@/lib/strategy/constants";
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

    // Fetch a current ticker for each unique asset so we have an exitPrice
    // even when placeMarketExit returns `pending` (paper mode fills on the
    // next wakeup tick; live mode fills server-side). Without this fallback,
    // close-all would write null exitPrice / grossPnl / netPnl in paper
    // mode — then the wakeup-cycle close path skips the row because its
    // status guard sees `closed`, leaving Phase 1 metrics permanently blank.
    const uniqueAssets = Array.from(new Set(open.map((p) => p.asset)));
    let tickers: Record<string, { midPrice: number }> = {};
    try {
      tickers = await getTickers(uniqueAssets.map(productIdFor));
    } catch (err) {
      log.warn("close-all: ticker fetch failed; P&L will be null for closes that lack a fill price", {
        error: (err as Error).message,
      });
    }

    const closed: string[] = [];
    const failed: string[] = [];

    for (const pos of open) {
      try {
        const qty = parseFloat(pos.quantity);
        const result = await executor.placeMarketExit(pos.asset, qty, {
          relatedPositionId: pos.id,
        });
        // Populate exitPrice + P&L so the dashboard / Phase 1 criteria
        // (closedTradeCount, fee drag) compute correctly. Aggregate fees
        // across ALL filled orders linked to this position so net = gross −
        // (entry fees + exit fees). The market_exit may still be `pending`
        // (paper mode fills it on the next wakeup tick; live mode fills
        // server-side), so the exit fee may not yet be reflected.
        const tickerPrice = tickers[productIdFor(pos.asset)]?.midPrice ?? null;
        const exitPrice = result.fillPrice ?? result.price ?? tickerPrice;
        const entryPrice = parseFloat(pos.entryPrice);
        const grossPnlUsd = exitPrice != null ? (exitPrice - entryPrice) * qty : null;
        const totalFees = await sumFilledOrderFeesForPositionForCurrentMode(pos.id);
        const netPnlUsd = grossPnlUsd != null ? grossPnlUsd - totalFees : null;
        await updatePosition(pos.id, {
          status: "closed",
          exitTime: new Date(),
          exitReason: "operator_close_all",
          exitPrice: exitPrice != null ? exitPrice.toString() : null,
          grossPnlUsd: grossPnlUsd != null ? grossPnlUsd.toString() : null,
          feesUsd: totalFees.toString(),
          netPnlUsd: netPnlUsd != null ? netPnlUsd.toString() : null,
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
