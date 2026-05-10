import { stateRead } from "@/lib/db/utils";
import { fetchPortfolioSnapshot } from "@/lib/coinbase";
import { safeDashboardHandler } from "@/lib/api/safe-handler";
import { log } from "@/lib/logger";

/**
 * Wallet + paper-equity payload for the persistent header + Overview page.
 *
 * Two completely separate ledgers:
 *
 *   1. Coinbase wallet (real money) — `coinbase.totalUsd`, `coinbase.cashUsd`,
 *      `coinbase.holdings`. Always shown for visibility, regardless of mode.
 *      The bot does NOT trade against this in paper mode.
 *
 *   2. Paper account (synthetic) — `paper.equityUsd`, `paper.startingCapitalUsd`.
 *      The bot's hypothetical portfolio. Maintained entirely in `state` keys
 *      and `positions`/`orders` rows with `paper_mode = true`.
 *
 * The Coinbase snapshot is cached for CACHE_TTL_MS server-side so the header's
 * 30s polling interval doesn't hammer Coinbase's API. If a fetch fails, we
 * return the last good value (or nulls if there is none).
 */

export interface WalletPayload {
  mode: "paper" | "live";
  coinbase: {
    totalUsd: number | null;
    cashUsd: number | null;
    holdings: Array<{ asset: string; quantity: number; valueUsd: number }>;
    snapshotAtIso: string | null;
    available: boolean;
    /** Reason if unavailable (rate limit, auth issue, etc.). */
    error: string | null;
  };
  paper: {
    equityUsd: number | null;
    cashUsd: number | null;
    startingCapitalUsd: number | null;
    /** Return % since paper start. */
    returnPct: number | null;
  };
  dbReady: boolean;
}

const CACHE_TTL_MS = 60_000; // 60s — header polls every 30s; halves Coinbase calls

interface CachedCoinbase {
  at: number;
  totalUsd: number;
  cashUsd: number;
  holdings: WalletPayload["coinbase"]["holdings"];
}

let cached: CachedCoinbase | null = null;
let lastError: string | null = null;

async function snapshotCoinbase(): Promise<CachedCoinbase | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
  try {
    const snap = await fetchPortfolioSnapshot();
    cached = {
      at: Date.now(),
      totalUsd: snap.totalUsd,
      cashUsd: snap.cashUsd,
      holdings: snap.holdings.map((h) => ({
        asset: h.asset,
        quantity: h.quantity,
        valueUsd: h.valueUsd,
      })),
    };
    lastError = null;
    return cached;
  } catch (err) {
    lastError = (err as Error).message;
    log.warn("Wallet snapshot failed", { error: lastError });
    return cached; // serve last good if available
  }
}

export async function GET() {
  return safeDashboardHandler<WalletPayload>(
    "api.dashboard.wallet",
    {
      mode: "paper",
      coinbase: {
        totalUsd: null,
        cashUsd: null,
        holdings: [],
        snapshotAtIso: null,
        available: false,
        error: null,
      },
      paper: {
        equityUsd: null,
        cashUsd: null,
        startingCapitalUsd: null,
        returnPct: null,
      },
      dbReady: false,
    },
    async () => {
      const [paperFlag, paperEquity, paperCash, paperStart, coinbaseSnap] =
        await Promise.all([
          stateRead<boolean>("paper_mode"),
          stateRead<number>("last_equity_paper_usd"),
          stateRead<number>("last_cash_paper_usd"),
          stateRead<number>("starting_capital_paper_usd"),
          snapshotCoinbase(),
        ]);

      const mode: "paper" | "live" = (paperFlag ?? true) ? "paper" : "live";
      const returnPct =
        paperEquity != null && paperStart != null && paperStart > 0
          ? ((paperEquity - paperStart) / paperStart) * 100
          : null;

      return {
        mode,
        coinbase: {
          totalUsd: coinbaseSnap?.totalUsd ?? null,
          cashUsd: coinbaseSnap?.cashUsd ?? null,
          holdings: coinbaseSnap?.holdings ?? [],
          snapshotAtIso: coinbaseSnap ? new Date(coinbaseSnap.at).toISOString() : null,
          available: coinbaseSnap != null,
          error: coinbaseSnap == null ? lastError : null,
        },
        paper: {
          equityUsd: paperEquity ?? null,
          cashUsd: paperCash ?? null,
          startingCapitalUsd: paperStart ?? null,
          returnPct,
        },
        dbReady: true,
      };
    },
  );
}
