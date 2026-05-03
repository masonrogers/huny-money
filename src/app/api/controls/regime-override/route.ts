import { NextRequest, NextResponse } from 'next/server';
import { setState } from '@/lib/db/queries/system-state';
import { insertRegimeAssessment } from '@/lib/db/queries/regime';
import { createAlert } from '@/lib/db/queries/alerts';
import type { RegimeName } from '@/lib/types/strategy';

export const dynamic = 'force-dynamic';

const VALID_REGIMES: RegimeName[] = [
  'strong_bull',
  'mild_bull',
  'ranging',
  'mild_bear',
  'strong_bear',
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { regime, reason } = body;

    if (!regime || !reason) {
      return NextResponse.json(
        { error: 'Invalid request: "regime" and "reason" are required' },
        { status: 400 }
      );
    }

    if (!VALID_REGIMES.includes(regime as RegimeName)) {
      return NextResponse.json(
        {
          error: `Invalid regime: "${regime}". Must be one of: ${VALID_REGIMES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    await setState('current_regime', regime);

    await insertRegimeAssessment({
      regime,
      evidence: `Manual override: ${reason}`,
    });

    await createAlert({
      type: 'regime_change',
      severity: 'warning',
      message: `Regime manually overridden to "${regime}". Reason: ${reason}`,
    });

    return NextResponse.json({
      regime,
      reason,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /controls/regime-override] Error:', message);
    return NextResponse.json(
      { error: 'Failed to override regime', details: message },
      { status: 500 }
    );
  }
}
