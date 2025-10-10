import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '@/lib/bot/config';
import { getIncomeHistory, IncomeRecord } from '@/lib/api/income';

type SummaryRange = '24h' | '7d' | '30d' | '90d' | '1y' | 'all';

interface SymbolSummary {
  symbol: string;
  realizedPnl: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  lastTradeTime: number | null;
}

const RANGE_LOOKBACK: Record<SummaryRange, number | null> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
  all: null,
};

export async function GET(request: NextRequest) {
  try {
    const config = await loadConfig();
    const credentials = config.api;

    if (!credentials?.apiKey || !credentials?.secretKey) {
      return NextResponse.json({
        symbols: [],
        range: '30d',
        generatedAt: Date.now(),
      });
    }

    const searchParams = request.nextUrl.searchParams;
    const rangeParam = (searchParams.get('range') as SummaryRange) || '30d';
    const range: SummaryRange = RANGE_LOOKBACK[rangeParam] !== undefined ? rangeParam : '30d';
    const limitParam = parseInt(searchParams.get('limit') || '1000', 10);
    const limit = Math.min(Math.max(limitParam, 100), 2000);
    const now = Date.now();
    const lookback = RANGE_LOOKBACK[range];
    const startTime = lookback ? now - lookback : undefined;

    const records = await getIncomeHistory(credentials, {
      incomeType: 'REALIZED_PNL',
      startTime,
      endTime: now,
      limit,
    });

    if (!records || records.length === 0) {
      return NextResponse.json({
        symbols: [],
        range,
        generatedAt: Date.now(),
      });
    }

    const activeSymbols = new Set(Object.keys(config.symbols || {}));
    const summaryMap = new Map<string, SymbolSummary & { totalWin: number; totalLoss: number }>();

    const upsertSummary = (record: IncomeRecord) => {
      const symbol = record.symbol;
      if (!symbol) return;
      if (activeSymbols.size > 0 && !activeSymbols.has(symbol)) return;

      const amount = parseFloat(record.income || '0');
      if (!summaryMap.has(symbol)) {
        summaryMap.set(symbol, {
          symbol,
          realizedPnl: 0,
          tradeCount: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          avgWin: 0,
          avgLoss: 0,
          largestWin: 0,
          largestLoss: 0,
          lastTradeTime: null,
          totalWin: 0,
          totalLoss: 0,
        });
      }

      const entry = summaryMap.get(symbol)!;
      entry.realizedPnl += amount;
      entry.tradeCount += 1;
      entry.lastTradeTime = entry.lastTradeTime ? Math.max(entry.lastTradeTime, record.time) : record.time;

      if (amount > 0) {
        entry.wins += 1;
        entry.totalWin += amount;
        entry.largestWin = Math.max(entry.largestWin, amount);
      } else if (amount < 0) {
        const lossAbs = Math.abs(amount);
        entry.losses += 1;
        entry.totalLoss += lossAbs;
        entry.largestLoss = Math.max(entry.largestLoss, lossAbs);
      }
    };

    records.forEach(upsertSummary);

    const summaries: SymbolSummary[] = Array.from(summaryMap.values()).map(entry => {
      const { totalWin, totalLoss, ...rest } = entry;
      const winRate = rest.tradeCount > 0 ? (rest.wins / rest.tradeCount) * 100 : 0;
      return {
        ...rest,
        winRate,
        avgWin: rest.wins > 0 ? totalWin / rest.wins : 0,
        avgLoss: rest.losses > 0 ? -(totalLoss / rest.losses) : 0,
      };
    }).sort((a, b) => b.realizedPnl - a.realizedPnl);

    const best = summaries.reduce<SymbolSummary | null>((acc, item) => {
      if (!acc || item.realizedPnl > acc.realizedPnl) {
        return item;
      }
      return acc;
    }, null);

    const worst = summaries.reduce<SymbolSummary | null>((acc, item) => {
      if (!acc || item.realizedPnl < acc.realizedPnl) {
        return item;
      }
      return acc;
    }, null);

    return NextResponse.json({
      symbols: summaries,
      best,
      worst,
      range,
      generatedAt: Date.now(),
    });
  } catch (error) {
    console.error('[Realized PnL Summary] Failed to generate summary:', error);
    return NextResponse.json({
      symbols: [],
      range: '30d',
      generatedAt: Date.now(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
