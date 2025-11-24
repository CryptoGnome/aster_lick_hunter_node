import { NextRequest, NextResponse } from 'next/server';
import WebSocket from 'ws';
import { configLoader } from '@/lib/config/configLoader';

export const dynamic = 'force-dynamic';

/**
 * GET /api/positions/scale-out/status
 * Check if scale out is active for a specific position
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const side = searchParams.get('side');

    if (!symbol || !side) {
      return NextResponse.json(
        { success: false, error: 'Symbol and side are required' },
        { status: 400 }
      );
    }

    // Send check request via WebSocket to bot
    const result = await checkScaleOutStatus({ symbol, side });

    if (!result.success) {
      return NextResponse.json(
        { success: false, isActive: false, error: result.error },
        { status: 200 } // Return 200 with isActive: false instead of error
      );
    }

    return NextResponse.json({
      success: true,
      isActive: result.isActive || false,
    });
  } catch (_error) {
    console.error('[API] Error checking scale out status:', error);
    return NextResponse.json(
      {
        success: false,
        isActive: false,
        error: error instanceof Error ? error.message : 'Failed to check status',
      },
      { status: 200 } // Return 200 to avoid errors in UI
    );
  }
}

/**
 * Helper to check scale out status via WebSocket
 */
async function checkScaleOutStatus(data: any): Promise<{ success: boolean; isActive?: boolean; error?: string }> {
  return new Promise((resolve) => {
    const config = configLoader.getConfig();
    const wsPort = config?.global?.server?.websocketPort || 8081;
    const ws = new WebSocket(`ws://localhost:${wsPort}`);
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ success: false, error: 'Connection timeout' });
    }, 5000);

    let responseReceived = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'check_scale_out_status',
        data
      }));
    });

    ws.on('message', (message: Buffer) => {
      try {
        const response = JSON.parse(message.toString());
        
        if (response.type === 'scale_out_status_response') {
          clearTimeout(timeout);
          responseReceived = true;
          ws.close();
          resolve({ success: true, isActive: response.data?.isActive || false });
        }
      } catch (_error) {
        // Ignore parse errors, keep waiting
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      if (!responseReceived) {
        resolve({ success: false, error: error.message });
      }
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!responseReceived) {
        resolve({ success: false, error: 'Connection closed before response' });
      }
    });
  });
}
