import { NextResponse } from "next/server";
import { stateWriter, errorLogger, appDecisionLogger } from "@/lib/db/utils";
import { getExecutor } from "@/lib/execution";
import {
  openPositionsForCurrentMode,
  insertPosition,
  updatePosition,
} from "@/lib/db/queries/positions";
import { sumFilledOrderFeesForPositionForCurrentMode } from "@/lib/db/queries/orders";
import { getTicker, getTickers } from "@/lib/coinbase";
import { productIdFor, STRATEGY_VERSION } from "@/lib/strategy/constants";
import { log } from "@/lib/logger";

/**
 * Convert to BTC core hold per STRATEGY.md §4.4 + §6.4.
 *
 * The honesty-check fallback. When 60-day BTC underperformance fires (or
 * the operator decides the bot has no edge), this:
 * 1. Closes all open positions
 * 2. Buys BTC with all available USDC at the current price
 * 3. Sets phase = "halted" and trading_paused = true
 * 4. Continues to run the dashboard for monitoring, but no AI calls or
 *    new entries are made
 *
 * Irreversible — restarting active trading after a convert requires the
 * operator to manually flip phase and trading_paused via the database
 * AND restart the bot.
 *
 * Requires triple-confirmation: confirmed + confirmedAgain + typedPhrase
 * matching "convert to BTC core hold".
 */
const REQUIRED_PHRASE = "convert to btc core hold";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const confirmed = body?.confirmed === true && body?.confirmedAgain === true;
    const phrase = String(body?.typedPhrase ?? "").trim().toLowerCase();
    if (!confirmed || phrase !== REQUIRED_PHRASE) {
      return NextResponse.json(
        {
          ok: false,
          error: `Triple-confirmation required: confirmed:true + confirmedAgain:true + typedPhrase '${REQUIRED_PHRASE}'.`,
        },
        { status: 400 },
      );
    }

    const executor = getExecutor();

    // 1. Close all open positions with proper P&L. Same approach as
    //    close-all: aggregate fees across linked orders, fall back to a
    //    fresh ticker fetch when placeMarketExit returns `pending` (paper
    //    mode + live pre-reconciliation) so P&L isn't null.
    const open = await openPositionsForCurrentMode();
    const uniqueAssets = Array.from(new Set(open.map((p) => p.asset)));
    let closeTickers: Record<string, { midPrice: number }> = {};
    if (uniqueAssets.length > 0) {
      try {
        closeTickers = await getTickers(uniqueAssets.map(productIdFor));
      } catch (err) {
        log.warn("convert-to-btc-hold: ticker fetch failed; closes may have null P&L", {
          error: (err as Error).message,
        });
      }
    }
    for (const pos of open) {
      try {
        const qty = parseFloat(pos.quantity);
        const result = await executor.placeMarketExit(pos.asset, qty, {
          relatedPositionId: pos.id,
        });
        const tickerPrice = closeTickers[productIdFor(pos.asset)]?.midPrice ?? null;
        const exitPrice = result.fillPrice ?? result.price ?? tickerPrice;
        const entryPrice = parseFloat(pos.entryPrice);
        const grossPnlUsd = exitPrice != null ? (exitPrice - entryPrice) * qty : null;
        const totalFees = await sumFilledOrderFeesForPositionForCurrentMode(pos.id);
        const netPnlUsd = grossPnlUsd != null ? grossPnlUsd - totalFees : null;
        await updatePosition(pos.id, {
          status: "closed",
          exitTime: new Date(),
          exitReason: "convert_to_btc_core_hold",
          exitPrice: exitPrice != null ? exitPrice.toString() : null,
          grossPnlUsd: grossPnlUsd != null ? grossPnlUsd.toString() : null,
          feesUsd: totalFees.toString(),
          netPnlUsd: netPnlUsd != null ? netPnlUsd.toString() : null,
        });
      } catch (err) {
        log.error("Failed to close position during BTC core hold conversion", {
          positionId: pos.id,
          error: (err as Error).message,
        });
        // Continue — we want to halt regardless
      }
    }

    // 2. Buy BTC with all available cash (mode-correct via the executor —
    //    paper mode uses simulated paper cash, live mode uses real Coinbase
    //    USD+USDC balances). Using getAllBalances directly would route
    //    paper-mode conversions through real exchange balances and diverge
    //    from the paper accounting.
    let btcBuyResult: { quantity: number; price: number; positionId?: string } | null = null;
    let cashAvailable = 0;
    try {
      cashAvailable = await executor.getCashBalanceUsd();
      const ticker = await getTicker("BTC-USD");
      if (cashAvailable > 50) {
        const btcQty = (cashAvailable / ticker.midPrice) * 0.999; // 0.1% buffer for fees
        // Insert the btc_core position record FIRST so the order can link
        // to it via relatedPositionId. Same shape as decision-executor's
        // dca_in path. All prior positions were closed in step 1, so any
        // existing btc_core was already drained — always insert fresh here.
        const inserted = await insertPosition({
          asset: "BTC",
          type: "btc_core",
          status: "open",
          direction: "long",
          entryPrice: ticker.midPrice.toString(),
          quantity: btcQty.toString(),
          stopPrice: null, // BTC core has no trailing stop per STRATEGY.md §3.7
          targetPrice: null,
          convictionAtEntry: null,
          catalyst: "convert_to_btc_core_hold",
          thesis:
            "Operator-triggered honesty-check fallback per STRATEGY.md §4.4. " +
            "Bot is being halted; this position holds the residual BTC.",
          entryTime: new Date(),
          strategyVersion: STRATEGY_VERSION,
          regimeAtEntry: null,
          paperMode: executor.mode === "paper",
        });
        await executor.placeDcaLimitBuy("BTC", ticker.midPrice, btcQty, {
          relatedPositionId: inserted.id,
        });
        btcBuyResult = {
          quantity: btcQty,
          price: ticker.midPrice,
          positionId: inserted.id,
        };
      } else {
        log.warn("Convert-to-BTC: skipping BTC buy — cash below $50 floor", {
          cashAvailable,
        });
      }
    } catch (err) {
      log.error("Failed to buy BTC during core-hold conversion", {
        error: (err as Error).message,
      });
    }

    // 3. Halt trading
    await stateWriter({
      key: "phase",
      value: "halted",
      changedBy: "api.controls.convert-to-btc-hold",
    });
    await stateWriter({
      key: "trading_paused",
      value: true,
      changedBy: "api.controls.convert-to-btc-hold",
    });

    await appDecisionLogger({
      decisionType: "circuit_breaker",
      inputs: { trigger: "convert_to_btc_hold", openClosed: open.length, cashAvailable },
      outputs: { btcBuyResult, phase: "halted", paused: true },
      reasoning:
        "Operator-triggered convert to BTC core hold. All positions closed, available cash swapped for BTC (mode-correct), trading halted. Irreversible without manual state intervention.",
    });

    log.warn("CONVERT TO BTC CORE HOLD executed by operator", {
      closed: open.length,
      btcBuyResult,
    });

    return NextResponse.json({
      ok: true,
      closed: open.length,
      btcBuyResult,
      message: "Bot halted. All positions closed; cash converted to BTC. Trading is now disabled.",
    });
  } catch (err) {
    await errorLogger({
      severity: "critical",
      component: "api.controls.convert-to-btc-hold",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
