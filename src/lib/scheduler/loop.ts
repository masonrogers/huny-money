import { stateRead, stateWriter, errorLogger } from "@/lib/db/utils";
import { log } from "@/lib/logger";
import {
  eventsDueNow,
  type ScheduledEvent,
  type ScheduledEventDue,
} from "./schedule";

/**
 * In-process scheduler loop per STRATEGY.md §5.2 + §6.1's "scheduling
 * without in-memory timers" rule.
 *
 * Tick every 60 seconds. On each tick:
 * 1. Compute which scheduled events are due (and haven't fired yet)
 * 2. Dispatch them in chronological order via the caller-provided handler
 * 3. Persist `state.last_<event>_fired_at` after each successful dispatch
 *
 * The 5-minute price polling + wake-up checks happen on a separate cadence
 * (every 5 ticks). Caller supplies `runWakeupChecks` which polls prices
 * and dispatches any wake-up triggers.
 *
 * Restart-safe by design: scheduling state lives in `state` table.
 */

export interface SchedulerHandlers {
  /** Dispatcher for a scheduled event — caller wires to morning brief / Sonnet check / cycle range job. */
  dispatchScheduledEvent: (event: ScheduledEvent) => Promise<void>;
  /** Polls prices and runs wake-up trigger checks. Called every 5 ticks. */
  runWakeupChecks: () => Promise<void>;
}

const TICK_INTERVAL_MS = 60_000;
const WAKEUP_TICK_MULTIPLE = 5; // 5 minutes

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let tickCount = 0;
let running = false;
let tickInFlight = false;

const FIRED_AT_KEY: Record<ScheduledEvent, string> = {
  opus_morning: "last_opus_morning_fired_at",
  sonnet_check_06: "last_sonnet_check_06_fired_at",
  sonnet_check_22: "last_sonnet_check_22_fired_at",
  cycle_range_recompute: "last_cycle_range_fired_at",
};

export async function tickOnce(
  handlers: SchedulerHandlers,
  now: Date = new Date(),
): Promise<void> {
  tickCount++;

  // 5-minute wake-up cycle
  if (tickCount % WAKEUP_TICK_MULTIPLE === 0) {
    try {
      await handlers.runWakeupChecks();
    } catch (err) {
      await errorLogger({
        severity: "error",
        component: "scheduler.loop.runWakeupChecks",
        error: err instanceof Error ? err : new Error(String(err)),
        recovered: true,
        recoveryAction: "Wake-up checks skipped this tick; will retry in 5 min",
      });
    }
  }

  // Scheduled events
  const lastFiredAt: Partial<Record<ScheduledEvent, Date | null>> = {};
  for (const event of Object.keys(FIRED_AT_KEY) as ScheduledEvent[]) {
    const v = await stateRead<string>(FIRED_AT_KEY[event]);
    lastFiredAt[event] = v ? new Date(v) : null;
  }

  const due = eventsDueNow(now, lastFiredAt);
  for (const item of due) {
    try {
      await dispatchAndRecord(item, handlers);
    } catch (err) {
      await errorLogger({
        severity: "error",
        component: `scheduler.loop.dispatch.${item.event}`,
        error: err instanceof Error ? err : new Error(String(err)),
        context: { event: item.event, scheduledAt: item.scheduledAt.toISOString() },
        recovered: true,
        recoveryAction: "Event will be retried on next tick if still in look-back window",
      });
    }
  }
}

async function dispatchAndRecord(
  item: ScheduledEventDue,
  handlers: SchedulerHandlers,
): Promise<void> {
  log.info("Scheduler dispatching event", {
    event: item.event,
    scheduledAt: item.scheduledAt.toISOString(),
  });
  await handlers.dispatchScheduledEvent(item.event);
  await stateWriter({
    key: FIRED_AT_KEY[item.event],
    value: item.scheduledAt.toISOString(),
    changedBy: "scheduler.loop",
  });
}

/**
 * Start the in-process scheduler. Idempotent — calling twice is a no-op.
 * Only one scheduler should run per process.
 */
export function startScheduler(handlers: SchedulerHandlers): void {
  if (running || intervalHandle) {
    log.warn("Scheduler.startScheduler called while already running — no-op");
    return;
  }
  running = true;
  log.info("Scheduler started", { tickIntervalMs: TICK_INTERVAL_MS });

  intervalHandle = setInterval(() => {
    // Skip if a previous tick is still in flight. Opus + max effort can
    // run for several minutes; without this guard the next 60s tick reads
    // the same `last_*_fired_at` (not yet written) and re-dispatches the
    // same event, double-billing the API budget.
    if (tickInFlight) {
      log.warn("Scheduler tick skipped — previous tick still in flight");
      return;
    }
    tickInFlight = true;
    void tickOnce(handlers)
      .catch(async (err) => {
        await errorLogger({
          severity: "critical",
          component: "scheduler.loop.tickOnce",
          error: err instanceof Error ? err : new Error(String(err)),
          recovered: true,
          recoveryAction: "Tick failed; next tick in 60s",
        });
      })
      .finally(() => {
        tickInFlight = false;
      });
  }, TICK_INTERVAL_MS);
}

export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  running = false;
  log.info("Scheduler stopped");
}

export function __resetSchedulerForTesting(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  running = false;
  tickCount = 0;
  tickInFlight = false;
}
