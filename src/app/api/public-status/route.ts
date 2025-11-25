import { NextResponse } from 'next/server';
import { configLoader } from '@/lib/config/configLoader';

/**
 * Public endpoint for pre-authentication checks
 * Returns minimal information needed for login/onboarding UI
 * Does NOT expose sensitive data like actual password hashes or API keys
 */
export async function GET() {
  try {
    const config = await configLoader.loadConfig();
    const dashboardPassword = config?.global?.server?.dashboardPassword;
    
    // Check if password is configured (not default "admin")
    const hasCustomPassword = !!(
      dashboardPassword &&
      dashboardPassword.trim().length > 0 &&
      dashboardPassword !== 'admin'
    );

    return NextResponse.json({
      // Setup status
      setupComplete: config?.global?.server?.setupComplete === true,
      hasApiKeys: !!(config?.api?.apiKey && config?.api?.secretKey),
      
      // Password status
      hasCustomPassword,
      
      // Never expose actual values
      // Only boolean flags for UI display logic
    });
  } catch (error) {
    console.error('Failed to get public status:', error);
    return NextResponse.json(
      { error: 'Failed to get status' },
      { status: 500 }
    );
  }
}
