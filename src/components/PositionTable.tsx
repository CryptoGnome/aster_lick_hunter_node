'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3, TrendingUp, TrendingDown, Shield, Target, ChevronDown, X, AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ScaleOutModal, ScaleOutSettings } from '@/components/ScaleOutModal';
import websocketService from '@/lib/services/websocketService';
import { useConfig } from '@/components/ConfigProvider';
import { useSymbolPrecision } from '@/hooks/useSymbolPrecision';
import dataStore from '@/lib/services/dataStore';
import { showApiError, showTradingError } from '@/lib/utils/errorToast';

interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPercent: number;
  margin: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage: number;
  liquidationPrice?: number;
  hasStopLoss?: boolean;
  hasTakeProfit?: boolean;
}

interface VWAPData {
  value: number;
  position: 'above' | 'below';
  timestamp: number;
}

interface PositionTableProps {
  positions?: Position[];
  onClosePosition?: (symbol: string, side: 'LONG' | 'SHORT') => void;
}

export default function PositionTable({
  positions = [],
  onClosePosition: _onClosePosition,
}: PositionTableProps) {
  const [realPositions, setRealPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [markPrices, setMarkPrices] = useState<Record<string, number>>({});
  const [vwapData, setVwapData] = useState<Record<string, VWAPData>>({});
  const [protectionStatus, setProtectionStatus] = useState<Record<string, boolean>>({});
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [closePositionModal, setClosePositionModal] = useState<{
    isOpen: boolean;
    symbol: string;
    side: 'LONG' | 'SHORT';
    quantity: number;
    entryPrice?: number;
    markPrice?: number;
    pnl?: number;
    pnlPercent?: number;
  }>({
    isOpen: false,
    symbol: '',
    side: 'LONG',
    quantity: 0,
  });
  const [isClosingPosition, setIsClosingPosition] = useState(false);
  const [protectPositionModal, setProtectPositionModal] = useState<{
    isOpen: boolean;
    position: {
      symbol: string;
      side: 'LONG' | 'SHORT';
      quantity: number;
      entryPrice: number;
      markPrice: number;
    } | null;
  }>({
    isOpen: false,
    position: null,
  });
  const { config } = useConfig();
  const { formatPrice, formatQuantity, formatPriceWithCommas } = useSymbolPrecision();

  // Initial load of VWAP data (fallback for when WebSocket is not yet connected)
  const loadVWAPData = useCallback(async () => {
    try {
      // Only fetch for symbols with VWAP protection enabled
      const symbolsWithVWAP = Object.entries(config?.symbols || {})
        .filter(([_, cfg]) => cfg.vwapProtection)
        .map(([symbol]) => symbol);

      if (symbolsWithVWAP.length === 0) {
        console.log('No symbols with VWAP protection enabled');
        return;
      }

      console.log('Initial VWAP load for symbols:', symbolsWithVWAP);

      const vwapPromises = symbolsWithVWAP.map(async (symbol) => {
        try {
          const response = await fetch(`/api/vwap/${symbol}`);
          if (response.ok) {
            const data = await response.json();
            return { symbol, data };
          }
        } catch (error) {
          console.error(`Failed to load initial VWAP for ${symbol}:`, error);
        }
        return null;
      });

      const results = await Promise.all(vwapPromises);
      const vwapMap: Record<string, VWAPData> = {};
      results.forEach(result => {
        if (result) {
          vwapMap[result.symbol] = result.data;
        }
      });
      console.log('Final VWAP map:', vwapMap);
      setVwapData(vwapMap);
    } catch (error) {
      console.error('Failed to load VWAP data:', error);
    }
  }, [config?.symbols]);

  // Load initial positions and set up WebSocket updates
  useEffect(() => {
    // Use data store if no positions passed as props
    if (positions.length === 0) {
      // Load initial data from data store
      dataStore.fetchPositions().then((data) => {
        setRealPositions(data);
        setIsLoading(false);
      }).catch((error) => {
        console.error('[PositionTable] Failed to load positions:', error);
        setIsLoading(false);
      });

      // Subscribe to data store events
      const handlePositionsUpdate = (data: Position[]) => {
        setRealPositions(data);
      };

      const handleMarkPricesUpdate = (prices: Record<string, number>) => {
        setMarkPrices(prices);
      };

      dataStore.on('positions:update', handlePositionsUpdate);
      dataStore.on('markPrices:update', handleMarkPricesUpdate);

      // Load initial mark prices
      const currentMarkPrices = dataStore.getMarkPrices();
      if (Object.keys(currentMarkPrices).length > 0) {
        setMarkPrices(currentMarkPrices);
      }

      // Clean up data store listeners
      const cleanupDataStore = () => {
        dataStore.off('positions:update', handlePositionsUpdate);
        dataStore.off('markPrices:update', handleMarkPricesUpdate);
      };

      // Forward WebSocket messages to data store and handle VWAP
      const handleWebSocketMessage = (message: any) => {
        // Forward to data store for balance/position/mark price updates
        dataStore.handleWebSocketMessage(message);

        // Handle VWAP updates separately (not in data store)
        if (message.type === 'vwap_update') {
          const data = message.data;
          if (data && data.symbol) {
            setVwapData(prev => ({
              ...prev,
              [data.symbol]: {
                value: data.vwap,
                position: data.position,
                timestamp: data.timestamp
              }
            }));
          }
        } else if (message.type === 'vwap_bulk') {
          if (Array.isArray(message.data)) {
            const vwapUpdates: Record<string, VWAPData> = {};
            message.data.forEach((data: any) => {
              vwapUpdates[data.symbol] = {
                value: data.vwap,
                position: data.position,
                timestamp: data.timestamp
              };
            });
            setVwapData(prev => ({ ...prev, ...vwapUpdates }));
          }
        } else if (message.type === 'scale_out_status_update') {
          // Update scale out button status when orders are filled/canceled
          const { symbol, side, isActive } = message.data;
          const key = `${symbol}_${side}`;
          setProtectionStatus(prev => ({ ...prev, [key]: isActive }));
        }
      };

      const cleanupWebSocket = websocketService.addMessageHandler(handleWebSocketMessage);

      // Skip initial VWAP load - WebSocket will provide updates
      // loadVWAPData();

      // Cleanup on unmount
      return () => {
        cleanupDataStore();
        cleanupWebSocket();
      };
    } else {
      // Use passed positions and set up VWAP updates only
      setIsLoading(false);

      const handleVwapMessage = (message: any) => {
        if (message.type === 'vwap_update') {
          const data = message.data;
          if (data && data.symbol) {
            setVwapData(prev => ({
              ...prev,
              [data.symbol]: {
                value: data.vwap,
                position: data.position,
                timestamp: data.timestamp
              }
            }));
          }
        } else if (message.type === 'vwap_bulk') {
          if (Array.isArray(message.data)) {
            const vwapUpdates: Record<string, VWAPData> = {};
            message.data.forEach((data: any) => {
              vwapUpdates[data.symbol] = {
                value: data.vwap,
                position: data.position,
                timestamp: data.timestamp
              };
            });
            setVwapData(prev => ({ ...prev, ...vwapUpdates }));
          }
        }
      };

      const cleanupVwap = websocketService.addMessageHandler(handleVwapMessage);
      loadVWAPData();

      return () => {
        cleanupVwap();
      };
    }
  }, [positions.length, loadVWAPData]); // Include loadVWAPData dependency

  // Load scale out status for all positions on mount and when position count changes
  useEffect(() => {
    const displayedPositions = positions.length > 0 ? positions : realPositions;
    if (displayedPositions.length === 0) return;

    // Filter to only positions we haven't checked yet
    const uncheckedPositions = displayedPositions.filter(p => {
      const key = `${p.symbol}_${p.side}`;
      return !(key in protectionStatus);
    });
    
    // Only check if we have new positions we haven't checked yet
    if (uncheckedPositions.length === 0) return;

    // Request status for all positions in parallel (much faster)
    const checkStatuses = async () => {
      const statusPromises = uncheckedPositions.map(async (position) => {
        const key = `${position.symbol}_${position.side}`;
        try {
          const response = await fetch(`/api/positions/scale-out/status?symbol=${position.symbol}&side=${position.side}`);
          if (response.ok) {
            const data = await response.json();
            return { key, isActive: data.isActive };
          }
        } catch (error) {
          console.error(`Failed to check scale out status for ${position.symbol}:`, error);
        }
        return null;
      });

      const results = await Promise.all(statusPromises);
      const updates: Record<string, boolean> = {};
      results.forEach(result => {
        if (result) updates[result.key] = result.isActive;
      });
      
      if (Object.keys(updates).length > 0) {
        setProtectionStatus(prev => ({ ...prev, ...updates }));
      }
    };

    // Small delay to batch requests after component mounts
    const timer = setTimeout(checkStatuses, 100);
    return () => clearTimeout(timer);
  }, [positions.length, realPositions.length]); // Removed protectionStatus from deps


  // Handle close position
  const handleClosePosition = useCallback((position: Position) => {
    setClosePositionModal({
      isOpen: true,
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      markPrice: position.markPrice,
      pnl: position.pnl,
      pnlPercent: position.pnlPercent,
    });
  }, []);

  const confirmClosePosition = useCallback(async () => {
    if (!closePositionModal.symbol || !closePositionModal.side) return;

    setIsClosingPosition(true);
    try {
      const response = await fetch(`/api/positions/${closePositionModal.symbol}/${closePositionModal.side}/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (result.success) {
        // Show success toast
        toast.success(`Successfully closed ${closePositionModal.symbol} ${closePositionModal.side} position`, {
          description: `Closed ${formatQuantity(closePositionModal.symbol, closePositionModal.quantity)} contracts`,
          duration: 5000,
        });

        // Always refresh positions data after successful close
        dataStore.fetchPositions().then((data) => {
          setRealPositions(data);
        }).catch((error) => {
          console.error('[PositionTable] Failed to refresh positions after close:', error);
          toast.error('Failed to refresh positions', {
            description: 'Please refresh the page to see updated positions',
          });
        });

        // Close modal
        setClosePositionModal({
          isOpen: false,
          symbol: '',
          side: 'LONG',
          quantity: 0,
        });
      } else {
        console.error('Failed to close position:', result.error);
        // Show error toast with details
        showTradingError(
          'Failed to close position',
          result.error || 'An unknown error occurred',
          {
            symbol: closePositionModal.symbol,
            component: 'PositionTable',
            rawError: result,
          }
        );
      }
    } catch (error) {
      console.error('Error closing position:', error);
      // Show error toast
      showApiError(
        'Network error',
        'Failed to connect to the server',
        {
          symbol: closePositionModal.symbol,
          component: 'PositionTable',
          rawError: error,
        }
      );
    } finally {
      setIsClosingPosition(false);
    }
  }, [closePositionModal, formatQuantity]);

  const cancelClosePosition = useCallback(() => {
    setClosePositionModal({
      isOpen: false,
      symbol: '',
      side: 'LONG',
      quantity: 0,
    });
  }, []);

  // Handle protect position
  const handleProtectPosition = useCallback((position: Position) => {
    const key = `${position.symbol}_${position.side}`;
    const isProtected = protectionStatus[key];

    // If already protected, deactivate instead of showing modal
    if (isProtected) {
      handleDeactivateProtection(position);
    } else {
      setProtectPositionModal({
        isOpen: true,
        position: {
          symbol: position.symbol,
          side: position.side,
          quantity: position.quantity,
          entryPrice: position.entryPrice,
          markPrice: position.markPrice,
        },
      });
    }
  }, [protectionStatus]);

  const handleDeactivateProtection = useCallback(async (position: Position) => {
    try {
      const response = await fetch('/api/positions/scale-out/deactivate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: position.symbol,
          side: position.side,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast.success(`Scale out deactivated for ${position.symbol}`);
        const key = `${position.symbol}_${position.side}`;
        setProtectionStatus(prev => ({ ...prev, [key]: false }));
      } else {
        throw new Error(result.error || 'Failed to deactivate scale out');
      }
    } catch (error: any) {
      console.error('[PositionTable] Error deactivating scale out:', error);
      toast.error(`Failed to deactivate scale out`, {
        description: error.message || 'Unknown error occurred',
      });
    }
  }, []);

  const handleProtectConfirm = useCallback(async (settings: ScaleOutSettings) => {
    if (!protectPositionModal.position) return;

    try {
      const response = await fetch('/api/positions/scale-out', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: protectPositionModal.position.symbol,
          side: protectPositionModal.position.side,
          entryPrice: protectPositionModal.position.entryPrice,
          quantity: protectPositionModal.position.quantity,
          settings,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast.success(`Scale out active for ${protectPositionModal.position.symbol}`, {
          description: settings.enableBreakeven 
            ? `Breakeven order and ${settings.trimLevels.length} trim level(s) set`
            : `${settings.trimLevels.length} trim level(s) set`,
          duration: 5000,
        });
        
        // Update protection status
        const key = `${protectPositionModal.position.symbol}_${protectPositionModal.position.side}`;
        setProtectionStatus(prev => ({ ...prev, [key]: true }));
      } else {
        showTradingError(
          'Failed to activate scale out',
          result.error || 'An unknown error occurred',
          {
            symbol: protectPositionModal.position.symbol,
            component: 'PositionTable',
            rawError: result,
          }
        );
      }
    } catch (error) {
      console.error('Error activating protection:', error);
      showApiError(
        'Network error',
        'Failed to connect to the server',
        {
          symbol: protectPositionModal.position.symbol,
          component: 'PositionTable',
          rawError: error,
        }
      );
    } finally {
      setProtectPositionModal({ isOpen: false, position: null });
    }
  }, [protectPositionModal]);

  const handleProtectCancel = useCallback(() => {
    setProtectPositionModal({ isOpen: false, position: null });
  }, []);

  // Use passed positions if available, otherwise use fetched positions
  // Apply live mark prices to calculate real-time PnL
  // Memoized to avoid recalculating on every render
  const displayPositions = useMemo(() => {
    return (positions.length > 0 ? positions : realPositions).map(position => {
      const liveMarkPrice = markPrices[position.symbol];
      if (liveMarkPrice && liveMarkPrice !== position.markPrice) {
        // Calculate live PnL based on current mark price
        const entryPrice = position.entryPrice;
        const quantity = position.quantity;
        const isLong = position.side === 'LONG';

        const priceDiff = liveMarkPrice - entryPrice;
        const livePnL = isLong ? priceDiff * quantity : -priceDiff * quantity;
        const notionalValue = quantity * entryPrice;
        const livePnLPercent = notionalValue > 0 ? (livePnL / notionalValue) * 100 : 0;

        return {
          ...position,
          markPrice: liveMarkPrice,
          pnl: livePnL,
          pnlPercent: livePnLPercent
        };
      }
      return position;
    });
  }, [positions, realPositions, markPrices]);

  const _totalPnL = displayPositions.reduce((sum, p) => sum + p.pnl, 0);
  const _totalMargin = displayPositions.reduce((sum, p) => sum + p.margin, 0);

  // Get unique symbols from positions and group by side
  const _positionSymbols = useMemo(() => {
    const symbolMap = new Map<string, Set<'LONG' | 'SHORT'>>();
    displayPositions.forEach(position => {
      if (!symbolMap.has(position.symbol)) {
        symbolMap.set(position.symbol, new Set());
      }
      symbolMap.get(position.symbol)?.add(position.side);
    });
    return Array.from(symbolMap.entries()).map(([symbol, sides]) => ({
      symbol,
      hasLong: sides.has('LONG'),
      hasShort: sides.has('SHORT'),
    }));
  }, [displayPositions]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <CardTitle className="text-base font-medium">Positions</CardTitle>
          <Badge variant="secondary" className="h-5 text-xs px-1.5">
            {displayPositions.length}
          </Badge>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
        </button>
      </CardHeader>

      {!isCollapsed && (
        <CardContent className="pt-0">
          {/* Mobile Card View */}
          <div className="sm:hidden space-y-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="border rounded-lg p-3">
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))
            ) : displayPositions.length === 0 ? (
              <div className="text-center py-6 text-sm text-muted-foreground">
                No open positions
              </div>
            ) : (
              displayPositions.map((position) => {
                const key = `${position.symbol}-${position.side}`;
                const vwap = vwapData[position.symbol];
                const symbolConfig = config?.symbols?.[position.symbol];
                const hasVwapProtection = symbolConfig?.vwapProtection;
                const isProtected = protectionStatus[`${position.symbol}_${position.side}`];

                return (
                  <div key={key} className="border rounded-lg p-3 space-y-2">
                    {/* Header: Symbol, Side, Leverage */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <a 
                          href={`https://www.asterdex.com/en/futures/v1/${position.symbol}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="font-semibold text-sm hover:underline"
                        >
                          {position.symbol}
                        </a>
                        <Badge variant="secondary" className="h-4 text-[10px] px-1">
                          {position.leverage}x
                        </Badge>
                      </div>
                      <Badge
                        variant={position.side === 'LONG' ? 'outline' : 'destructive'}
                        className={`h-5 text-xs ${position.side === 'LONG' ? 'border-green-600 text-green-600' : ''}`}
                      >
                        {position.side === 'LONG' ? <TrendingUp className="h-3 w-3 mr-0.5" /> : <TrendingDown className="h-3 w-3 mr-0.5" />}
                        {position.side}
                      </Badge>
                    </div>

                    {/* PnL - Large and prominent */}
                    <div className="flex items-baseline gap-2">
                      <span className={`text-lg font-bold ${position.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {position.pnl >= 0 ? '+' : ''}${Math.abs(position.pnl).toFixed(2)}
                      </span>
                      <Badge variant={position.pnl >= 0 ? "outline" : "destructive"} className={`h-4 text-[10px] ${position.pnl >= 0 ? 'border-green-600 text-green-600' : ''}`}>
                        {position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(1)}%
                      </Badge>
                    </div>

                    {/* Position Details Grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Size</div>
                        <div className="font-mono font-medium">{formatQuantity(position.symbol, position.quantity)}</div>
                        <div className="text-[10px] text-muted-foreground">${position.margin.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Entry / Mark</div>
                        <div className="font-mono font-medium">${formatPriceWithCommas(position.symbol, position.entryPrice)}</div>
                        <div className="text-[10px] text-muted-foreground">${formatPriceWithCommas(position.symbol, position.markPrice)}</div>
                      </div>
                      {position.liquidationPrice && position.liquidationPrice > 0 && (
                        <div>
                          <div className="text-muted-foreground">Liquidation</div>
                          <div className="font-mono font-medium text-orange-600">${formatPriceWithCommas(position.symbol, position.liquidationPrice)}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {(() => {
                              const distancePercent = position.side === 'LONG'
                                ? ((position.markPrice - position.liquidationPrice) / position.markPrice) * 100
                                : ((position.liquidationPrice - position.markPrice) / position.markPrice) * 100;
                              return `${distancePercent.toFixed(1)}% away`;
                            })()}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Protection Status */}
                    <div className="flex items-center gap-1 pt-1 border-t">
                      {position.hasStopLoss ? (
                        <Badge variant="outline" className="h-5 text-[10px] px-1.5 border-green-600 text-green-600">
                          <Shield className="h-3 w-3 mr-0.5" />SL
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="h-5 text-[10px] px-1.5 text-muted-foreground">
                          <Shield className="h-3 w-3 mr-0.5" />No SL
                        </Badge>
                      )}
                      {position.hasTakeProfit ? (
                        <Badge variant="outline" className="h-5 text-[10px] px-1.5 border-blue-600 text-blue-600">
                          <Target className="h-3 w-3 mr-0.5" />TP
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="h-5 text-[10px] px-1.5 text-muted-foreground">
                          <Target className="h-3 w-3 mr-0.5" />No TP
                        </Badge>
                      )}
                      {hasVwapProtection && vwap && (
                        <Badge variant="outline" className={`h-5 text-[10px] px-1.5 ${
                          (position.side === 'LONG' && vwap.position === 'below') || (position.side === 'SHORT' && vwap.position === 'above')
                            ? 'border-green-600 text-green-600'
                            : 'border-orange-600 text-orange-600'
                        }`}>
                          <BarChart3 className="h-3 w-3 mr-0.5" />
                          ${formatPrice(position.symbol, vwap.value)}
                        </Badge>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant={isProtected ? "default" : "outline"}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleProtectPosition(position); }}
                        className={`flex-1 h-8 text-xs ${isProtected ? 'bg-green-600 hover:bg-green-700' : ''}`}
                      >
                        <Shield className="h-3 w-3 mr-1" />
                        {isProtected ? 'Scaling' : 'Scale Out'}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleClosePosition(position); }}
                        className="flex-1 h-8 text-xs"
                      >
                        <X className="h-3 w-3 mr-1" />
                        Close
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="h-8">
                  <TableHead className="text-xs">Symbol</TableHead>
                  <TableHead className="text-xs">Side</TableHead>
                  <TableHead className="text-xs text-right">Size</TableHead>
                  <TableHead className="text-xs text-right">Entry/Mark</TableHead>
                  <TableHead className="text-xs text-right">Liq. Price</TableHead>
                  <TableHead className="text-xs text-right">PnL</TableHead>
                  <TableHead className="text-xs text-center">Protection</TableHead>
                  <TableHead className="text-xs text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className="h-12">
                    <TableCell className="py-2"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="py-2"><Skeleton className="h-5 w-8" /></TableCell>
                    <TableCell className="py-2 text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                    <TableCell className="py-2 text-right"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                    <TableCell className="py-2 text-right"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                    <TableCell className="py-2 text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                    <TableCell className="py-2 text-center"><Skeleton className="h-5 w-20 mx-auto" /></TableCell>
                    <TableCell className="py-2 text-center"><Skeleton className="h-8 w-16 mx-auto" /></TableCell>
                  </TableRow>
                ))
            ) : displayPositions.map((position) => {
              const key = `${position.symbol}-${position.side}`;
              const vwap = vwapData[position.symbol];
              const symbolConfig = config?.symbols?.[position.symbol];
              const hasVwapProtection = symbolConfig?.vwapProtection;

              return (
                <TableRow key={key} className="h-12">
                  <TableCell className="py-2">
                    <div className="flex items-center gap-1.5">
                      <a 
                        href={`https://www.asterdex.com/en/futures/v1/${position.symbol}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="font-medium text-sm hover:underline hover:text-primary transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {position.symbol}
                      </a>
                      <Badge variant="secondary" className="h-4 text-[10px] px-1">
                        {position.leverage}x
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="py-2">
                    <Badge
                      variant={position.side === 'LONG' ? 'outline' : 'destructive'}
                      className={`h-5 text-xs px-1.5 ${position.side === 'LONG' ? 'border-green-600 text-green-600 dark:border-green-400 dark:text-green-400' : ''}`}
                    >
                      {position.side === 'LONG' ? (
                        <TrendingUp className="h-3 w-3 mr-0.5" />
                      ) : (
                        <TrendingDown className="h-3 w-3 mr-0.5" />
                      )}
                      {position.side[0]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right py-2">
                    <div className="text-sm font-mono">
                      {formatQuantity(position.symbol, position.quantity)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      ${position.margin.toFixed(2)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-2">
                    <div className="text-sm font-mono">
                      ${formatPriceWithCommas(position.symbol, position.entryPrice)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      ${formatPriceWithCommas(position.symbol, position.markPrice)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-2">
                    {position.liquidationPrice && position.liquidationPrice > 0 ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="flex items-center gap-1">
                                {(() => {
                                  const distancePercent = position.side === 'LONG'
                                    ? ((position.markPrice - position.liquidationPrice) / position.markPrice) * 100
                                    : ((position.liquidationPrice - position.markPrice) / position.markPrice) * 100;
                                  const isNearLiquidation = distancePercent < 20;
                                  const isCritical = distancePercent < 10;

                                  return (
                                    <>
                                      {(isNearLiquidation || isCritical) && (
                                        <AlertTriangle className={`h-3 w-3 ${isCritical ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'}`} />
                                      )}
                                      <span className={`text-sm font-mono ${isCritical ? 'text-red-600 dark:text-red-400' : isNearLiquidation ? 'text-orange-600 dark:text-orange-400' : ''}`}>
                                        ${formatPriceWithCommas(position.symbol, position.liquidationPrice)}
                                      </span>
                                    </>
                                  );
                                })()}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {(() => {
                                  const distancePercent = position.side === 'LONG'
                                    ? ((position.markPrice - position.liquidationPrice) / position.markPrice) * 100
                                    : ((position.liquidationPrice - position.markPrice) / position.markPrice) * 100;
                                  return `${distancePercent.toFixed(1)}% away`;
                                })()}
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs space-y-1">
                              <p>Liquidation Price: ${formatPrice(position.symbol, position.liquidationPrice)}</p>
                              <p className="text-muted-foreground">
                                {position.side === 'LONG'
                                  ? 'Position liquidates if price drops below this level'
                                  : 'Position liquidates if price rises above this level'}
                              </p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right py-2">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={`text-sm font-semibold ${position.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {position.pnl >= 0 ? '+' : ''}${Math.abs(position.pnl).toFixed(2)}
                      </span>
                      <Badge
                        variant={position.pnl >= 0 ? "outline" : "destructive"}
                        className={`h-3.5 text-[9px] px-1 ${position.pnl >= 0 ? 'border-green-600 text-green-600 dark:border-green-400 dark:text-green-400' : ''}`}
                      >
                        {position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(1)}%
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-center py-2">
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="flex items-center gap-0.5">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex gap-0.5">
                                {position.hasStopLoss ? (
                                  <Badge variant="outline" className="h-5 w-5 p-0 border-green-600">
                                    <Shield className="h-3 w-3 text-green-600" />
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="h-5 w-5 p-0">
                                    <Shield className="h-3 w-3 text-muted-foreground" />
                                  </Badge>
                                )}
                                {position.hasTakeProfit ? (
                                  <Badge variant="outline" className="h-5 w-5 p-0 border-blue-600">
                                    <Target className="h-3 w-3 text-blue-600" />
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="h-5 w-5 p-0">
                                    <Target className="h-3 w-3 text-muted-foreground" />
                                  </Badge>
                                )}
                                {hasVwapProtection && vwap ? (
                                  <Badge
                                    variant="outline"
                                    className={`h-5 w-5 p-0 ${
                                      (position.side === 'LONG' && vwap.position === 'below') ||
                                      (position.side === 'SHORT' && vwap.position === 'above')
                                        ? 'border-green-600'
                                        : 'border-orange-600'
                                    }`}
                                  >
                                    <BarChart3
                                      className={`h-3 w-3 ${
                                        (position.side === 'LONG' && vwap.position === 'below') ||
                                        (position.side === 'SHORT' && vwap.position === 'above')
                                          ? 'text-green-600'
                                          : 'text-orange-600'
                                      }`}
                                    />
                                  </Badge>
                                ) : hasVwapProtection ? (
                                  <Badge variant="outline" className="h-5 w-5 p-0">
                                    <BarChart3 className="h-3 w-3 text-muted-foreground animate-pulse" />
                                  </Badge>
                                ) : null}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs space-y-1">
                                <p>Stop Loss: {position.hasStopLoss ? '✅ Active' : '❌ Inactive'}</p>
                                <p>Take Profit: {position.hasTakeProfit ? '✅ Active' : '❌ Inactive'}</p>
                                {hasVwapProtection && vwap && (
                                  <>
                                    <p>VWAP: ${formatPrice(position.symbol, vwap.value)}</p>
                                    <p className="text-muted-foreground">
                                      {position.side === 'LONG' && vwap.position === 'below' && '✅ Long below VWAP (Good)'}
                                      {position.side === 'LONG' && vwap.position === 'above' && '⚠️ Long above VWAP (Risky)'}
                                      {position.side === 'SHORT' && vwap.position === 'above' && '✅ Short above VWAP (Good)'}
                                      {position.side === 'SHORT' && vwap.position === 'below' && '⚠️ Short below VWAP (Risky)'}
                                    </p>
                                  </>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      {hasVwapProtection && vwap && (
                        <div className="text-[9px] text-muted-foreground font-mono">
                          V:${formatPrice(position.symbol, vwap.value)}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center py-2">
                    <div className="flex gap-1 justify-center">
                      {(() => {
                        const key = `${position.symbol}_${position.side}`;
                        const isProtected = protectionStatus[key];
                        return (
                          <Button
                            variant={isProtected ? "default" : "outline"}
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleProtectPosition(position);
                            }}
                            className={`h-7 px-2 text-xs ${isProtected ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}
                          >
                            <Shield className="h-3 w-3 mr-1" />
                            {isProtected ? 'Scaling' : 'Scale Out'}
                          </Button>
                        );
                      })()}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClosePosition(position);
                        }}
                        className="h-7 px-2 text-xs"
                      >
                        <X className="h-3 w-3 mr-1" />
                        Close
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
              {!isLoading && displayPositions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-6">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-sm text-muted-foreground">No open positions</span>
                      <Badge variant="secondary" className="h-4 text-[10px] px-1.5">
                        Waiting for trades
                      </Badge>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}

      {/* Close Position Confirmation Modal */}
      <Dialog open={closePositionModal.isOpen} onOpenChange={cancelClosePosition}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Close Position</DialogTitle>
            <DialogDescription>
              Are you sure you want to close this position? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium">Symbol:</span>
                <span className="text-sm">{closePositionModal.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">Side:</span>
                <Badge
                  variant={closePositionModal.side === 'LONG' ? 'outline' : 'destructive'}
                  className={`text-xs ${closePositionModal.side === 'LONG' ? 'border-green-600 text-green-600' : ''}`}
                >
                  {closePositionModal.side === 'LONG' ? (
                    <TrendingUp className="h-3 w-3 mr-1" />
                  ) : (
                    <TrendingDown className="h-3 w-3 mr-1" />
                  )}
                  {closePositionModal.side}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium">Quantity:</span>
                <span className="text-sm font-mono">
                  {closePositionModal.quantity > 0 ? formatQuantity(closePositionModal.symbol, closePositionModal.quantity) : '0'}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={cancelClosePosition}
              disabled={isClosingPosition}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmClosePosition}
              disabled={isClosingPosition}
            >
              {isClosingPosition ? 'Closing...' : 'Close Position'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scale Out Modal */}
      {protectPositionModal.position && (
        <ScaleOutModal
          isOpen={protectPositionModal.isOpen}
          onClose={handleProtectCancel}
          onConfirm={handleProtectConfirm}
          position={protectPositionModal.position}
        />
      )}
    </Card>
  );
}