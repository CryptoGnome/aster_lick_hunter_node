'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Wallet,
  Activity,
  Target
} from 'lucide-react';
import MinimalBotStatus from '@/components/MinimalBotStatus';
import LiquidationSidebar from '@/components/LiquidationSidebar';
import PositionTable from '@/components/PositionTable';
import PnLChart from '@/components/PnLChart';
import PerformanceCardInline from '@/components/PerformanceCardInline';
import RecentOrdersTable from '@/components/RecentOrdersTable';
import { useConfig } from '@/components/ConfigProvider';
import websocketService from '@/lib/services/websocketService';
import { useOrderNotifications } from '@/hooks/useOrderNotifications';
import { useErrorToasts } from '@/hooks/useErrorToasts';
import { useWebSocketUrl } from '@/hooks/useWebSocketUrl';
import { RateLimitToastListener } from '@/hooks/useRateLimitToasts';
import dataStore, { AccountInfo, Position } from '@/lib/services/dataStore';
import { signOut } from 'next-auth/react';

interface BalanceStatus {
  source?: string;
  timestamp?: number;
  error?: string;
}

export default function DashboardPage() {
  const { config } = useConfig();
  const wsUrl = useWebSocketUrl();
  const [accountInfo, setAccountInfo] = useState<AccountInfo>({
    totalBalance: 10000,
    availableBalance: 8500,
    totalPositionValue: 1500,
    totalPnL: 60,
  });
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>({});
  const [isLoading, setIsLoading] = useState(true);
  const [positions, setPositions] = useState<Position[]>([]);
  const [markPrices, setMarkPrices] = useState<Record<string, number>>({});

  // Initialize toast notifications
  useOrderNotifications();
  useErrorToasts();

  useEffect(() => {
    // Update websocketService URL when wsUrl is available
    if (wsUrl) {
      websocketService.setUrl(wsUrl);
    }
  }, [wsUrl]);

  useEffect(() => {
    // Load initial data from data store
    const loadInitialData = async () => {
      try {
        const [balanceData, positionsData] = await Promise.all([
          dataStore.fetchBalance(),
          dataStore.fetchPositions()
        ]);
        setAccountInfo(balanceData);
        setPositions(positionsData);
        setBalanceStatus({ source: 'api', timestamp: Date.now() });
      } catch (error) {
        console.error('[Dashboard] Failed to load initial data:', error);
        setBalanceStatus({ error: error instanceof Error ? error.message : 'Unknown error' });
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();

    // Listen to data store updates
    const handleBalanceUpdate = (data: AccountInfo & { source: string }) => {
      console.log('[Dashboard] Balance updated from data store:', data.source);
      setAccountInfo(data);
      setBalanceStatus({ source: data.source, timestamp: Date.now() });
      setIsLoading(false);
    };

    const handlePositionsUpdate = (data: Position[]) => {
      console.log('[Dashboard] Positions updated from data store');
      setPositions(data);
    };

    const handleMarkPricesUpdate = (prices: Record<string, number>) => {
      setMarkPrices(prices);
    };

    // Subscribe to data store events
    dataStore.on('balance:update', handleBalanceUpdate);
    dataStore.on('positions:update', handlePositionsUpdate);
    dataStore.on('markPrices:update', handleMarkPricesUpdate);

    // Set up WebSocket listener for real-time updates
    const handleWebSocketMessage = (message: any) => {
      // Forward to data store for centralized handling
      dataStore.handleWebSocketMessage(message);
    };

    const cleanupMessageHandler = websocketService.addMessageHandler(handleWebSocketMessage);

    // Cleanup on unmount
    return () => {
      dataStore.off('balance:update', handleBalanceUpdate);
      dataStore.off('positions:update', handlePositionsUpdate);
      dataStore.off('markPrices:update', handleMarkPricesUpdate);
      cleanupMessageHandler();
    };
  }, []); // No dependencies - only run once on mount

  // Refresh data manually if needed
  const _refreshData = async () => {
    try {
      const [balanceData, positionsData] = await Promise.all([
        dataStore.fetchBalance(true), // Force refresh
        dataStore.fetchPositions(true)
      ]);
      setAccountInfo(balanceData);
      setPositions(positionsData);
      setBalanceStatus({ source: 'manual', timestamp: Date.now() });
    } catch (error) {
      console.error('[Dashboard] Failed to refresh data:', error);
      setBalanceStatus({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    const formatted = Math.abs(value).toFixed(2);
    return `${value >= 0 ? '+' : '-'}${formatted}%`;
  };

  // Memoize volumeThresholds to prevent unnecessary re-fetching
  const volumeThresholds = useMemo(() => {
    if (!config?.symbols) return {};
    return Object.entries(config.symbols).reduce((acc, [symbol, cfg]) => ({
      ...acc,
      [symbol]: cfg.volumeThresholdUSDT
    }), {});
  }, [config?.symbols]);

  // Calculate live account info with real-time mark prices
  // This supplements the official balance data with live price updates
  const liveAccountInfo = useMemo(() => {
    if (positions.length === 0) {
      return accountInfo;
    }

    // Calculate live PnL based on current mark prices
    let liveTotalPnL = 0;
    let hasLivePrices = false;

    positions.forEach(position => {
      const liveMarkPrice = markPrices[position.symbol];
      if (liveMarkPrice && liveMarkPrice !== position.markPrice) {
        hasLivePrices = true;
        const entryPrice = position.entryPrice;
        const quantity = position.quantity;
        const isLong = position.side === 'LONG';

        // Calculate live PnL for this position
        const priceDiff = liveMarkPrice - entryPrice;
        const positionPnL = isLong ? priceDiff * quantity : -priceDiff * quantity;
        liveTotalPnL += positionPnL;
      } else {
        // Use the position's current PnL if no live price available
        liveTotalPnL += position.pnl || 0;
      }
    });

    // If we have live prices, update the PnL only
    // Total balance should remain consistent (available + margin)
    if (hasLivePrices) {
      return {
        ...accountInfo,
        totalPnL: liveTotalPnL,
        // Don't recalculate total balance - it's already correct
        totalBalance: accountInfo.totalBalance
      };
    }

    // Otherwise return official balance data
    return accountInfo;
  }, [accountInfo, positions, markPrices]);

  const handleClosePosition = async (_symbol: string, _side: 'LONG' | 'SHORT') => {
    try {
      // TODO: Implement position closing API call
      // For now, just log the action
    } catch (_error) {
    }
  };

  const _handleLogout = async () => {
    try {
      await signOut({
        callbackUrl: '/login',
        redirect: true
      });
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const _handleUpdateSL = async (_symbol: string, _side: 'LONG' | 'SHORT', _price: number) => {
    try {
      // TODO: Implement stop loss update API call
      // For now, just log the action
    } catch (_error) {
    }
  };

  const _handleUpdateTP = async (_symbol: string, _side: 'LONG' | 'SHORT', _price: number) => {
    try {
      // TODO: Implement take profit update API call
      // For now, just log the action
    } catch (_error) {
    }
  };

  return (
    <DashboardLayout>
      {/* Rate Limit Toast Listener */}
      <RateLimitToastListener />

      {/* Minimal Bot Status Bar */}
      <MinimalBotStatus />

      <div className="flex h-full overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto">
          {/* Account Summary - Minimal Design */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Total Balance */}
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Balance</span>
                <div className="flex items-center gap-2">
                  {isLoading ? (
                    <Skeleton className="h-5 w-20" />
                  ) : (
                    <>
                      <span className="text-lg font-semibold">{formatCurrency(liveAccountInfo.totalBalance)}</span>
                      {balanceStatus.error ? (
                        <Badge variant="destructive" className="h-4 text-[10px] px-1">ERROR</Badge>
                      ) : balanceStatus.source === 'websocket' ? (
                        <Badge variant="default" className="h-4 text-[10px] px-1 bg-green-600">LIVE</Badge>
                      ) : balanceStatus.source === 'rest-account' || balanceStatus.source === 'rest-balance' ? (
                        <Badge variant="secondary" className="h-4 text-[10px] px-1">REST</Badge>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="w-px h-8 bg-border" />

            {/* Available Balance */}
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Available</span>
                {isLoading ? (
                  <Skeleton className="h-5 w-20" />
                ) : (
                  <span className="text-lg font-semibold">{formatCurrency(liveAccountInfo.availableBalance)}</span>
                )}
              </div>
            </div>

            <div className="w-px h-8 bg-border" />

            {/* Position Value */}
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">In Position</span>
                {isLoading ? (
                  <Skeleton className="h-5 w-20" />
                ) : (
                  <span className="text-lg font-semibold">{formatCurrency(liveAccountInfo.totalPositionValue)}</span>
                )}
              </div>
            </div>

            <div className="w-px h-8 bg-border" />

            {/* Unrealized PnL */}
            <div className="flex items-center gap-2">
              {liveAccountInfo.totalPnL >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Unrealized PnL</span>
                {isLoading ? (
                  <Skeleton className="h-5 w-20" />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-semibold ${
                      liveAccountInfo.totalPnL >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                      {formatCurrency(liveAccountInfo.totalPnL)}
                    </span>
                    <Badge
                      variant={liveAccountInfo.totalPnL >= 0 ? "outline" : "destructive"}
                      className={`h-4 text-[10px] px-1 ${
                        liveAccountInfo.totalPnL >= 0
                          ? 'border-green-600 text-green-600 dark:border-green-400 dark:text-green-400'
                          : ''
                      }`}
                    >
                      {liveAccountInfo.totalBalance > 0
                        ? formatPercentage(liveAccountInfo.totalPnL / liveAccountInfo.totalBalance * 100)
                        : '0.00%'
                      }
                    </Badge>
                  </div>
                )}
              </div>
            </div>

            <div className="w-px h-8 bg-border" />

            {/* Session Performance - Inline */}
            <PerformanceCardInline />

            <div className="w-px h-8 bg-border" />

            {/* Active Trading Symbols */}
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">Active Symbols</span>
                <div className="flex items-center gap-1">
                  {config?.symbols && Object.keys(config.symbols).length > 0 ? (
                    <>
                      <span className="text-lg font-semibold">{Object.keys(config.symbols).length}</span>
                      <div className="flex gap-1 max-w-[200px] overflow-hidden">
                        {Object.keys(config.symbols).slice(0, 3).map((symbol, _index) => (
                          <Badge key={symbol} variant="outline" className="h-4 text-[10px] px-1">
                            {symbol.replace('USDT', '')}
                          </Badge>
                        ))}
                        {Object.keys(config.symbols).length > 3 && (
                          <Badge variant="outline" className="h-4 text-[10px] px-1">
                            +{Object.keys(config.symbols).length - 3}
                          </Badge>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="text-lg font-semibold text-muted-foreground">0</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* PnL Chart */}
          <PnLChart />

          {/* Positions Table */}
          <PositionTable
            onClosePosition={handleClosePosition}
          />

          {/* Recent Orders Table */}
          <RecentOrdersTable maxRows={100} />
        </div>

        {/* Liquidation Sidebar */}
        <LiquidationSidebar
          volumeThresholds={volumeThresholds}
          maxEvents={50}
        />
      </div>
    </DashboardLayout>
  );
}