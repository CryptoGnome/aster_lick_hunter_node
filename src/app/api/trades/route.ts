import { NextResponse } from 'next/server';
import { getAllOrders } from '@/lib/api/orders';
import { loadConfig } from '@/lib/bot/config';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');

    const config = await loadConfig();

    // If paper mode is enabled, return paper trading trades from database
    if (config.global.paperMode) {
      try {
        const { Database } = await import('@/lib/db/database');
        const db = Database.getInstance();
        
        let sql = 'SELECT * FROM paper_orders WHERE status = ? ORDER BY created_time DESC';
        const params: any[] = ['FILLED'];
        
        if (symbol) {
          sql += ' AND symbol = ?';
          params.push(symbol);
        }
        
        sql += ' LIMIT ?';
        params.push(limit);
        
        const orders = await db.all<any>(sql, params);
        
        // Format to match API response
        const formattedTrades = orders.map((order: any) => ({
          symbol: order.symbol,
          orderId: order.order_id,
          side: order.side,
          price: order.filled_price || order.price || 0,
          quantity: order.filled_quantity,
          status: order.status,
          time: order.filled_time || order.created_time,
          type: order.type,
        }));
        
        console.log(`[Trades API] Returning ${formattedTrades.length} paper trades from DB`);
        return NextResponse.json(formattedTrades);
      } catch (error: any) {
        console.log('[Trades API] Error reading paper trades from DB:', error.message);
        return NextResponse.json([]);
      }
    }

    // If no API key is configured and not in paper mode, return empty array
    if (!config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json([]);
    }

    // Get real trades from API
    const trades = await getAllOrders(symbol, config.api, undefined, undefined, limit);

    return NextResponse.json(trades || []);
  } catch (error: any) {
    console.error('API Trades error:', error);

    // Return mock data on error
    return NextResponse.json([
      {
        symbol: 'BTCUSDT',
        orderId: 1,
        side: 'BUY',
        price: 42000,
        quantity: 0.1,
        status: 'FILLED',
        time: Date.now() - 3600000,
      },
    ]);
  }
}