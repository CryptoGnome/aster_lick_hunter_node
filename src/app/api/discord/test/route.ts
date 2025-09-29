import { NextRequest, NextResponse } from 'next/server';
import { DiscordService } from '@/lib/services/discordService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { webhookUrl, notifyOnPositionOpen, notifyOnPositionClose } = body;

    if (!webhookUrl) {
      return NextResponse.json(
        { error: 'Webhook URL is required' },
        { status: 400 }
      );
    }

    // Validate webhook URL
    try {
      new URL(webhookUrl);
    } catch {
      return NextResponse.json(
        { error: 'Invalid webhook URL format' },
        { status: 400 }
      );
    }

    const results = [];

    // Test position opened notification if enabled
    if (notifyOnPositionOpen) {
      try {
        const openMessage = DiscordService.createTestMessage('open');

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: openMessage,
          }),
        });

        if (!response.ok) {
          throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
        }

        results.push('Position opened test notification sent');
      } catch (error) {
        console.error('Failed to send position opened test:', error);
        return NextResponse.json(
          { error: `Failed to send position opened test: ${error instanceof Error ? error.message : 'Unknown error'}` },
          { status: 500 }
        );
      }
    }

    // Test position closed notification if enabled
    if (notifyOnPositionClose) {
      try {
        // Wait a bit between notifications to avoid rate limiting
        if (notifyOnPositionOpen) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const closeMessage = DiscordService.createTestMessage('close');

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: closeMessage,
          }),
        });

        if (!response.ok) {
          throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
        }

        results.push('Position closed test notification sent');
      } catch (error) {
        console.error('Failed to send position closed test:', error);
        return NextResponse.json(
          { error: `Failed to send position closed test: ${error instanceof Error ? error.message : 'Unknown error'}` },
          { status: 500 }
        );
      }
    }

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'No notifications enabled. Please enable at least one notification type.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Test notifications sent successfully',
      results,
    });

  } catch (error) {
    console.error('Discord test API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
