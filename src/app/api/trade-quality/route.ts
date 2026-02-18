import { NextRequest, NextResponse } from 'next/server';
import { tradeQualityDb } from '@/lib/db/tradeQualityDb';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');
    const symbol = searchParams.get('symbol') || undefined;
    const recommendation = searchParams.get('recommendation') || undefined;
    const since = searchParams.get('since') ? parseInt(searchParams.get('since')!) : undefined;
    const type = searchParams.get('type') || 'signals'; // 'signals', 'fta', 'stats'

    if (type === 'stats') {
      const timeframe = parseInt(searchParams.get('timeframe') || String(24 * 60 * 60 * 1000));
      const stats = tradeQualityDb.getStats(timeframe);
      return NextResponse.json({ success: true, stats });
    }

    if (type === 'fta') {
      const signals = tradeQualityDb.getRecentFTASignals({ limit, symbol, since });
      return NextResponse.json({ success: true, signals });
    }

    // Default: trade quality signals
    const signals = tradeQualityDb.getRecentSignals({ limit, symbol, recommendation, since });
    return NextResponse.json({ success: true, signals });

  } catch (error) {
    console.error('[API] Error fetching trade quality signals:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch trade quality signals' },
      { status: 500 }
    );
  }
}

// POST endpoint for saving signals (called from bot)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, data } = body;

    if (type === 'signal') {
      const id = tradeQualityDb.saveTradeSignal(data);
      return NextResponse.json({ success: true, id });
    }

    if (type === 'fta') {
      const id = tradeQualityDb.saveFTASignal(data);
      return NextResponse.json({ success: true, id });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid type' },
      { status: 400 }
    );

  } catch (error) {
    console.error('[API] Error saving trade quality signal:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save signal' },
      { status: 500 }
    );
  }
}
