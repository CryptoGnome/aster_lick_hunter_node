import { NextRequest, NextResponse } from 'next/server';
import { liquidationStorage } from '@/lib/services/liquidationStorage';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

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
        default:
          timeWindowSeconds = parseInt(timeWindow) || 86400;
      }
    }

    const stats = await liquidationStorage.getStatistics(timeWindowSeconds);

    return NextResponse.json({
      success: true,
      data: {
        ...stats,
        timeWindow: timeWindowSeconds,
        timeWindowLabel: getTimeWindowLabel(timeWindowSeconds),
      },
    });
  } catch (error) {
    console.error('API error - get liquidation stats:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch liquidation statistics',
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