import { NextRequest, NextResponse } from 'next/server';
import { liquidationStorage } from '@/lib/services/liquidationStorage';
import { ensureDbInitialized } from '@/lib/db/initDb';

/**
 * GET /api/liquidations/discovery
 * Returns comprehensive statistics for discovering tradeable symbols
 */
export async function GET(request: NextRequest) {
  try {
    await ensureDbInitialized();

    const searchParams = request.nextUrl.searchParams;

    // Parse time window
    const timeWindow = searchParams.get('timeWindow');
    let timeWindowSeconds = 86400; // Default to 24 hours

    if (timeWindow) {
      switch (timeWindow) {
        case '1h':
          timeWindowSeconds = 3600;
          break;
        case '6h':
          timeWindowSeconds = 21600;
          break;
        case '24h':
          timeWindowSeconds = 86400;
          break;
        case '7d':
          timeWindowSeconds = 604800;
          break;
        case '30d':
          timeWindowSeconds = 2592000;
          break;
        default:
          timeWindowSeconds = parseInt(timeWindow) || 86400;
      }
    }

    // Get discovery stats
    const discoveryStats = await liquidationStorage.getDiscoveryStats(timeWindowSeconds);
    
    // Get database info
    const dbInfo = await liquidationStorage.getDatabaseInfo();

    return NextResponse.json({
      success: true,
      data: {
        ...discoveryStats,
        timeWindowLabel: getTimeWindowLabel(timeWindowSeconds),
        databaseInfo: dbInfo,
      },
    });
  } catch (error) {
    console.error('API error - get discovery stats:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch discovery statistics',
      },
      { status: 500 }
    );
  }
}

function getTimeWindowLabel(seconds: number): string {
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} minutes`;
  } else if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)} hours`;
  } else {
    return `${Math.floor(seconds / 86400)} days`;
  }
}
