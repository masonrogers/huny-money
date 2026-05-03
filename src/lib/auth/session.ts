import { SignJWT, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'huny_session';
const SESSION_DURATION_DAYS = 7;

function getSecret(): Uint8Array {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error('APP_SECRET is not set');
  return new TextEncoder().encode(secret);
}

/**
 * Creates a JWT session token and sets it as an httpOnly cookie on the response.
 */
export async function createSessionResponse(
  response: NextResponse
): Promise<NextResponse> {
  const secret = getSecret();
  const token = await new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_DAYS}d`)
    .sign(secret);

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
  });

  return response;
}

/**
 * Verifies the session JWT from the request cookie.
 * Edge-compatible -- uses only jose and Web APIs.
 */
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

/**
 * Deletes the session cookie on the response.
 */
export function clearSessionResponse(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
