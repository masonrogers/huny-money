"use client";

import { useEffect, useState } from "react";
import { useCoinbaseTicker, type TickerData } from "@/lib/hooks/use-coinbase-ticker";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/format";

/**
 * Live BTC/ETH/SOL price strip. Shown in the AppShell header.
 *
 * Display-only — uses the public Coinbase Exchange WebSocket (no auth).
 * Trading logic uses the authenticated REST API on a 5-min polling loop;
 * this hook never feeds trading decisions.
 */

const ASSETS = ["BTC", "ETH", "SOL"] as const;

export function PriceTicker() {
  const { tickers, connected } = useCoinbaseTicker();

  return (
    <div className="flex items-center gap-3" role="region" aria-label="Live prices">
      <div
        className={cn(
          "size-1.5 rounded-full transition-colors",
          connected ? "bg-[var(--color-success)]" : "bg-[var(--color-text-faint)]",
        )}
        aria-label={connected ? "WebSocket connected" : "WebSocket disconnected"}
      />
      <div className="flex items-center gap-4">
        {ASSETS.map((asset) => (
          <PricePill key={asset} asset={asset} ticker={tickers[asset]} />
        ))}
      </div>
    </div>
  );
}

function PricePill({ asset, ticker }: { asset: string; ticker?: TickerData }) {
  const [flashClass, setFlashClass] = useState("");
  const lastSeq = ticker?.tickSeq ?? 0;

  useEffect(() => {
    if (!ticker) return;
    if (ticker.tickDir === "up") setFlashClass("flash-up");
    else if (ticker.tickDir === "down") setFlashClass("flash-down");
    const t = setTimeout(() => setFlashClass(""), 350);
    return () => clearTimeout(t);
  }, [lastSeq, ticker]);

  const changeClass =
    ticker == null
      ? "text-[var(--color-text-faint)]"
      : ticker.changePct24h >= 0
        ? "text-[var(--color-success)]"
        : "text-[var(--color-danger)]";

  return (
    <div className={cn("flex items-baseline gap-1.5 transition-colors", flashClass)}>
      <span className="text-xs text-[var(--color-text-muted)] font-medium">{asset}</span>
      <span className="text-xs font-medium tnum text-[var(--color-text-primary)]">
        {ticker ? formatUsd(ticker.price) : "—"}
      </span>
      {ticker && (
        <span className={cn("text-[0.65rem] tnum", changeClass)}>
          {ticker.changePct24h >= 0 ? "+" : ""}
          {ticker.changePct24h.toFixed(2)}%
        </span>
      )}
      <style jsx>{`
        .flash-up {
          color: var(--color-success);
        }
        .flash-down {
          color: var(--color-danger);
        }
      `}</style>
    </div>
  );
}
