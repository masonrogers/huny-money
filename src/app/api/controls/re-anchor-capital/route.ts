import { NextResponse } from "next/server";
import { stateRead, stateWriter, errorLogger, appDecisionLogger } from "@/lib/db/utils";
import { fetchPortfolioSnapshot } from "@/lib/coinbase";
import { log } from "@/lib/logger";

/**
 * Re-anchor starting capital from current Coinbase balances.
 *
 * Use case: first-launch captured the wrong starting capital — for example
 * because the asset scan was incomplete (pre-fix it only checked
 * BTC/ETH/SOL and missed AERO/LINK/AAVE/UNI), or because funds were added
 * to the account after first-launch.
 *
 * What this does (idempotent):
 *   - Reads a fresh portfolio snapshot across the full strategy universe
 *   - Updates `starting_capital_<mode>_usd` to the new total
 *   - Updates `btc_price_at_start_<mode>` (the BTC buy-and-hold anchor)
 *   - Resets `last_equity_<mode>_usd`, `last_cash_<mode>_usd`,
 *     `last_positions_value_<mode>_usd`, `peak_value_<mode>_usd` so the
 *     dashboard's equity curve restarts cleanly from this anchor
 *   - Logs the per-asset breakdown to app_decisions
 *
 * What this does NOT do:
 *   - Does not import existing Coinbase holdings as managed `positions`
 *     rows. Paper mode's accounting is hypothetical: starting capital
 *     captures the wallet's value at anchor time and paper trading
 *     proceeds from there. Live-mode position import is a separate
 *     feature (TODO when paper→live transition is exercised).
 *   - Does not retroactively rewrite the equity-curve history. The curve
 *     restarts from this snapshot.
 *
 * Confirmation: requires `confirmed: true` in the body. The dashboard
 * button wraps this in a single-step confirm dialog (re-anchoring is
 * idempotent + doesn't touch positions/orders, so double-confirm is
 * overkill — simple confirm + visible per-asset breakdown is enough).
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

    const snapshot = await fetchPortfolioSnapshot();

    const previousStartingCapital = await stateRead<number>(
      `starting_capital_${suffix}_usd`,
    );

    await stateWriter({
      key: `starting_capital_${suffix}_usd`,
      value: snapshot.totalUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `btc_price_at_start_${suffix}`,
      value: snapshot.btcPriceUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `last_equity_${suffix}_usd`,
      value: snapshot.totalUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `last_cash_${suffix}_usd`,
      value: snapshot.cashUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `last_positions_value_${suffix}_usd`,
      value: snapshot.totalUsd - snapshot.cashUsd,
      changedBy: "api.controls.re-anchor-capital",
    });
    await stateWriter({
      key: `peak_value_${suffix}_usd`,
      value: snapshot.totalUsd,
      changedBy: "api.controls.re-anchor-capital",
    });

    await appDecisionLogger({
      decisionType: "circuit_breaker",
      inputs: {
        action: "re_anchor_capital",
        mode,
        previousStartingCapital,
      },
      outputs: {
        cashUsd: snapshot.cashUsd,
        totalUsd: snapshot.totalUsd,
        btcPriceUsd: snapshot.btcPriceUsd,
        holdings: snapshot.holdings,
        missingPriceAssets: snapshot.missingPriceAssets,
      },
      reasoning: `Re-anchored ${mode}-mode starting capital from $${previousStartingCapital ?? 0} to $${snapshot.totalUsd.toFixed(2)}. Equity curve restarts from this point.`,
    });

    log.warn("RE-ANCHOR CAPITAL executed by operator", {
      mode,
      previousStartingCapital,
      newStartingCapital: snapshot.totalUsd,
      cashUsd: snapshot.cashUsd,
      holdings: snapshot.holdings.length,
      missingPriceAssets: snapshot.missingPriceAssets,
    });

    return NextResponse.json({
      ok: true,
      message: `Capital re-anchored: $${snapshot.totalUsd.toFixed(2)} (was $${(previousStartingCapital ?? 0).toFixed(2)}). Equity curve will restart from this point.`,
      previousStartingCapital,
      snapshot: {
        cashUsd: snapshot.cashUsd,
        totalUsd: snapshot.totalUsd,
        btcPriceUsd: snapshot.btcPriceUsd,
        holdings: snapshot.holdings,
        missingPriceAssets: snapshot.missingPriceAssets,
      },
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
