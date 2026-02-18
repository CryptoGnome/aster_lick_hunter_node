import { NextResponse } from 'next/server';
import { getTimeRangeIncome, aggregateDailyPnLWithTrades, calculatePerformanceMetrics } from '@/lib/api/income';
import { configLoader } from '@/lib/config/configLoader';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(async (request: Request, _user) => {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') as '24h' | '7d' | '30d' | '90d' | '1y' | 'all' || '7d';

    // Load config to get API credentials and symbols
    let config = configLoader.getConfig();
    if (!config) {
      config = await configLoader.loadConfig();
    }

    // If paper mode is enabled, return simulated performance data
    if (config.global?.paperMode) {
      try {
        const { getVirtualBalanceTracker } = await import('@/lib/paperTrading/virtualBalance');
        const balanceTracker = getVirtualBalanceTracker();
        const balance = balanceTracker.getBalance();
        
        // For paper trading, we show today's session performance
        const today = new Date().toISOString().split('T')[0];
        const dailyPnL = [{
          date: today,
          realizedPnl: balance.realizedPnL,
          commission: 0, // Fees are already included in paper trading
          fundingFee: 0,
          insuranceClear: 0,
          marketMerchantReward: 0,
          apolloxRebate: 0,
          usdfReward: 0,
          netPnl: balance.realizedPnL,
          tradeCount: balance.trades,
          cumulativePnl: balance.realizedPnL,
        }];

        const metrics = {
          totalPnl: balance.totalPnL,
          totalRealizedPnl: balance.realizedPnL,
          totalCommission: 0,
          totalFundingFee: 0,
          totalInsuranceClear: 0,
          totalMarketMerchantReward: 0,
          totalApolloxRebate: 0,
          totalUsdfReward: 0,
          winRate: balance.winRate,
          profitableDays: balance.wins,
          lossDays: balance.losses,
          bestDay: null,
          worstDay: null,
          avgDailyPnl: balance.realizedPnL,
          maxDrawdown: 0,
          profitFactor: balance.losses > 0 ? balance.wins / balance.losses : balance.wins,
          sharpeRatio: 0,
        };

        return NextResponse.json({
          dailyPnL,
          metrics,
          range,
          recordCount: 1,
        });
      } catch (error) {
        // Paper trading not initialized yet, return empty data
        return NextResponse.json({
          dailyPnL: [],
          metrics: {
            totalPnl: 0,
            totalRealizedPnl: 0,
            totalCommission: 0,
            totalFundingFee: 0,
            totalInsuranceClear: 0,
            totalMarketMerchantReward: 0,
            totalApolloxRebate: 0,
            totalUsdfReward: 0,
            winRate: 0,
            profitableDays: 0,
            lossDays: 0,
            bestDay: null,
            worstDay: null,
            avgDailyPnl: 0,
            maxDrawdown: 0,
            profitFactor: 0,
            sharpeRatio: 0,
          },
          range,
          recordCount: 0,
        });
      }
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

    // Fetch income history for fees and funding
    const records = await getTimeRangeIncome(credentials, range);

    // Discover symbols from income records (includes ALL traded symbols, not just configured ones)
    const symbolsFromIncome = Array.from(new Set(records.map(r => r.symbol).filter(s => s)));
    const configuredSymbols = config.symbols ? Object.keys(config.symbols) : [];

    // Use income symbols if available, fallback to configured symbols
    const symbols = symbolsFromIncome.length > 0 ? symbolsFromIncome : configuredSymbols;

    console.log(`[Income API] Fetching trades for ${symbols.length} symbols: ${symbols.join(', ')}`);

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

    // Aggregate with REAL realized PnL from user trades
    const dailyPnL = await aggregateDailyPnLWithTrades(
      records,
      credentials,
      symbols,
      startTime,
      now
    );

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