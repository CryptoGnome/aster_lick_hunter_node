import { NextRequest, NextResponse } from 'next/server';
import { cancelOrder, placeOrder, queryOrder } from '@/lib/api/orders';
import { loadConfig } from '@/lib/bot/config';
import { withAuth } from '@/lib/auth/with-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/modify
 * Modify an open order (cancel and replace)
 */
export const POST = withAuth(async (request: NextRequest, _user) => {
  try {
    const body = await request.json();
    const { symbol, orderId, quantity, price } = body;

    // Validate required fields
    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Symbol is required' },
        { status: 400 }
      );
    }

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'Order ID is required' },
        { status: 400 }
      );
    }

    if (typeof quantity !== 'number' || quantity <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid quantity is required' },
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

    // First, get the existing order details
    const existingOrder = await queryOrder(
      { symbol, orderId: Number(orderId) },
      config.api
    );

    if (!existingOrder) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    // Check if order can be modified
    if (existingOrder.status !== 'NEW' && existingOrder.status !== 'PARTIALLY_FILLED') {
      return NextResponse.json(
        { success: false, error: `Cannot modify order with status: ${existingOrder.status}` },
        { status: 400 }
      );
    }

    // Cancel the existing order
    try {
      await cancelOrder(
        { symbol, orderId: Number(orderId) },
        config.api
      );
    } catch (cancelError: any) {
      // If cancel fails due to order already filled, return appropriate error
      const errorMsg = cancelError?.response?.data?.msg || cancelError.message;
      if (errorMsg.includes('UNKNOWN_ORDER') || errorMsg.includes('Unknown order')) {
        return NextResponse.json(
          { success: false, error: 'Order no longer exists or was already filled' },
          { status: 400 }
        );
      }
      throw cancelError;
    }

    // Place a new order with the updated parameters
    const orderParams: {
      symbol: string;
      side: 'BUY' | 'SELL';
      type: 'LIMIT';
      quantity: number;
      price: number;
      positionSide?: 'LONG' | 'SHORT';
      timeInForce: 'GTC';
    } = {
      symbol,
      side: existingOrder.side as 'BUY' | 'SELL',
      type: 'LIMIT',
      quantity,
      price: typeof price === 'number' ? price : parseFloat(String(existingOrder.price) || '0'),
      timeInForce: 'GTC',
    };

    // Include positionSide if it was set on the original order
    const positionSide = (existingOrder as any).positionSide;
    if (positionSide && positionSide !== 'BOTH') {
      orderParams.positionSide = positionSide as 'LONG' | 'SHORT';
    }

    const newOrder = await placeOrder(orderParams, config.api);

    return NextResponse.json({
      success: true,
      message: 'Order modified successfully',
      oldOrderId: orderId,
      newOrder: {
        orderId: newOrder.orderId,
        symbol: newOrder.symbol,
        side: newOrder.side,
        type: newOrder.type,
        quantity: newOrder.quantity,
        price: newOrder.price,
        status: newOrder.status,
      },
    });
  } catch (error: any) {
    console.error('[API] Error modifying order:', error);
    
    // Extract error message from Axios error response
    let errorMessage = 'Failed to modify order';
    
    if (error?.response?.data?.msg) {
      errorMessage = error.response.data.msg;
    } else if (error?.response?.data?.message) {
      errorMessage = error.response.data.message;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
});
