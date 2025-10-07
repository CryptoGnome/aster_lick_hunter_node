import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/with-auth';
import { applyOptimizedConfig } from '@/lib/services/optimizerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/optimizer/apply
 * 
 * Apply the optimized configuration from a completed job
 * Creates a backup before applying changes
 * 
 * Request body:
 * {
 *   jobId: "opt_123abc"
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   backupPath: "config.user.backup-2025-10-05T12-34-56.json",
 *   message: "Configuration applied successfully"
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

    const result = await applyOptimizedConfig(body.jobId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      backupPath: result.backupPath,
      message: 'Configuration applied successfully. Bot will reload config automatically.',
    });
  } catch (error) {
    console.error('Error applying optimized config:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to apply configuration',
      },
      { status: 500 }
    );
  }
});

