import { Bot } from "lucide-react";
import { PageStub } from "@/components/page-stub";

export default function AiActivityPage() {
  return (
    <PageStub
      title="AI Activity"
      description="Chronological feed of every AI call. The most important page in the dashboard."
      phaseRef="Phase 7.3"
      icon={<Bot />}
      whatGoesHere={
        <>
          Filter bar: model (Opus/Sonnet), call type, date range, action taken.
          Each entry collapsed by default; expand to see the full rendered
          prompt (system prompt collapsed by hash, dynamic data shown), full
          raw response, parsed JSON with syntax highlighting, reasoning
          extracted, action taken with links to created entities, cost,
          tokens, cache hit rate, latency. Morning briefs get special card
          rendering (not raw JSON). Search box for full-text over prompts and
          responses.
        </>
      }
    />
  );
}
