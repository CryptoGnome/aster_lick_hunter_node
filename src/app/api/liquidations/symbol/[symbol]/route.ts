import { NextRequest, NextResponse } from 'next/server';
import { liquidationStorage } from '@/lib/services/liquidationStorage';
import { ensureDbInitialized } from '@/lib/db/initDb';

interface RouteParams {
  params: Promise<{ symbol: string }>;
}

/**
 * GET /api/liquidations/symbol/[symbol]
 * Returns detailed statistics for a specific symbol
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await ensureDbInitialized();

    const { symbol } = await params;
    
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Symbol is required' },
        { status: 400 }
      );
    }

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

    // Get symbol details
    const details = await liquidationStorage.getSymbolDetails(symbol.toUpperCase(), timeWindowSeconds);
    
    if (!details) {
      return NextResponse.json(
        { success: false, error: `No data found for symbol ${symbol}` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...details,
        timeWindow: timeWindowSeconds,
        timeWindowLabel: getTimeWindowLabel(timeWindowSeconds),
      },
    });
  } catch (error) {
    console.error('API error - get symbol details:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch symbol details',
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
