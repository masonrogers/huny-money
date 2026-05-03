import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  const authenticated = await verifySession(request);
  return NextResponse.json({ authenticated });
}
