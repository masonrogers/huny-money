import { NextResponse } from "next/server";
import { stateWriter, errorLogger, appDecisionLogger } from "@/lib/db/utils";
import { getExecutor } from "@/lib/execution";
import { openPositionsForCurrentMode, updatePosition } from "@/lib/db/queries/positions";
import { getAllBalances, getTicker } from "@/lib/coinbase";
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

    // 1. Close all open positions
    const open = await openPositionsForCurrentMode();
    for (const pos of open) {
      try {
        await executor.placeMarketExit(pos.asset, parseFloat(pos.quantity), {
          relatedPositionId: pos.id,
        });
        await updatePosition(pos.id, {
          status: "closed",
          exitTime: new Date(),
          exitReason: "convert_to_btc_core_hold",
        });
      } catch (err) {
        log.error("Failed to close position during BTC core hold conversion", {
          positionId: pos.id,
          error: (err as Error).message,
        });
        // Continue — we want to halt regardless
      }
    }

    // 2. Buy BTC with all available USDC
    let btcBuyResult: { quantity: number; price: number } | null = null;
    try {
      const balances = await getAllBalances(["USDC", "USD"]);
      const cashAvailable = (balances.USDC?.available ?? 0) + (balances.USD?.available ?? 0);
      const ticker = await getTicker("BTC-USD");
      if (cashAvailable > 50) {
        const btcQty = (cashAvailable / ticker.midPrice) * 0.999; // 0.1% buffer for fees
        await executor.placeDcaLimitBuy("BTC", ticker.midPrice, btcQty);
        btcBuyResult = { quantity: btcQty, price: ticker.midPrice };
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
      inputs: { trigger: "convert_to_btc_hold", openClosed: open.length },
      outputs: { btcBuyResult, phase: "halted", paused: true },
      reasoning:
        "Operator-triggered convert to BTC core hold. All positions closed, all USDC swapped for BTC, trading halted. Irreversible without manual state intervention.",
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
