"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface TickerData {
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24h: number;
  changePct24h: number;
  lastUpdate: number;
}

export type TickerMap = Record<string, TickerData>;

const WS_URL = "wss://ws-feed.exchange.coinbase.com";
const PRODUCT_IDS = ["BTC-USD", "ETH-USD", "SOL-USD"];
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;

export function useCoinbaseTicker() {
  const [tickers, setTickers] = useState<TickerMap>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_DELAY);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = RECONNECT_DELAY;
      ws.send(
        JSON.stringify({
          type: "subscribe",
          product_ids: PRODUCT_IDS,
          channels: ["ticker"],
        })
      );
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type !== "ticker") return;

      const price = parseFloat(data.price);
      const open = parseFloat(data.open_24h);
      const change = price - open;
      const changePct = open > 0 ? (change / open) * 100 : 0;
      const symbol = data.product_id.replace("-USD", "");

      setTickers((prev) => ({
        ...prev,
        [symbol]: {
          price,
          open24h: open,
          high24h: parseFloat(data.high_24h),
          low24h: parseFloat(data.low_24h),
          volume24h: parseFloat(data.volume_24h),
          change24h: change,
          changePct24h: changePct,
          lastUpdate: Date.now(),
        },
      }));
    };

    ws.onclose = () => {
      setConnected(false);
      if (!mountedRef.current) return;
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(
          reconnectDelay.current * 1.5,
          MAX_RECONNECT_DELAY
        );
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { tickers, connected };
}
