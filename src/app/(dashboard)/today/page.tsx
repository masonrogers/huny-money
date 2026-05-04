import { CalendarClock } from "lucide-react";
import { PageStub } from "@/components/page-stub";

export default function TodaysPlanPage() {
  return (
    <PageStub
      title="Today's Plan"
      description="The live morning brief, beautifully rendered."
      phaseRef="Phase 7.2"
      icon={<CalendarClock />}
      whatGoesHere={
        <>
          Today&apos;s regime call with evidence + 7-day regime history strip.
          BTC core decision (DCA in / hold / DCA out / exit) with reasoning.
          Alt watchlist with each asset&apos;s cycle position visualized as a
          colored bar (cycle low → mid → cycle high). Active alt positions
          with cycle progress, days held, P&amp;L, distance to next decision
          point. Today&apos;s watch list with current trigger states. The
          discipline check prominently displayed.
        </>
      }
    />
  );
}
