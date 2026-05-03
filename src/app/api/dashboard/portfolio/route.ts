import { NextResponse } from 'next/server';
import { getMultipleStates, setState } from '@/lib/db/queries/system-state';
import { getOpenPositions } from '@/lib/db/queries/positions';
import { getAllBalances, getMidPrice } from '@/lib/coinbase';
import { HARD_CIRCUIT_BREAKER, SOFT_CIRCUIT_BREAKER_PCT } from '@/lib/constants';
import type { RegimeName } from '@/lib/types/strategy';

// Regime exposure caps (mirrors risk-manager.ts)
const REGIME_EXPOSURE_CAP: Record<RegimeName, number> = {
  strong_bull: 0.70,
  mild_bull: 0.70,
  ranging: 0.50,
  mild_bear: 0.30,
  strong_bear: 0.10,
};

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Fetch system state first to determine paper mode
    const states = await getMultipleStates([
      'current_regime',
      'paper_trading_mode',
      'trading_paused',
      'peak_portfolio_value',
      'paper_peak_value',
      'paper_cash_usd',
      'starting_capital',
      'strategy_version',
    ]);

    const paperMode = states['paper_trading_mode'] === 'true';
    const regime = (states['current_regime'] ?? 'ranging') as RegimeName;
    const tradingPaused = states['trading_paused'] === 'true';
    const strategyVersion = states['strategy_version'] ?? '1.0';

    // Fetch positions filtered by paper mode
    const openPositions = await getOpenPositions(paperMode);

    let cashUsd: number;
    let peakValue: number;

    if (paperMode) {
      // Paper mode: use virtual cash from system_state, no Coinbase balance calls
      cashUsd = states['paper_cash_usd'] ? Number(states['paper_cash_usd']) : 500;
      peakValue = states['paper_peak_value'] ? Number(states['paper_peak_value']) : 500;
    } else {
      // Live mode: use real Coinbase balances
      const balances = await getAllBalances(['USD', 'USDC', 'BTC', 'ETH', 'SOL']);
      cashUsd = (balances.USD?.available ?? 0) + (balances.USDC?.available ?? 0);
      peakValue = states['peak_portfolio_value']
        ? Number(states['peak_portfolio_value'])
        : 500;
    }

    // Calculate deployed value from open positions with real market prices
    let deployedUsd = 0;
    for (const pos of openPositions) {
      let currentPrice = 0;
      try {
        currentPrice = await getMidPrice(`${pos.asset}-USD`);
      } catch {
        currentPrice = Number(pos.entryPrice);
      }
      deployedUsd += currentPrice * Number(pos.quantity);
    }

    const totalValue = cashUsd + deployedUsd;
    const exposurePct = totalValue > 0 ? (deployedUsd / totalValue) * 100 : 0;
    const drawdownPct =
      peakValue > 0 ? ((peakValue - totalValue) / peakValue) * 100 : 0;

    // Update paper_peak_value if current total exceeds it
    if (paperMode && totalValue > peakValue) {
      peakValue = totalValue;
      await setState('paper_peak_value', String(totalValue));
    }

    // Regime exposure cap & remaining deployable
    const regimeExposureCapPct = (REGIME_EXPOSURE_CAP[regime] ?? 0.50) * 100;
    const maxDeployable = totalValue * (REGIME_EXPOSURE_CAP[regime] ?? 0.50);
    const remainingDeployableUsd = Math.max(0, maxDeployable - deployedUsd);

    // Circuit breakers
    const softBreakerActive = drawdownPct >= SOFT_CIRCUIT_BREAKER_PCT * 100;
    const hardBreakerActive = totalValue <= HARD_CIRCUIT_BREAKER;

    return NextResponse.json({
      totalValueUsd: totalValue,
      cashUsd: cashUsd,
      remainingDeployableUsd: Math.round(remainingDeployableUsd * 100) / 100,
      exposurePct: Math.round(exposurePct * 100) / 100,
      regime,
      regimeExposureCapPct: Math.round(regimeExposureCapPct * 100) / 100,
      drawdownFromPeakPct: Math.round(drawdownPct * 100) / 100,
      peakValueUsd: peakValue,
      positions: openPositions,
      strategyVersion: strategyVersion,
      softBreakerActive: softBreakerActive,
      hardBreakerActive: hardBreakerActive,
      paperMode: paperMode,
      tradingPaused: tradingPaused,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /dashboard/portfolio] Error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio', details: message },
      { status: 500 }
    );
  }
}
