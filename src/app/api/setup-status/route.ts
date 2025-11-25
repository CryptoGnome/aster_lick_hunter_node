import { NextRequest, NextResponse } from 'next/server';
import { configLoader } from '@/lib/config/configLoader';

/**
 * Public endpoint to check if initial setup has been completed
 * This doesn't require authentication so onboarding can check before login
 */
export async function GET(request: NextRequest) {
  try {
    const config = await configLoader.loadConfig();
    
    return NextResponse.json({
      setupComplete: config?.global?.server?.setupComplete === true,
      hasPassword: !!(config?.global?.server?.dashboardPassword),
      hasApiKeys: !!(config?.api?.apiKey && config?.api?.secretKey)
    });
  } catch (error) {
    console.error('Failed to check setup status:', error);
    return NextResponse.json(
      { error: 'Failed to check setup status' },
      { status: 500 }
    );
  }
}
