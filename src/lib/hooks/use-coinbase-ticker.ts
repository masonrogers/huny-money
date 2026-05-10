"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Public Coinbase Exchange WebSocket ticker. No auth required for the ticker
 * channel. Used by the dashboard header strip for live BTC/ETH/SOL prices.
 *
 * NOT used for trading logic per STRATEGY.md "What NOT to Build" — the
 * trading-side price source is the 5-minute polling loop hitting the
 * authenticated REST API. This is display-only.
 */

export interface TickerData {
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24h: number;
  changePct24h: number;
  lastUpdate: number;
  /** Increments each tick — used for a brief flash animation. */
  tickSeq: number;
  /** "up" if price rose since last tick, "down" otherwise. */
  tickDir: "up" | "down" | "flat";
}

export type TickerMap = Record<string, TickerData>;

const WS_URL = "wss://ws-feed.exchange.coinbase.com";
const DEFAULT_PRODUCT_IDS = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;

export function useCoinbaseTicker(productIds: readonly string[] = DEFAULT_PRODUCT_IDS) {
  const [tickers, setTickers] = useState<TickerMap>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Stringify deps so caller-supplied arrays don't churn the effect on every
  // render. The caller usually passes the stable DEFAULT_PRODUCT_IDS or a
  // memoized list, but defensive against the inline-array case.
  const productKey = productIds.join(",");

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectDelay = RECONNECT_DELAY;
    const ids = productKey.split(",").filter(Boolean);

    function connect() {
      if (cancelled) return;
      if (ws?.readyState === WebSocket.OPEN) return;

      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!ws) return;
        setConnected(true);
        reconnectDelay = RECONNECT_DELAY;
        ws.send(
          JSON.stringify({
            type: "subscribe",
            product_ids: ids,
            channels: ["ticker"],
          }),
        );
      };

      ws.onmessage = (event) => {
        let data: {
          type?: string;
          product_id?: string;
          price?: string;
          open_24h?: string;
          high_24h?: string;
          low_24h?: string;
          volume_24h?: string;
        };
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type !== "ticker" || !data.product_id || !data.price) return;

        const price = parseFloat(data.price);
        const open = parseFloat(data.open_24h ?? "0");
        const change = price - open;
        const changePct = open > 0 ? (change / open) * 100 : 0;
        const symbol = data.product_id.replace("-USD", "");

        setTickers((prev) => {
          const previous = prev[symbol];
          const dir: TickerData["tickDir"] = previous
            ? price > previous.price
              ? "up"
              : price < previous.price
                ? "down"
                : previous.tickDir
            : "flat";
          return {
            ...prev,
            [symbol]: {
              price,
              open24h: open,
              high24h: parseFloat(data.high_24h ?? "0"),
              low24h: parseFloat(data.low_24h ?? "0"),
              volume24h: parseFloat(data.volume_24h ?? "0"),
              change24h: change,
              changePct24h: changePct,
              lastUpdate: Date.now(),
              tickSeq: (previous?.tickSeq ?? 0) + 1,
              tickDir: dir,
            },
          };
        });
      };

      ws.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
          connect();
        }, reconnectDelay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      wsRef.current = null;
    };
  }, [productKey]);

  return { tickers, connected };
}
