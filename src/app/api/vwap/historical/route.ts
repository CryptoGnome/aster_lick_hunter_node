import { NextResponse } from 'next/server';
import { getKlines } from '@/lib/api/market';
import { loadConfig } from '@/lib/bot/config';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const timeframe = searchParams.get('timeframe') || '1m';
    const limit = parseInt(searchParams.get('limit') || '500');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    // Read config to get VWAP settings for this symbol (optional fallback)
    const config = await loadConfig();
    const symbolConfig = config.symbols[symbol];

    // Use provided params or fall back to config
    const finalTimeframe = timeframe || symbolConfig?.vwapTimeframe || '1m';

    // Fetch klines
    const klines = await getKlines(symbol, finalTimeframe, limit);

    if (!klines || klines.length === 0) {
      return NextResponse.json(
        { error: 'No kline data available' },
        { status: 404 }
      );
    }

    // Calculate cumulative VWAP for each candle
    // VWAP resets at the start of each trading day (00:00 UTC)
    const vwapData: Array<{ time: number; value: number }> = [];
    let cumulativePriceVolume = 0;
    let cumulativeVolume = 0;
    let lastDayStart = 0;

    for (const kline of klines) {
      const openTime = kline.openTime;
      const high = parseFloat(kline.high);
      const low = parseFloat(kline.low);
      const close = parseFloat(kline.close);
      const volume = parseFloat(kline.volume);

      // Check if we've crossed into a new day (00:00 UTC)
      const dayStart = new Date(openTime);
      dayStart.setUTCHours(0, 0, 0, 0);
      const currentDayStart = dayStart.getTime();

      // Reset cumulative values at the start of a new day
      if (currentDayStart !== lastDayStart && lastDayStart !== 0) {
        cumulativePriceVolume = 0;
        cumulativeVolume = 0;
      }
      lastDayStart = currentDayStart;

      // Calculate typical price (HLC/3)
      const typicalPrice = (high + low + close) / 3;

      // Add to cumulative values
      cumulativePriceVolume += typicalPrice * volume;
      cumulativeVolume += volume;

      // Calculate VWAP
      const vwap = cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : close;

      // Add to result array (convert to seconds for lightweight-charts)
      vwapData.push({
        time: Math.floor(openTime / 1000),
        value: vwap
      });
    }

    return NextResponse.json({
      symbol,
      timeframe: finalTimeframe,
      data: vwapData,
      count: vwapData.length,
      timestamp: Date.now()
    });

  } catch (error: any) {
    console.error('Failed to fetch historical VWAP data:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch historical VWAP data',
        details: error.message
      },
      { status: 500 }
    );
  }
}
