'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface PaperTradingStats {
  totalBalance: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnL: number;
  realizedPnL: number;
  totalPnL: number;
  sessionStartBalance: number;
  sessionPnL: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  openPositions: number;
}

interface PaperTradingPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  leverage: number;
  margin: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  liquidationPrice: number;
  takeProfit?: number;
  stopLoss?: number;
}

export function PaperTradingDashboard() {
  const [stats, setStats] = useState<PaperTradingStats | null>(null);
  const [positions, setPositions] = useState<PaperTradingPosition[]>([]);

  useEffect(() => {
    // Connect to WebSocket for paper trading updates
    const wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost';
    const wsPort = process.env.NEXT_PUBLIC_WS_PORT || '8080';
    const ws = new WebSocket(`ws://${wsHost}:${wsPort}`);

    ws.onopen = () => {
      console.log('Connected to paper trading WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'paper_balance_update') {
          setStats(data.payload);
        } else if (data.type === 'paper_position_opened') {
          setPositions((prev) => [...prev, data.payload]);
        } else if (data.type === 'paper_position_closed') {
          setPositions((prev) =>
            prev.filter((p) => p.symbol !== data.payload.position.symbol)
          );
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  if (!stats) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-2xl">📄</span>
            Paper Trading
            <Badge variant="outline" className="ml-2">
              SIMULATION
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Waiting for paper trading data...</p>
        </CardContent>
      </Card>
    );
  }

  const pnlColor = stats.sessionPnL >= 0 ? 'text-green-500' : 'text-red-500';
  const pnlPercent = ((stats.sessionPnL / stats.sessionStartBalance) * 100).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Main Stats Card */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-2xl">📄</span>
            Paper Trading Performance
            <Badge variant="secondary" className="ml-2">
              VIRTUAL MONEY
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Balance</p>
              <p className="text-2xl font-bold">${stats.totalBalance.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Available</p>
              <p className="text-2xl font-bold">${stats.availableBalance.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Session P&L</p>
              <p className={`text-2xl font-bold ${pnlColor}`}>
                {stats.sessionPnL >= 0 ? '+' : ''}
                ${stats.sessionPnL.toFixed(2)}
                <span className="text-sm ml-1">({pnlPercent}%)</span>
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Used Margin</p>
              <p className="text-2xl font-bold">${stats.usedMargin.toFixed(2)}</p>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Unrealized P&L</p>
              <p
                className={`text-lg font-semibold ${
                  stats.unrealizedPnL >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {stats.unrealizedPnL >= 0 ? '+' : ''}${stats.unrealizedPnL.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Realized P&L</p>
              <p
                className={`text-lg font-semibold ${
                  stats.realizedPnL >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {stats.realizedPnL >= 0 ? '+' : ''}${stats.realizedPnL.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Trades</p>
              <p className="text-lg font-semibold">{stats.trades}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Win Rate</p>
              <p className="text-lg font-semibold">{stats.winRate.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">W/L</p>
              <p className="text-lg font-semibold">
                <span className="text-green-500">{stats.wins}</span> /{' '}
                <span className="text-red-500">{stats.losses}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Open Positions */}
      {positions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open Positions ({positions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {positions.map((position, index) => {
                const pnlColor =
                  position.unrealizedPnL >= 0 ? 'text-green-500' : 'text-red-500';
                return (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={position.side === 'LONG' ? 'default' : 'destructive'}>
                        {position.side}
                      </Badge>
                      <div>
                        <p className="font-semibold">{position.symbol}</p>
                        <p className="text-sm text-muted-foreground">
                          Entry: ${position.entryPrice.toFixed(2)} | Qty: {position.quantity} |
                          Leverage: {position.leverage}x
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${pnlColor}`}>
                        {position.unrealizedPnL >= 0 ? '+' : ''}$
                        {position.unrealizedPnL.toFixed(2)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {position.unrealizedPnLPercent >= 0 ? '+' : ''}
                        {position.unrealizedPnLPercent.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
