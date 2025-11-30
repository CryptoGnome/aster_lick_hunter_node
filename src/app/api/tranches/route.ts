import { NextResponse } from 'next/server';
import { getAllTranchesForSymbol, getActiveTranches, getIsolatedTranches } from '@/lib/db/trancheDb';

/**
 * GET /api/tranches - Fetch tranche data
 * Query params:
 * - symbol: Filter by symbol (optional)
 * - side: Filter by side (optional)
 * - status: 'active', 'isolated', 'all' (default: 'all')
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const side = searchParams.get('side');
    const status = searchParams.get('status') || 'all';

    let tranches = [];

    if (symbol && side) {
      // Fetch specific symbol and side
      if (status === 'active') {
        const activeTranches = await getActiveTranches(symbol, side);
        tranches = activeTranches.filter(t => !t.isolated);
      } else if (status === 'isolated') {
        tranches = await getIsolatedTranches(symbol, side);
      } else {
        tranches = await getAllTranchesForSymbol(symbol);
        tranches = tranches.filter(t => t.side === side);
      }
    } else if (symbol) {
      // Fetch all sides for symbol
      tranches = await getAllTranchesForSymbol(symbol);

      if (status === 'active') {
        tranches = tranches.filter(t => t.status === 'active' && !t.isolated);
      } else if (status === 'isolated') {
        tranches = tranches.filter(t => t.isolated);
      }
    } else {
      // Return error - need at least symbol
      return NextResponse.json(
        { error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    // Calculate aggregated metrics
    const activeTranches = tranches.filter(t => t.status === 'active' && !t.isolated);
    const isolatedTranches = tranches.filter(t => t.isolated);
    const closedTranches = tranches.filter(t => t.status === 'closed');

    const totalQuantity = activeTranches.reduce((sum, t) => sum + t.quantity, 0);
    const totalMarginUsed = activeTranches.reduce((sum, t) => sum + t.marginUsed, 0);
    const totalUnrealizedPnl = activeTranches.reduce((sum, t) => sum + t.unrealizedPnl, 0);
    const totalRealizedPnl = closedTranches.reduce((sum, t) => sum + t.realizedPnl, 0);

    // Calculate weighted average entry
    let weightedAvgEntry = 0;
    if (totalQuantity > 0) {
      const weightedSum = activeTranches.reduce(
        (sum, t) => sum + t.entryPrice * t.quantity,
        0
      );
      weightedAvgEntry = weightedSum / totalQuantity;
    }

    return NextResponse.json({
      tranches,
      metrics: {
        total: tranches.length,
        active: activeTranches.length,
        isolated: isolatedTranches.length,
        closed: closedTranches.length,
        totalQuantity,
        totalMarginUsed,
        totalUnrealizedPnl,
        totalRealizedPnl,
        weightedAvgEntry,
      },
    });
  } catch (error: any) {
    console.error('Error fetching tranches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tranches', details: error.message },
      { status: 500 }
    );
  }
}
