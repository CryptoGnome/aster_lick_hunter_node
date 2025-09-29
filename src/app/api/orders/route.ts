import { NextRequest, NextResponse } from 'next/server';
import { getOpenOrders } from '@/lib/api/market';
import { loadConfig } from '@/lib/bot/config';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(async (request: NextRequest, _user) => {
  try {
    const config = await loadConfig();

    // If no API key is configured, return empty orders
    if (!config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json([]);
    }

    // Get symbol from query params if provided
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol') || undefined;

    // Get open orders from exchange
    const orders = await getOpenOrders(symbol, config.api);

    // Filter and format orders for UI
    const formattedOrders = orders.map(order => ({
      symbol: order.symbol,
      orderId: order.orderId,
      type: order.type,
      side: order.side,
      price: order.price ? parseFloat(order.price) : undefined,
      stopPrice: order.stopPrice ? parseFloat(order.stopPrice) : undefined,
      quantity: parseFloat(order.origQty || '0'),
      reduceOnly: order.reduceOnly,
      status: order.status,
      time: order.time,
    }));

    return NextResponse.json(formattedOrders);
  } catch (error) {
    console.error('Error fetching open orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch open orders' },
      { status: 500 }
    );
  }
});