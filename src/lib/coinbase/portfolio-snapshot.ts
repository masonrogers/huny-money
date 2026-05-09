import { getAllBalances } from "./accounts";
import { getTickers } from "./market-data";
import { ALL_ASSETS, productIdFor } from "@/lib/strategy/constants";

/**
 * Snapshot of the operator's actual Coinbase wallet, valued in USD.
 *
 * Used at boot first-launch (to anchor starting_capital_<mode>_usd correctly)
 * and by the re-anchor-capital control (to recompute when the operator's
 * funds were wrong/missing at first-launch).
 *
 * Covers the FULL strategy universe: USD/USDC for cash + every asset in
 * ALL_ASSETS (BTC, ETH, AERO, LINK, AAVE, UNI, SOL). The previous boot
 * code only checked BTC/ETH/SOL, missing ~70% of the cycle watchlist —
 * any AERO/LINK/AAVE/UNI holding was invisible to the capital scan.
 */

export interface PortfolioHolding {
  asset: string;
  quantity: number;
  priceUsd: number;
  valueUsd: number;
}

export interface PortfolioSnapshot {
  /** USD + USDC — both treated as cash by the orchestration layer. */
  cashUsd: number;
  /** Per-asset breakdown. Only assets with quantity > 0 are included. */
  holdings: PortfolioHolding[];
  /** Sum of cashUsd + Σ holdings. */
  totalUsd: number;
  /** BTC price at snapshot time — used as the BTC-buy-and-hold anchor. */
  btcPriceUsd: number;
  /** Tickers that failed to fetch (asset in wallet, no price → excluded from totalUsd). */
  missingPriceAssets: string[];
}

/**
 * Reads Coinbase balances + market prices and returns a USD-valued snapshot.
 *
 * Throws if BTC ticker can't be fetched (we need it as the buy-and-hold
 * anchor; missing it makes the snapshot meaningless). Other tickers are
 * best-effort: a missing alt ticker logs the asset to `missingPriceAssets`
 * and excludes it from `totalUsd` rather than silently marking it $0.
 */
export async function fetchPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const balances = await getAllBalances(["USD", "USDC", ...ALL_ASSETS]);
  const cashUsd = (balances.USD?.total ?? 0) + (balances.USDC?.total ?? 0);

  const heldNonCash = ALL_ASSETS.filter((a) => (balances[a]?.total ?? 0) > 0);

  // Always fetch BTC — it's the anchor. Plus every held asset.
  const productsToPrice = Array.from(new Set(["BTC", ...heldNonCash])).map(productIdFor);
  const tickers = await getTickers(productsToPrice);

  const btcTicker = tickers[productIdFor("BTC")];
  if (!btcTicker || !Number.isFinite(btcTicker.midPrice) || btcTicker.midPrice <= 0) {
    throw new Error("fetchPortfolioSnapshot: BTC ticker unavailable — refusing to snapshot");
  }
  const btcPriceUsd = btcTicker.midPrice;

  const holdings: PortfolioHolding[] = [];
  const missingPriceAssets: string[] = [];

  for (const asset of heldNonCash) {
    const qty = balances[asset]?.total ?? 0;
    if (qty <= 0) continue;
    const ticker = tickers[productIdFor(asset)];
    const price = ticker?.midPrice;
    if (!price || !Number.isFinite(price) || price <= 0) {
      missingPriceAssets.push(asset);
      continue;
    }
    holdings.push({
      asset,
      quantity: qty,
      priceUsd: price,
      valueUsd: qty * price,
    });
  }

  const totalUsd = cashUsd + holdings.reduce((sum, h) => sum + h.valueUsd, 0);

  return {
    cashUsd,
    holdings,
    totalUsd,
    btcPriceUsd,
    missingPriceAssets,
  };
}
