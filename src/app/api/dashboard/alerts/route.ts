import { NextRequest, NextResponse } from 'next/server';
import { getAlerts } from '@/lib/db/queries/alerts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const acknowledgedParam = searchParams.get('acknowledged');
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);

    const acknowledged =
      acknowledgedParam === null
        ? undefined
        : acknowledgedParam === 'true';

    const alerts = await getAlerts({ acknowledged, limit });

    return NextResponse.json({
      alerts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /dashboard/alerts] Error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch alerts', details: message },
      { status: 500 }
    );
  }
}
