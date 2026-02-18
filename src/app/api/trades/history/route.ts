import { NextRequest, NextResponse } from 'next/server';
import { tradeHistoryDb } from '@/lib/db/tradeHistoryDb';

/**
 * GET /api/trades/history
 * 
 * Query local trade history database.
 * Much faster than exchange API and supports deep history.
 * 
 * Query params:
 *   symbol    - Filter by symbol (e.g. BTCUSDT)
 *   status    - Filter by status (e.g. FILLED, CANCELED) - comma-separated
 *   side      - Filter by side (BUY or SELL)
 *   startTime - Start timestamp (ms)
 *   endTime   - End timestamp (ms)
 *   limit     - Max results (default 200)
 *   offset    - Pagination offset
 *   format    - Response format: 'raw' | 'orders' | 'markers' (default: 'orders')
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol') || undefined;
    const status = searchParams.get('status') || undefined;
    const side = searchParams.get('side') || undefined;
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    const limit = parseInt(searchParams.get('limit') || '200');
    const offset = parseInt(searchParams.get('offset') || '0');
    const format = searchParams.get('format') || 'orders';

    // Chart markers mode - optimized for TradingView
    if (format === 'markers') {
      if (!symbol) {
        return NextResponse.json(
          { error: 'symbol is required for markers format' },
          { status: 400 }
        );
      }
      const markers = tradeHistoryDb.getChartMarkers(
        symbol,
        startTime ? parseInt(startTime) : Date.now() - 90 * 24 * 60 * 60 * 1000, // Default 90 days
        endTime ? parseInt(endTime) : undefined
      );
      return NextResponse.json(markers);
    }

    // Orders format - compatible with existing UI components
    if (format === 'orders') {
      const orders = tradeHistoryDb.getRecentFilledOrders({
        symbol,
        limit,
        startTime: startTime ? parseInt(startTime) : undefined,
      });
      return NextResponse.json(orders);
    }

    // Raw format - full trade records
    const statusList = status?.includes(',') ? status.split(',').map(s => s.trim()) : status;
    const trades = tradeHistoryDb.queryTrades({
      symbol,
      status: statusList,
      side,
      startTime: startTime ? parseInt(startTime) : undefined,
      endTime: endTime ? parseInt(endTime) : undefined,
      limit,
      offset,
    });

    return NextResponse.json(trades);
  } catch (error) {
    console.error('[Trade History API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trade history', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/trades/history?action=stats
 * Get aggregate stats from local DB
 */
