import { Settings } from "lucide-react";
import { PageStub } from "@/components/page-stub";

export default function ControlsPage() {
  return (
    <PageStub
      title="Controls"
      description="Manual interventions: pause, close-all, force brief, mode toggle, params."
      phaseRef="Phase 7.9"
      icon={<Settings />}
      whatGoesHere={
        <>
          Pause / Resume. Close all positions (double-confirmation, market
          exits). Force morning brief now (counts against budget; warning
          shown if cap would be exceeded). Force reconciliation. Toggle
          paper / live mode (gated by Phase 1 criteria; double-confirmation
          if criteria pass; triple-confirmation if operator overrides).
          Convert to BTC core hold (irreversible, double-confirmation).
          Strategy parameters (read-only by default; edit-mode toggle exposes
          editing with required <code>changed_reason</code> text).
        </>
      }
    />
  );
}
