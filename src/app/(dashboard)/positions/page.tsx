import { GanttChart } from "lucide-react";
import { PageStub } from "@/components/page-stub";

export default function PositionsPage() {
  return (
    <PageStub
      title="Positions"
      description="Open positions with full detail and timeline; closed positions table with sort and filter."
      phaseRef="Phase 7.4"
      icon={<GanttChart />}
      whatGoesHere={
        <>
          Open position cards (BTC core + alt cycles separately): asset, type,
          entry/current price, %P&amp;L, stop, target, trailing-stop progress,
          Coinbase order IDs (entry, stop, take-profit) so the operator can
          verify exchange-side protection, days held, conviction at entry,
          catalyst, full thesis. Timeline panel showing every AI evaluation
          that touched the position with the action taken. Closed positions
          table with sort/filter and trade lifecycle drill-in.
        </>
      }
    />
  );
}
