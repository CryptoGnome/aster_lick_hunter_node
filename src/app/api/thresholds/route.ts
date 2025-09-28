import { NextRequest, NextResponse } from 'next/server';
import { thresholdMonitor } from '@/lib/services/thresholdMonitor';
import { loadConfig } from '@/lib/bot/config';

// GET /api/thresholds - Get current threshold statuses
export async function GET(_request: NextRequest) {
  try {
    // First, ensure threshold monitor has latest config
    let configLoaded = false;
    try {
      const currentConfig = await loadConfig();
      console.log('API: Config loaded, symbols:', Object.keys(currentConfig?.symbols || {}));
      if (currentConfig) {
        thresholdMonitor.updateConfig(currentConfig);
        configLoaded = true;
        console.log('API: Threshold monitor updated with config');
      }
    } catch (configError) {
      console.warn('Could not update threshold monitor config:', configError);
    }

    const thresholdStatuses = thresholdMonitor.getAllThresholdStatuses();
    console.log('API: Retrieved threshold statuses, count:', thresholdStatuses.length);

    return NextResponse.json({
      success: true,
      data: thresholdStatuses,
      debug: {
        configLoaded,
        statusCount: thresholdStatuses.length
      }
    });
  } catch (error) {
    console.error('API Error (GET /api/thresholds):', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}