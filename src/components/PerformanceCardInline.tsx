'use client';

import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, TrendingUp, TrendingDown } from 'lucide-react';
import websocketService from '@/lib/services/websocketService';
import dataStore from '@/lib/services/dataStore';

interface DailyPnL {
  date: string;
  realizedPnl: number;
  commission: number;
  fundingFee: number;
  insuranceClear: number;
  marketMerchantReward: number;
  apolloxRebate: number;
  usdfReward: number;
  netPnl: number;
  tradeCount: number;
}

interface PnLMetrics {
  totalPnl: number;
  totalRealizedPnl: number;
  totalCommission: number;
  totalFundingFee: number;
  totalInsuranceClear: number;
  totalMarketMerchantReward: number;
  totalApolloxRebate: number;
  totalUsdfReward: number;
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

export default function PerformanceCardInline() {
  const [pnlData, setPnlData] = useState<{ dailyPnL: DailyPnL[], metrics: PnLMetrics } | null>(null);
  const [totalBalance, setTotalBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const pnlResponse = await fetch('/api/income?range=24h');
        if (pnlResponse.ok) {
          const pnlData = await pnlResponse.json();
          setPnlData(pnlData);
        }
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

  useEffect(() => {
    const handleBalanceUpdate = (data: any) => {
      setTotalBalance(data.totalBalance);
    };

    dataStore.on('balance:update', handleBalanceUpdate);

    const handleMessage = (message: any) => {
      if (message.type === 'pnl_update' || message.type === 'trade_update') {
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

  const formatPercentage = (value: number) => {
    const formatted = Math.abs(value).toFixed(2);
    return `${value >= 0 ? '+' : '-'}${formatted}%`;
  };

  if (isLoading || !pnlData) {
    return (
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">24h Performance</span>
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
    );
  }

  const totalPnL = pnlData.metrics.totalPnl;
  const totalRealizedPnL = pnlData.metrics.totalRealizedPnl;
  const totalFees = pnlData.metrics.totalCommission + pnlData.metrics.totalFundingFee;
  const totalTrades = pnlData.dailyPnL.reduce((sum, day) => sum + day.tradeCount, 0);
  const isProfit = totalPnL >= 0;
  const returnPercent = totalBalance > 0 ? (totalPnL / totalBalance) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <Clock className="h-4 w-4 text-muted-foreground" />
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">24h</span>
          {totalTrades > 0 && (
            <Badge variant="secondary" className="h-3.5 text-[10px] px-1">
              {totalTrades} trades
            </Badge>
          )}
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
              {formatCurrency(totalPnL)}
            </span>
          </div>
          <Badge
            variant={isProfit ? "outline" : "destructive"}
            className={`h-4 text-[10px] px-1 ${
              isProfit
                ? 'border-green-600 text-green-600 dark:border-green-400 dark:text-green-400'
                : ''
            }`}
          >
            {formatPercentage(returnPercent)}
          </Badge>
          <div className="flex gap-2 text-[10px] text-muted-foreground">
            <span>Real: {formatCurrency(totalRealizedPnL)}</span>
            <span>Fees: {formatCurrency(Math.abs(totalFees))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}