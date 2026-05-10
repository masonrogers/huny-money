import { NextResponse } from "next/server";
import { stateRead, stateWriter, errorLogger, appDecisionLogger } from "@/lib/db/utils";
import { fetchPortfolioSnapshot, getTicker } from "@/lib/coinbase";
import { openPositionsForCurrentMode } from "@/lib/db/queries/positions";
import { setCurrentMode } from "@/lib/mode";
import { PAPER_STARTING_CAPITAL_USD } from "@/lib/strategy/constants";
import { log } from "@/lib/logger";

/**
 * Re-anchor starting capital.
 *
 * Behavior is mode-aware (STRATEGY.md §13.6 — paper accounting must NEVER
 * read the real Coinbase wallet):
 *
 *   PAPER mode:
 *     - `startingCapitalUsd` operator-supplied (default PAPER_STARTING_CAPITAL_USD)
 *     - BTC anchor pulled from the public ticker feed only
 *     - Resets all `_paper_` equity / cash / peak / positions-value state keys
 *     - Does NOT touch `positions` or `orders` — see /api/controls/reset-paper
 *       for a full paper-progress wipe
 *
 *   LIVE mode:
 *     - Reads the real Coinbase portfolio snapshot
 *     - Used when a live-mode first-launch captured the wrong total
 *
 * Confirmation: requires `confirmed: true` in the body. The dashboard
 * wraps this in a single-step confirm dialog.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.confirmed !== true) {
      return NextResponse.json(
        { ok: false, error: "Confirmation required: { confirmed: true }" },
        { status: 400 },
      );
    }

    const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
    const mode: "paper" | "live" = paperMode ? "paper" : "live";
    const suffix = mode;
    setCurrentMode(mode);

    // Refuse re-anchor if there are open positions (FINDINGS.md #26).
    // Re-anchor blindly writes last_cash = totalUsd and last_positions_value
    // = 0, which lies about state when positions are held. The next brief
    // would then read wildly wrong context. Operator must close-all or
    // reset-paper FIRST. Same idea as toggle-mode's open-position gate.
    const openPositions = await openPositionsForCurrentMode();
    if (openPositions.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Refused: ${openPositions.length} open position(s) exist. Re-anchor would corrupt cash + positions-value bookkeeping. Use /api/controls/close-all or /api/controls/reset-paper first.`,
        },
        { status: 409 },
      );
    }

    const previousStartingCapital = await stateRead<number>(
      `starting_capital_${suffix}_usd`,
    );

    let totalUsd: number;
    let cashUsd: number;
    let btcPriceUsd: number;
    let breakdown: unknown = null;

    if (mode === "paper") {
      const requested = body?.startingCapitalUsd;
      if (requested !== undefined) {
        const n = Number(requested);
        if (!Number.isFinite(n) || n <= 0) {
          return NextResponse.json(
            { ok: false, error: "startingCapitalUsd must be a positive number" },
            { status: 400 },
          );
        }
        totalUsd = n;
      } else {
        totalUsd = PAPER_STARTING_CAPITAL_USD;
      }
      cashUsd = totalUsd; // paper resets to all-cash; positions wiped via reset-paper
      const btcTicker = await getTicker("BTC-USD");
      btcPriceUsd = btcTicker.midPrice;
    } else {
      // Live mode: snapshot real Coinbase balances. Operator can't override
      // the number — we want the real total, not a fiction.
      const snapshot = await fetchPortfolioSnapshot();
      totalUsd = snapshot.totalUsd;
      cashUsd = snapshot.cashUsd;
      btcPriceUsd = snapshot.btcPriceUsd;
      breakdown = {
        holdings: snapshot.holdings,
        missingPriceAssets: snapshot.missingPriceAssets,
      };
    }

    await stateWriter({
      key: `starting_capital_${suffix}_usd`,
      value: totalUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `btc_price_at_start_${suffix}`,
      value: btcPriceUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `last_equity_${suffix}_usd`,
      value: totalUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `last_cash_${suffix}_usd`,
      value: cashUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `last_positions_value_${suffix}_usd`,
      value: totalUsd - cashUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `peak_value_${suffix}_usd`,
      value: totalUsd,
      changedBy: "api.controls.re-anchor-capital",
    });

    await appDecisionLogger({
      decisionType: "circuit_breaker",
      inputs: {
        action: "re_anchor_capital",
        mode,
        previousStartingCapital,
        operatorSupplied: mode === "paper" ? body?.startingCapitalUsd ?? null : null,
      },
      outputs: {
        cashUsd,
        totalUsd,
        btcPriceUsd,
        breakdown,
      },
      reasoning:
        mode === "paper"
          ? `Re-anchored paper-mode starting capital from $${(previousStartingCapital ?? 0).toFixed(2)} to $${totalUsd.toFixed(2)} (synthetic — does not reference real wallet). Equity curve restarts from this point. Open paper positions are NOT wiped — use /reset-paper for that.`
          : `Re-anchored live-mode starting capital from $${(previousStartingCapital ?? 0).toFixed(2)} to $${totalUsd.toFixed(2)} (from real Coinbase snapshot). Equity curve restarts from this point.`,
    });

    log.warn("RE-ANCHOR CAPITAL executed by operator", {
      mode,
      previousStartingCapital,
      newStartingCapital: totalUsd,
      cashUsd,
    });

    return NextResponse.json({
      ok: true,
      message:
        mode === "paper"
          ? `Paper capital re-anchored: $${totalUsd.toFixed(2)} (was $${(previousStartingCapital ?? 0).toFixed(2)}). Synthetic dollars — separate from your Coinbase wallet.`
          : `Live capital re-anchored: $${totalUsd.toFixed(2)} (was $${(previousStartingCapital ?? 0).toFixed(2)}).`,
      mode,
      previousStartingCapital,
      newStartingCapital: totalUsd,
      cashUsd,
      btcPriceUsd,
      breakdown,
    });
  } catch (err) {
    await errorLogger({
      severity: "error",
      component: "api.controls.re-anchor-capital",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
