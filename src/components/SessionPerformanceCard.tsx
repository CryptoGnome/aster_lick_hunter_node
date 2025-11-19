'use client';

import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity } from 'lucide-react';
import websocketService from '@/lib/services/websocketService';

interface SessionPnL {
  startTime: number;
  startBalance: number;
  currentBalance: number;
  startingAccumulatedPnl: number;
  currentAccumulatedPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  commission: number;
  fundingFee: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  maxDrawdown: number;
  peak: number;
}

export default function SessionPerformanceCard() {
  const [sessionPnL, setSessionPnL] = useState<SessionPnL | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSessionData = async () => {
      try {
        const response = await fetch('/api/pnl/session');
        if (response.ok) {
          const data = await response.json();
          setSessionPnL(data.session);
        }
      } catch (error) {
        console.error('Failed to fetch session PnL:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSessionData();
  }, []);

  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'pnl_update' && message.data?.session) {
        setSessionPnL(message.data.session);
        setIsLoading(false);
      }
    };

    const cleanup = websocketService.addMessageHandler(handleMessage);
    return cleanup;
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDuration = (startTime: number) => {
    const duration = Date.now() - startTime;
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  if (isLoading || !sessionPnL) {
    return (
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">Session</span>
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
    );
  }

  // Calculate win rate
  const winRate = sessionPnL.tradeCount > 0
    ? (sessionPnL.winCount / sessionPnL.tradeCount) * 100
    : 0;

  // Calculate average profit per trade
  const avgProfitPerTrade = sessionPnL.tradeCount > 0
    ? sessionPnL.realizedPnl / sessionPnL.tradeCount
    : 0;

  const isProfit = sessionPnL.realizedPnl >= 0;

  return (
    <div className="flex items-center gap-2">
      <Activity className="h-4 w-4 text-muted-foreground" />
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Session</span>
          <Badge variant="secondary" className="h-3.5 text-[10px] px-1">
            {formatDuration(sessionPnL.startTime)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {isProfit ? (
              <TrendingUp className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-red-600" />
            )}
            <span className={`text-lg font-semibold ${
              isProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            }`}>
              {formatCurrency(sessionPnL.realizedPnl)}
            </span>
          </div>
          {sessionPnL.tradeCount > 0 && (
            <>
              <Badge
                variant={isProfit ? "outline" : "destructive"}
                className={`h-4 text-[10px] px-1 ${
                  isProfit
                    ? 'border-green-600 text-green-600 dark:border-green-400 dark:text-green-400'
                    : ''
                }`}
              >
                {sessionPnL.tradeCount} trades
              </Badge>
              <div className="flex gap-2 text-[10px] text-muted-foreground">
                <span>Win: {winRate.toFixed(0)}%</span>
                <span>Avg: {formatCurrency(avgProfitPerTrade)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
