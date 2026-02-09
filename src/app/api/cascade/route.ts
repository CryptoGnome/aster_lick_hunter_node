import { NextResponse } from 'next/server';
import { cascadeDetector } from '@/lib/services/cascadeDetector';

// GET /api/cascade - Get current cascade state
export async function GET() {
  try {
    const state = cascadeDetector.getState();
    return NextResponse.json({
      success: true,
      ...state,
      cooldownRemaining: cascadeDetector.getCooldownRemaining(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to get cascade state' },
      { status: 500 }
    );
  }
}

// POST /api/cascade - Force clear cascade (manual override)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (body.action === 'clear') {
      cascadeDetector.forceClear();
      return NextResponse.json({
        success: true,
        message: 'Cascade protection manually cleared',
        state: cascadeDetector.getState(),
      });
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action. Use { "action": "clear" }' },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to process cascade action' },
      { status: 500 }
    );
  }
}
