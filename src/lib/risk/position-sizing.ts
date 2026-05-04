import {
  REGIME_ALLOCATIONS,
  MAX_BTC_CORE_PCT,
  MAX_SINGLE_ALT_PCT,
  MAX_TOTAL_ALT_PCT,
  MIN_POSITION_SIZE_USD,
  type Regime,
} from "@/lib/strategy/constants";

/**
 * Regime-driven position sizing helpers per STRATEGY.md §3.6.
 *
 * The morning brief's `btc_core_decision.target_alloc_pct` and
 * `alt_entry_candidates[].size_pct` are AI-generated. These helpers VALIDATE
 * those choices against the strategy constants, apply the soft-breaker
 * halving when active, and verify total exposure stays under the regime
 * ceiling. They are the sizing-side defense in depth on top of the
 * order-shape validation.
 */

// ---------------------------------------------------------------------------
// BTC core sizing
// ---------------------------------------------------------------------------

export function targetBtcCoreUsd(regime: Regime, accountValueUsd: number): number {
  const pct = REGIME_ALLOCATIONS[regime].btcCoreTargetPct;
  return Math.max(0, accountValueUsd * (pct / 100));
}

export interface BtcCoreSizingDecision {
  targetUsd: number;
  /** Minimum allowed (zero in bear). */
  minUsd: number;
  /** Maximum allowed (per-regime cap, never above MAX_BTC_CORE_PCT). */
  maxUsd: number;
  regimeCapPct: number;
}

export function btcCoreSizing(regime: Regime, accountValueUsd: number): BtcCoreSizingDecision {
  const target = REGIME_ALLOCATIONS[regime].btcCoreTargetPct;
  const cap = Math.min(target, MAX_BTC_CORE_PCT);
  return {
    targetUsd: accountValueUsd * (target / 100),
    minUsd: 0,
    maxUsd: accountValueUsd * (cap / 100),
    regimeCapPct: cap,
  };
}

// ---------------------------------------------------------------------------
// Alt cycle sizing
// ---------------------------------------------------------------------------

export interface AltSizingInput {
  regime: Regime;
  /** AI's requested size as a percentage of capital. */
  requestedSizePct: number;
  accountValueUsd: number;
  /** Sum of currently-open alt position values. */
  currentAltExposureUsd: number;
  softBreakerActive: boolean;
}

export interface AltSizingDecision {
  /** True if the proposed entry can be placed at all. */
  allowed: boolean;
  /** Reason if not allowed. */
  rejectionReason?: string;
  /** Effective size after soft-breaker halving and any reductions. */
  effectiveSizePct: number;
  effectiveSizeUsd: number;
  /** Headroom remaining in the alt allocation (post-entry). */
  totalAltExposurePctAfter: number;
}

export function altSizing(input: AltSizingInput): AltSizingDecision {
  const regimeCap = REGIME_ALLOCATIONS[input.regime].maxAltPct;

  if (regimeCap === 0) {
    return {
      allowed: false,
      rejectionReason: `Regime ${input.regime} forbids alt positions (cap=0%)`,
      effectiveSizePct: 0,
      effectiveSizeUsd: 0,
      totalAltExposurePctAfter:
        (input.currentAltExposureUsd / input.accountValueUsd) * 100,
    };
  }

  // Cap requested size at MAX_SINGLE_ALT_PCT (15%)
  let pct = Math.min(input.requestedSizePct, MAX_SINGLE_ALT_PCT);

  // Soft breaker: halve alt sizes when active
  if (input.softBreakerActive) {
    pct /= 2;
  }

  let usd = input.accountValueUsd * (pct / 100);

  // Min position size — fees eat smaller trades
  if (usd < MIN_POSITION_SIZE_USD) {
    return {
      allowed: false,
      rejectionReason: `Effective size $${usd.toFixed(2)} below minimum $${MIN_POSITION_SIZE_USD}`,
      effectiveSizePct: pct,
      effectiveSizeUsd: usd,
      totalAltExposurePctAfter:
        (input.currentAltExposureUsd / input.accountValueUsd) * 100,
    };
  }

  // Total alt exposure cap (30%, scaled to regime if lower)
  const effectiveCap = Math.min(MAX_TOTAL_ALT_PCT, regimeCap);
  const headroomUsd = Math.max(
    0,
    input.accountValueUsd * (effectiveCap / 100) - input.currentAltExposureUsd,
  );
  if (usd > headroomUsd) {
    if (headroomUsd < MIN_POSITION_SIZE_USD) {
      return {
        allowed: false,
        rejectionReason: `Total alt headroom $${headroomUsd.toFixed(2)} below minimum $${MIN_POSITION_SIZE_USD}`,
        effectiveSizePct: pct,
        effectiveSizeUsd: usd,
        totalAltExposurePctAfter:
          (input.currentAltExposureUsd / input.accountValueUsd) * 100,
      };
    }
    // Reduce to fit headroom rather than reject
    usd = headroomUsd;
    pct = (usd / input.accountValueUsd) * 100;
  }

  const newExposurePct =
    ((input.currentAltExposureUsd + usd) / input.accountValueUsd) * 100;

  return {
    allowed: true,
    effectiveSizePct: pct,
    effectiveSizeUsd: usd,
    totalAltExposurePctAfter: newExposurePct,
  };
}

// ---------------------------------------------------------------------------
// Cash availability
// ---------------------------------------------------------------------------

export function minCashUsd(regime: Regime, accountValueUsd: number): number {
  return accountValueUsd * (REGIME_ALLOCATIONS[regime].minCashPct / 100);
}
