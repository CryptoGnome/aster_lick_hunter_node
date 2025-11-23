import { NextRequest, NextResponse } from 'next/server';
import { protectiveOrderService } from '@/lib/services/protectiveOrderService';

export const dynamic = 'force-dynamic';

/**
 * POST /api/positions/protect
 * Activate protective orders (breakeven + trim levels) for a specific position
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, side, entryPrice, quantity, settings } = body;

    if (!symbol || !side) {
      return NextResponse.json(
        { success: false, error: 'Symbol and side are required' },
        { status: 400 }
      );
    }

    if (typeof entryPrice !== 'number' || entryPrice <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid entry price is required' },
        { status: 400 }
      );
    }

    if (typeof quantity !== 'number' || quantity <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid quantity is required' },
        { status: 400 }
      );
    }

    if (!settings) {
      return NextResponse.json(
        { success: false, error: 'Protection settings are required' },
        { status: 400 }
      );
    }

    // Validate settings structure
    if (typeof settings.enableBreakeven !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'Invalid protection settings: enableBreakeven must be boolean' },
        { status: 400 }
      );
    }

    if (!Array.isArray(settings.trimLevels)) {
      return NextResponse.json(
        { success: false, error: 'Invalid protection settings: trimLevels must be an array' },
        { status: 400 }
      );
    }

    // Validate trim levels
    for (const level of settings.trimLevels) {
      if (typeof level.profitPercent !== 'number' || level.profitPercent <= 0) {
        return NextResponse.json(
          { success: false, error: 'Invalid trim level: profitPercent must be a positive number' },
          { status: 400 }
        );
      }
      if (typeof level.trimPercent !== 'number' || level.trimPercent <= 0 || level.trimPercent > 100) {
        return NextResponse.json(
          { success: false, error: 'Invalid trim level: trimPercent must be between 0 and 100' },
          { status: 400 }
        );
      }
    }

    // Activate protection via the service
    await protectiveOrderService.activateProtection(
      symbol,
      side,
      entryPrice,
      quantity,
      settings
    );

    return NextResponse.json({
      success: true,
      message: 'Protection activated successfully',
      details: {
        symbol,
        side,
        breakeven: settings.enableBreakeven,
        trimLevels: settings.trimLevels.length,
      },
    });
  } catch (error) {
    console.error('[API] Error activating protection:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to activate protection',
      },
      { status: 500 }
    );
  }
}
