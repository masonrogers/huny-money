"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { useApi, apiPost } from "@/lib/hooks/api";
import { Bitcoin, Bot, Loader2, Pause, Play, RefreshCw, Repeat, Wallet, X } from "lucide-react";
import type { DashboardStatusPayload } from "@/app/api/dashboard/status/route";

export default function ControlsPage() {
  const { data, mutate } = useApi<DashboardStatusPayload>("/api/dashboard/status");
  const [busy, setBusy] = useState<string | null>(null);
  const [closeAllOpen, setCloseAllOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [reAnchorOpen, setReAnchorOpen] = useState(false);

  const paused = data?.paused ?? false;
  const mode = data?.mode ?? "paper";
  const target: "paper" | "live" = mode === "paper" ? "live" : "paper";

  async function pauseTrading(p: boolean) {
    setBusy(p ? "pause" : "resume");
    try {
      await apiPost("/api/controls/pause", { paused: p });
      toast.success(p ? "Trading paused" : "Trading resumed");
      await mutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function postControl(
    label: string,
    url: string,
    body?: unknown,
  ): Promise<void> {
    setBusy(label);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(json.message ?? `${label} succeeded`);
        await mutate();
      } else {
        const detail = json.error ?? json.message ?? `HTTP ${res.status}`;
        toast.error(`${label} failed: ${detail}`, { duration: 8_000 });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Controls"
        description="Manual interventions. Each action is logged to app_decisions for the audit trail."
      />

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
                <Badge variant={data?.pausedByBtcUnderperfGate ? "danger" : "warning"}>
                  {data?.pausedByBtcUnderperfGate ? "Auto-paused" : "Paused"}
                </Badge>
              ) : (
                <Badge variant="success">Active</Badge>
              )}
            </div>
            {paused && data?.pausedReason && (
              <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed border border-[var(--color-border)] rounded-md p-2 bg-[var(--color-surface-2)]">
                <span className="font-medium text-[var(--color-text-primary)]">Reason:</span>{" "}
                {data.pausedReason}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant={paused ? "secondary" : "primary"}
                onClick={() => pauseTrading(true)}
                disabled={paused || busy != null}
              >
                {busy === "pause" ? <Loader2 className="animate-spin" /> : <Pause />}
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
            <Button
              onClick={() => postControl("Force brief", "/api/controls/force-brief")}
              disabled={busy != null}
            >
              {busy === "Force brief" ? <Loader2 className="animate-spin" /> : <Bot />}
              Force brief now
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Force reconciliation</CardTitle>
            <CardDescription>
              Re-runs the boot reconciliation sequence without a restart. Verifies all open
              positions have active stops on the exchange, reconciles order status, detects
              5%+ price moves during downtime.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => postControl("Force reconcile", "/api/controls/force-reconcile")}
              disabled={busy != null}
            >
              {busy === "Force reconcile" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Force reconcile
            </Button>
          </CardContent>
        </Card>

        <Card className="border-[var(--color-warning)]/30">
          <CardHeader>
            <CardTitle>Mode toggle</CardTitle>
            <CardDescription>
              Switch between paper and live trading. Requires typed-phrase confirmation +
              zero open positions in either mode + Phase 1 criteria pass (for paper→live).
              Takes effect on next boot — the executor object IS the mode and must be reloaded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => setToggleOpen(true)}
              disabled={busy != null}
            >
              <Repeat />
              Toggle to {target}…
            </Button>
          </CardContent>
        </Card>

        <Card className="border-[var(--color-danger)]/30">
          <CardHeader>
            <CardTitle>Close all positions</CardTitle>
            <CardDescription>
              Market-exit every open position for the current mode. Double-confirmation
              required. Use only as a kill switch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="danger"
              onClick={() => setCloseAllOpen(true)}
              disabled={busy != null}
            >
              <X />
              Close all…
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Re-anchor starting capital</CardTitle>
            <CardDescription>
              Reads current Coinbase balances across the full strategy universe (USD/USDC +
              BTC/ETH/AERO/LINK/AAVE/UNI/SOL), marks each to market, and resets
              starting_capital, the BTC anchor, and the equity-curve seeds for the current
              mode. Use this if first-launch captured the wrong capital (e.g. before the
              full-asset scan landed) or if you've added/withdrawn funds. Equity curve
              restarts from this snapshot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => setReAnchorOpen(true)}
              disabled={busy != null}
            >
              <Wallet />
              Re-anchor capital…
            </Button>
          </CardContent>
        </Card>

        <Card className="border-[var(--color-warning)]/30">
          <CardHeader>
            <CardTitle>Convert to BTC core hold</CardTitle>
            <CardDescription>
              Closes all positions, buys BTC with all available USDC, halts active trading.
              Irreversible. The §4.4 honesty-check fallback when 60-day BTC underperformance
              fires.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => setConvertOpen(true)}
              disabled={busy != null}
            >
              <Bitcoin />
              Convert to BTC core hold…
            </Button>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={reAnchorOpen}
        onOpenChange={setReAnchorOpen}
        title="Re-anchor starting capital from Coinbase?"
        description={
          <>
            This reads current Coinbase balances across <strong>USD, USDC, BTC, ETH, AERO,
            LINK, AAVE, UNI, SOL</strong>, sums to a new total, and resets the current mode's{" "}
            <code>starting_capital</code>, BTC buy-and-hold anchor, and equity-curve seeds.
            The equity curve <strong>restarts</strong> from this snapshot — historical
            equity rows aren't deleted, but the headline metrics are anchored to today.
            Idempotent and safe to re-run.
          </>
        }
        tone="warning"
        confirmLabel="Re-anchor capital"
        onConfirm={async (payload) =>
          postControl("Re-anchor capital", "/api/controls/re-anchor-capital", payload)
        }
      />

      <ConfirmDialog
        open={closeAllOpen}
        onOpenChange={setCloseAllOpen}
        title="Close all open positions?"
        description="This market-exits every open position for the current mode. Existing limit/stop orders are cancelled. Cannot be undone."
        tone="danger"
        doubleConfirm
        confirmLabel="Close all positions"
        onConfirm={async (payload) =>
          postControl("Close all", "/api/controls/close-all", payload)
        }
      />

      <ConfirmDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        title="Convert to BTC core hold?"
        description={
          <>
            <strong>This is the strategy kill switch.</strong> All positions close, all
            USDC swaps for BTC, and trading halts. Used when the bot has failed the
            60-day BTC benchmark gate. Reversing this requires manual database
            intervention AND a restart.
          </>
        }
        tone="warning"
        doubleConfirm
        typedPhrase="convert to btc core hold"
        confirmLabel="Halt and convert"
        onConfirm={async (payload) =>
          postControl("Convert to BTC core hold", "/api/controls/convert-to-btc-hold", payload)
        }
      />

      <ConfirmDialog
        open={toggleOpen}
        onOpenChange={setToggleOpen}
        title={`Switch from ${mode} to ${target} mode?`}
        description={
          <>
            The mode flip is rejected if there are open positions in either mode, pending
            orders, or (for paper→live) Phase 1 advance criteria are not yet met. The change
            takes effect on the <strong>next boot</strong> — the running executor is the
            previous mode until then.
          </>
        }
        tone="warning"
        typedPhrase={`transition to ${target} trading`}
        confirmLabel={`Schedule transition to ${target}`}
        onConfirm={async (payload) =>
          postControl("Toggle mode", "/api/controls/toggle-mode", {
            target,
            typedPhrase: payload.typedPhrase,
          })
        }
      />
    </div>
  );
}
