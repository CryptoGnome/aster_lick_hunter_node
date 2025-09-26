'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  Filter,
  ChevronDown
} from 'lucide-react';
import orderStore from '@/lib/services/orderStore';
import { Order, OrderStatus, OrderSide, OrderType } from '@/lib/types/order';
import { useConfig } from '@/components/ConfigProvider';
import websocketService from '@/lib/services/websocketService';

interface RecentOrdersTableProps {
  maxRows?: number;
}

export default function RecentOrdersTable({ maxRows = 50 }: RecentOrdersTableProps) {
  const { config } = useConfig();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('FILLED');
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [showMore, setShowMore] = useState(false);
  const [flashingOrders, setFlashingOrders] = useState<Set<number>>(new Set());

  // Get available symbols from config
  const availableSymbols = useMemo(() => {
    if (!config?.symbols) return [];
    return Object.keys(config.symbols);
  }, [config]);

  // Load initial orders
  const loadOrders = useCallback(async (force = false) => {
    try {
      setLoading(true);
      setError(null);

      // Set filters in store
      orderStore.setFilters({
        status: statusFilter === 'ALL' ? undefined : statusFilter as OrderStatus,
        symbol: symbolFilter === 'ALL' ? undefined : symbolFilter,
        limit: maxRows,
      });

      // Fetch orders
      await orderStore.fetchOrders(force);
      let filteredOrders = orderStore.getFilteredOrders();

      // Filter by configured symbols only
      if (availableSymbols.length > 0) {
        filteredOrders = filteredOrders.filter(order =>
          availableSymbols.includes(order.symbol)
        );
      }

      setOrders(filteredOrders);
    } catch (err) {
      console.error('Failed to load orders:', err);
      setError('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, symbolFilter, maxRows, availableSymbols]);

  // Initial load
  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Subscribe to order updates
  useEffect(() => {
    const handleOrdersUpdate = (updatedOrders: Order[]) => {
      let filtered = orderStore.getFilteredOrders();
      // Filter by configured symbols only
      if (availableSymbols.length > 0) {
        filtered = filtered.filter(order =>
          availableSymbols.includes(order.symbol)
        );
      }
      setOrders(filtered);
    };

    const handleNewOrder = (order: Order) => {
      // Only flash if this order is for a configured symbol
      if (availableSymbols.length === 0 || availableSymbols.includes(order.symbol)) {
        // Flash animation for new orders
        setFlashingOrders(prev => new Set(prev).add(order.orderId));
        setTimeout(() => {
          setFlashingOrders(prev => {
            const next = new Set(prev);
            next.delete(order.orderId);
            return next;
          });
        }, 2000);
      }
    };

    const handleOrderFilled = (order: Order) => {
      // Only log if this order is for a configured symbol
      if (availableSymbols.length === 0 || availableSymbols.includes(order.symbol)) {
        // Special handling for filled orders
        console.log('Order filled:', order.symbol, order.realizedProfit);
      }
    };

    // Subscribe to store events
    orderStore.on('orders:filtered', handleOrdersUpdate);
    orderStore.on('order:new', handleNewOrder);
    orderStore.on('order:filled', handleOrderFilled);

    // Subscribe to WebSocket messages
    const handleWebSocketMessage = (message: any) => {
      if (message.type === 'order_update' || message.type === 'ORDER_TRADE_UPDATE') {
        orderStore.handleWebSocketMessage(message);
      }
    };

    const cleanupWebSocket = websocketService.addMessageHandler(handleWebSocketMessage);

    // Cleanup
    return () => {
      orderStore.off('orders:filtered', handleOrdersUpdate);
      orderStore.off('order:new', handleNewOrder);
      orderStore.off('order:filled', handleOrderFilled);
      cleanupWebSocket();
    };
  }, [availableSymbols]);

  // Format time
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  // Format price
  const formatPrice = (price: string | undefined) => {
    if (!price || price === '0') return '-';
    const num = parseFloat(price);
    if (num < 0.01) return num.toFixed(6);
    if (num < 1) return num.toFixed(4);
    return num.toFixed(2);
  };

  // Format quantity
  const formatQuantity = (qty: string | undefined) => {
    if (!qty || qty === '0') return '-';
    const num = parseFloat(qty);
    if (num < 0.001) return num.toFixed(6);
    if (num < 1) return num.toFixed(4);
    return num.toFixed(3);
  };

  // Format PnL
  const formatPnL = (pnl: string | undefined) => {
    if (!pnl || pnl === '0') return null;
    const num = parseFloat(pnl);
    const formatted = Math.abs(num).toFixed(2);
    return { value: num, formatted: `${num >= 0 ? '+' : '-'}$${formatted}` };
  };

  // Get status icon and color
  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.FILLED:
        return (
          <Badge className="bg-green-600/10 text-green-600 border-green-600/20">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Filled
          </Badge>
        );
      case OrderStatus.NEW:
      case OrderStatus.PARTIALLY_FILLED:
        return (
          <Badge className="bg-blue-600/10 text-blue-600 border-blue-600/20">
            <Clock className="w-3 h-3 mr-1" />
            {status === OrderStatus.NEW ? 'Open' : 'Partial'}
          </Badge>
        );
      case OrderStatus.CANCELED:
      case OrderStatus.EXPIRED:
        return (
          <Badge className="bg-gray-600/10 text-gray-600 border-gray-600/20">
            <XCircle className="w-3 h-3 mr-1" />
            {status === OrderStatus.CANCELED ? 'Canceled' : 'Expired'}
          </Badge>
        );
      case OrderStatus.REJECTED:
        return (
          <Badge className="bg-red-600/10 text-red-600 border-red-600/20">
            <AlertCircle className="w-3 h-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Get order type badge
  const getTypeBadge = (type: OrderType) => {
    const colors: Record<string, string> = {
      [OrderType.MARKET]: 'bg-purple-600/10 text-purple-600 border-purple-600/20',
      [OrderType.LIMIT]: 'bg-blue-600/10 text-blue-600 border-blue-600/20',
      [OrderType.STOP_MARKET]: 'bg-orange-600/10 text-orange-600 border-orange-600/20',
      [OrderType.TAKE_PROFIT_MARKET]: 'bg-green-600/10 text-green-600 border-green-600/20',
      [OrderType.TRAILING_STOP_MARKET]: 'bg-yellow-600/10 text-yellow-600 border-yellow-600/20',
      [OrderType.LIQUIDATION]: 'bg-red-600/10 text-red-600 border-red-600/20',
    };

    return (
      <Badge className={colors[type] || 'bg-gray-600/10 text-gray-600 border-gray-600/20'}>
        {type.replace(/_/g, ' ')}
      </Badge>
    );
  };

  // Determine position action type
  const getPositionAction = (order: Order): string => {
    // Check if this is a reduce-only order (closing/reducing position)
    if (order.reduceOnly) {
      // Check if it's a stop-loss or take-profit
      if (order.type === OrderType.STOP_MARKET || order.type === 'STOP') {
        return 'STOP LOSS';
      }
      if (order.type === OrderType.TAKE_PROFIT_MARKET || order.type === 'TAKE_PROFIT') {
        return 'TAKE PROFIT';
      }
      // Check if it fully closed the position (would need position tracking for accuracy)
      // For now, we'll label all other reduce-only as REDUCE
      return 'REDUCE';
    }

    // Check if this is a close-all position order
    if (order.closePosition) {
      return 'CLOSE ALL';
    }

    // For non-reduce orders, it's either OPEN or ADD
    // Without position history, we'll label as OPEN for now
    // In a full implementation, you'd track if a position existed before this order
    return 'OPEN';
  };

  // Get position action badge
  const getPositionActionBadge = (order: Order) => {
    const action = getPositionAction(order);

    const colors: Record<string, string> = {
      'OPEN': 'bg-blue-600/10 text-blue-600 border-blue-600/20',
      'ADD': 'bg-cyan-600/10 text-cyan-600 border-cyan-600/20',
      'REDUCE': 'bg-yellow-600/10 text-yellow-600 border-yellow-600/20',
      'CLOSE': 'bg-gray-600/10 text-gray-600 border-gray-600/20',
      'CLOSE ALL': 'bg-gray-600/10 text-gray-600 border-gray-600/20',
      'STOP LOSS': 'bg-red-600/10 text-red-600 border-red-600/20',
      'TAKE PROFIT': 'bg-green-600/10 text-green-600 border-green-600/20',
    };

    return (
      <Badge className={colors[action] || 'bg-gray-600/10 text-gray-600 border-gray-600/20'} variant="outline">
        {action}
      </Badge>
    );
  };

  // Get statistics
  const statistics = useMemo(() => {
    // Calculate statistics only for configured symbols
    const configuredOrders = availableSymbols.length > 0
      ? orders.filter(o => availableSymbols.includes(o.symbol))
      : orders;

    const filled = configuredOrders.filter(o => o.status === OrderStatus.FILLED);

    // Only count orders that actually closed positions (have PnL data)
    // These are typically reduce-only orders, SL/TP orders, or close orders
    const closingOrders = filled.filter(o => {
      // Check if order has realized profit/loss (not undefined, not null, not empty string)
      const hasRealizedPnL = o.realizedProfit !== undefined &&
                             o.realizedProfit !== null &&
                             o.realizedProfit !== '' &&
                             o.realizedProfit !== '0';

      // Also check if it's a reduce-only order or SL/TP type
      const isClosingOrder = o.reduceOnly ||
                             o.type === OrderType.STOP_MARKET ||
                             o.type === OrderType.TAKE_PROFIT_MARKET ||
                             o.type === 'STOP' ||
                             o.type === 'TAKE_PROFIT';

      return hasRealizedPnL || isClosingOrder;
    });

    const profit = closingOrders.reduce((sum, o) => {
      const pnl = parseFloat(o.realizedProfit || '0');
      return sum + (pnl > 0 ? pnl : 0);
    }, 0);

    const loss = closingOrders.reduce((sum, o) => {
      const pnl = parseFloat(o.realizedProfit || '0');
      return sum + (pnl < 0 ? Math.abs(pnl) : 0);
    }, 0);

    // Count wins and losses only from closing orders with PnL
    const ordersWithPnL = closingOrders.filter(o =>
      o.realizedProfit !== undefined &&
      o.realizedProfit !== null &&
      o.realizedProfit !== '' &&
      o.realizedProfit !== '0'
    );

    const wins = ordersWithPnL.filter(o => parseFloat(o.realizedProfit || '0') > 0).length;
    const losses = ordersWithPnL.filter(o => parseFloat(o.realizedProfit || '0') < 0).length;

    return {
      total: configuredOrders.length,
      filled: filled.length,
      open: configuredOrders.filter(o =>
        o.status === OrderStatus.NEW ||
        o.status === OrderStatus.PARTIALLY_FILLED
      ).length,
      canceled: configuredOrders.filter(o => o.status === OrderStatus.CANCELED).length,
      totalProfit: profit,
      totalLoss: loss,
      netPnL: profit - loss,
      winRate: ordersWithPnL.length > 0
        ? (wins / ordersWithPnL.length) * 100
        : 0,
      wins,
      losses,
      closedTrades: ordersWithPnL.length,
    };
  }, [orders, availableSymbols]);

  const displayedOrders = showMore ? orders : orders.slice(0, 10);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Recent Orders
            <Badge variant="outline" className="ml-2">
              {orders.length} orders
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Status</SelectItem>
                <SelectItem value="FILLED">Filled</SelectItem>
                <SelectItem value="NEW">Open</SelectItem>
                <SelectItem value="PARTIALLY_FILLED">Partial</SelectItem>
                <SelectItem value="CANCELED">Canceled</SelectItem>
              </SelectContent>
            </Select>

            {/* Symbol Filter */}
            <Select value={symbolFilter} onValueChange={setSymbolFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Symbols</SelectItem>
                {availableSymbols.map(symbol => (
                  <SelectItem key={symbol} value={symbol}>
                    {symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Refresh Button */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => loadOrders(true)}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Statistics Bar */}
        <div className="flex items-center gap-4 mt-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Win Rate:</span>
            <span className="font-medium">
              {statistics.closedTrades > 0
                ? `${statistics.winRate.toFixed(1)}% (${statistics.wins}W/${statistics.losses}L)`
                : 'N/A'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Net PnL:</span>
            <span className={`font-medium ${statistics.netPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {statistics.netPnL >= 0 ? '+' : '-'}${Math.abs(statistics.netPnL).toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Closed:</span>
            <span className="font-medium">{statistics.closedTrades}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Open:</span>
            <span className="font-medium">{statistics.open}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading && orders.length === 0 ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p>{error}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2" />
            <p>No orders found</p>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Time</TableHead>
                    <TableHead className="w-[100px]">Symbol</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Filled</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">PnL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedOrders.map((order) => {
                    const pnl = formatPnL(order.realizedProfit);
                    const isFlashing = flashingOrders.has(order.orderId);

                    return (
                      <TableRow
                        key={order.orderId}
                        className={`
                          ${isFlashing ? 'animate-pulse bg-blue-500/5' : ''}
                          transition-colors duration-200
                        `}
                      >
                        <TableCell className="text-xs text-muted-foreground">
                          {formatTime(order.updateTime)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {order.symbol.replace('USDT', '')}
                        </TableCell>
                        <TableCell>
                          {getPositionActionBadge(order)}
                        </TableCell>
                        <TableCell>
                          {getTypeBadge(order.type)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={order.side === OrderSide.BUY ? 'text-green-600' : 'text-red-600'}
                          >
                            {order.side === OrderSide.BUY ? (
                              <TrendingUp className="w-3 h-3 mr-1" />
                            ) : (
                              <TrendingDown className="w-3 h-3 mr-1" />
                            )}
                            {order.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPrice(order.avgPrice || order.price)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatQuantity(order.origQty)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatQuantity(order.executedQty)}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(order.status)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {pnl && (
                            <span className={pnl.value >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {pnl.formatted}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {orders.length > 10 && (
              <div className="mt-4 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMore(!showMore)}
                  className="gap-2"
                >
                  {showMore ? 'Show Less' : `Show More (${orders.length - 10} more)`}
                  <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? 'rotate-180' : ''}`} />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}