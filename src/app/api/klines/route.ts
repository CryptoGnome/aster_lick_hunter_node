import { NextRequest, NextResponse } from 'next/server';
import { getKlines } from '@/lib/api/market';
import { getCandlesFor7Days } from '@/lib/klineCache';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    const symbol = searchParams.get('symbol');
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    const interval = searchParams.get('interval') || '5m';
    const requestedLimit = parseInt(searchParams.get('limit') || '0');
    const since = searchParams.get('since');

    // Validate interval
    const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
    if (!validIntervals.includes(interval)) {
      return NextResponse.json(
        { success: false, error: `Invalid interval. Must be one of: ${validIntervals.join(', ')}` },
        { status: 400 }
      );
    }

    // Calculate limit: use 7-day calculation if no specific limit requested
    const limit = requestedLimit > 0 
      ? Math.min(requestedLimit, 1500) 
      : getCandlesFor7Days(interval);

    console.log(`[Klines API] Fetching ${limit} candles for ${symbol} ${interval} (7-day optimized: ${getCandlesFor7Days(interval)})`);

    const klines = await getKlines(symbol, interval, limit);

    // Transform to lightweight-charts format: [timestamp, open, high, low, close, volume]
    const chartData = klines.map(kline => [
      Math.floor(kline.openTime / 1000), // Convert to seconds for TradingView
      parseFloat(kline.open),
      parseFloat(kline.high),
      parseFloat(kline.low),
      parseFloat(kline.close),
      parseFloat(kline.volume)
    ]);

    // Filter by since parameter if provided
    const filteredData = since 
      ? chartData.filter(([timestamp]) => timestamp >= parseInt(since) / 1000)
      : chartData;

    return NextResponse.json({
      success: true,
      data: filteredData,
      symbol,
      interval,
      count: filteredData.length,
      requestedLimit,
      calculatedLimit: limit,
      sevenDayOptimal: getCandlesFor7Days(interval)
    });

  } catch (error) {
    console.error('API error - get klines:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch klines data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}