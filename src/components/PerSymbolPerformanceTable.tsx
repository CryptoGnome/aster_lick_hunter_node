'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TrendingUp, TrendingDown, Target, RefreshCw } from 'lucide-react';
import { useConfig } from '@/components/ConfigProvider';
import websocketService from '@/lib/services/websocketService';

type TimeRange = '24h' | '7d' | '30d' | '90d' | '1y' | 'all';

interface SymbolPnL {
  symbol: string;
  tradeCount: number;
  realizedPnl: number;
  commission: number;
  fundingFee: number;
  insuranceClear: number;
  marketMerchantReward: number;
  apolloxRebate: number;
  usdfReward: number;
  netPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
}

type SortColumn = 'symbol' | 'trades' | 'pnl' | 'winRate' | 'commission' | 'funding';
type SortDirection = 'asc' | 'desc';

interface PerSymbolPerformanceTableProps {
  timeRange: TimeRange;
}

export default function PerSymbolPerformanceTable({ timeRange }: PerSymbolPerformanceTableProps) {
  const { config } = useConfig();
  const [symbolData, setSymbolData] = useState<SymbolPnL[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('pnl');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const hasApiKeys = config?.api?.apiKey && config?.api?.secretKey;

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const response = await fetch(`/api/income/symbols?range=${timeRange}`);
      if (response.ok) {
        const data = await response.json();
        setSymbolData(data.symbols || []);
      } else {
        setSymbolData([]);
      }
    } catch (error) {
      console.error('Failed to fetch per-symbol data:', error);
      setSymbolData([]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [timeRange]);

  useEffect(() => {
    if (hasApiKeys) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [timeRange, hasApiKeys, fetchData]);

  // Refresh on trade updates
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'pnl_update' || message.type === 'trade_update') {
        fetchData(true);
      }
    };

    const cleanup = websocketService.addMessageHandler(handleMessage);
    return cleanup;
  }, [fetchData]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortedData = [...symbolData].sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;

    switch (sortColumn) {
      case 'symbol':
        aVal = a.symbol;
        bVal = b.symbol;
        break;
      case 'trades':
        aVal = a.tradeCount;
        bVal = b.tradeCount;
        break;
      case 'pnl':
        aVal = a.netPnl;
        bVal = b.netPnl;
        break;
      case 'winRate':
        aVal = a.winRate;
        bVal = b.winRate;
        break;
      case 'commission':
        aVal = a.commission;
        bVal = b.commission;
        break;
      case 'funding':
        aVal = a.fundingFee;
        bVal = b.fundingFee;
        break;
      default:
        aVal = a.netPnl;
        bVal = b.netPnl;
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDirection === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    return sortDirection === 'asc'
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number);
  });

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <TrendingUp className="h-3 w-3 inline ml-1" />
    ) : (
      <TrendingDown className="h-3 w-3 inline ml-1" />
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        <div className="text-center">
          <RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" />
          <p className="text-xs">Loading symbol performance...</p>
        </div>
      </div>
    );
  }

  if (!hasApiKeys) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        <div className="text-center">
          <Target className="h-6 w-6 mx-auto opacity-50 mb-2" />
          <p className="text-xs font-medium">API keys required</p>
        </div>
      </div>
    );
  }

  if (symbolData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        <div className="text-center">
          <Target className="h-6 w-6 mx-auto opacity-50 mb-2" />
          <p className="text-xs font-medium">No trading data</p>
          <Badge variant="secondary" className="h-4 text-[10px] px-1.5 mt-1">
            {timeRange} period
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {isRefreshing && (
        <div className="absolute inset-0 z-10 bg-background/50 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => handleSort('symbol')}>
                Symbol <SortIcon column="symbol" />
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('trades')}>
                Trades <SortIcon column="trades" />
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('winRate')}>
                Win Rate <SortIcon column="winRate" />
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('pnl')}>
                Net PnL <SortIcon column="pnl" />
              </TableHead>
              <TableHead className="text-right">Realized</TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('commission')}>
                Commission <SortIcon column="commission" />
              </TableHead>
              <TableHead className="cursor-pointer text-right" onClick={() => handleSort('funding')}>
                Funding <SortIcon column="funding" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.map((symbolPnl) => {
              const isAccountRewards = symbolPnl.symbol === 'Account Rewards';
              return (
              <TableRow key={symbolPnl.symbol} className={isAccountRewards ? 'bg-yellow-50/50 dark:bg-yellow-950/20' : ''}>
                <TableCell className="font-medium">
                  <Badge
                    variant="outline"
                    className={`font-mono ${isAccountRewards ? 'border-yellow-600 text-yellow-700 dark:border-yellow-500 dark:text-yellow-400' : ''}`}
                    title={isAccountRewards ? 'Referral rebates and staking rewards (not tied to specific symbols)' : ''}
                  >
                    {symbolPnl.symbol}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-col items-end">
                    <span className="text-sm">{symbolPnl.tradeCount}</span>
                    {symbolPnl.tradeCount > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {symbolPnl.winCount}W/{symbolPnl.lossCount}L
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Badge
                    variant={symbolPnl.winRate >= 50 ? "outline" : "secondary"}
                    className={`h-5 text-[10px] ${
                      symbolPnl.winRate >= 50
                        ? 'border-green-600 text-green-600 dark:border-green-400 dark:text-green-400'
                        : ''
                    }`}
                  >
                    {symbolPnl.winRate.toFixed(0)}%
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <span className={`font-semibold ${
                    symbolPnl.netPnl >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {formatCurrency(symbolPnl.netPnl)}
                  </span>
                </TableCell>
                <TableCell className="text-right text-sm">
                  {formatCurrency(symbolPnl.realizedPnl)}
                </TableCell>
                <TableCell className="text-right text-sm text-red-600 dark:text-red-400">
                  {formatCurrency(symbolPnl.commission)}
                </TableCell>
                <TableCell className="text-right text-sm">
                  <span className={symbolPnl.fundingFee >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {formatCurrency(symbolPnl.fundingFee)}
                  </span>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
