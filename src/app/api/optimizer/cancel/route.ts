import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/with-auth';
import { cancelJob } from '@/lib/services/optimizerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/optimizer/cancel
 * 
 * Cancel a running optimization job
 * 
 * Request body:
 * {
 *   jobId: "opt_123abc"
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   message: "Optimization cancelled"
 * }
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();

    if (!body.jobId) {
      return NextResponse.json(
        { success: false, error: 'Missing jobId' },
        { status: 400 }
      );
    }

    const cancelled = cancelJob(body.jobId);

    if (!cancelled) {
      return NextResponse.json(
        { success: false, error: 'Job not found or cannot be cancelled' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Optimization cancelled successfully',
    });
  } catch (error) {
    console.error('Error cancelling optimization:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel optimization',
      },
      { status: 500 }
    );
  }
});

