import { NextResponse } from 'next/server';
import { getTimeRangeIncome, aggregateBySymbolWithTrades } from '@/lib/api/income';
import { configLoader } from '@/lib/config/configLoader';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(async (request: Request, _user) => {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') as '24h' | '7d' | '30d' | '90d' | '1y' | 'all' || '7d';

    // Load config to get API credentials
    let config = configLoader.getConfig();
    if (!config) {
      config = await configLoader.loadConfig();
    }

    // If paper mode is enabled, return empty symbol data for now
    // (Could be enhanced to show per-symbol stats from paper trading)
    if (config.global?.paperMode) {
      return NextResponse.json({
        symbols: [],
        range,
        recordCount: 0,
      });
    }

    if (!config.api || !config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json(
        { error: 'API credentials not configured' },
        { status: 500 }
      );
    }

    const credentials = {
      apiKey: config.api.apiKey,
      secretKey: config.api.secretKey,
    };

    // Fetch income history
    const records = await getTimeRangeIncome(credentials, range);

    // Discover symbols from income records (includes ALL traded symbols)
    const symbolsFromIncome = Array.from(new Set(records.map(r => r.symbol).filter(s => s)));

    // Calculate time range for trade fetching
    const now = Date.now();
    let startTime: number;

    switch (range) {
      case '24h':
        startTime = now - 24 * 60 * 60 * 1000;
        break;
      case '7d':
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case '30d':
        startTime = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case '90d':
        startTime = now - 90 * 24 * 60 * 60 * 1000;
        break;
      case '1y':
        startTime = now - 365 * 24 * 60 * 60 * 1000;
        break;
      case 'all':
        startTime = now - 2 * 365 * 24 * 60 * 60 * 1000;
        break;
      default:
        startTime = now - 7 * 24 * 60 * 60 * 1000;
    }

    // Aggregate by symbol WITH REAL realized PnL from trades
    const symbols = await aggregateBySymbolWithTrades(
      records,
      credentials,
      symbolsFromIncome,
      startTime,
      now
    );

    return NextResponse.json({
      symbols,
      range,
      recordCount: records.length,
    });
  } catch (error) {
    console.error('Error fetching per-symbol income:', error);

    const { searchParams } = new URL(request.url);
    return NextResponse.json({
      symbols: [],
      range: searchParams.get('range') || '7d',
      recordCount: 0,
      error: 'Failed to fetch per-symbol income'
    });
  }
});
