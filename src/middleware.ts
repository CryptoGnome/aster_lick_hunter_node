import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || 'your-secret-key-change-in-production'
);

async function verifyAuth(req: NextRequest): Promise<boolean> {
  // Check for simple auth token (cookie-based JWT)
  const authToken = req.cookies.get('auth-token')?.value;
  if (authToken) {
    try {
      await jwtVerify(authToken, SECRET);
      return true;
    } catch {
      // Token invalid or expired
    }
  }
  
  // NextAuth is no longer used - don't trust old cookies
  // Users with stale next-auth cookies will need to re-login
  
  return false;
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Allow public paths without authentication
  const PUBLIC_PATHS = [
    '/login',
    '/api/auth',           // NextAuth endpoints
    '/api/health',         // Health check
    '/api/public-status'   // Initial setup and password check (no sensitive data)
  ];
  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Check if user is authenticated
  const isAuthenticated = await verifyAuth(req);

  // For /api/config, require authentication
  if (pathname.startsWith('/api/config')) {
    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // For all other protected routes, redirect to login if not authenticated
  if (!isAuthenticated) {
    // Redirect to /login WITHOUT any callbackUrl
    // Build a clean URL with no query parameters
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};