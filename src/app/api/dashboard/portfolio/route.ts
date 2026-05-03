import { NextResponse } from 'next/server';
import { getMultipleStates } from '@/lib/db/queries/system-state';
import { getOpenPositions } from '@/lib/db/queries/positions';
import { getAllBalances, getMidPrice } from '@/lib/coinbase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Fetch system state and open positions in parallel
    const [
      openPositions,
      states,
      balances,
    ] = await Promise.all([
      getOpenPositions(),
      getMultipleStates([
        'current_regime',
        'paper_trading_mode',
        'trading_paused',
        'peak_portfolio_value',
        'starting_capital',
      ]),
      getAllBalances(['USD', 'BTC', 'ETH', 'SOL']),
    ]);

    const regime = states['current_regime'] ?? 'ranging';
    const paperMode = states['paper_trading_mode'] === 'true';
    const tradingPaused = states['trading_paused'] === 'true';
    const peakValue = states['peak_portfolio_value']
      ? Number(states['peak_portfolio_value'])
      : 500;

    const cashUsd = balances.USD?.available ?? 0;

    // Calculate deployed value from open positions with live prices
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

    return NextResponse.json({
      total_value: totalValue,
      cash: cashUsd,
      deployed: deployedUsd,
      exposure_pct: Math.round(exposurePct * 100) / 100,
      current_regime: regime,
      paper_mode: paperMode,
      trading_paused: tradingPaused,
      drawdown_pct: Math.round(drawdownPct * 100) / 100,
      peak_value: peakValue,
      open_positions: openPositions.length,
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
