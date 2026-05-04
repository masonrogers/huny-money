import { stateRead } from "@/lib/db/utils";
import { setCurrentMode } from "@/lib/mode";
import {
  openPositionsForCurrentMode,
  closedPositionsForCurrentMode,
} from "@/lib/db/queries/positions";
import { safeDashboardHandler } from "@/lib/api/safe-handler";
import type { Position } from "@/lib/db/schema";

export interface PositionRow {
  id: string;
  asset: string;
  type: "btc_core" | "alt_cycle";
  status: "open" | "closed";
  entryPrice: number;
  quantity: number;
  stopPrice: number | null;
  targetPrice: number | null;
  convictionAtEntry: number | null;
  catalyst: string | null;
  thesis: string | null;
  entryTime: string;
  exitPrice: number | null;
  exitTime: string | null;
  exitReason: string | null;
  grossPnlUsd: number | null;
  feesUsd: number | null;
  netPnlUsd: number | null;
  strategyVersion: string;
  regimeAtEntry: string | null;
  stopOrderId: string | null;
  tpOrderId: string | null;
  entryOrderId: string | null;
  paperMode: boolean;
}

export interface PositionsPayload {
  open: PositionRow[];
  recentClosed: PositionRow[];
  dbReady: boolean;
}

function toRow(p: Position): PositionRow {
  return {
    id: p.id,
    asset: p.asset,
    type: p.type,
    status: p.status,
    entryPrice: Number(p.entryPrice),
    quantity: Number(p.quantity),
    stopPrice: p.stopPrice != null ? Number(p.stopPrice) : null,
    targetPrice: p.targetPrice != null ? Number(p.targetPrice) : null,
    convictionAtEntry: p.convictionAtEntry,
    catalyst: p.catalyst,
    thesis: p.thesis,
    entryTime: p.entryTime.toISOString(),
    exitPrice: p.exitPrice != null ? Number(p.exitPrice) : null,
    exitTime: p.exitTime ? p.exitTime.toISOString() : null,
    exitReason: p.exitReason,
    grossPnlUsd: p.grossPnlUsd != null ? Number(p.grossPnlUsd) : null,
    feesUsd: p.feesUsd != null ? Number(p.feesUsd) : null,
    netPnlUsd: p.netPnlUsd != null ? Number(p.netPnlUsd) : null,
    strategyVersion: p.strategyVersion,
    regimeAtEntry: p.regimeAtEntry,
    stopOrderId: p.stopOrderId,
    tpOrderId: p.tpOrderId,
    entryOrderId: p.entryOrderId,
    paperMode: p.paperMode,
  };
}

export async function GET() {
  return safeDashboardHandler<PositionsPayload>(
    "api.dashboard.positions",
    { open: [], recentClosed: [], dbReady: false },
    async () => {
      // Read mode from state and seed the mode singleton so the query helpers
      // mode-filter correctly. Boot would normally do this, but the dashboard
      // routes run in their own request context.
      const paperMode = (await stateRead<boolean>("paper_mode")) ?? true;
      setCurrentMode(paperMode ? "paper" : "live");

      const [open, closed] = await Promise.all([
        openPositionsForCurrentMode(),
        closedPositionsForCurrentMode(50),
      ]);
      return {
        open: open.map(toRow),
        recentClosed: closed.map(toRow),
        dbReady: true,
      };
    },
  );
}
