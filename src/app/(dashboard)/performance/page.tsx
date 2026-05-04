import { LineChart } from "lucide-react";
import { PageStub } from "@/components/page-stub";

export default function PerformancePage() {
  return (
    <PageStub
      title="Performance"
      description="Equity curve with BTC benchmark overlay as the dominant feature."
      phaseRef="Phase 7.7"
      icon={<LineChart />}
      whatGoesHere={
        <>
          Equity curve with toggleable timeframes (7d / 30d / 90d / all-time)
          and BTC benchmark overlay. <strong>&quot;Beating BTC over 30d /
          60d / all-time&quot;</strong> as headline metric with pass/fail
          badge — the most important number in the dashboard. Cumulative
          outperformance chart, drawdown chart, P&amp;L breakdown by asset
          and trade source, R-multiple distribution histogram, fee drag,
          API cost vs trading P&amp;L (the honest comparison), per-strategy-
          version segmentation when multiple versions exist.
        </>
      }
    />
  );
}
