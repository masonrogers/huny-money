import { ListChecks } from "lucide-react";
import { PageStub } from "@/components/page-stub";

export default function DecisionsPage() {
  return (
    <PageStub
      title="Decisions & Triggers"
      description='The "why did the bot do (or not do) X?" page.'
      phaseRef="Phase 7.6"
      icon={<ListChecks />}
      whatGoesHere={
        <>
          Today&apos;s watch list with each trigger&apos;s current state. Recent
          wake-up history (chronological): trigger type, observed value,
          dispatched? suppressed (with reason)? resulting Sonnet eval link,
          escalated to Opus? action taken? Wake-up statistics per trigger
          type (fire counts, escalation rates, actionable rates over 7d/30d).
          App decisions stream (budget gate, model routing, debounce, dispatch,
          reconciliation, circuit breakers) with inputs/outputs/reasoning.
          State change log answering &quot;what was the value of X at
          time T?&quot;.
        </>
      }
    />
  );
}
