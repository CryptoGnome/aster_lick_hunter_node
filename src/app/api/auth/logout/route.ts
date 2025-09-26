import { NextRequest, NextResponse } from 'next/server';

export async function POST(_request: NextRequest) {
  const response = NextResponse.json({ success: true });

  // Delete the auth cookie
  response.cookies.delete('auth-token');

  return response;
}