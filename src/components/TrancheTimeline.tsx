'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, AlertTriangle, X, DollarSign } from 'lucide-react';

interface TrancheEvent {
  id: string;
  type: 'tranche_created' | 'tranche_isolated' | 'tranche_closed' | 'tranche_sync';
  timestamp: Date;
  data: any;
}

export function TrancheTimeline() {
  const [events, setEvents] = useState<TrancheEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    // Connect to WebSocket for real-time events
    const wsHost = process.env.NEXT_PUBLIC_WS_HOST || 'localhost';
    const wsPort = process.env.NEXT_PUBLIC_WS_PORT || '8080';
    const ws = new WebSocket(`ws://${wsHost}:${wsPort}`);

    ws.onopen = () => {
      console.log('TrancheTimeline: WebSocket connected');
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const { type, data } = message;

        // Only handle tranche events
        if (
          type === 'tranche_created' ||
          type === 'tranche_isolated' ||
          type === 'tranche_closed' ||
          type === 'tranche_sync'
        ) {
          const newEvent: TrancheEvent = {
            id: `${type}-${Date.now()}-${Math.random()}`,
            type,
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            data,
          };

          setEvents((prev) => [newEvent, ...prev].slice(0, 50)); // Keep last 50 events
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('TrancheTimeline: WebSocket disconnected');
      setWsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('TrancheTimeline: WebSocket error:', error);
    };

    return () => {
      ws.close();
    };
  }, []);

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'tranche_created':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'tranche_isolated':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'tranche_closed':
        return <DollarSign className="h-4 w-4 text-blue-500" />;
      case 'tranche_sync':
        return <TrendingDown className="h-4 w-4 text-gray-500" />;
      default:
        return <X className="h-4 w-4 text-gray-500" />;
    }
  };

  const getEventTitle = (event: TrancheEvent) => {
    const { type, data } = event;
    const _trancheId = data.trancheId?.substring(0, 8) || 'Unknown';

    switch (type) {
      case 'tranche_created':
        return `Tranche Created: ${data.symbol} ${data.side}`;
      case 'tranche_isolated':
        return `Tranche Isolated: ${data.symbol} (${data.pnlPercent?.toFixed(2)}% loss)`;
      case 'tranche_closed':
        return `Tranche Closed: ${data.symbol} (${data.closedFully ? 'Full' : 'Partial'})`;
      case 'tranche_sync':
        return `Exchange Sync: ${data.symbol} ${data.side} (${data.syncStatus})`;
      default:
        return 'Unknown Event';
    }
  };

  const getEventDetails = (event: TrancheEvent) => {
    const { type, data } = event;

    switch (type) {
      case 'tranche_created':
        return (
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Entry: ${data.entryPrice?.toLocaleString()}</p>
            <p>Quantity: {data.quantity} | Margin: ${data.marginUsed}</p>
            <p>TP: ${data.tpPrice?.toLocaleString()} | SL: ${data.slPrice?.toLocaleString()}</p>
          </div>
        );
      case 'tranche_isolated':
        return (
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Entry: ${data.entryPrice?.toLocaleString()} → Current: ${data.currentPrice?.toLocaleString()}</p>
            <p>Unrealized P&L: ${data.unrealizedPnl?.toFixed(2)}</p>
            <p>Threshold: {data.isolationThreshold}%</p>
          </div>
        );
      case 'tranche_closed':
        return (
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Entry: ${data.entryPrice?.toLocaleString()} → Exit: ${data.exitPrice?.toLocaleString()}</p>
            <p>Quantity: {data.quantity}</p>
            <p className={data.realizedPnl >= 0 ? 'text-green-500' : 'text-red-500'}>
              Realized P&L: ${data.realizedPnl?.toFixed(2)}
            </p>
          </div>
        );
      case 'tranche_sync':
        return (
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Local: {data.totalQuantity} | Exchange: {data.exchangeQuantity}</p>
            <p>Active: {data.activeTranches} | Isolated: {data.isolatedTranches}</p>
            {data.quantityDrift && <p className="text-yellow-500">Drift: {data.quantityDrift.toFixed(4)}</p>}
          </div>
        );
      default:
        return null;
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Tranche Activity Timeline</span>
          <Badge variant={wsConnected ? 'default' : 'destructive'}>
            {wsConnected ? 'Live' : 'Disconnected'}
          </Badge>
        </CardTitle>
        <CardDescription>
          Real-time tranche events and lifecycle updates
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[600px] overflow-y-auto pr-4">
          {events.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No tranche events yet</p>
              <p className="text-sm mt-2">Events will appear here in real-time</p>
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((event, index) => (
                <div key={event.id} className="relative">
                  {/* Timeline line */}
                  {index < events.length - 1 && (
                    <div className="absolute left-[11px] top-8 bottom-0 w-px bg-border" />
                  )}

                  {/* Event card */}
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 mt-1">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-background border-2 border-border">
                        {getEventIcon(event.type)}
                      </div>
                    </div>

                    <div className="flex-1 border rounded-lg p-3 bg-card hover:bg-accent/50 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-sm">{getEventTitle(event)}</h4>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(event.timestamp)}
                        </span>
                      </div>

                      {getEventDetails(event)}

                      {event.data.trancheId && (
                        <div className="mt-2">
                          <Badge variant="outline" className="font-mono text-xs">
                            {event.data.trancheId.substring(0, 8)}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
