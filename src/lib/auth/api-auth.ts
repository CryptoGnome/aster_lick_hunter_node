import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || 'your-secret-key-change-in-production'
);

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
    // Check for custom JWT auth token (cookie-based)
    const authToken = request.cookies.get('auth-token')?.value;
    
    if (!authToken) {
      return {
        isAuthenticated: false,
        error: 'No authentication token found'
      };
    }

    const { payload } = await jwtVerify(authToken, SECRET);

    return {
      isAuthenticated: true,
      user: {
        id: payload.userId as string || 'user',
        email: payload.email as string || 'user@local',
        name: payload.name as string || 'User',
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
