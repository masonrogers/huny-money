import { NextRequest, NextResponse } from 'next/server';
import { getEvaluations } from '@/lib/db/queries/evaluations';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const type = searchParams.get('type') ?? undefined;
    const offset = (page - 1) * limit;

    const evaluations = await getEvaluations({ type, limit, offset });

    return NextResponse.json({
      evaluations,
      total: evaluations.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /dashboard/evaluations] Error:', message);
    return NextResponse.json(
      { error: 'Failed to fetch evaluations', details: message },
      { status: 500 }
    );
  }
}
