import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Sparkline } from "@/components/ui/sparkline";
import { Activity, TrendingUp } from "lucide-react";

/**
 * Overview view — the default landing page.
 *
 * Phase 6: layout + skeleton with placeholder data so the design system can
 * be reviewed end-to-end. Phase 7 wires real data via SWR + the dashboard
 * API routes.
 */
export default function OverviewPage() {
  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Overview"
        description="At-a-glance view of the bot's state, equity, and what just happened."
      />

      {/* Top metric strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total value"
          value="$500.03"
          delta="0.00%"
          deltaTone="muted"
          spark={[100, 100, 100, 100, 100, 100, 100]}
        />
        <MetricCard
          label="vs BTC hold (60d)"
          value="—"
          delta="awaiting data"
          deltaTone="muted"
        />
        <MetricCard
          label="Cash (USDC)"
          value="$500.03"
          delta="100% of capital"
          deltaTone="muted"
        />
        <MetricCard
          label="MTD API spend"
          value="$0.00"
          delta="of $50.00 cap"
          deltaTone="muted"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equity curve</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<TrendingUp />}
            title="No history yet"
            description="The equity curve appears once the bot has at least 24 hours of equity snapshots. The chart will overlay a BTC buy-and-hold benchmark."
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Today's plan</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={<Activity />}
              title="No morning brief yet"
              description="The first morning brief runs on the next 14:00 UTC scheduler tick. You'll see today's regime call, BTC core decision, alt cycle candidates, and the watch list here."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open positions</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              title="No positions open"
              description="The bot is in chop regime and currently sitting in cash. Positions appear here when the AI identifies an alt cycle entry candidate that meets all 7 entry criteria, or when the regime upgrades to bull and BTC core DCA begins."
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No activity to show"
            description="Morning briefs, Sonnet checkpoints, wake-up triggers, trades opened/closed, and errors appear here in chronological order."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-[var(--color-text-muted)]">{description}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  deltaTone,
  spark,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone: "success" | "danger" | "muted";
  spark?: number[];
}) {
  const deltaColor =
    deltaTone === "success"
      ? "text-[var(--color-success)]"
      : deltaTone === "danger"
        ? "text-[var(--color-danger)]"
        : "text-[var(--color-text-muted)]";
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          {label}
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div className="text-2xl font-semibold tnum">{value}</div>
          {spark && <Sparkline values={spark} tone="muted" width={70} height={20} />}
        </div>
        <div className={`mt-1.5 text-xs tnum ${deltaColor}`}>{delta}</div>
      </CardContent>
    </Card>
  );
}
