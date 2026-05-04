import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const authed = await verifySession(request);
  if (!authed) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true });
}
