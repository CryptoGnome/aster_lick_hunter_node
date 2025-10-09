import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/with-auth';
import WebSocket from 'ws';

// Helper to send control command via WebSocket
async function sendBotCommand(action: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:8080');
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ success: false, error: 'Connection timeout' });
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'bot_control',
        action
      }));

      // Wait a bit for the command to be processed
      setTimeout(() => {
        clearTimeout(timeout);
        ws.close();
        resolve({ success: true });
      }, 500);
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: error.message });
    });
  });
}

export const POST = withAuth(async (request: NextRequest, _user) => {
  try {
    const body = await request.json();
    const { action } = body;

    if (!action || !['pause', 'resume', 'stop'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be one of: pause, resume, stop' },
        { status: 400 }
      );
    }

    console.log(`[Bot Control API] Received ${action} command`);

    const result = await sendBotCommand(action);

    if (!result.success) {
      if (result.error?.includes('ECONNREFUSED') || result.error?.includes('timeout')) {
        return NextResponse.json(
          { error: 'Bot is not running or not responding. Please start the bot first.' },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: `Failed to send command to bot: ${result.error}` },
        { status: 500 }
      );
    }

    console.log(`[Bot Control API] Successfully sent ${action} command to bot`);

    return NextResponse.json({
      success: true,
      action,
      message: `Bot ${action} command sent successfully`
    });
  } catch (error: any) {
    console.error('[Bot Control API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
});
