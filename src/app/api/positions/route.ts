import { NextRequest, NextResponse } from 'next/server';
import { getPositions } from '@/lib/api/orders';
import { getOpenOrders } from '@/lib/api/market';
import { loadConfig } from '@/lib/bot/config';
import { withAuth } from '@/lib/auth/with-auth';

// Simple in-memory cache
interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache: Map<string, CacheEntry> = new Map();
const CACHE_TTL = 5000; // 5 seconds

export const GET = withAuth(async (request: NextRequest, _user) => {
  const cacheKey = 'positions';

  // Check if force refresh is requested
  const searchParams = request.nextUrl.searchParams;
  const forceRefresh = searchParams.get('force') === 'true';

  // Check cache first (skip if force refresh)
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('[Positions API] Returning cached data');
      return NextResponse.json(cached.data);
    }
  }

  try {
    const config = await loadConfig();

    // If paper mode is enabled, return paper trading positions from database
    if (config.global.paperMode) {
      try {
        const { PaperTradingDatabase } = await import('@/lib/db/paperTradingDb');
        const db = PaperTradingDatabase.getInstance();
        const positions = await db.all<any>('SELECT * FROM positions');
        
        console.log(`[Positions API] Paper trading has ${positions.length} position(s) from database`);
        
        // Format database positions to match API format
        const formattedPositions = positions.map((pos: any) => {
          const unrealizedPnlPercent = pos.unrealized_pnl_percent || 0;
          return {
            symbol: pos.symbol,
            side: pos.side,
            positionAmt: pos.quantity.toString(),
            entryPrice: parseFloat(pos.entry_price),
            markPrice: parseFloat(pos.current_price || pos.entry_price),
            pnl: parseFloat(pos.unrealized_pnl) || 0,
            pnlPercent: parseFloat(unrealizedPnlPercent),
            roe: unrealizedPnlPercent.toString(),
            liquidationPrice: parseFloat(pos.liquidation_price) || 0,
            leverage: parseInt(pos.leverage) || 10,
            margin: parseFloat(pos.margin),
            quantity: parseFloat(pos.quantity),
            hasSL: !!pos.stop_loss,
            hasTP: !!pos.take_profit,
            stopLoss: pos.stop_loss ? parseFloat(pos.stop_loss) : undefined,
            takeProfit: pos.take_profit ? parseFloat(pos.take_profit) : undefined,
          };
        });
        
        return NextResponse.json(formattedPositions);
      } catch (error) {
        console.error('[Positions API] Error getting paper trading positions:', error);
        // Return empty array instead of erroring
        return NextResponse.json([]);
      }
    }

    // If no API key is configured and not in paper mode, return empty positions
    if (!config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json([]);
    }

    // Get positions and open orders from exchange
    const [positions, openOrders] = await Promise.all([
      getPositions(config.api),
      getOpenOrders(undefined, config.api)
    ]);

    // Filter out positions with zero amount and format for UI
    const activePositions = positions
      .filter(pos => Math.abs(parseFloat(pos.positionAmt || '0')) > 0)
      .map(pos => {
        const positionAmt = parseFloat(pos.positionAmt || '0');
        const entryPrice = parseFloat(pos.entryPrice || '0');
        const markPrice = parseFloat(pos.markPrice || '0');
        const unRealizedProfit = parseFloat(pos.unRealizedProfit || '0');
        const leverage = parseInt(pos.leverage || '1');
        const quantity = Math.abs(positionAmt);
        const notionalValue = quantity * entryPrice;
        const currentNotionalValue = quantity * markPrice;
        const side = positionAmt > 0 ? 'LONG' : 'SHORT';

        // Check for active SL/TP orders for this position
        const hasStopLoss = openOrders.some(order =>
          order.symbol === pos.symbol &&
          (order.type === 'STOP_MARKET' || order.type === 'STOP') &&
          order.reduceOnly === true &&
          ((side === 'LONG' && order.side === 'SELL') || (side === 'SHORT' && order.side === 'BUY'))
        );

        const hasTakeProfit = openOrders.some(order =>
          order.symbol === pos.symbol &&
          (order.type === 'TAKE_PROFIT_MARKET' || order.type === 'TAKE_PROFIT' ||
           (order.type === 'LIMIT' && order.reduceOnly === true)) &&
          ((side === 'LONG' && order.side === 'SELL') || (side === 'SHORT' && order.side === 'BUY'))
        );

        return {
          symbol: pos.symbol,
          side,
          quantity,
          entryPrice,
          markPrice,
          pnl: unRealizedProfit,
          pnlPercent: notionalValue > 0 ? (unRealizedProfit / notionalValue) * 100 : 0,
          margin: currentNotionalValue / leverage,
          leverage,
          liquidationPrice: pos.liquidationPrice ? parseFloat(pos.liquidationPrice) : undefined,
          hasStopLoss,
          hasTakeProfit,
        };
      });

    // Cache the successful response
    cache.set(cacheKey, {
      data: activePositions,
      timestamp: Date.now(),
    });

    return NextResponse.json(activePositions);
  } catch (error) {
    console.error('Error fetching positions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch positions' },
      { status: 500 }
    );
  }
});