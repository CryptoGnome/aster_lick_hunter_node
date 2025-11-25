import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

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
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET || 'your-secret-key-change-in-production' });

  // For /api/config, require authentication
  if (pathname.startsWith('/api/config')) {
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // For all other protected routes, redirect to login if not authenticated
  if (!token) {
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