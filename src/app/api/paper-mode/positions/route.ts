import { NextResponse } from 'next/server';
import { paperModeSimulator } from '@/lib/services/paperModeSimulator';
import { loadConfig } from '@/lib/bot/config';

/**
 * GET /api/paper-mode/positions
 *
 * Returns all active paper mode positions
 */
export async function GET() {
  try {
    const config = await loadConfig();

    // Only return positions if in paper mode
    if (!config.global.paperMode) {
      return NextResponse.json({
        positions: [],
        paperMode: false,
        message: 'Not in paper mode'
      });
    }

    const positions = paperModeSimulator.getPositions();

    return NextResponse.json({
      positions: positions.map(pos => ({
        symbol: pos.symbol,
        side: pos.side,
        quantity: pos.quantity,
        entryPrice: pos.entryPrice,
        markPrice: pos.lastMarkPrice,
        slPrice: pos.slPrice,
        tpPrice: pos.tpPrice,
        leverage: pos.leverage,
        pnlPercent: pos.lastPnL,
        openTime: pos.openTime,
        unrealizedPnl: (pos.lastPnL / 100) * pos.quantity * pos.entryPrice * pos.leverage,
      })),
      paperMode: true,
      count: positions.length
    });
  } catch (error: any) {
    console.error('Error fetching paper mode positions:', error);
    return NextResponse.json(
      {
        error: `Failed to fetch paper mode positions: ${error.message}`,
        positions: [],
        paperMode: true
      },
      { status: 500 }
    );
  }
}
