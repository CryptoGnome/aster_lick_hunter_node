import { NextRequest, NextResponse } from 'next/server';

// This file exists to satisfy Next.js type validation
// The actual authentication is handled by custom routes in /api/auth/
export async function GET(_request: NextRequest) {
  return NextResponse.json({ error: 'NextAuth not configured' }, { status: 404 });
}

export async function POST(_request: NextRequest) {
  return NextResponse.json({ error: 'NextAuth not configured' }, { status: 404 });
}
