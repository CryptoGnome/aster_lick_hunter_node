import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, createAuthErrorResponse } from './api-auth';

export function withAuth(
  handler: (request: NextRequest, user: { id: string; email: string; name: string }) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const authResult = await authenticateRequest(request);

    if (!authResult.isAuthenticated || !authResult.user) {
      return createAuthErrorResponse(authResult.error || 'Authentication required') as unknown as NextResponse;
    }

    try {
      return await handler(request, authResult.user);
    } catch (error) {
      console.error('API handler error:', error);
      return new NextResponse(
        JSON.stringify({
          error: 'Internal server error',
          code: 'INTERNAL_ERROR'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  };
}

export function withOptionalAuth(
  handler: (request: NextRequest, user?: { id: string; email: string; name: string }) => Promise<NextResponse>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const authResult = await authenticateRequest(request);

    try {
      return await handler(request, authResult.isAuthenticated ? authResult.user : undefined);
    } catch (error) {
      console.error('API handler error:', error);
      return new NextResponse(
        JSON.stringify({
          error: 'Internal server error',
          code: 'INTERNAL_ERROR'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  };
}
