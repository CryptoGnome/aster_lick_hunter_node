import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { configLoader } from '@/lib/config/configLoader';

const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || 'your-secret-key-change-in-production'
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    if (!password || password.trim().length === 0) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    // Load config to check password
    const config = await configLoader.loadConfig();
    const dashboardPassword = config.global?.server?.dashboardPassword;

    let isValid = false;

    // If no password is set, use default "admin"
    if (!dashboardPassword || dashboardPassword.trim().length === 0) {
      isValid = password === 'admin';
    } else if (dashboardPassword.startsWith('$2a$') || dashboardPassword.startsWith('$2b$')) {
      // Password is hashed - use bcrypt compare
      isValid = await bcrypt.compare(password, dashboardPassword);
    } else {
      // Plain text password (legacy support)
      isValid = password === dashboardPassword;
    }

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Create JWT token
    const token = await new SignJWT({ 
      sub: 'dashboard-user',
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('7d')
      .sign(SECRET);

    // Determine if we're behind a reverse proxy (HTTPS)
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const isHttps = forwardedProto === 'https' || process.env.NODE_ENV === 'production';

    // Set HTTP-only cookie
    const response = NextResponse.json({ success: true });
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}
