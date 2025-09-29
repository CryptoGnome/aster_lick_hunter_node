import { NextResponse } from 'next/server';
import { getTimeRangeIncome, aggregateDailyPnL, calculatePerformanceMetrics } from '@/lib/api/income';
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

    if (!config.api || !config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json(
        { error: 'API credentials not configured' },
        { status: 500 }
      );
    }

    // Fetch income history (API will include today's trades if any)
    const records = await getTimeRangeIncome(
      {
        apiKey: config.api.apiKey,
        secretKey: config.api.secretKey,
      },
      range
    );

    // Aggregate by day
    const dailyPnL = aggregateDailyPnL(records);

    // CRITICAL FIX: Don't artificially add today's zeros - this causes inconsistency
    // Let the data be what the exchange API actually returns
    // If today has no trades, then today shouldn't appear in historical data

    // Calculate performance metrics
    const metrics = calculatePerformanceMetrics(dailyPnL);

    return NextResponse.json({
      dailyPnL,
      metrics,
      range,
      recordCount: records.length,
    });
  } catch (error) {
    console.error('Error fetching income history:', error);

    // Return empty data with proper structure on error
    const { searchParams } = new URL(request.url);
    return NextResponse.json({
      dailyPnL: [],
      metrics: calculatePerformanceMetrics([]),
      range: searchParams.get('range') || '7d',
      recordCount: 0,
      error: 'Failed to fetch income history'
    });
  }
});