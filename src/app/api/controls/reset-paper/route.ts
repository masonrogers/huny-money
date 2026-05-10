import { NextResponse } from "next/server";
import { stateRead, stateWriter, errorLogger, appDecisionLogger } from "@/lib/db/utils";
import {
  deleteAllPositionsForCurrentMode,
  openPositionsForCurrentMode,
} from "@/lib/db/queries/positions";
import { deleteAllOrdersForCurrentMode } from "@/lib/db/queries/orders";
import { getTicker } from "@/lib/coinbase";
import { setCurrentMode, getCurrentMode } from "@/lib/mode";
import { PAPER_STARTING_CAPITAL_USD } from "@/lib/strategy/constants";
import { log } from "@/lib/logger";

/**
 * Reset paper progress.
 *
 * Wipes everything paper-specific and seeds the synthetic paper account
 * fresh. Live mode is rejected outright — this control only ever touches
 * paper rows (the helpers it calls also assert the mode).
 *
 * What gets wiped:
 *   - Every row in `positions` with paper_mode = true (open + closed)
 *   - Every row in `orders` with paper_mode = true
 *   - state.pending_entry_ladders (queued tranche-2 records)
 *   - state.last_executed_brief_eval_id (so the next brief executes fresh)
 *   - state.cooldown_until (was tied to wiped trade history)
 *   - state.trading_paused_reason + ..._by_btc_underperf_gate (clear stale
 *     auto-pause text)
 *
 * What gets re-seeded (synthetic, no real-wallet read):
 *   - starting_capital_paper_usd  → operator-supplied or PAPER_STARTING_CAPITAL_USD
 *   - btc_price_at_start_paper    → public BTC ticker
 *   - last_equity_paper_usd       → starting capital
 *   - last_cash_paper_usd         → starting capital
 *   - last_positions_value_paper_usd → 0
 *   - peak_value_paper_usd        → starting capital
 *   - trading_paused              → false (fresh start)
 *
 * What is NOT touched:
 *   - evaluations, app_decisions, system_state_history, errors,
 *     api_spend, price_snapshots — the audit trail survives the reset.
 *     If the operator wants those gone too, that's a manual DB op.
 *
 * Confirmation: requires typed phrase "reset paper progress" + confirmed=true.
 */
const REQUIRED_PHRASE = "reset paper progress";

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

    // Mode gate: paper only. Belt + braces — the queries also assert mode.
    const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
    if (!paperMode) {
      return NextResponse.json(
        { ok: false, error: "reset-paper refused: bot is in live mode" },
        { status: 400 },
      );
    }
    setCurrentMode("paper");
    if (getCurrentMode() !== "paper") {
      return NextResponse.json(
        { ok: false, error: "internal: failed to set mode to paper for reset" },
        { status: 500 },
      );
    }

    // Resolve the new starting capital.
    const requested = body?.startingCapitalUsd;
    let startingCapital: number;
    if (requested !== undefined) {
      const n = Number(requested);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json(
          { ok: false, error: "startingCapitalUsd must be a positive number" },
          { status: 400 },
        );
      }
      startingCapital = n;
    } else {
      startingCapital = PAPER_STARTING_CAPITAL_USD;
    }

    // Snapshot the BEFORE-state for the audit log.
    const openBefore = await openPositionsForCurrentMode();
    const previousStartingCapital = await stateRead<number>(
      "starting_capital_paper_usd",
    );

    // Wipe paper trade history. ORDER MATTERS: orders FK -> positions, so
    // delete orders first or the second delete violates
    // orders_related_position_id_positions_id_fk (FINDINGS.md #23).
    const ordersDeleted = await deleteAllOrdersForCurrentMode();
    const positionsDeleted = await deleteAllPositionsForCurrentMode();

    // BTC anchor from public ticker (no balance read).
    const btcTicker = await getTicker("BTC-USD");
    const btcPriceUsd = btcTicker.midPrice;

    // Reseed all paper-mode state keys.
    const resets: Array<{ key: string; value: unknown }> = [
      { key: "starting_capital_paper_usd", value: startingCapital },
      { key: "btc_price_at_start_paper", value: btcPriceUsd },
      { key: "last_equity_paper_usd", value: startingCapital },
      { key: "last_cash_paper_usd", value: startingCapital },
      { key: "last_positions_value_paper_usd", value: 0 },
      { key: "peak_value_paper_usd", value: startingCapital },
      { key: "pending_entry_ladders", value: [] },
      { key: "last_executed_brief_eval_id", value: null },
      { key: "cooldown_until", value: null },
      { key: "trading_paused", value: false },
      { key: "trading_paused_reason", value: null },
      { key: "trading_paused_by_btc_underperf_gate", value: false },
    ];
    for (const r of resets) {
      await stateWriter({
        key: r.key,
        value: r.value,
        changedBy: "api.controls.reset-paper",
      });
    }

    await appDecisionLogger({
      decisionType: "circuit_breaker",
      inputs: {
        action: "reset_paper",
        previousStartingCapital,
        operatorSuppliedStartingCapital: requested ?? null,
        openPositionsBefore: openBefore.length,
      },
      outputs: {
        positionsDeleted,
        ordersDeleted,
        newStartingCapital: startingCapital,
        newBtcAnchor: btcPriceUsd,
      },
      reasoning: `Operator reset paper progress: wiped ${positionsDeleted} position(s) + ${ordersDeleted} order(s); reseeded synthetic capital to $${startingCapital.toFixed(2)}; BTC anchor at $${btcPriceUsd.toFixed(2)}. Equity curve restarts. Audit trail (evaluations, app_decisions, history) preserved.`,
    });

    log.warn("RESET PAPER PROGRESS executed by operator", {
      previousStartingCapital,
      newStartingCapital: startingCapital,
      positionsDeleted,
      ordersDeleted,
    });

    return NextResponse.json({
      ok: true,
      message: `Paper reset complete: ${positionsDeleted} position(s) + ${ordersDeleted} order(s) wiped. Fresh synthetic capital: $${startingCapital.toFixed(2)}.`,
      positionsDeleted,
      ordersDeleted,
      newStartingCapital: startingCapital,
      btcPriceUsd,
    });
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "api.controls.reset-paper",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
