import { NextRequest, NextResponse } from 'next/server';
import WebSocket from 'ws';
import { configLoader } from '@/lib/config/configLoader';

export const dynamic = 'force-dynamic';

/**
 * Helper to send deactivate scale out command via WebSocket to the bot
 */
async function sendDeactivateCommand(data: any): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const config = configLoader.getConfig();
    const wsPort = config?.global?.server?.websocketPort || 8081;
    const ws = new WebSocket(`ws://localhost:${wsPort}`);
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ success: false, error: 'Connection timeout' });
    }, 10000);

    let responseReceived = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'deactivate_scale_out',
        data
      }));
    });

    ws.on('message', (message: Buffer) => {
      try {
        const response = JSON.parse(message.toString());
        
        if (response.type === 'deactivate_scale_out_response') {
          clearTimeout(timeout);
          responseReceived = true;
          ws.close();
          resolve({ success: true });
        } else if (response.type === 'deactivate_scale_out_success') {
          clearTimeout(timeout);
          responseReceived = true;
          ws.close();
          resolve({ success: true });
        } else if (response.type === 'deactivate_scale_out_error') {
          clearTimeout(timeout);
          responseReceived = true;
          ws.close();
          resolve({ success: false, error: response.data?.error || 'Unknown error' });
        }
      } catch (error) {
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

/**
 * POST /api/positions/scale-out/deactivate
 * Deactivate scale out orders for a specific position
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, side } = body;

    if (!symbol || !side) {
      return NextResponse.json(
        { success: false, error: 'Symbol and side are required' },
        { status: 400 }
      );
    }

    // Send deactivate command to bot via WebSocket
    const result = await sendDeactivateCommand({ symbol, side });

    if (!result.success) {
      if (result.error?.includes('ECONNREFUSED') || result.error?.includes('timeout')) {
        return NextResponse.json(
          { success: false, error: 'Bot is not running or not responding. Please ensure the bot is started.' },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { success: false, error: result.error || 'Failed to deactivate scale out' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Scale out deactivated successfully',
    });
  } catch (error) {
    console.error('[API] Error deactivating scale out:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to deactivate scale out',
      },
      { status: 500 }
    );
  }
}
