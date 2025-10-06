import { NextRequest, NextResponse } from 'next/server';
import { getAllOrders, getUserTrades } from '@/lib/api/orders';
import { loadConfig } from '@/lib/bot/config';
import { Order, OrderStatus } from '@/lib/types/order';

// Cache for orders to reduce API calls
let ordersCache: { data: Order[]; timestamp: number } | null = null;
const CACHE_TTL = 10000; // 10 seconds

export async function GET(request: NextRequest) {
  try {
    const config = await loadConfig();
    const searchParams = request.nextUrl.searchParams;

    // Extract query parameters
    const status = searchParams.get('status');
    const symbol = searchParams.get('symbol');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    const limit = parseInt(searchParams.get('limit') || '100');
    const force = searchParams.get('force') === 'true';

    // Get configured symbols
    const configuredSymbols = config.symbols ? Object.keys(config.symbols) : [];

    // Determine which symbol to fetch - use provided symbol or first configured symbol
    const fetchSymbol = symbol || (configuredSymbols.length > 0 ? configuredSymbols[0] : 'BTCUSDT');

    // If no API key is configured, return empty array
    if (!config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json([]);
    }

    // Check cache if not forcing refresh
    if (!force && ordersCache && Date.now() - ordersCache.timestamp < CACHE_TTL) {
      const filtered = filterOrders(ordersCache.data, { status, symbol, startTime, endTime, limit });
      return NextResponse.json(filtered);
    }

    try {
      // Fetch orders from exchange - we can only fetch one symbol at a time from the API
      // So we'll fetch for the requested symbol or iterate through configured symbols
      let allOrders: any[] = [];

      if (symbol && symbol !== 'ALL') {
        // Fetch for specific symbol
        const orders = await getAllOrders(
          symbol,
          config.api,
          startTime ? parseInt(startTime) : undefined,
          endTime ? parseInt(endTime) : undefined,
          Math.min(limit * 2, 1000)
        );
        allOrders = orders;
      } else if (configuredSymbols.length > 0) {
        // Fetch for all configured symbols
        const symbolsToFetch = configuredSymbols; // Fetch all configured symbols

        for (const sym of symbolsToFetch) {
          try {
            const orders = await getAllOrders(
              sym,
              config.api,
              startTime ? parseInt(startTime) : undefined,
              endTime ? parseInt(endTime) : undefined,
              Math.min(limit, 200) // Limit per symbol when fetching multiple
            );
            allOrders = allOrders.concat(orders);
          } catch (err) {
            console.error(`Failed to fetch orders for ${sym}:`, err);
          }
        }
      } else {
        // Fallback to default symbol
        const orders = await getAllOrders(
          fetchSymbol,
          config.api,
          startTime ? parseInt(startTime) : undefined,
          endTime ? parseInt(endTime) : undefined,
          Math.min(limit * 2, 1000)
        );
        allOrders = orders;
      }

      // Fetch user trades to get realized PnL for filled orders
      const pnlMap = new Map<number, number>(); // orderId → total realizedPnl

      if (symbol && symbol !== 'ALL') {
        // Fetch trades for specific symbol
        try {
          const trades = await getUserTrades(symbol, config.api, {
            startTime: startTime ? parseInt(startTime) : Date.now() - 7 * 24 * 60 * 60 * 1000,
            endTime: endTime ? parseInt(endTime) : Date.now(),
            limit: 1000,
          });

          // Aggregate PnL by orderId (handle multiple fills per order)
          trades.forEach(trade => {
            const existing = pnlMap.get(trade.orderId) || 0;
            pnlMap.set(trade.orderId, existing + parseFloat(trade.realizedPnl));
          });
        } catch (err) {
          console.error(`Failed to fetch trades for ${symbol}:`, err);
        }
      } else if (configuredSymbols.length > 0) {
        // Fetch trades for all configured symbols
        const symbolsToFetch = configuredSymbols;

        for (const sym of symbolsToFetch) {
          try {
            const trades = await getUserTrades(sym, config.api, {
              startTime: startTime ? parseInt(startTime) : Date.now() - 7 * 24 * 60 * 60 * 1000,
              endTime: endTime ? parseInt(endTime) : Date.now(),
              limit: 1000,
            });

            // Aggregate PnL by orderId (handle multiple fills per order)
            trades.forEach(trade => {
              const existing = pnlMap.get(trade.orderId) || 0;
              pnlMap.set(trade.orderId, existing + parseFloat(trade.realizedPnl));
            });
          } catch (err) {
            console.error(`Failed to fetch trades for ${sym}:`, err);
          }
        }
      }

      // Transform and enrich order data
      const transformedOrders: Order[] = allOrders.map(order => {
        // Get realized PnL from trades map using orderId
        const realizedPnl = pnlMap.get(order.orderId);
        const realizedPnlStr = realizedPnl !== undefined ? realizedPnl.toString() : '0';

        return {
          symbol: order.symbol,
          orderId: order.orderId,
          clientOrderId: order.clientOrderId || order.origClientOrderId,
          price: order.price,
          origQty: order.origQty,
          executedQty: order.executedQty,
          cumulativeQuoteQty: order.cumQuote,
          status: order.status as OrderStatus,
          timeInForce: order.timeInForce,
          type: order.type || order.origType,
          side: order.side,
          stopPrice: order.stopPrice,
          time: order.time,
          updateTime: order.updateTime,
          positionSide: order.positionSide || 'BOTH',
          closePosition: order.closePosition || false,
          activatePrice: order.activatePrice,
          priceRate: order.priceRate,
          reduceOnly: order.reduceOnly || false,
          priceProtect: order.priceProtect || false,
          avgPrice: order.avgPrice || order.price,
          origType: order.origType || order.type,
          realizedProfit: realizedPnlStr,
        };
      });

      // Update cache
      ordersCache = { data: transformedOrders, timestamp: Date.now() };

      // Filter orders based on status and other criteria
      const filtered = filterOrders(transformedOrders, { status, symbol, startTime, endTime, limit });

      return NextResponse.json(filtered);
    } catch (apiError: any) {
      console.error('API Orders error:', apiError);

      // If API fails, return cached data if available
      if (ordersCache) {
        const filtered = filterOrders(ordersCache.data, { status, symbol, startTime, endTime, limit });
        return NextResponse.json(filtered);
      }

      // Otherwise return empty array
      return NextResponse.json([]);
    }
  } catch (error) {
    console.error('Error in orders/all endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function filterOrders(
  orders: Order[],
  filters: {
    status?: string | null;
    symbol?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    limit: number;
  }
): Order[] {
  let filtered = [...orders];

  // Filter by status
  if (filters.status) {
    const statusList = filters.status.split(',').map(s => s.trim());
    filtered = filtered.filter(order => statusList.includes(order.status));
  }

  // Filter by symbol
  if (filters.symbol) {
    filtered = filtered.filter(order => order.symbol === filters.symbol);
  }

  // Filter by time range
  if (filters.startTime) {
    const start = parseInt(filters.startTime);
    filtered = filtered.filter(order => order.updateTime >= start);
  }

  if (filters.endTime) {
    const end = parseInt(filters.endTime);
    filtered = filtered.filter(order => order.updateTime <= end);
  }

  // Sort by updateTime descending (most recent first)
  filtered.sort((a, b) => b.updateTime - a.updateTime);

  // Limit results
  return filtered.slice(0, filters.limit);
}

