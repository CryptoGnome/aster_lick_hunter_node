import { NextRequest, NextResponse } from 'next/server';
import { placeOrder } from '@/lib/api/orders';
import { loadConfig } from '@/lib/bot/config';
import { withAuth } from '@/lib/auth/with-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/positions/add
 * Add to an existing position by placing a new order
 */
export const POST = withAuth(async (request: NextRequest, _user) => {
  try {
    const body = await request.json();
    const { symbol, side, orderType, quantity, price } = body;

    // Validate required fields
    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Symbol is required' },
        { status: 400 }
      );
    }

    if (!side || !['LONG', 'SHORT'].includes(side)) {
      return NextResponse.json(
        { success: false, error: 'Valid side (LONG or SHORT) is required' },
        { status: 400 }
      );
    }

    if (!orderType || !['LIMIT', 'MARKET'].includes(orderType)) {
      return NextResponse.json(
        { success: false, error: 'Valid order type (LIMIT or MARKET) is required' },
        { status: 400 }
      );
    }

    if (typeof quantity !== 'number' || quantity <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid quantity is required' },
        { status: 400 }
      );
    }

    // Price is required for limit orders
    if (orderType === 'LIMIT' && (typeof price !== 'number' || price <= 0)) {
      return NextResponse.json(
        { success: false, error: 'Valid price is required for limit orders' },
        { status: 400 }
      );
    }

    // Load config for API credentials
    const config = await loadConfig();
    
    if (!config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json(
        { success: false, error: 'API keys not configured' },
        { status: 400 }
      );
    }

    // Determine order side based on position side
    // LONG position: add by BUYing more
    // SHORT position: add by SELLing more
    const orderSide = side === 'LONG' ? 'BUY' : 'SELL';

    // Build order params - include positionSide for Hedge Mode
    // Note: Don't send reduceOnly=false, only send it when true
    const orderParams: {
      symbol: string;
      side: 'BUY' | 'SELL';
      type: 'MARKET' | 'LIMIT';
      quantity: number;
      price?: number;
      positionSide: 'LONG' | 'SHORT';
      timeInForce?: 'GTC';
    } = {
      symbol,
      side: orderSide,
      type: orderType as 'MARKET' | 'LIMIT',
      quantity,
      positionSide: side, // Use the position side for Hedge Mode
    };

    // Add price for limit orders
    if (orderType === 'LIMIT' && price) {
      orderParams.price = price;
      orderParams.timeInForce = 'GTC';
    }

    // Place the order
    const result = await placeOrder(orderParams, config.api);

    return NextResponse.json({
      success: true,
      message: `Successfully placed ${orderType.toLowerCase()} order to add to ${side} position`,
      order: {
        orderId: result.orderId,
        symbol: result.symbol,
        side: result.side,
        type: result.type,
        quantity: result.quantity,
        price: result.price,
        status: result.status,
      },
    });
  } catch (error: any) {
    console.error('[API] Error adding to position:', error);
    
    // Extract error message from Axios error response
    let errorMessage = 'Failed to place order';
    
    if (error?.response?.data?.msg) {
      // Aster/Binance API error format
      errorMessage = error.response.data.msg;
    } else if (error?.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error?.response?.data?.error) {
      errorMessage = error.response.data.error;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    console.error('[API] Extracted error message:', errorMessage);
    
    // Check for common API errors
    if (errorMessage.includes('insufficient') || errorMessage.includes('Insufficient')) {
      return NextResponse.json(
        { success: false, error: 'Insufficient margin for this order' },
        { status: 400 }
      );
    }
    
    if (errorMessage.includes('Invalid quantity') || errorMessage.includes('LOT_SIZE')) {
      return NextResponse.json(
        { success: false, error: 'Invalid quantity. Check minimum order size and step size.' },
        { status: 400 }
      );
    }
    
    if (errorMessage.includes('PRICE_FILTER') || errorMessage.includes('price')) {
      return NextResponse.json(
        { success: false, error: `Price error: ${errorMessage}` },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
});
