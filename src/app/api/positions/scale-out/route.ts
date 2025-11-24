import { NextRequest, NextResponse } from 'next/server';
import WebSocket from 'ws';
import { configLoader } from '@/lib/config/configLoader';

export const dynamic = 'force-dynamic';

/**
 * Helper to send scale out command via WebSocket to the bot
 */
async function sendProtectCommand(data: any): Promise<{ success: boolean; error?: string }> {
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
        type: 'scale_out_position',
        data
      }));
    });

    ws.on('message', (message: Buffer) => {
      try {
        const response = JSON.parse(message.toString());
        
        if (response.type === 'scale_out_position_response') {
          clearTimeout(timeout);
          responseReceived = true;
          ws.close();
          resolve({ success: true });
        } else if (response.type === 'scale_out_position_success') {
          clearTimeout(timeout);
          responseReceived = true;
          ws.close();
          resolve({ success: true });
        } else if (response.type === 'scale_out_position_error') {
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
 * POST /api/positions/scale-out
 * Activate scale out orders (breakeven + trim levels) for a specific position
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

    // Send protection command to bot via WebSocket
    const result = await sendProtectCommand({
      symbol,
      side,
      entryPrice,
      quantity,
      settings
    });

    if (!result.success) {
      if (result.error?.includes('ECONNREFUSED') || result.error?.includes('timeout')) {
        return NextResponse.json(
          { success: false, error: 'Bot is not running or not responding. Please ensure the bot is started.' },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { success: false, error: result.error || 'Failed to activate protection' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Scale out activated successfully',
      details: {
        symbol,
        side,
        breakeven: settings.enableBreakeven,
        trimLevels: settings.trimLevels.length,
      },
    });
  } catch (error) {
    console.error('[API] Error activating scale out:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to activate scale out',
      },
      { status: 500 }
    );
  }
}
