import { NextResponse } from 'next/server';
import { getMAEService } from '@/lib/services/maeService';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || undefined;
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    
    const maeService = getMAEService();
    
    // Get stats
    const stats = maeService.getStats(symbol);
    
    // Get recent records
    const recentRecords = maeService.getRecentRecords(limit, symbol);
    
    // Get active positions being tracked
    const activePositions = maeService.getActivePositions();
    
    return NextResponse.json({
      success: true,
      stats: stats || {
        totalTrades: 0,
        winners: 0,
        losers: 0,
        avgMaeWinners: 0,
        avgMaeLosers: 0,
        avgMfeWinners: 0,
        avgMfeLosers: 0,
        avgCapturedMfe: 0,
        avgMaeToMfeRatio: 0
      },
      recentRecords,
      activePositions: activePositions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        highPrice: p.highPrice,
        lowPrice: p.lowPrice,
        currentMae: p.side === 'LONG' 
          ? ((p.entryPrice - p.lowPrice) / p.entryPrice) * 100
          : ((p.highPrice - p.entryPrice) / p.entryPrice) * 100,
        currentMfe: p.side === 'LONG'
          ? ((p.highPrice - p.entryPrice) / p.entryPrice) * 100
          : ((p.entryPrice - p.lowPrice) / p.entryPrice) * 100,
        entryTime: p.entryTime,
        lastUpdate: p.lastUpdate
      })),
      timestamp: Date.now()
    });
  } catch (error: any) {
    console.error('MAE/MFE API error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Failed to fetch MAE/MFE data',
        stats: null,
        recentRecords: [],
        activePositions: []
      },
      { status: 500 }
    );
  }
}
