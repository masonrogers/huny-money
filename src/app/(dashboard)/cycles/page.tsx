import { TrendingUp } from "lucide-react";
import { PageStub } from "@/components/page-stub";

export default function CyclePositionPage() {
  return (
    <PageStub
      title="Cycle Position"
      description="Per-watchlist-asset 6-month range visualization with current cycle position and bot entries/exits overlaid."
      phaseRef="Phase 7.5"
      icon={<TrendingUp />}
      whatGoesHere={
        <>
          Per asset (AERO, LINK, AAVE, UNI, SOL, +1): 6-month price chart with
          cycle low zone (bottom 30%) and cycle high zone (top 25%) shaded,
          current cycle position % marked, history of bot entries/exits on
          this asset overlaid, volume profile, recent news for the asset.
          This is the core instrument the operator uses to evaluate AI
          judgment on cycle calls.
        </>
      }
    />
  );
}
