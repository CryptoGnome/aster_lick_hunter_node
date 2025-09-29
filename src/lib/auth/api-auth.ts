import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export interface AuthenticatedRequest extends NextRequest {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export async function authenticateRequest(request: NextRequest): Promise<{
  isAuthenticated: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  error?: string;
}> {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET
    });

    if (!token) {
      return {
        isAuthenticated: false,
        error: 'No authentication token found'
      };
    }

    return {
      isAuthenticated: true,
      user: {
        id: token.id as string,
        email: token.email as string,
        name: token.name as string,
      }
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return {
      isAuthenticated: false,
      error: 'Authentication failed'
    };
  }
}

export function createAuthErrorResponse(message: string = 'Unauthorized', status: number = 401) {
  return new Response(
    JSON.stringify({
      error: message,
      code: 'UNAUTHORIZED'
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
