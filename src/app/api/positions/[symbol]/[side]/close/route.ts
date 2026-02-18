import { NextRequest, NextResponse } from 'next/server';
import { placeOrder } from '@/lib/api/orders';
import { getPositions } from '@/lib/api/orders';
import { getPositionMode } from '@/lib/api/positionMode';
import { loadConfig } from '@/lib/bot/config';
import { symbolPrecision } from '@/lib/utils/symbolPrecision';
import { getExchangeInfo } from '@/lib/api/market';
import { invalidateIncomeCache } from '@/lib/api/income';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string; side: string }> }
) {
  try {
    const { symbol, side } = await params;

    // Validate side parameter
    if (side !== 'LONG' && side !== 'SHORT') {
      return NextResponse.json(
        { error: 'Invalid side parameter. Must be LONG or SHORT', success: false },
        { status: 400 }
      );
    }

    const config = await loadConfig();

    // If no API key is configured, return simulation mode
    if (!config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json({
        success: true,
        message: `Simulated closing ${symbol} ${side} position`,
        simulated: true
      });
    }

    // Load exchange info for precision validation
    const exchangeInfo = await getExchangeInfo();
    symbolPrecision.parseExchangeInfo(exchangeInfo);

    // Get current positions to find the specific position
    const positions = await getPositions(config.api);

    // Find the target position
    const targetPosition = positions.find(pos => {
      const positionAmt = parseFloat(pos.positionAmt || '0');
      const posSymbol = pos.symbol;

      if (posSymbol !== symbol || positionAmt === 0) {
        return false;
      }

      const currentSide = positionAmt > 0 ? 'LONG' : 'SHORT';
      return currentSide === side;
    });

    if (!targetPosition) {
      return NextResponse.json(
        { error: `No open position found for ${symbol} ${side}`, success: false },
        { status: 404 }
      );
    }

    const positionAmt = parseFloat(targetPosition.positionAmt || '0');
    let quantity = Math.abs(positionAmt);

    // Format quantity according to exchange precision rules
    quantity = symbolPrecision.formatQuantity(symbol, quantity);

    if (quantity === 0) {
      return NextResponse.json(
        { error: `No position size for ${symbol} ${side}`, success: false },
        { status: 400 }
      );
    }

    // Determine the order side (opposite of position)
    const orderSide: 'SELL' | 'BUY' = side === 'LONG' ? 'SELL' : 'BUY';

    // Get current position mode from exchange
    let isHedgeMode = false;
    try {
      isHedgeMode = await getPositionMode(config.api);
      console.log(`Position mode: ${isHedgeMode ? 'HEDGE' : 'ONE_WAY'}`);
    } catch (error) {
      console.warn('Failed to fetch position mode, defaulting to ONE_WAY:', error);
    }

    // Check if we're in paper mode (simulation)
    if (config.global.paperMode) {
      console.log(`PAPER MODE: Would close position for ${symbol} ${side} with quantity ${quantity}`);
      return NextResponse.json({
        success: true,
        message: `Paper mode: Simulated closing ${symbol} ${side} position of ${quantity} units`,
        simulated: true,
        order_side: orderSide,
        quantity: quantity
      });
    }

    // Prepare market order to close the position
    const orderParams: any = {
      symbol,
      side: orderSide,
      type: 'MARKET' as const,
      quantity,
    };

    // Set position side based on mode
    if (isHedgeMode) {
      // In hedge mode, use the position side from the position
      orderParams.positionSide = targetPosition.positionSide || (side === 'LONG' ? 'LONG' : 'SHORT');
    } else {
      // In one-way mode, use BOTH and reduceOnly
      orderParams.positionSide = 'BOTH';
      orderParams.reduceOnly = true;
    }

    console.log(`Closing position with params:`, orderParams);

    // Place the market order to close the position
    const orderResult = await placeOrder(orderParams, config.api);

    console.log(`Successfully closed position ${symbol} ${side}:`, orderResult);

    // Invalidate income cache since a position was closed (generates realized PnL and commission)
    invalidateIncomeCache();
    console.log('[Close Position] Invalidated income cache after closing position');

    return NextResponse.json({
      success: true,
      message: `Successfully closed ${symbol} ${side} position`,
      order_id: orderResult.orderId,
      order_side: orderSide,
      quantity: quantity,
      position_mode: isHedgeMode ? 'HEDGE' : 'ONE_WAY',
      order_details: orderResult
    });

  } catch (error: any) {
    console.error(`Error closing position:`, error);

    // Handle specific API errors
    if (error.response?.data) {
      const errorMsg = error.response.data.msg || error.response.data.message || 'Unknown API error';

      // Add more specific error messages for common issues
      let enhancedError = errorMsg;
      if (errorMsg.includes('precision')) {
        enhancedError = `Quantity precision error: ${errorMsg}. The exchange requires specific decimal precision for this symbol.`;
      } else if (errorMsg.includes('balance')) {
        enhancedError = `Insufficient balance: ${errorMsg}`;
      } else if (errorMsg.includes('reduce only')) {
        enhancedError = `Reduce-only order error: ${errorMsg}. The order settings may not match your position.`;
      }

      return NextResponse.json(
        {
          error: enhancedError,
          success: false,
          details: error.response.data
        },
        { status: error.response.status || 500 }
      );
    }

    return NextResponse.json(
      {
        error: `Internal error: ${error.message || 'Unknown error'}`,
        success: false
      },
      { status: 500 }
    );
  }
}
