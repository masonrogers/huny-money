"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { useApi, apiPost } from "@/lib/hooks/api";
import { Bot, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import type { DashboardStatusPayload } from "@/app/api/dashboard/status/route";

export default function ControlsPage() {
  const { data, mutate } = useApi<DashboardStatusPayload>("/api/dashboard/status");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );

  async function pauseTrading(paused: boolean) {
    setBusy(paused ? "pause" : "resume");
    setFeedback(null);
    try {
      await apiPost("/api/controls/pause", { paused });
      setFeedback({ tone: "success", text: paused ? "Trading paused" : "Trading resumed" });
      await mutate();
    } catch (err) {
      setFeedback({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function forceBrief() {
    setBusy("brief");
    setFeedback(null);
    try {
      const res = await fetch("/api/controls/force-brief", { method: "POST" });
      const body = await res.json();
      setFeedback({
        tone: res.ok ? "success" : "danger",
        text: body.message ?? (res.ok ? "Forced brief" : "Failed"),
      });
    } catch (err) {
      setFeedback({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const paused = data?.paused ?? false;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Controls"
        description="Manual interventions. Each action is logged to app_decisions for the audit trail."
      />

      {feedback && (
        <div
          className={`text-sm rounded-md px-4 py-3 border ${
            feedback.tone === "success"
              ? "bg-[var(--color-success-bg)] border-[var(--color-success)]/30 text-[var(--color-success)]"
              : "bg-[var(--color-danger-bg)] border-[var(--color-danger)]/30 text-[var(--color-danger)]"
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Trading state</CardTitle>
            <CardDescription>
              Pause halts new entries; existing positions continue to be managed by their stops
              and theses. Resume re-enables entries.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--color-text-muted)]">Status:</span>
              {paused ? (
                <Badge variant="warning">Paused</Badge>
              ) : (
                <Badge variant="success">Active</Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant={paused ? "secondary" : "primary"}
                onClick={() => pauseTrading(true)}
                disabled={paused || busy != null}
              >
                {busy === "pause" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Pause />
                )}
                Pause
              </Button>
              <Button
                variant={!paused ? "secondary" : "primary"}
                onClick={() => pauseTrading(false)}
                disabled={!paused || busy != null}
              >
                {busy === "resume" ? <Loader2 className="animate-spin" /> : <Play />}
                Resume
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Force morning brief</CardTitle>
            <CardDescription>
              Run a morning brief immediately. Counts against the monthly API budget. Useful for
              testing prompt changes or after a strategy parameter update.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={forceBrief} disabled={busy != null}>
              {busy === "brief" ? <Loader2 className="animate-spin" /> : <Bot />}
              Force brief now
            </Button>
            <p className="text-xs text-[var(--color-text-faint)] mt-3">
              Wired in Phase 9 — currently returns a 501 to acknowledge intent. Use the manual
              cron trigger via API in the meantime.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Force reconciliation</CardTitle>
            <CardDescription>
              Re-runs the boot reconciliation sequence without a restart. Verifies all open
              positions have active stops on the exchange, reconciles order status, detects 5%+
              price moves.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled>
              <RefreshCw />
              Force reconcile
            </Button>
            <p className="text-xs text-[var(--color-text-faint)] mt-3">Wired in Phase 9.</p>
          </CardContent>
        </Card>

        <Card className="border-[var(--color-warning)]/30">
          <CardHeader>
            <CardTitle>Mode toggle</CardTitle>
            <CardDescription>
              Switch between paper and live trading. Requires typed-phrase confirmation. Takes
              effect on next boot — the executor object is the mode and must be reloaded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" disabled>
              Toggle mode…
            </Button>
            <p className="text-xs text-[var(--color-text-faint)] mt-3">
              Confirmation modal lands in Phase 8 polish. Endpoint at /api/controls/toggle-mode
              already enforces all §13.5 preconditions.
            </p>
          </CardContent>
        </Card>

        <Card className="border-[var(--color-danger)]/30">
          <CardHeader>
            <CardTitle>Close all positions</CardTitle>
            <CardDescription>
              Market-exit all open positions. Cancels all open orders. Double-confirmation
              required. Use only as a kill switch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="danger" disabled>
              Close all (double-confirm)
            </Button>
            <p className="text-xs text-[var(--color-text-faint)] mt-3">Wired in Phase 9.</p>
          </CardContent>
        </Card>

        <Card className="border-[var(--color-warning)]/30">
          <CardHeader>
            <CardTitle>Convert to BTC core hold</CardTitle>
            <CardDescription>
              Closes all positions, buys BTC with all available USDC, halts active trading.
              Irreversible. Used as the §4.4 honesty-check fallback when 60-day BTC
              underperformance fires.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" disabled>
              Convert to BTC core hold
            </Button>
            <p className="text-xs text-[var(--color-text-faint)] mt-3">Wired in Phase 9.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
