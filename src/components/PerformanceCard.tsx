'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import websocketService from '@/lib/services/websocketService';
import dataStore from '@/lib/services/dataStore';

interface DailyPnL {
  date: string;
  realizedPnl: number;
  commission: number;
  fundingFee: number;
  netPnl: number;
  tradeCount: number;
}

interface PnLMetrics {
  totalPnl: number;
  totalRealizedPnl: number;
  totalCommission: number;
  totalFundingFee: number;
  winRate: number;
  profitableDays: number;
  lossDays: number;
  bestDay: DailyPnL | null;
  worstDay: DailyPnL | null;
  avgDailyPnl: number;
  maxDrawdown: number;
  profitFactor: number;
  sharpeRatio: number;
}


export default function PerformanceCard() {
  const [pnlData, setPnlData] = useState<{ dailyPnL: DailyPnL[], metrics: PnLMetrics } | null>(null);
  const [totalBalance, setTotalBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch initial 24h data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch 24h PnL data
        const pnlResponse = await fetch('/api/income?range=24h');

        if (pnlResponse.ok) {
          const pnlData = await pnlResponse.json();
          setPnlData(pnlData);
        }

        // Get balance from data store
        const balanceData = await dataStore.fetchBalance();
        setTotalBalance(balanceData.totalBalance);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  // Subscribe to real-time updates
  useEffect(() => {
    // Listen for balance updates from data store
    const handleBalanceUpdate = (data: any) => {
      setTotalBalance(data.totalBalance);
    };

    dataStore.on('balance:update', handleBalanceUpdate);

    // Listen for trade updates to refresh PnL
    const handleMessage = (message: any) => {
      if (message.type === 'pnl_update' || message.type === 'trade_update') {
        // Refresh 24h data when trades occur
        fetch('/api/income?range=24h')
          .then(async r => {
            const contentType = r.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              return r.json();
            }
            throw new Error('Non-JSON response');
          })
          .then(pnlData => setPnlData(pnlData))
          .catch(error => console.error('Failed to refresh PnL data:', error));
      }

      // Forward balance updates to data store
      if (message.type === 'balance_update') {
        dataStore.handleWebSocketMessage(message);
      }
    };

    const cleanup = websocketService.addMessageHandler(handleMessage);

    return () => {
      dataStore.off('balance:update', handleBalanceUpdate);
      cleanup();
    };
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const _formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  if (isLoading || !pnlData) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">24-Hour Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-8 bg-muted rounded"></div>
            <div className="h-4 bg-muted rounded w-3/4"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate 24h totals
  const totalPnL = pnlData.metrics.totalPnl;
  const totalRealizedPnL = pnlData.metrics.totalRealizedPnl;
  const totalTrades = pnlData.dailyPnL.reduce((sum, day) => sum + day.tradeCount, 0);
  const isProfit = totalPnL >= 0;

  // Calculate return percentage based on total balance
  const returnPercent = totalBalance > 0 ? (totalPnL / totalBalance) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium">24-Hour Performance</CardTitle>
          {totalTrades > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Activity className="h-3 w-3" />
              {totalTrades} trades
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Main PnL Display */}
          <div className="flex items-baseline justify-between">
            <div className="flex items-center gap-2">
              {isProfit ? (
                <TrendingUp className="h-5 w-5 text-green-500" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-500" />
              )}
              <span className={cn(
                "text-2xl font-bold",
                isProfit ? "text-green-500" : "text-red-500"
              )}>
                {formatCurrency(totalPnL)}
              </span>
            </div>
            <span className={cn(
              "text-sm font-medium",
              isProfit ? "text-green-500" : "text-red-500"
            )}>
              {returnPercent >= 0 ? '+' : ''}{returnPercent.toFixed(2)}%
            </span>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-muted-foreground">Realized</p>
              <p className={cn(
                "font-medium",
                totalRealizedPnL >= 0 ? "text-green-500" : "text-red-500"
              )}>
                {formatCurrency(totalRealizedPnL)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Fees</p>
              <p className={cn(
                "font-medium",
                (pnlData.metrics.totalCommission + pnlData.metrics.totalFundingFee) >= 0 ? "text-green-500" : "text-red-500"
              )}>
                {formatCurrency(pnlData.metrics.totalCommission + pnlData.metrics.totalFundingFee)}
              </p>
            </div>
          </div>


          {/* Time Period */}
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              24-Hour Period
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}