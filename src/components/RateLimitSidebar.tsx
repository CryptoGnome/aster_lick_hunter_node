'use client';

import React, { useEffect, useState } from 'react';
import { useRateLimits } from '@/hooks/useRateLimits';
import { cn } from '@/lib/utils';
import { Zap, Clock, Info } from 'lucide-react';
import websocketService from '@/lib/services/websocketService';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface BotRateLimit {
  weight: number;
  orders: number;
  weightPercent: number;
  orderPercent: number;
  queueLength: number;
}

export function RateLimitSidebar() {
  const { data: webData, loading } = useRateLimits(2000); // Web rate limits
  const [botData, setBotData] = useState<BotRateLimit | null>(null);

  // Listen for bot rate limit updates via WebSocket
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'rateLimit' && message.data) {
        setBotData(message.data);
      }
    };

    const cleanup = websocketService.addMessageHandler(handleMessage);
    return cleanup;
  }, []);

  // Combine web and bot rate limits
  const data = React.useMemo(() => {
    if (!webData) return null;

    // If we have bot data, combine it with web data
    if (botData) {
      const totalWeight = webData.usage.weight + botData.weight;
      const totalOrders = webData.usage.orders + botData.orders;
      const totalQueue = webData.queue.total + botData.queueLength;

      return {
        usage: {
          weight: totalWeight,
          weightLimit: webData.usage.weightLimit,
          weightPercent: (totalWeight / webData.usage.weightLimit) * 100,
          orders: totalOrders,
          orderLimit: webData.usage.orderLimit,
          orderPercent: (totalOrders / webData.usage.orderLimit) * 100,
          queueLength: totalQueue
        },
        queue: {
          total: totalQueue
        }
      };
    }

    // Otherwise just return web data
    return webData;
  }, [webData, botData]);

  if (loading || !data) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">API Limits</span>
        </div>
        <div className="space-y-1">
          <div className="h-1.5 bg-muted rounded-full" />
          <div className="h-1.5 bg-muted rounded-full" />
        </div>
      </div>
    );
  }

  const weightPercent = data.usage.weightPercent;
  const orderPercent = data.usage.orderPercent;
  const hasQueue = data.queue.total > 0;

  // Color based on highest usage
  const maxPercent = Math.max(weightPercent, orderPercent);
  const getColor = (percent: number) => {
    if (percent < 50) return 'bg-green-500';
    if (percent < 70) return 'bg-yellow-500';
    if (percent < 85) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getTextColor = (percent: number) => {
    if (percent < 50) return 'text-green-600 dark:text-green-400';
    if (percent < 70) return 'text-yellow-600 dark:text-yellow-400';
    if (percent < 85) return 'text-orange-600 dark:text-orange-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">API Limits</span>
          {botData && (
            <span className="text-[10px] text-muted-foreground">(Total)</span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-help transition-colors" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <div className="space-y-2 text-xs">
                <div>
                  <p className="font-semibold text-foreground">📊 Weight (2400/min)</p>
                  <p className="text-muted-foreground">
                    How &ldquo;heavy&rdquo; your API requests are. Simple requests = 1, complex queries = 30+
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">📝 Orders (1200/min)</p>
                  <p className="text-muted-foreground">
                    Number of trade orders placed, cancelled, or modified.
                  </p>
                </div>
                <div className="pt-1 border-t border-border">
                  <p className="text-muted-foreground italic">
                    {botData ? "Shows combined Web + Bot usage" : "Shows Web usage only (Bot not connected)"}
                  </p>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1">
          {hasQueue && (
            <Clock className={cn("h-3 w-3", getTextColor(maxPercent))} />
          )}
          <Zap className={cn("h-3 w-3", getTextColor(maxPercent))} />
        </div>
      </div>

      {/* Minimal Progress Bars */}
      <div className="space-y-1.5">
        {/* Weight Bar */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs text-muted-foreground">Weight</span>
            <span className={cn("text-xs font-medium", getTextColor(weightPercent))}>
              {weightPercent.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 bg-sidebar-accent rounded-full overflow-hidden">
            <div
              className={cn("h-full transition-all duration-500", getColor(weightPercent))}
              style={{ width: `${Math.min(weightPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Orders Bar */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs text-muted-foreground">Orders</span>
            <span className={cn("text-xs font-medium", getTextColor(orderPercent))}>
              {orderPercent.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 bg-sidebar-accent rounded-full overflow-hidden">
            <div
              className={cn("h-full transition-all duration-500", getColor(orderPercent))}
              style={{ width: `${Math.min(orderPercent, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Queue indicator - only show if there are queued requests */}
      {hasQueue && (
        <div className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400">
          <Clock className="h-3 w-3" />
          <span>{data.queue.total} queued</span>
        </div>
      )}
    </div>
  );
}