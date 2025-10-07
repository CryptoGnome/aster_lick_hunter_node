import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/with-auth';
import { getJobStatus } from '@/lib/services/optimizerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/optimizer/status?jobId=opt_123abc
 * 
 * Get the current status of an optimization job
 * Designed for 5-second polling interval
 * 
 * Response:
 * {
 *   success: true,
 *   job: {
 *     jobId: "opt_123abc",
 *     status: "running" | "completed" | "failed" | "cancelled",
 *     progress: 65,
 *     currentStage: "Analyzing SOLUSDT (5/9)",
 *     startTime: 1234567890,
 *     estimatedTimeRemaining: 720000,
 *     results: { ... } // only when completed
 *   }
 * }
 */
export const GET = withAuth(async (request: NextRequest) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const jobId = searchParams.get('jobId');

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'Missing jobId parameter' },
        { status: 400 }
      );
    }

    const job = getJobStatus(jobId);

    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      );
    }

    // Calculate elapsed time
    const elapsedTime = Date.now() - job.startTime;

    return NextResponse.json({
      success: true,
      job: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        currentStage: job.currentStage,
        startTime: job.startTime,
        elapsedTime,
        estimatedTimeRemaining: job.estimatedTimeRemaining,
        error: job.error,
        // Only include results if job is completed
        results: job.status === 'completed' ? job.results : undefined,
      },
    });
  } catch (error) {
    console.error('Error fetching optimization status:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch status',
      },
      { status: 500 }
    );
  }
});

