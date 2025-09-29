import { NextRequest, NextResponse } from 'next/server';
import { getRateLimitManager } from '@/lib/api/rateLimitManager';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(async (_request: NextRequest, _user) => {
  try {
    const rateLimitManager = getRateLimitManager();

    // Get current usage statistics
    const usage = rateLimitManager.getCurrentUsage();

    // Get queue statistics
    const queueStats = rateLimitManager.getQueueStats();

    // Calculate recommendations based on current usage
    const recommendations = [];

    if (usage.weightPercent > 80) {
      recommendations.push({
        level: 'warning',
        message: `High request weight usage: ${usage.weightPercent.toFixed(1)}%`,
        suggestion: 'Consider reducing non-critical API calls or using WebSocket streams for market data'
      });
    }

    if (usage.orderPercent > 80) {
      recommendations.push({
        level: 'warning',
        message: `High order count usage: ${usage.orderPercent.toFixed(1)}%`,
        suggestion: 'Consider batching orders or reducing trading frequency'
      });
    }

    if (queueStats.total > 10) {
      recommendations.push({
        level: 'info',
        message: `${queueStats.total} requests queued`,
        suggestion: 'Queue is building up - some requests may be delayed'
      });
    }

    if (queueStats.oldestWaitTime > 5000) {
      recommendations.push({
        level: 'warning',
        message: `Oldest request waiting ${(queueStats.oldestWaitTime / 1000).toFixed(1)}s`,
        suggestion: 'Consider reducing request volume to clear the queue faster'
      });
    }

    // Calculate available capacity
    const availableWeight = 2400 - usage.weight;
    const availableOrders = 1200 - usage.orders;
    const capacityPercent = Math.min(
      (availableWeight / 2400) * 100,
      (availableOrders / 1200) * 100
    );

    return NextResponse.json({
      usage: {
        weight: usage.weight,
        weightLimit: 2400,
        weightPercent: usage.weightPercent,
        orders: usage.orders,
        orderLimit: 1200,
        orderPercent: usage.orderPercent,
        queueLength: usage.queueLength
      },
      queue: {
        total: queueStats.total,
        byPriority: {
          critical: queueStats.byPriority[0],
          high: queueStats.byPriority[1],
          medium: queueStats.byPriority[2],
          low: queueStats.byPriority[3]
        },
        oldestWaitTime: queueStats.oldestWaitTime
      },
      capacity: {
        availableWeight,
        availableOrders,
        capacityPercent,
        status: capacityPercent > 50 ? 'healthy' : capacityPercent > 20 ? 'moderate' : 'critical'
      },
      recommendations,
      timestamp: Date.now()
    });
  } catch (error: any) {
    console.error('Error fetching rate limit metrics:', error);
    return NextResponse.json({
      error: 'Failed to fetch rate limit metrics',
      message: error.message || 'Unknown error'
    }, { status: 500 });
  }
});

// Add dynamic route revalidation
export const dynamic = 'force-dynamic';
export const revalidate = 0;