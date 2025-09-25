import { NextResponse } from 'next/server';
import { getAllOrders } from '@/lib/api/orders';
import { loadConfig } from '@/lib/bot/config';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'BTCUSDT';
    const limit = parseInt(searchParams.get('limit') || '10');

    const config = await loadConfig();

    // If no API key is configured, return mock data
    if (!config.api.apiKey || !config.api.secretKey) {
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
        {
          symbol: 'ETHUSDT',
          orderId: 2,
          side: 'SELL',
          price: 2200,
          quantity: 1,
          status: 'FILLED',
          time: Date.now() - 7200000,
        },
      ]);
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