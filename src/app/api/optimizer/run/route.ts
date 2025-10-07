import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/with-auth';
import { startOptimization } from '@/lib/services/optimizerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/optimizer/run
 * 
 * Start a new optimization job
 * 
 * Request body:
 * {
 *   weights: { pnl: 50, sharpe: 30, drawdown: 20 },
 *   capitalAllocation?: number,
 *   symbols?: string[]
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   jobId: "opt_123abc",
 *   estimatedDuration: "10-30 minutes"
 * }
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();

    // Validate request body
    if (!body.weights) {
      return NextResponse.json(
        { success: false, error: 'Missing weights configuration' },
        { status: 400 }
      );
    }

    const { pnl, sharpe, drawdown } = body.weights;

    // Validate weights
    if (
      typeof pnl !== 'number' ||
      typeof sharpe !== 'number' ||
      typeof drawdown !== 'number'
    ) {
      return NextResponse.json(
        { success: false, error: 'Weights must be numbers' },
        { status: 400 }
      );
    }

    const totalWeight = pnl + sharpe + drawdown;
    if (Math.abs(totalWeight - 100) > 0.01) {
      return NextResponse.json(
        {
          success: false,
          error: `Weights must sum to 100% (current: ${totalWeight.toFixed(1)}%)`,
        },
        { status: 400 }
      );
    }

    // Validate capital allocation if provided
    if (
      body.capitalAllocation !== undefined &&
      (typeof body.capitalAllocation !== 'number' || body.capitalAllocation <= 0)
    ) {
      return NextResponse.json(
        { success: false, error: 'Capital allocation must be a positive number' },
        { status: 400 }
      );
    }

    // Validate symbols if provided
    if (body.symbols !== undefined && !Array.isArray(body.symbols)) {
      return NextResponse.json(
        { success: false, error: 'Symbols must be an array' },
        { status: 400 }
      );
    }

    // Start optimization job
    const jobId = await startOptimization({
      weights: { pnl, sharpe, drawdown },
      capitalAllocation: body.capitalAllocation,
      symbols: body.symbols,
    });

    return NextResponse.json({
      success: true,
      jobId,
      estimatedDuration: '10-30 minutes',
      message: 'Optimization started successfully',
    });
  } catch (error) {
    console.error('Error starting optimization:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start optimization',
      },
      { status: 500 }
    );
  }
});

