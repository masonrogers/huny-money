import type { TradeProposal } from '@/lib/types/evaluation';
import type { PortfolioState, PositionWithPrice } from '@/lib/types/portfolio';
import type { RegimeName } from '@/lib/types/strategy';
import {
  MAX_SINGLE_POSITION_PCT,
  MIN_CASH_RESERVE_PCT,
  MAX_POSITIONS,
  MIN_POSITION_SIZE,
  ENTRY_CONVICTION_THRESHOLD,
  HARD_CIRCUIT_BREAKER,
  SOFT_CIRCUIT_BREAKER_PCT,
  PRIMARY_ASSETS,
  SECONDARY_ASSETS,
} from '@/lib/constants';
import { getRecentClosedPositions, getClosedPositions } from '@/lib/db/queries/positions';
import { getState } from '@/lib/db/queries/system-state';
import { getStrategyParams } from '@/lib/db/queries/strategy';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ValidationResult {
  approved: boolean;
  modifications: Array<{
    field: string;
    original: unknown;
    modified: unknown;
    reason: string;
  }>;
  rejectionReasons: string[];
}

export interface RiskState {
  dailyLossExceeded: boolean;
  dailyLoss: number;
  inCooldown: boolean;
  consecutiveLosses: number;
  softBreakerActive: boolean;
  hardBreakerActive: boolean;
  currentDrawdownPct: number;
  peakValue: number;
  currentValue: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DAILY_LOSS_LIMIT_PCT = 0.04;
const CONSECUTIVE_LOSS_COOLDOWN = 2;
const DRAWDOWN_REDUCTION_THRESHOLD = 0.15;
const DRAWDOWN_REDUCED_MAX_POSITION_PCT = 0.35;
const MIN_RR_RATIO = 2;
const ETH_SOL_COMBINED_CAP_PCT = 0.50;

// ─── Regime exposure caps ──────────────────────────────────────────────────

const REGIME_EXPOSURE_CAP: Record<RegimeName, number> = {
  strong_bull: 0.70,
  mild_bull: 0.70,
  ranging: 0.50,
  mild_bear: 0.30,
  strong_bear: 0.10,
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function getEffectiveMaxPositionPct(drawdownPct: number): number {
  if (drawdownPct >= DRAWDOWN_REDUCTION_THRESHOLD) {
    return DRAWDOWN_REDUCED_MAX_POSITION_PCT;
  }
  return MAX_SINGLE_POSITION_PCT;
}

async function getParamValue(paramName: string, fallback: number): Promise<number> {
  const params = await getStrategyParams();
  const param = params.find((p) => p.paramName === paramName);
  return param?.currentValue ? Number(param.currentValue) : fallback;
}

// ─── 1. validateNewTrade ───────────────────────────────────────────────────

export async function validateNewTrade(
  proposal: TradeProposal,
  portfolioState: PortfolioState,
  openPositions: PositionWithPrice[]
): Promise<ValidationResult> {
  const rejectionReasons: string[] = [];
  const modifications: ValidationResult['modifications'] = [];

  const totalCapital = portfolioState.total_value_usd;
  const cashAfterTrade = portfolioState.cash_usd - proposal.position_size_usd;
  const drawdownPct = portfolioState.drawdown_from_peak_pct;
  const regime = portfolioState.regime;

  // --- Hard circuit breaker: halt all trading ---
  const circuitBreakers = await checkCircuitBreakers(totalCapital);
  if (circuitBreakers.hard) {
    rejectionReasons.push(
      `Hard circuit breaker active: total value $${totalCapital.toFixed(2)} <= $${HARD_CIRCUIT_BREAKER}. All trading halted.`
    );
    return { approved: false, modifications, rejectionReasons };
  }

  // --- Soft circuit breaker: halve position sizes ---
  let effectiveMaxPositionPct = getEffectiveMaxPositionPct(drawdownPct);
  if (circuitBreakers.soft) {
    const halved = effectiveMaxPositionPct / 2;
    if (proposal.position_size_pct > halved * 100) {
      modifications.push({
        field: 'position_size_pct',
        original: proposal.position_size_pct,
        modified: halved * 100,
        reason: `Soft circuit breaker active (${(circuitBreakers.drawdownPct * 100).toFixed(1)}% drawdown). Max position halved to ${(halved * 100).toFixed(1)}%.`,
      });
      const modifiedSizeUsd = totalCapital * halved;
      modifications.push({
        field: 'position_size_usd',
        original: proposal.position_size_usd,
        modified: modifiedSizeUsd,
        reason: 'Position size reduced due to soft circuit breaker.',
      });
      effectiveMaxPositionPct = halved;
    }
  }

  // --- Daily loss limit ---
  const dailyLoss = await checkDailyLossLimit();
  if (dailyLoss.exceeded) {
    rejectionReasons.push(
      `Daily loss limit exceeded: $${dailyLoss.currentLoss.toFixed(2)} losses in 24h vs $${dailyLoss.limit.toFixed(2)} limit (4% of capital).`
    );
  }

  // --- Cooldown check ---
  const cooldown = await checkCooldown();
  if (cooldown.inCooldown) {
    // During cooldown, reduce max position size by 50% but don't reject outright
    const cooldownMaxPct = effectiveMaxPositionPct / 2;
    if (proposal.position_size_usd > totalCapital * cooldownMaxPct) {
      modifications.push({
        field: 'position_size_usd',
        original: proposal.position_size_usd,
        modified: totalCapital * cooldownMaxPct,
        reason: `Cooldown active (${cooldown.consecutiveLosses} consecutive losses). Position size reduced by 50%.`,
      });
      modifications.push({
        field: 'position_size_pct',
        original: proposal.position_size_pct,
        modified: cooldownMaxPct * 100,
        reason: 'Position size percentage reduced due to cooldown.',
      });
    }
  }

  // --- Position size vs max single position % ---
  const maxPositionUsd = totalCapital * effectiveMaxPositionPct;
  if (proposal.position_size_usd > maxPositionUsd) {
    modifications.push({
      field: 'position_size_usd',
      original: proposal.position_size_usd,
      modified: maxPositionUsd,
      reason: `Position exceeds max single position (${(effectiveMaxPositionPct * 100).toFixed(0)}% of capital = $${maxPositionUsd.toFixed(2)}).`,
    });
    modifications.push({
      field: 'position_size_pct',
      original: proposal.position_size_pct,
      modified: effectiveMaxPositionPct * 100,
      reason: 'Position size percentage capped.',
    });
  }

  // --- Total exposure cap ---
  const currentExposure = portfolioState.deployed_usd;
  const exposureCheck = validateExposureCap(currentExposure, proposal.position_size_usd, regime, totalCapital);
  if (!exposureCheck.allowed) {
    if (exposureCheck.maxAdditional >= MIN_POSITION_SIZE) {
      modifications.push({
        field: 'position_size_usd',
        original: proposal.position_size_usd,
        modified: exposureCheck.maxAdditional,
        reason: `Exceeds regime exposure cap (${(REGIME_EXPOSURE_CAP[regime] * 100).toFixed(0)}%). Reduced to max additional $${exposureCheck.maxAdditional.toFixed(2)}.`,
      });
    } else {
      rejectionReasons.push(
        `Adding this trade would exceed regime exposure cap (${(REGIME_EXPOSURE_CAP[regime] * 100).toFixed(0)}%). Only $${exposureCheck.maxAdditional.toFixed(2)} deployable, below $${MIN_POSITION_SIZE} minimum.`
      );
    }
  }

  // --- Cash reserve ---
  const minCashReserve = totalCapital * MIN_CASH_RESERVE_PCT;
  if (cashAfterTrade < minCashReserve) {
    const maxTradeForCash = portfolioState.cash_usd - minCashReserve;
    if (maxTradeForCash >= MIN_POSITION_SIZE) {
      modifications.push({
        field: 'position_size_usd',
        original: proposal.position_size_usd,
        modified: maxTradeForCash,
        reason: `Trade would breach ${(MIN_CASH_RESERVE_PCT * 100).toFixed(0)}% cash reserve ($${minCashReserve.toFixed(2)}). Reduced to $${maxTradeForCash.toFixed(2)}.`,
      });
    } else {
      rejectionReasons.push(
        `Insufficient cash: $${portfolioState.cash_usd.toFixed(2)} available, need $${minCashReserve.toFixed(2)} reserve. Max trade $${maxTradeForCash.toFixed(2)} below $${MIN_POSITION_SIZE} minimum.`
      );
    }
  }

  // --- Open position count ---
  const swingCount = openPositions.filter((p) => p.type === 'swing').length;
  const coreCount = openPositions.filter((p) => p.type === 'core').length;
  if (openPositions.length >= MAX_POSITIONS) {
    rejectionReasons.push(
      `Max positions (${MAX_POSITIONS}) already open: ${swingCount} swing + ${coreCount} core.`
    );
  } else if (proposal.type === 'swing' && swingCount >= 2) {
    rejectionReasons.push(
      `Max swing positions (2) already open.`
    );
  } else if (proposal.type === 'core' && coreCount >= 1) {
    rejectionReasons.push(
      `Max core positions (1) already open.`
    );
  }

  // --- Minimum position size ---
  // Use the effective (possibly modified) size for this check
  const effectiveSize = getEffectiveValue(modifications, 'position_size_usd', proposal.position_size_usd);
  if (effectiveSize < MIN_POSITION_SIZE) {
    rejectionReasons.push(
      `Position size $${effectiveSize.toFixed(2)} is below minimum $${MIN_POSITION_SIZE}.`
    );
  }

  // --- R:R ratio >= 2:1 ---
  const riskPerUnit = Math.abs(proposal.entry_price_target - proposal.stop_loss);
  const rewardPerUnit = Math.abs(proposal.take_profit_target - proposal.entry_price_target);
  const actualRR = riskPerUnit > 0 ? rewardPerUnit / riskPerUnit : 0;
  if (actualRR < MIN_RR_RATIO) {
    rejectionReasons.push(
      `Risk:reward ratio ${actualRR.toFixed(2)}:1 is below minimum ${MIN_RR_RATIO}:1 (risk $${riskPerUnit.toFixed(2)}, reward $${rewardPerUnit.toFixed(2)}).`
    );
  }

  // --- Conviction >= entry threshold ---
  const convictionThreshold = await getParamValue(
    'entry_conviction_threshold',
    ENTRY_CONVICTION_THRESHOLD
  );
  if (proposal.conviction < convictionThreshold) {
    rejectionReasons.push(
      `Conviction ${proposal.conviction} is below entry threshold ${convictionThreshold}.`
    );
  }

  // --- Correlation rules ---
  const correlationResult = checkCorrelationRules(
    proposal.asset,
    openPositions,
    proposal.position_size_usd,
    totalCapital
  );
  if (!correlationResult.approved) {
    rejectionReasons.push(...correlationResult.rejectionReasons);
  }
  if (correlationResult.modifications.length > 0) {
    modifications.push(...correlationResult.modifications);
  }

  // --- Regime alignment ---
  if (!checkRegimeAlignment(proposal.direction, regime)) {
    rejectionReasons.push(
      `No new longs allowed in strong_bear regime.`
    );
  }

  // Check for mild_bear: allow but warn via modification
  if (regime === 'mild_bear' && proposal.direction === 'long') {
    modifications.push({
      field: 'regime_alignment',
      original: proposal.regime_alignment,
      modified: 'mild_bear_warning',
      reason: 'Mild bear regime: trade allowed but position size should be conservative.',
    });
  }

  const approved = rejectionReasons.length === 0;
  return { approved, modifications, rejectionReasons };
}

// ─── 2. computeRiskState ───────────────────────────────────────────────────

export async function computeRiskState(): Promise<RiskState> {
  const dailyLoss = await checkDailyLossLimit();
  const cooldown = await checkCooldown();

  const isPaper = (await getState('paper_trading_mode')) === 'true';
  const peakKey = isPaper ? 'paper_peak_value' : 'peak_portfolio_value';
  const peakStr = await getState(peakKey);
  const peakValue = peakStr ? Number(peakStr) : 500;

  // Estimate current value from peak minus recent losses.
  // In practice, callers with a full PortfolioState should use checkCircuitBreakers
  // directly with the real totalValue for more accurate results.
  const currentValue = peakValue - dailyLoss.currentLoss;
  const drawdownPct = peakValue > 0 ? (peakValue - currentValue) / peakValue : 0;

  const breakers = await checkCircuitBreakers(currentValue);

  return {
    dailyLossExceeded: dailyLoss.exceeded,
    dailyLoss: dailyLoss.currentLoss,
    inCooldown: cooldown.inCooldown,
    consecutiveLosses: cooldown.consecutiveLosses,
    softBreakerActive: breakers.soft,
    hardBreakerActive: breakers.hard,
    currentDrawdownPct: drawdownPct,
    peakValue,
    currentValue,
  };
}

// ─── 3. checkDailyLossLimit ────────────────────────────────────────────────

export async function checkDailyLossLimit(): Promise<{
  exceeded: boolean;
  currentLoss: number;
  limit: number;
}> {
  // Get positions closed in the last 24 hours (filtered by current paper mode)
  const isPaper = (await getState('paper_trading_mode')) === 'true';
  const recentClosed = await getRecentClosedPositions(24, isPaper);

  // Sum negative net PnL (losses)
  const totalLoss = recentClosed.reduce((sum, pos) => {
    const pnl = pos.netPnl ? Number(pos.netPnl) : 0;
    return pnl < 0 ? sum + Math.abs(pnl) : sum;
  }, 0);

  // Get current capital to compute limit (use paper or live peak)
  const peakKey = isPaper ? 'paper_peak_value' : 'peak_portfolio_value';
  const peakStr = await getState(peakKey);
  const startingCapitalStr = await getState('starting_capital');
  const currentCapital = peakStr
    ? Number(peakStr)
    : startingCapitalStr
      ? Number(startingCapitalStr)
      : 500;

  const limit = currentCapital * DAILY_LOSS_LIMIT_PCT;

  return {
    exceeded: totalLoss >= limit,
    currentLoss: totalLoss,
    limit,
  };
}

// ─── 4. checkCooldown ──────────────────────────────────────────────────────

export async function checkCooldown(): Promise<{
  inCooldown: boolean;
  consecutiveLosses: number;
}> {
  // Get last 2 closed positions (filtered by current paper mode)
  const isPaper = (await getState('paper_trading_mode')) === 'true';
  const recentClosed = await getClosedPositions({ limit: 2, isPaper });

  if (recentClosed.length < CONSECUTIVE_LOSS_COOLDOWN) {
    return { inCooldown: false, consecutiveLosses: 0 };
  }

  let consecutiveLosses = 0;
  for (const pos of recentClosed) {
    const pnl = pos.netPnl ? Number(pos.netPnl) : 0;
    if (pnl < 0) {
      consecutiveLosses++;
    } else {
      break;
    }
  }

  return {
    inCooldown: consecutiveLosses >= CONSECUTIVE_LOSS_COOLDOWN,
    consecutiveLosses,
  };
}

// ─── 5. checkCircuitBreakers ───────────────────────────────────────────────

export async function checkCircuitBreakers(totalValue: number): Promise<{
  soft: boolean;
  hard: boolean;
  drawdownPct: number;
}> {
  const isPaper = (await getState('paper_trading_mode')) === 'true';
  const peakKey = isPaper ? 'paper_peak_value' : 'peak_portfolio_value';
  const peakStr = await getState(peakKey);
  const peakValue = peakStr ? Number(peakStr) : 500;

  const drawdownPct = peakValue > 0 ? (peakValue - totalValue) / peakValue : 0;

  return {
    soft: drawdownPct > SOFT_CIRCUIT_BREAKER_PCT,
    hard: totalValue <= HARD_CIRCUIT_BREAKER,
    drawdownPct,
  };
}

// ─── 6. checkCorrelationRules ──────────────────────────────────────────────

export function checkCorrelationRules(
  newAsset: string,
  openPositions: PositionWithPrice[],
  newPositionSizeUsd: number,
  totalCapital: number
): ValidationResult {
  const rejectionReasons: string[] = [];
  const modifications: ValidationResult['modifications'] = [];

  const openAssets = openPositions.map((p) => p.asset.toUpperCase());
  const normalizedNew = newAsset.toUpperCase();

  // --- ETH + SOL combined cap ---
  if (normalizedNew === 'ETH' || normalizedNew === 'SOL') {
    const counterpart = normalizedNew === 'ETH' ? 'SOL' : 'ETH';
    const existingCounterpart = openPositions.find(
      (p) => p.asset.toUpperCase() === counterpart
    );

    if (existingCounterpart) {
      const existingValue = existingCounterpart.position_value_usd;
      const combinedValue = existingValue + newPositionSizeUsd;
      const combinedCap = totalCapital * ETH_SOL_COMBINED_CAP_PCT;

      if (combinedValue > combinedCap) {
        const maxNewSize = combinedCap - existingValue;
        if (maxNewSize >= MIN_POSITION_SIZE) {
          modifications.push({
            field: 'position_size_usd',
            original: newPositionSizeUsd,
            modified: maxNewSize,
            reason: `ETH + SOL combined ($${combinedValue.toFixed(2)}) exceeds 50% cap ($${combinedCap.toFixed(2)}). New position reduced to $${maxNewSize.toFixed(2)}.`,
          });
        } else {
          rejectionReasons.push(
            `ETH + SOL combined would exceed 50% cap. Existing ${counterpart} at $${existingValue.toFixed(2)}, only $${maxNewSize.toFixed(2)} available for ${normalizedNew} (below $${MIN_POSITION_SIZE} minimum).`
          );
        }
      }
    }
  }

  // --- Max 1 tertiary asset at a time ---
  const tertiaryAssets = SECONDARY_ASSETS.map((a) => a.toUpperCase());
  const primaryAssets = PRIMARY_ASSETS.map((a) => a.toUpperCase());
  const isTertiaryNew = !primaryAssets.includes(normalizedNew) && !tertiaryAssets.includes(normalizedNew);
  // SOL is secondary/tertiary in context of this project
  const isSecondaryNew = tertiaryAssets.includes(normalizedNew);

  // Check for existing tertiary/secondary positions (non-BTC, non-ETH)
  const existingNonPrimary = openPositions.filter(
    (p) => !primaryAssets.includes(p.asset.toUpperCase())
  );

  if ((isSecondaryNew || isTertiaryNew) && existingNonPrimary.length > 0) {
    const existingNonPrimaryAsset = existingNonPrimary[0].asset;
    if (existingNonPrimaryAsset.toUpperCase() !== normalizedNew) {
      rejectionReasons.push(
        `Only 1 tertiary/secondary asset at a time. Already holding ${existingNonPrimaryAsset}.`
      );
    }
  }

  // --- ETH + SOL + another alt: not allowed ---
  if (normalizedNew !== 'BTC') {
    const hasETH = openAssets.includes('ETH');
    const hasSOL = openAssets.includes('SOL');
    const newIsETH = normalizedNew === 'ETH';
    const newIsSOL = normalizedNew === 'SOL';

    // If we already have ETH + SOL and are adding another alt
    if (hasETH && hasSOL && !newIsETH && !newIsSOL) {
      rejectionReasons.push(
        'Cannot add another alt when both ETH and SOL positions are open. Too much correlated alt exposure.'
      );
    }
  }

  return { approved: rejectionReasons.length === 0, modifications, rejectionReasons };
}

// ─── 7. checkRegimeAlignment ───────────────────────────────────────────────

export function checkRegimeAlignment(
  direction: string,
  regime: RegimeName
): boolean {
  // No longs in strong_bear
  if (direction === 'long' && regime === 'strong_bear') {
    return false;
  }

  // All other combinations are allowed
  // (mild_bear long is allowed but should be flagged as a modification/warning)
  return true;
}

// ─── 8. computePositionSize ────────────────────────────────────────────────

export async function computePositionSize(
  conviction: number,
  totalCapital: number,
  regime: RegimeName
): Promise<number> {
  // Base allocation = 30% of total capital
  const baseAllocation = totalCapital * 0.30;

  // Conviction multiplier
  let convictionMultiplier: number;
  if (conviction >= 85) {
    convictionMultiplier = 1.50;
  } else if (conviction >= 70) {
    convictionMultiplier = 1.00;
  } else if (conviction >= 60) {
    convictionMultiplier = 0.67;
  } else {
    // Below entry threshold; return 0
    return 0;
  }

  let size = baseAllocation * convictionMultiplier;

  // Apply regime exposure cap (position cannot exceed regime max)
  const regimeCap = REGIME_EXPOSURE_CAP[regime];
  const regimeMaxUsd = totalCapital * regimeCap;
  size = Math.min(size, regimeMaxUsd);

  // Apply drawdown reduction
  const isPaperForSize = (await getState('paper_trading_mode')) === 'true';
  const peakKeyForSize = isPaperForSize ? 'paper_peak_value' : 'peak_portfolio_value';
  const peakStr = await getState(peakKeyForSize);
  const peakValue = peakStr ? Number(peakStr) : totalCapital;
  const drawdownPct = peakValue > 0 ? (peakValue - totalCapital) / peakValue : 0;

  const maxPositionPct = getEffectiveMaxPositionPct(drawdownPct);
  size = Math.min(size, totalCapital * maxPositionPct);

  // Apply cooldown reduction
  const cooldown = await checkCooldown();
  if (cooldown.inCooldown) {
    size = size / 2;
  }

  // Apply soft circuit breaker
  const breakers = await checkCircuitBreakers(totalCapital);
  if (breakers.soft) {
    size = size / 2;
  }

  // Clamp to minimum
  if (size < MIN_POSITION_SIZE) {
    return 0;
  }

  // Ensure we don't exceed absolute max position size
  const absoluteMax = totalCapital * MAX_SINGLE_POSITION_PCT;
  size = Math.min(size, absoluteMax);

  return Math.floor(size * 100) / 100; // Round down to cents
}

// ─── 9. validateExposureCap ────────────────────────────────────────────────

export function validateExposureCap(
  currentExposure: number,
  newTradeSize: number,
  regime: RegimeName,
  totalCapital?: number
): { allowed: boolean; maxAdditional: number } {
  const regimeCap = REGIME_EXPOSURE_CAP[regime];

  // If totalCapital is not provided, estimate it from currentExposure.
  // This is a conservative fallback; callers should provide totalCapital when available.
  if (!totalCapital || totalCapital <= 0) {
    return { allowed: true, maxAdditional: newTradeSize };
  }

  const maxExposure = totalCapital * regimeCap;
  const projectedExposure = currentExposure + newTradeSize;
  const maxAdditional = Math.max(0, maxExposure - currentExposure);

  return {
    allowed: projectedExposure <= maxExposure,
    maxAdditional,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Get the effective value for a field after applying modifications.
 * Returns the last modified value for the field, or the original if unmodified.
 */
function getEffectiveValue(
  modifications: ValidationResult['modifications'],
  field: string,
  original: number
): number {
  const mod = [...modifications].reverse().find((m) => m.field === field);
  return mod ? Number(mod.modified) : original;
}
