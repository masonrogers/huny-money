import { stateRead } from "@/lib/db/utils";
import { getCurrentMode } from "@/lib/mode";
import { openPositionsForCurrentMode, closedPositionsForCurrentMode } from "@/lib/db/queries/positions";
import type { Position } from "@/lib/db/schema";

/**
 * Portfolio state assembly for the AI data package.
 *
 * Reads mode-correct state keys (peak_value_paper_usd vs peak_value_live_usd,
 * etc.) per STRATEGY.md §13.3. All values are computed against the active
 * mode's anchor — paper P&L never contaminates live accounting.
 */

export interface PortfolioSnapshot {
  mode: "paper" | "live";
  startingCapitalUsd: number | null;
  currentTotalValueUsd: number;
  cashUsd: number;
  /** Total value including unrealized P&L on open positions. */
  unrealizedPnlUsd: number;
  /** P&L from inception (current value − starting capital), as a percent. */
  systemReturnPct: number;
  /** P&L vs BTC buy-and-hold from inception, as a percent (positive = beating BTC). */
  btcOutperformancePct: number | null;
  drawdownFromPeakPct: number;
  peakValueUsd: number | null;
  currentRegime: "bull" | "chop" | "bear" | null;
  daysInCurrentRegime: number | null;
  openPositions: Position[];
  closedPositions: Position[];
}

export interface PortfolioInput {
  /** Current USDC balance from Coinbase (or simulated for paper). */
  cashUsd: number;
  /** Mark-to-market value of all open positions. */
  positionsValueUsd: number;
  /** Current BTC price (used for benchmark computation). */
  currentBtcPrice: number;
}

export async function assemblePortfolioSnapshot(
  input: PortfolioInput,
): Promise<PortfolioSnapshot> {
  const mode = getCurrentMode();
  const suffix = mode === "paper" ? "paper" : "live";

  const [
    startingCapitalUsd,
    btcPriceAtStart,
    peakValueUsd,
    currentRegime,
    daysInCurrentRegime,
    openPositions,
    closedPositions,
  ] = await Promise.all([
    stateRead<number>(`starting_capital_${suffix}_usd`),
    stateRead<number>(`btc_price_at_start_${suffix}`),
    stateRead<number>(`peak_value_${suffix}_usd`),
    stateRead<"bull" | "chop" | "bear">("current_regime"),
    stateRead<number>("days_in_current_regime"),
    openPositionsForCurrentMode(),
    closedPositionsForCurrentMode(20),
  ]);

  const currentTotalValueUsd = input.cashUsd + input.positionsValueUsd;
  const unrealizedPnlUsd =
    startingCapitalUsd != null ? currentTotalValueUsd - startingCapitalUsd : 0;

  const systemReturnPct =
    startingCapitalUsd != null && startingCapitalUsd > 0
      ? ((currentTotalValueUsd - startingCapitalUsd) / startingCapitalUsd) * 100
      : 0;

  const btcOutperformancePct =
    btcPriceAtStart != null && btcPriceAtStart > 0
      ? systemReturnPct - ((input.currentBtcPrice - btcPriceAtStart) / btcPriceAtStart) * 100
      : null;

  const drawdownFromPeakPct =
    peakValueUsd != null && peakValueUsd > 0
      ? Math.max(0, ((peakValueUsd - currentTotalValueUsd) / peakValueUsd) * 100)
      : 0;

  return {
    mode,
    startingCapitalUsd,
    currentTotalValueUsd,
    cashUsd: input.cashUsd,
    unrealizedPnlUsd,
    systemReturnPct,
    btcOutperformancePct,
    drawdownFromPeakPct,
    peakValueUsd,
    currentRegime,
    daysInCurrentRegime,
    openPositions,
    closedPositions,
  };
}
