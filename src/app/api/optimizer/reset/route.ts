import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/with-auth';
import { resetOptimizerState } from '@/lib/services/optimizerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/optimizer/reset
 *
 * Reset all optimizer state - clears cached jobs and results files
 * This allows starting fresh optimizations without server restart
 *
 * Response:
 * {
 *   success: true,
 *   message: "Optimizer state reset successfully"
 * }
 */
export const POST = withAuth(async () => {
  try {
    resetOptimizerState();

    return NextResponse.json({
      success: true,
      message: 'Optimizer state reset successfully',
    });
  } catch (error) {
    console.error('Error resetting optimizer state:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset optimizer state',
      },
      { status: 500 }
    );
  }
});
