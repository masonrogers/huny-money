import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

/**
 * Session helper used by the login/logout/check API routes.
 *
 * Edge-compatible — only `jose` and Web APIs. Reads APP_SECRET directly from
 * process.env (not the lazy config proxy) because middleware runs in the
 * Edge runtime where the proxy isn't available.
 */

const COOKIE_NAME = "huny_session";
const SESSION_DURATION_DAYS = 7;

function getSecret(): Uint8Array {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function createSessionResponse(response: NextResponse): Promise<NextResponse> {
  const secret = getSecret();
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_DAYS}d`)
    .sign(secret);

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
  });
  return response;
}

export async function verifySession(request: NextRequest): Promise<boolean> {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) return false;
    const secret = getSecret();
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export function clearSessionResponse(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
