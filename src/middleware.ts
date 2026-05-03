import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'huny_session';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/',
  '/api/healthz',
  '/api/cron/',
  '/_next/',
  '/favicon',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) return false;

    const secret = process.env.APP_SECRET;
    if (!secret) return false;

    const key = new TextEncoder().encode(secret);
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths through without auth
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const authenticated = await isAuthenticated(request);

  if (!authenticated) {
    // API routes get a 401 JSON response
    if (isApiRoute(pathname)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Page routes get redirected to /login
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files.
     * _next/static and _next/image are excluded by default via the PUBLIC_PATHS check,
     * but we also skip them at the matcher level for performance.
     */
    '/((?!_next/static|_next/image).*)',
  ],
};
