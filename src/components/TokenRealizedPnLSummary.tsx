'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowDown, ArrowUp, Loader2, RefreshCw } from 'lucide-react';
import websocketService from '@/lib/services/websocketService';

type SummaryRange = '24h' | '7d' | '30d' | '90d' | '1y' | 'all';

interface SymbolSummary {
  symbol: string;
  realizedPnl: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  lastTradeTime: number | null;
}

interface SummaryResponse {
  symbols: SymbolSummary[];
  best: SymbolSummary | null;
  worst: SymbolSummary | null;
  range: SummaryRange;
  generatedAt: number;
  error?: string;
}

const RANGE_OPTIONS: { value: SummaryRange; label: string }[] = [
  { value: '24h', label: '24 Hours' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
  { value: '1y', label: '1 Year' },
  { value: 'all', label: 'All Available' },
];

export default function TokenRealizedPnLSummary() {
  const [range, setRange] = useState<SummaryRange>('30d');
  const [summaries, setSummaries] = useState<SymbolSummary[]>([]);
  const [best, setBest] = useState<SymbolSummary | null>(null);
  const [worst, setWorst] = useState<SymbolSummary | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async (opts?: { refresh?: boolean }) => {
    try {
      if (opts?.refresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      const response = await fetch(`/api/pnl/realized-summary?range=${range}`);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data: SummaryResponse = await response.json();
      setSummaries(data.symbols || []);
      setBest(data.best || null);
      setWorst(data.worst || null);
      setGeneratedAt(data.generatedAt || Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load summary';
      setError(message);
      setSummaries([]);
      setBest(null);
      setWorst(null);
      setGeneratedAt(null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    const handler = (message: any) => {
      if (message?.type === 'order_update' || message?.type === 'ORDER_TRADE_UPDATE') {
        const payload = message?.data?.o || message?.data;
        const status = payload?.X;
        const realized = payload?.rp;
        if (status === 'FILLED' && realized !== undefined) {
          fetchSummary({ refresh: true });
        }
      }
    };

    const cleanup = websocketService.addMessageHandler(handler);
    return () => {
      cleanup();
    };
  }, [fetchSummary]);

  const formattedGeneratedAt = useMemo(() => {
    if (!generatedAt) return null;
    return new Date(generatedAt).toLocaleTimeString();
  }, [generatedAt]);

  const topSummaries = useMemo(() => summaries.slice(0, 10), [summaries]);

  const formatCurrency = (value: number) => {
    if (!Number.isFinite(value)) return '$0.00';
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return formatter.format(value);
  };

  const formatPercent = (value: number) => {
    if (!Number.isFinite(value)) return '0%';
    return `${value >= 0 ? '' : '-'}${Math.abs(value).toFixed(1)}%`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            Token Realized PnL
            {isRefreshing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {best && (
              <Badge variant="outline" className="border-green-500/50 text-green-600 dark:text-green-400">
                <ArrowUp className="mr-1 h-3 w-3" />
                Best: {best.symbol.replace('USDT', '')} {formatCurrency(best.realizedPnl)}
              </Badge>
            )}
            {worst && (
              <Badge variant="outline" className="border-red-500/50 text-red-600 dark:text-red-400">
                <ArrowDown className="mr-1 h-3 w-3" />
                Worst: {worst.symbol.replace('USDT', '')} {formatCurrency(worst.realizedPnl)}
              </Badge>
            )}
            {formattedGeneratedAt && (
              <span>Updated {formattedGeneratedAt}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={value => setRange(value as SummaryRange)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => fetchSummary({ refresh: true })}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : summaries.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No realized trades found for this range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Avg Win</TableHead>
                  <TableHead className="text-right">Avg Loss</TableHead>
                  <TableHead className="text-right">Realized PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topSummaries.map(summary => {
                  const isPositive = summary.realizedPnl >= 0;
                  return (
                    <TableRow key={summary.symbol}>
                      <TableCell className="font-medium">
                        {summary.symbol.replace('USDT', '')}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {summary.tradeCount}
                        <span className="ml-2 text-xs">
                          ({summary.wins}/{summary.losses})
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatPercent(summary.winRate)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-green-600 dark:text-green-400">
                        {formatCurrency(summary.avgWin)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-red-600 dark:text-red-400">
                        {formatCurrency(summary.avgLoss)}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${
                        isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {formatCurrency(summary.realizedPnl)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
