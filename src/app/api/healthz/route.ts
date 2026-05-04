import { NextResponse } from "next/server";

/**
 * Health check endpoint for DigitalOcean App Platform. Always returns 200 if
 * the Next.js process is up. Deeper health checks (DB reachable, Coinbase
 * reachable) are part of the boot sequence; this just answers "is the web
 * process accepting traffic?"
 */
export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
