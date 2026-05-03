/**
 * Processes Layer 1 regime assessment output from Claude.
 *
 * Enforces the one-level-at-a-time regime change rule and updates
 * system state, regime history, theses, and alerts accordingly.
 */

import type { Layer1Assessment } from '@/lib/types/evaluation';
import type { RegimeName } from '@/lib/types/strategy';
import { getState, setState } from '@/lib/db/queries/system-state';
import { insertRegimeAssessment } from '@/lib/db/queries/regime';
import { createAlert } from '@/lib/db/queries/alerts';
import { createThesis, updateThesis, getActiveTheses, invalidateThesis } from '@/lib/db/queries/theses';

// ─── Regime ordering (index = severity level) ──────────────────────────────

const REGIME_ORDER: RegimeName[] = [
  'strong_bear',
  'mild_bear',
  'ranging',
  'mild_bull',
  'strong_bull',
];

function regimeIndex(regime: RegimeName): number {
  return REGIME_ORDER.indexOf(regime);
}

/**
 * Clamp a proposed regime to at most one level change from current.
 * Returns the clamped regime and whether clamping was applied.
 */
function clampRegimeChange(
  current: RegimeName,
  proposed: RegimeName
): { clamped: RegimeName; wasClamped: boolean } {
  const currentIdx = regimeIndex(current);
  const proposedIdx = regimeIndex(proposed);

  if (currentIdx === -1 || proposedIdx === -1) {
    // Unknown regime, return current as safe fallback
    return { clamped: current, wasClamped: proposed !== current };
  }

  const diff = proposedIdx - currentIdx;

  if (Math.abs(diff) <= 1) {
    // Within one level, no clamping needed
    return { clamped: proposed, wasClamped: false };
  }

  // Clamp to one level in the proposed direction
  const clampedIdx = currentIdx + Math.sign(diff);
  return {
    clamped: REGIME_ORDER[clampedIdx],
    wasClamped: true,
  };
}

// ─── Process regime change ─────────────────────────────────────────────────

export async function processRegimeChange(
  assessment: Layer1Assessment
): Promise<void> {
  const currentRegimeStr = await getState('current_regime');
  const currentRegime = (currentRegimeStr ?? 'ranging') as RegimeName;
  const proposedRegime = assessment.market_regime;

  console.log(
    `[RegimeDetector] Current regime: ${currentRegime}, proposed: ${proposedRegime}`
  );

  // Validate one-level-at-a-time rule
  const { clamped, wasClamped } = clampRegimeChange(currentRegime, proposedRegime);

  if (wasClamped) {
    console.warn(
      `[RegimeDetector] Regime change clamped: ${currentRegime} -> ${proposedRegime} (clamped to ${clamped}). ` +
        `One-level-at-a-time rule enforced.`
    );

    await createAlert({
      type: 'regime_change',
      severity: 'warning',
      message: `Regime change clamped from ${proposedRegime} to ${clamped} (current: ${currentRegime}). One-level-at-a-time rule enforced.`,
      data: {
        current: currentRegime,
        proposed: proposedRegime,
        clamped,
        evidence: assessment.regime_evidence,
      },
    });
  }

  const effectiveRegime = clamped;
  const regimeChanged = effectiveRegime !== currentRegime;

  // Update system_state if regime changed
  if (regimeChanged) {
    await setState('current_regime', effectiveRegime);

    console.log(
      `[RegimeDetector] Regime changed: ${currentRegime} -> ${effectiveRegime}`
    );

    await createAlert({
      type: 'regime_change',
      severity: 'info',
      message: `Market regime changed from ${currentRegime} to ${effectiveRegime}`,
      data: {
        from: currentRegime,
        to: effectiveRegime,
        evidence: assessment.regime_evidence,
        target_exposure_pct: assessment.target_exposure_pct,
      },
    });
  }

  // Always record regime assessment in history
  await insertRegimeAssessment({
    regime: effectiveRegime,
    evidence: assessment.regime_evidence,
  });

  // Process theses from the assessment
  await processTheses(assessment);
}

// ─── Process theses from Layer 1 ──────────────────────────────────────────

async function processTheses(assessment: Layer1Assessment): Promise<void> {
  if (!assessment.active_theses || assessment.active_theses.length === 0) {
    return;
  }

  const existingTheses = await getActiveTheses();

  for (const thesisUpdate of assessment.active_theses) {
    // Find matching existing thesis by asset and similar text
    const existing = existingTheses.find(
      (t) => t.asset === thesisUpdate.asset && t.status !== 'invalidated'
    );

    if (thesisUpdate.status === 'invalidated' && existing) {
      // Invalidate the thesis
      await invalidateThesis(
        existing.id,
        thesisUpdate.notes || 'Invalidated by daily regime assessment'
      );
      console.log(
        `[RegimeDetector] Thesis invalidated for ${thesisUpdate.asset}: ${thesisUpdate.notes}`
      );
      continue;
    }

    if (existing) {
      // Update existing thesis
      await updateThesis(existing.id, {
        conviction: thesisUpdate.conviction,
        status: thesisUpdate.status,
        lastReviewedAt: new Date(),
      });
    } else if (thesisUpdate.status !== 'invalidated') {
      // Create new thesis
      await createThesis({
        asset: thesisUpdate.asset,
        thesisText: thesisUpdate.thesis,
        status: thesisUpdate.status,
        conviction: thesisUpdate.conviction,
        lastReviewedAt: new Date(),
      });
      console.log(
        `[RegimeDetector] New thesis created for ${thesisUpdate.asset}: ${thesisUpdate.thesis.substring(0, 80)}...`
      );
    }
  }
}
