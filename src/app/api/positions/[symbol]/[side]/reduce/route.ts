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
    const body = await request.json();
    const { percent } = body;

    // Validate side parameter
    if (side !== 'LONG' && side !== 'SHORT') {
      return NextResponse.json(
        { error: 'Invalid side parameter. Must be LONG or SHORT', success: false },
        { status: 400 }
      );
    }

    // Validate percent
    if (!percent || typeof percent !== 'number' || percent <= 0 || percent > 100) {
      return NextResponse.json(
        { error: 'Invalid percent parameter. Must be a number between 1 and 100', success: false },
        { status: 400 }
      );
    }

    const config = await loadConfig();

    // If no API key is configured, return simulation mode
    if (!config.api.apiKey || !config.api.secretKey) {
      return NextResponse.json({
        success: true,
        message: `Simulated reducing ${symbol} ${side} position by ${percent}%`,
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
    const totalQuantity = Math.abs(positionAmt);

    // Calculate the quantity to close
    let reduceQuantity = totalQuantity * (percent / 100);

    // Format quantity according to exchange precision rules
    reduceQuantity = symbolPrecision.formatQuantity(symbol, reduceQuantity);

    if (reduceQuantity === 0) {
      return NextResponse.json(
        { error: `Reduce quantity too small for ${symbol} at ${percent}%. Try a larger percentage.`, success: false },
        { status: 400 }
      );
    }

    // If reducing 100%, use full position amount to avoid dust
    if (percent === 100) {
      reduceQuantity = symbolPrecision.formatQuantity(symbol, totalQuantity);
    }

    // Determine the order side (opposite of position)
    const orderSide: 'SELL' | 'BUY' = side === 'LONG' ? 'SELL' : 'BUY';

    // Get current position mode from exchange
    let isHedgeMode = false;
    try {
      isHedgeMode = await getPositionMode(config.api);
      console.log(`[Reduce] Position mode: ${isHedgeMode ? 'HEDGE' : 'ONE_WAY'}`);
    } catch (error) {
      console.warn('[Reduce] Failed to fetch position mode, defaulting to ONE_WAY:', error);
    }

    // Check if we're in paper mode (simulation)
    if (config.global.paperMode) {
      console.log(`PAPER MODE: Would reduce ${symbol} ${side} by ${percent}% (${reduceQuantity} units)`);
      return NextResponse.json({
        success: true,
        message: `Paper mode: Simulated reducing ${symbol} ${side} position by ${percent}% (${reduceQuantity} units)`,
        simulated: true,
        order_side: orderSide,
        quantity: reduceQuantity,
        percent,
        remainingQuantity: totalQuantity - reduceQuantity
      });
    }

    // Prepare market order to reduce the position
    const orderParams: any = {
      symbol,
      side: orderSide,
      type: 'MARKET' as const,
      quantity: reduceQuantity,
    };

    // Set position side based on mode
    if (isHedgeMode) {
      orderParams.positionSide = targetPosition.positionSide || (side === 'LONG' ? 'LONG' : 'SHORT');
    } else {
      orderParams.positionSide = 'BOTH';
      orderParams.reduceOnly = true;
    }

    console.log(`[Reduce] Reducing position ${symbol} ${side} by ${percent}% with params:`, orderParams);

    // Place the market order to reduce the position
    const orderResult = await placeOrder(orderParams, config.api);

    console.log(`[Reduce] Successfully reduced position ${symbol} ${side} by ${percent}%:`, orderResult);

    // Invalidate income cache since a partial close generates realized PnL and commission
    invalidateIncomeCache();
    console.log('[Reduce] Invalidated income cache after reducing position');

    return NextResponse.json({
      success: true,
      message: `Successfully reduced ${symbol} ${side} position by ${percent}%`,
      order_id: orderResult.orderId,
      order_side: orderSide,
      quantity: reduceQuantity,
      percent,
      remainingQuantity: totalQuantity - reduceQuantity,
      position_mode: isHedgeMode ? 'HEDGE' : 'ONE_WAY',
      order_details: orderResult
    });

  } catch (error: any) {
    console.error(`[Reduce] Error reducing position:`, error);

    if (error.response?.data) {
      const errorMsg = error.response.data.msg || error.response.data.message || 'Unknown API error';

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
