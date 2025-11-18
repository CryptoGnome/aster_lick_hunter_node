import { NextResponse } from 'next/server';
import { vwapService } from '@/lib/services/vwapService';
import { loadConfig } from '@/lib/bot/config';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const timeframe = searchParams.get('timeframe') || '1m';
    const lookback = parseInt(searchParams.get('lookback') || '100');

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
    const finalLookback = lookback || symbolConfig?.vwapLookback || 100;

    // Calculate VWAP
    const vwap = await vwapService.getVWAP(symbol, finalTimeframe, finalLookback);

    return NextResponse.json({
      vwap,
      symbol,
      timeframe: finalTimeframe,
      lookback: finalLookback,
      timestamp: Date.now()
    });

  } catch (error: any) {
    console.error('Failed to fetch VWAP data:', error);

    return NextResponse.json(
      {
        error: 'Failed to fetch VWAP data',
        details: error.message
      },
      { status: 500 }
    );
  }
}
