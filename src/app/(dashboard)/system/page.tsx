import { Activity } from "lucide-react";
import { PageStub } from "@/components/page-stub";

export default function SystemPage() {
  return (
    <PageStub
      title="System"
      description="Boot history, error log, API budget detail, phase progress."
      phaseRef="Phase 7.8"
      icon={<Activity />}
      whatGoesHere={
        <>
          Boot history with downtime durations + reconciliation outcomes.
          Error log filterable by severity (info / warning / error / critical)
          and component. API budget detail: MTD spend, daily spend chart, by
          call type, by model, projection vs cap. Cache hit rates per model.
          Last successful action per type (Opus call, Sonnet call,
          reconciliation, order placement, price poll). Phase progress card:
          every Phase 1 advance criterion with current value, threshold,
          pass/fail badge, days remaining.
        </>
      }
    />
  );
}
