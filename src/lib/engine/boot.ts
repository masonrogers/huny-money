/**
 * System startup sequence.
 *
 * Handles both first-ever launch (Section 23) and normal restarts
 * (Section 22 reconciliation). This is the entry point for the
 * trading engine on every startup.
 */

import { getState, setState, initializeDefaults } from '@/lib/db/queries/system-state';
import { initializeDefaultParams } from '@/lib/db/queries/strategy';
import { createAlert } from '@/lib/db/queries/alerts';
import { runFullReconciliation } from '@/lib/engine/reconciliation';
import { STARTING_CAPITAL } from '@/lib/constants';

// ─── Boot Sequence ─────────────────────────────────────────────────────────

export async function runBootSequence(): Promise<{
  firstLaunch: boolean;
  missedEvaluation: boolean;
  emergencyTriggered: boolean;
  emergencyAsset?: string;
  emergencyPriceChange?: number;
  emergencyDirection?: string;
}> {
  console.log('[Boot] Starting boot sequence...');

  const result = {
    firstLaunch: false,
    missedEvaluation: false,
    emergencyTriggered: false,
    emergencyAsset: undefined as string | undefined,
    emergencyPriceChange: undefined as number | undefined,
    emergencyDirection: undefined as string | undefined,
  };

  // Check if this is the first-ever launch
  const lastBoot = await getState('last_successful_boot_at');
  const tradingPaused = await getState('trading_paused');

  // If there's no last boot AND no trading_paused key, system_state is empty = first launch
  const isFirstLaunch = lastBoot === null && tradingPaused === null;

  if (isFirstLaunch) {
    console.log('[Boot] First-ever launch detected. Initializing system...');
    result.firstLaunch = true;

    // Initialize all system_state defaults
    await initializeDefaults();
    console.log('[Boot] System state defaults initialized');

    // Initialize strategy parameters
    await initializeDefaultParams();
    console.log('[Boot] Strategy parameters initialized');

    // Ensure paper trading mode is on for first launch
    await setState('paper_trading_mode', 'true');

    // Initialize paper mode virtual cash system
    await setState('paper_cash_usd', String(STARTING_CAPITAL));
    await setState('paper_peak_value', String(STARTING_CAPITAL));

    // Record boot time
    await setState('last_successful_boot_at', new Date().toISOString());

    // Create informational alert about first launch
    await createAlert({
      type: 'regime_change',
      severity: 'info',
      message:
        'System initialized for the first time. Paper trading mode is ON. ' +
        'The system will observe for at least 2-3 evaluation cycles before taking any action. ' +
        'Review the dashboard to monitor regime assessments and hypothetical signals.',
      data: {
        first_launch: true,
        paper_trading_mode: true,
        initial_regime: 'ranging',
      },
    });

    console.log('[Boot] First launch complete. Paper trading mode enabled. Skipping reconciliation.');
  } else {
    // Normal restart — run full reconciliation
    console.log('[Boot] Normal restart detected. Running reconciliation...');

    try {
      const reconResult = await runFullReconciliation();
      result.missedEvaluation = reconResult.missedEvaluation;
      result.emergencyTriggered = reconResult.emergencyTriggered;
      result.emergencyAsset = reconResult.emergencyAsset;
      result.emergencyPriceChange = reconResult.emergencyPriceChange;
      result.emergencyDirection = reconResult.emergencyDirection;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Boot] Reconciliation failed: ${message}`);

      await createAlert({
        type: 'reconciliation_discrepancy',
        severity: 'critical',
        message: `Boot reconciliation failed: ${message}. System may be in an inconsistent state.`,
      });

      // Don't crash — the system should still be able to run evaluations
      // even if reconciliation failed. The alerts will notify the operator.
    }
  }

  console.log(
    `[Boot] Boot sequence complete. First launch: ${result.firstLaunch}, ` +
      `missed eval: ${result.missedEvaluation}, emergency: ${result.emergencyTriggered}`
  );

  return result;
}
