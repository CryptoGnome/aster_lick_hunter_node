'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TrendingUp, AlertTriangle, Clock, DollarSign } from 'lucide-react';
import { Tranche } from '@/lib/types';

interface TrancheBreakdownCardProps {
  symbol: string;
  side: 'LONG' | 'SHORT';
}

interface TrancheMetrics {
  total: number;
  active: number;
  isolated: number;
  closed: number;
  totalQuantity: number;
  totalMarginUsed: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  weightedAvgEntry: number;
}

export function TrancheBreakdownCard({ symbol, side }: TrancheBreakdownCardProps) {
  const [tranches, setTranches] = useState<Tranche[]>([]);
  const [metrics, setMetrics] = useState<TrancheMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTranches();
    // Refresh every 5 seconds
    const interval = setInterval(fetchTranches, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, side]);

  const fetchTranches = async () => {
    try {
      const response = await fetch(`/api/tranches?symbol=${symbol}&side=${side}&status=all`);
      if (!response.ok) {
        throw new Error('Failed to fetch tranches');
      }
      const data = await response.json();
      setTranches(data.tranches || []);
      setMetrics(data.metrics || null);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatPnL = (pnl: number) => {
    const formatted = Math.abs(pnl).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return pnl >= 0 ? `+$${formatted}` : `-$${formatted}`;
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getPnLColor = (pnl: number) => {
    if (pnl > 0) return 'text-green-500';
    if (pnl < 0) return 'text-red-500';
    return 'text-gray-500';
  };

  const activeTranches = tranches.filter(t => t.status === 'active' && !t.isolated);
  const isolatedTranches = tranches.filter(t => t.isolated && t.status === 'active');
  const closedTranches = tranches.filter(t => t.status === 'closed');

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tranche Breakdown - {symbol} {side}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tranche Breakdown - {symbol} {side}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-red-500">Error: {error}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Tranche Breakdown - {symbol} {side}</span>
          <Badge variant={side === 'LONG' ? 'default' : 'destructive'}>
            {side}
          </Badge>
        </CardTitle>
        <CardDescription>
          Track multiple position entries (tranches) for better margin utilization
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Metrics */}
        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Active Tranches</p>
              <p className="text-2xl font-bold">{metrics.active}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Isolated</p>
              <p className="text-2xl font-bold text-yellow-500">{metrics.isolated}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total Quantity</p>
              <p className="text-2xl font-bold">{metrics.totalQuantity.toFixed(4)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Unrealized P&L</p>
              <p className={`text-2xl font-bold ${getPnLColor(metrics.totalUnrealizedPnl)}`}>
                {formatPnL(metrics.totalUnrealizedPnl)}
              </p>
            </div>
          </div>
        )}

        <Separator />

        {/* Active Tranches */}
        {activeTranches.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              Active Tranches ({activeTranches.length})
            </h3>
            <div className="space-y-2">
              {activeTranches.map((tranche) => (
                <div
                  key={tranche.id}
                  className="border rounded-lg p-3 space-y-2 bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        {tranche.id.substring(0, 8)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {formatTime(tranche.entryTime)}
                      </span>
                    </div>
                    <Badge variant="default">Active</Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Entry</p>
                      <p className="font-semibold">${formatPrice(tranche.entryPrice)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quantity</p>
                      <p className="font-semibold">{tranche.quantity.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Margin</p>
                      <p className="font-semibold">${formatPrice(tranche.marginUsed)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Unrealized P&L</p>
                      <p className={`font-semibold ${getPnLColor(tranche.unrealizedPnl)}`}>
                        {formatPnL(tranche.unrealizedPnl)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>TP: ${formatPrice(tranche.tpPrice)}</span>
                    <span>SL: ${formatPrice(tranche.slPrice)}</span>
                    <span>Leverage: {tranche.leverage}x</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Isolated Tranches */}
        {isolatedTranches.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Isolated Tranches ({isolatedTranches.length})
            </h3>
            <div className="space-y-2">
              {isolatedTranches.map((tranche) => (
                <div
                  key={tranche.id}
                  className="border border-yellow-500/50 rounded-lg p-3 space-y-2 bg-yellow-500/5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        {tranche.id.substring(0, 8)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {formatTime(tranche.entryTime)}
                      </span>
                    </div>
                    <Badge variant="destructive">Isolated</Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Entry</p>
                      <p className="font-semibold">${formatPrice(tranche.entryPrice)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quantity</p>
                      <p className="font-semibold">{tranche.quantity.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Margin</p>
                      <p className="font-semibold">${formatPrice(tranche.marginUsed)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Unrealized P&L</p>
                      <p className="font-semibold text-red-500">
                        {formatPnL(tranche.unrealizedPnl)}
                      </p>
                    </div>
                  </div>

                  {tranche.isolationTime && (
                    <div className="flex items-center gap-2 text-xs text-yellow-600">
                      <Clock className="h-3 w-3" />
                      <span>Isolated at {formatTime(tranche.isolationTime)}</span>
                      {tranche.isolationPrice && (
                        <span>@ ${formatPrice(tranche.isolationPrice)}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Closed Tranches */}
        {closedTranches.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-blue-500" />
              Recent Closed ({closedTranches.slice(0, 5).length})
            </h3>
            <div className="space-y-2">
              {closedTranches.slice(0, 5).map((tranche) => (
                <div
                  key={tranche.id}
                  className="border rounded-lg p-3 space-y-2 bg-muted/30"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        {tranche.id.substring(0, 8)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {tranche.exitTime && formatTime(tranche.exitTime)}
                      </span>
                    </div>
                    <Badge variant="secondary">Closed</Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Entry → Exit</p>
                      <p className="font-semibold">
                        ${formatPrice(tranche.entryPrice)} → ${formatPrice(tranche.exitPrice || 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quantity</p>
                      <p className="font-semibold">{tranche.quantity.toFixed(4)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Realized P&L</p>
                      <p className={`font-semibold ${getPnLColor(tranche.realizedPnl)}`}>
                        {formatPnL(tranche.realizedPnl)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {tranches.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>No tranches found for {symbol} {side}</p>
            <p className="text-sm mt-2">Tranches will appear here when positions are opened</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
