import { stateRead, stateWriter, errorLogger } from "@/lib/db/utils";
import {
  bootConstructExecutor,
  runBootReconciliation,
  CrossModeBootRejection,
} from "@/lib/execution";
import { clearModeChangePendingFlag } from "@/lib/execution/mode-transition";
import { assertTradeOnlyKey, getTicker } from "@/lib/coinbase";
import { startScheduler, type SchedulerHandlers } from "@/lib/scheduler";
import { runCycleRangeJob } from "@/lib/scheduler/cycle-range-job";
import { runScheduledMorningBrief } from "@/lib/orchestration/morning-brief";
import { runScheduledSonnetCheckpoint } from "@/lib/orchestration/sonnet-checkpoint";
import { runWakeupCycle } from "@/lib/orchestration/wakeup-cycle";
import { upsertParam } from "@/lib/db/queries/params";
import { PAPER_STARTING_CAPITAL_USD, STRATEGY_VERSION } from "@/lib/strategy/constants";
import { log } from "@/lib/logger";

/**
 * Boot sequence per STRATEGY.md §6.1 + §6.2.
 *
 * Called once per server start (from Next.js `instrumentation.ts`).
 *
 *   Order:
 *     1. Health checks (Coinbase TRADE-only key, DB reachable via stateRead)
 *     2. Determine first-launch vs restart
 *     3. First launch: capture starting capital, BTC anchor, default params
 *     4. Mode-aware reconciliation (cross-mode rejection halts boot)
 *     5. Construct executor (mode-locked for the session)
 *     6. Clear mode_change_pending flag (operator's pending toggle now applied)
 *     7. Start the scheduler (Opus morning, Sonnet checkpoints, cycle-range job)
 *
 * If anything in steps 1-4 throws fatally, the process is left in a halted
 * state — the executor is not constructed and the scheduler is not started.
 * The dashboard remains reachable so the operator can see the error.
 */

let bootCompleted = false;

export interface BootResult {
  firstLaunch: boolean;
  mode: "paper" | "live";
  startingCapitalUsd?: number;
  reconciliationFindings?: unknown;
}

export async function runBoot(): Promise<BootResult> {
  if (bootCompleted) {
    throw new Error("runBoot() called twice — this is a one-time per-process operation");
  }
  bootCompleted = true;

  log.info("Boot sequence starting");

  // 1. Coinbase TRADE-only assertion (refuses to start if withdrawal enabled)
  try {
    await assertTradeOnlyKey();
  } catch (err) {
    await errorLogger({
      severity: "critical",
      component: "boot",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
      recoveryAction: "Boot halted — fix the Coinbase API key permissions and restart",
    }).catch(() => {});
    throw err;
  }

  // 2. Detect first launch vs restart
  const lastBootAt = await stateRead<string>("last_boot_at");
  const firstLaunch = !lastBootAt;
  log.info(firstLaunch ? "First launch detected" : "Restart detected", { lastBootAt });

  // 3. First launch initialization
  let startingCapitalUsd: number | undefined;
  if (firstLaunch) {
    startingCapitalUsd = await initializeFirstLaunch();
  }

  // 4. Construct executor (this also seeds the mode singleton)
  const { executor, mode } = await bootConstructExecutor();

  // 5. Reconciliation — cross-mode rejection throws CrossModeBootRejection
  let reconciliationFindings: Awaited<ReturnType<typeof runBootReconciliation>> | undefined;
  try {
    reconciliationFindings = await runBootReconciliation({
      executor,
      fetchCurrentPrices: async () => {
        const [btc, eth, sol] = await Promise.all([
          getTicker("BTC-USD").then((t) => t.midPrice).catch(() => 0),
          getTicker("ETH-USD").then((t) => t.midPrice).catch(() => 0),
          getTicker("SOL-USD").then((t) => t.midPrice).catch(() => 0),
        ]);
        return { BTC: btc, ETH: eth, SOL: sol };
      },
    });
  } catch (err) {
    if (err instanceof CrossModeBootRejection) {
      // Halt: do not construct the rest of the runtime. The error is loud
      // enough that the operator will see it in logs and the dashboard.
      log.error("BOOT HALTED — cross-mode positions detected", {
        bootMode: err.bootMode,
        foundPaperOpen: err.foundPaperOpen,
        foundLiveOpen: err.foundLiveOpen,
      });
      throw err;
    }
    await errorLogger({
      severity: "critical",
      component: "boot.reconciliation",
      error: err instanceof Error ? err : new Error(String(err)),
      recovered: false,
    }).catch(() => {});
    throw err;
  }

  // 6. Clear the mode_change_pending flag (mode change has now taken effect)
  await clearModeChangePendingFlag();

  // 7. Start scheduler
  startScheduler(buildSchedulerHandlers());

  log.info("Boot sequence complete", {
    firstLaunch,
    mode,
    findings: reconciliationFindings,
  });

  return {
    firstLaunch,
    mode,
    startingCapitalUsd,
    reconciliationFindings,
  };
}

// ---------------------------------------------------------------------------
// First-launch initialization
// ---------------------------------------------------------------------------

async function initializeFirstLaunch(): Promise<number> {
  log.info("First launch — initializing state defaults");

  // PAPER MODE STARTING CAPITAL IS SYNTHETIC by design (STRATEGY.md §13.6).
  // The bot's first launch defaults to paper, and paper accounting must NEVER
  // reference the real Coinbase wallet — they are entirely separate notional
  // ledgers. Operator can re-anchor via the dashboard if a different starting
  // size is wanted. The BTC anchor uses the public price feed only — no
  // balance read.
  const btcTicker = await getTicker("BTC-USD");
  const btcPriceUsd = btcTicker.midPrice;
  const totalUsd = PAPER_STARTING_CAPITAL_USD;

  log.info("First-launch synthetic paper capital", {
    startingCapitalUsd: totalUsd,
    btcAnchorUsd: btcPriceUsd,
    note: "paper mode does NOT read real Coinbase balances",
  });

  await stateWriter({ key: "phase", value: "paper", changedBy: "boot.first-launch" });
  await stateWriter({ key: "paper_mode", value: true, changedBy: "boot.first-launch" });
  await stateWriter({
    key: "mode_change_pending",
    value: false,
    changedBy: "boot.first-launch",
  });
  await stateWriter({
    key: "starting_capital_paper_usd",
    value: totalUsd,
    changedBy: "boot.first-launch",
  });
  // Seed the equity curve at t=0 so the dashboard renders a single point on
  // day one rather than waiting for the first 5-minute wake-up tick.
  await stateWriter({
    key: "last_equity_paper_usd",
    value: totalUsd,
    changedBy: "boot.first-launch",
  });
  await stateWriter({
    key: "last_cash_paper_usd",
    value: totalUsd,
    changedBy: "boot.first-launch",
  });
  await stateWriter({
    key: "last_positions_value_paper_usd",
    value: 0,
    changedBy: "boot.first-launch",
  });
  await stateWriter({
    key: "peak_value_paper_usd",
    value: totalUsd,
    changedBy: "boot.first-launch",
  });
  await stateWriter({
    key: "btc_price_at_start_paper",
    value: btcPriceUsd,
    changedBy: "boot.first-launch",
  });
  await stateWriter({
    key: "current_regime",
    value: null, // first morning brief sets it; null = "not yet classified"
    changedBy: "boot.first-launch",
  });
  await stateWriter({
    key: "trading_paused",
    value: false,
    changedBy: "boot.first-launch",
  });
  await stateWriter({
    key: "strategy_version",
    value: STRATEGY_VERSION,
    changedBy: "boot.first-launch",
  });

  // Seed the strategy version in `params` so the AI calls record it correctly.
  await upsertParam({
    paramName: "strategy_version",
    currentValue: STRATEGY_VERSION,
    version: STRATEGY_VERSION,
    changedReason: "first launch",
  });

  log.info("First-launch state initialized", {
    startingCapitalUsd: totalUsd,
    btcAnchor: btcPriceUsd,
  });

  return totalUsd;
}

// ---------------------------------------------------------------------------
// Scheduler handlers
// ---------------------------------------------------------------------------

function buildSchedulerHandlers(): SchedulerHandlers {
  return {
    dispatchScheduledEvent: async (event) => {
      log.info(`Scheduler dispatching ${event}`);
      switch (event) {
        case "opus_morning":
          await runScheduledMorningBrief();
          break;
        case "cycle_range_recompute":
          await runCycleRangeJob();
          break;
        case "sonnet_check_06":
        case "sonnet_check_22":
          await runScheduledSonnetCheckpoint();
          break;
      }
    },
    runWakeupChecks: async () => {
      await runWakeupCycle();
    },
  };
}
