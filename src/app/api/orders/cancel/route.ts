import { NextRequest, NextResponse } from 'next/server';
import { cancelOrder } from '@/lib/api/orders';
import { loadConfig } from '@/lib/bot/config';
import { withAuth } from '@/lib/auth/with-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/cancel
 * Cancel an open order
 */
export const POST = withAuth(async (request: NextRequest, _user) => {
  try {
    const body = await request.json();
    const { symbol, orderId } = body;

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

    // Load config for API credentials
    const config = await loadConfig();
    
    if (!config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json(
        { success: false, error: 'API keys not configured' },
        { status: 400 }
      );
    }

    // Cancel the order
    const result = await cancelOrder(
      { symbol, orderId: Number(orderId) },
      config.api
    );

    return NextResponse.json({
      success: true,
      message: 'Order cancelled successfully',
      order: result,
    });
  } catch (error: any) {
    console.error('[API] Error cancelling order:', error);
    
    // Extract error message from Axios error response
    let errorMessage = 'Failed to cancel order';
    
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
