import { NextRequest, NextResponse } from 'next/server';
import { getState, setState } from '@/lib/db/queries/system-state';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { asset, approved } = body;

    if (!asset || typeof approved !== 'boolean') {
      return NextResponse.json(
        {
          error:
            'Invalid request: "asset" (string) and "approved" (boolean) are required',
        },
        { status: 400 }
      );
    }

    const currentStr = await getState('approved_tertiary_assets');
    let approvedAssets: string[] = [];
    try {
      approvedAssets = currentStr ? JSON.parse(currentStr) : [];
    } catch {
      approvedAssets = [];
    }

    const upperAsset = asset.toUpperCase();

    if (approved) {
      if (!approvedAssets.includes(upperAsset)) {
        approvedAssets.push(upperAsset);
      }
    } else {
      approvedAssets = approvedAssets.filter((a: string) => a !== upperAsset);
    }

    await setState('approved_tertiary_assets', JSON.stringify(approvedAssets));

    return NextResponse.json({
      approved_tertiary_assets: approvedAssets,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API /controls/approve-asset] Error:', message);
    return NextResponse.json(
      { error: 'Failed to update approved assets', details: message },
      { status: 500 }
    );
  }
}
