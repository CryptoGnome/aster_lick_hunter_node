'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useConfig } from '@/components/ConfigProvider';
import orderStore from '@/lib/services/orderStore';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCachedKlines, setCachedKlines, updateCachedKlines, getCandlesFor7Days, prependHistoricalKlines } from '@/lib/klineCache';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';

// Types
interface LiquidationData {
  time: number;
  event_time: number;
  volume: number;
  volume_usdt: number;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
}

interface GroupedLiquidation {
  timestamp: number;
  side: number; // 1 = long liquidation (red), 0 = short liquidation (blue)
  totalVolume: number;
  count: number;
  price: number;
}

interface TradingViewChartProps {
  symbol: string;
  liquidations?: LiquidationData[];
  positions?: any[];
  className?: string;
  availableSymbols?: string[];
  onSymbolChange?: (symbol: string) => void;
}

const TIMEFRAMES = [
  { value: '1m', label: '1 Min' },
  { value: '5m', label: '5 Min' },
  { value: '15m', label: '15 Min' },
  { value: '30m', label: '30 Min' },
  { value: '1h', label: '1 Hour' },
  { value: '4h', label: '4 Hours' },
  { value: '1d', label: '1 Day' },
];

const LIQUIDATION_GROUPINGS = [
  { value: '1m', label: '1 Min' },
  { value: '5m', label: '5 Min' },
  { value: '15m', label: '15 Min' },
  { value: '30m', label: '30 Min' },
  { value: '1h', label: '1 Hour' },
  { value: '2h', label: '2 Hours' },
  { value: '4h', label: '4 Hours' },
  { value: '6h', label: '6 Hours' },
  { value: '12h', label: '12 Hours' },
  { value: '1d', label: '1 Day' },
];

// Debounce utility
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Convert timeframe to seconds for liquidation grouping
function timeframeToSeconds(timeframe: string): number {
  const timeframes: Record<string, number> = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '6h': 21600,
    '8h': 28800,
    '12h': 43200,
    '1d': 86400,
    '3d': 259200,
    '1w': 604800,
    '1M': 2592000
  };
  return timeframes[timeframe] || 300; // Default to 5 minutes
}

export default function TradingViewChart({ 
  symbol, 
  liquidations = [], 
  positions = [], 
  className,
  availableSymbols = [],
  onSymbolChange 
}: TradingViewChartProps) {
  // Get config for symbol-specific VWAP settings
  const { config } = useConfig();
  
  // Chart refs
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  // Responsive chart height (550px - slightly bigger for better visibility)
  const [chartHeight, setChartHeight] = useState<number>(550);
  // Chart visibility toggle
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    function handleResize() {
      setChartHeight(550); // Fixed 550px height
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const positionLinesRef = useRef<any[]>([]);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const orderMarkersRef = useRef<any[]>([]);

  // State
  const [timeframe, setTimeframe] = useState('5m');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [klineData, setKlineData] = useState<CandlestickData[]>([]);
  const [dbLiquidations, setDbLiquidations] = useState<LiquidationData[]>([]);
  const [showLiquidations, setShowLiquidations] = useState(true);
  const [liquidationGrouping, setLiquidationGrouping] = useState('5m');
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [showVWAP, setShowVWAP] = useState(false);
  const [showRecentOrders, setShowRecentOrders] = useState(false);
  const [showPositions, setShowPositions] = useState(true); // Show TP/SL lines
  const [magnetMode, setMagnetMode] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30); // Default 30 seconds
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingHistorical, setIsLoadingHistorical] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const isInitialLoadRef = useRef(true);
  
  // Refs to store refresh functions for auto-refresh
  const fetchKlineDataRef = useRef<(force?: boolean) => Promise<void>>();
  const fetchLiquidationDataRef = useRef<() => Promise<void>>();
  const fetchOpenOrdersRef = useRef<() => Promise<void>>();
  const isLoadingHistoricalRef = useRef(false);
  const loadHistoricalDataRef = useRef<() => Promise<void>>();

  // Combine props liquidations with database liquidations
  const allLiquidations = useMemo(() => 
    [...liquidations, ...dbLiquidations], 
    [liquidations, dbLiquidations]
  );

  // Group liquidations by time for marker display
  const groupLiquidationsByTime = useCallback((liquidations: LiquidationData[], timeframeStr: string): GroupedLiquidation[] => {
    const groups: Record<string, GroupedLiquidation> = {};
    const periodSeconds = timeframeToSeconds(timeframeStr);

    // Sort liquidations by time first (don't modify original array)
    const sortedLiquidations = [...liquidations].sort((a, b) => a.event_time - b.event_time);

    sortedLiquidations.forEach(liq => {
      const timestamp = liq.event_time; // Already in milliseconds
      const timestampSeconds = Math.floor(timestamp / 1000); // Convert to seconds
      const periodStart = Math.floor(timestampSeconds / periodSeconds) * periodSeconds;
      
      // SHOW ON LAST CANDLE: Add period duration to show at END of period
      const periodEnd = periodStart + periodSeconds;
      
      // Map database sides: 'SELL' = long liquidation (red), 'BUY' = short liquidation (blue)
      const side = liq.side === 'SELL' ? 1 : 0;
      const key = `${periodStart}_${side}`;

      if (!groups[key]) {
        groups[key] = {
          timestamp: periodEnd * 1000, // Use END of period (last candle)
          side,
          totalVolume: 0,
          count: 0,
          price: 0
        };
      }

      groups[key].totalVolume += liq.volume_usdt;
      groups[key].count += 1;
      groups[key].price = (groups[key].price * (groups[key].count - 1) + liq.price) / groups[key].count;
    });

    // Sort the grouped results by timestamp to ensure proper ordering
    return Object.values(groups).sort((a, b) => a.timestamp - b.timestamp);
  }, []);

  // Get color by volume and side
  const getColorByVolume = useCallback((volume: number, side: number): string => {
    if (side === 1) { // Long liquidations (red spectrum)
      return volume > 1000000 ? '#ff1744' :    // >$1M: Bright red
             volume > 100000  ? '#ff5722' :    // >$100K: Orange-red  
             '#ff9800';                        // <$100K: Orange
    } else { // Short liquidations (blue spectrum)
      return volume > 1000000 ? '#1976d2' :    // >$1M: Dark blue
             volume > 100000  ? '#2196f3' :    // >$100K: Medium blue
             '#64b5f6';                        // <$100K: Light blue
    }
  }, []);

  // Get size by volume
  const getSizeByVolume = useCallback((volume: number): number => {
    return volume > 1000000 ? 2 :    // >$1M: Large
           volume > 100000  ? 1 :    // >$100K: Medium
           0;                        // <$100K: Small
  }, []);

  // Update position indicators
  const updatePositionIndicators = useCallback((positions: any[], orders: any[]) => {
    if (!candlestickSeriesRef.current) {
      return;
    }

    // Clear existing position lines
    positionLinesRef.current.forEach(line => {
      try {
        candlestickSeriesRef.current?.removePriceLine(line);
      } catch (_e) {
        // Ignore errors from already removed lines
      }
    });
    positionLinesRef.current = [];

    // Don't show position lines if toggle is off
    if (!showPositions) {
      return;
    }

    // Filter positions for current symbol
    const symbolPositions = positions.filter(pos => pos.symbol === symbol);

    symbolPositions.forEach(position => {
      try {
        const entryPrice = parseFloat(position.entryPrice || position.markPrice || position.avgPrice || '0');
        const quantity = parseFloat(position.quantity || position.positionAmt || position.size || '0');
        const side = position.side; // "LONG" or "SHORT"
        const positionAmt = side === 'SHORT' ? -quantity : quantity; // Convert to signed amount
        const unrealizedPnl = parseFloat(position.unrealizedProfit || position.pnl || '0');
        const liquidationPrice = parseFloat(position.liquidationPrice || '0');
        
        if (entryPrice > 0 && Math.abs(positionAmt) > 0) {
          const isLong = positionAmt > 0;
          
          // Entry price line - using different approach
          const entryLine = candlestickSeriesRef.current!.createPriceLine({
            price: entryPrice,
            color: isLong ? '#26a69a' : '#ef5350',
            lineWidth: 2,
            lineStyle: 0, // Solid line
            axisLabelVisible: true,
            title: `${isLong ? 'LONG' : 'SHORT'} Entry: ${entryPrice}`,
          });
          positionLinesRef.current.push(entryLine);

          // Liquidation price line (if available)
          if (liquidationPrice > 0) {
            const liqLine = candlestickSeriesRef.current!.createPriceLine({
              price: liquidationPrice,
              color: '#ff1744', // Bright red for liquidation
              lineWidth: 1,
              lineStyle: 1, // Dashed line
              axisLabelVisible: true,
              title: `Liquidation: ${liquidationPrice}`,
            });
            positionLinesRef.current.push(liqLine);
          }
        }
      } catch (error) {
        console.error('[TradingViewChart] Error adding position line:', error);
      }
    });

    // Find and process open orders for current symbol
    const symbolOrders = orders.filter(order => order.symbol === symbol);

    symbolOrders.forEach(order => {
      try {
        const orderPrice = parseFloat(order.stopPrice || order.price || '0');
        
        if (orderPrice > 0) {
          const isTP = order.type.includes('TAKE_PROFIT');
          const isSL = order.type.includes('STOP') && !isTP;
          
          let color = '#ffa726'; // Default orange
          let title = `Order: ${orderPrice}`;
          
          if (isTP) {
            color = '#4caf50'; // Green for TP
            title = `TP: ${orderPrice}`;
          } else if (isSL) {
            color = '#f44336'; // Red for SL
            title = `SL: ${orderPrice}`;
          }

          const orderLine = candlestickSeriesRef.current!.createPriceLine({
            price: orderPrice,
            color,
            lineWidth: 1,
            lineStyle: 2, // Dotted line
            axisLabelVisible: true,
            title,
          });
          positionLinesRef.current.push(orderLine);
        }
      } catch (error) {
        console.error('[TradingViewChart] Error adding order line:', error);
      }
    });
  }, [symbol, showPositions]);

  // Debounced position updates
  const debouncedUpdatePositions = useCallback(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    debounce((positions: any[], orders: any[]) => {
      updatePositionIndicators(positions, orders);
    }, 250),
    [updatePositionIndicators]
  );

  // Load historical data when scrolling back in time
  const loadHistoricalData = useCallback(async () => {
    if (!symbol || !timeframe || isLoadingHistoricalRef.current) return;

    const cached = getCachedKlines(symbol, timeframe);
    if (!cached) return;

    isLoadingHistoricalRef.current = true;
    setIsLoadingHistorical(true);

    try {
      // Fetch candles before the earliest loaded candle
      const endTime = cached.earliestCandleTime - 1;
      const response = await fetch(`/api/klines?symbol=${symbol}&interval=${timeframe}&endTime=${endTime}&limit=500`);
      const result = await response.json();

      if (result.success && result.data.length > 0) {
        // Prepend historical data to cache
        const updated = prependHistoricalKlines(symbol, timeframe, result.data);
        
        if (updated) {
          // Transform and update chart data
          const transformedData: CandlestickData[] = updated.data.map((kline: any[]) => {
            const timestamp = typeof kline[0] === 'number' ? kline[0] : parseInt(kline[0]);
            return {
              time: timestamp as Time,
              open: parseFloat(kline[1]),
              high: parseFloat(kline[2]),
              low: parseFloat(kline[3]),
              close: parseFloat(kline[4])
            };
          });
          
          transformedData.sort((a, b) => (a.time as number) - (b.time as number));
          setKlineData(transformedData);
          
          console.log(`[TradingViewChart] Loaded ${result.data.length} historical candles`);
        }
      }
    } catch (error) {
      console.error('[TradingViewChart] Error loading historical data:', error);
    } finally {
      setIsLoadingHistorical(false);
      isLoadingHistoricalRef.current = false;
    }
  }, [symbol, timeframe]);
  
  // Store function ref
  loadHistoricalDataRef.current = loadHistoricalData;

  // Fetch liquidation data from database
  const fetchLiquidationData = useCallback(async () => {
    if (!symbol) return;

    try {
      const response = await fetch(`/api/liquidations?symbol=${symbol}&limit=2000`);
      const result = await response.json();

      if (result.success && result.data) {
        const transformedLiquidations: LiquidationData[] = result.data.map((liq: any) => ({
          time: liq.event_time,
          event_time: liq.event_time,
          volume: liq.volume_usdt,
          volume_usdt: liq.volume_usdt,
          side: liq.side,
          price: liq.price,
          quantity: liq.quantity
        }));
        
        // Only update if data has changed (check length and latest timestamp)
        setDbLiquidations(prev => {
          if (prev.length === transformedLiquidations.length && 
              prev.length > 0 && transformedLiquidations.length > 0 &&
              prev[prev.length - 1]?.event_time === transformedLiquidations[transformedLiquidations.length - 1]?.event_time) {
            return prev; // No change
          }
          return transformedLiquidations;
        });
      }
    } catch (error) {
      console.error('Error fetching liquidation data:', error);
    }
  }, [symbol]);
  
  fetchLiquidationDataRef.current = fetchLiquidationData;

  // Fetch open orders for TP/SL display
  const fetchOpenOrders = useCallback(async () => {
    if (!symbol) return;

    try {
      const response = await fetch('/api/orders');
      const result = await response.json();

      if (Array.isArray(result)) {
        // Filter orders for current symbol
        const symbolOrders = result.filter((order: any) => order.symbol === symbol);
        
        // Only update if data has changed (check length and order IDs)
        setOpenOrders(prev => {
          if (prev.length === symbolOrders.length && prev.length > 0 && symbolOrders.length > 0) {
            const prevIds = prev.map(o => o.orderId).sort().join(',');
            const newIds = symbolOrders.map(o => o.orderId).sort().join(',');
            if (prevIds === newIds) {
              return prev; // No change
            }
          }
          return symbolOrders;
        });
      }
    } catch (error) {
      console.error('Error fetching open orders:', error);
    }
  }, [symbol]);
  
  fetchOpenOrdersRef.current = fetchOpenOrders;

  // Fetch kline data with caching
  const fetchKlineData = useCallback(async (force = false) => {
    if (!symbol || !timeframe) return;

    if (force) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      // When forcing refresh, only fetch the latest candles (much more efficient)
      if (force) {
        const cached = getCachedKlines(symbol, timeframe);
        
        if (cached) {
          // We have cached data - only fetch latest 2 candles to update
          const lastCachedTime = cached.lastCandleTime || cached.data[cached.data.length - 1][0];
          
          // Fetch just the latest 2 candles (current incomplete + most recent complete)
          const response = await fetch(`/api/klines?symbol=${symbol}&interval=${timeframe}&since=${lastCachedTime}&limit=2`);
          const result = await response.json();

          if (result.success && result.data.length > 0) {
            // Update cache with just the new candles
            const updated = updateCachedKlines(symbol, timeframe, result.data);
            
            if (updated) {
              // Update chart with merged data
              const transformedData: CandlestickData[] = updated.data.map((kline: any[]) => {
                const timestamp = typeof kline[0] === 'number' ? kline[0] : parseInt(kline[0]);
                return {
                  time: timestamp as Time,
                  open: parseFloat(kline[1]),
                  high: parseFloat(kline[2]),
                  low: parseFloat(kline[3]),
                  close: parseFloat(kline[4])
                };
              });
              
              transformedData.sort((a, b) => (a.time as number) - (b.time as number));
              
              // Only update if data has actually changed
              setKlineData(prev => {
                if (prev.length === transformedData.length && 
                    prev[prev.length - 1]?.close === transformedData[transformedData.length - 1]?.close) {
                  return prev; // No change
                }
                return transformedData;
              });
            }
          }
        } else {
          // No cache - do a full initial fetch
          const since = Date.now() - (7 * 24 * 60 * 60 * 1000);
          const response = await fetch(`/api/klines?symbol=${symbol}&interval=${timeframe}&since=${since}&limit=500`);
          const result = await response.json();

          if (result.success && result.data.length > 0) {
            const transformedData: CandlestickData[] = result.data.map((kline: any[]) => {
              const timestamp = typeof kline[0] === 'number' ? kline[0] : parseInt(kline[0]);
              return {
                time: timestamp as Time,
                open: parseFloat(kline[1]),
                high: parseFloat(kline[2]),
                low: parseFloat(kline[3]),
                close: parseFloat(kline[4])
              };
            });
            
            transformedData.sort((a, b) => (a.time as number) - (b.time as number));
            setKlineData(transformedData);
            
            // Cache the data
            setCachedKlines(symbol, timeframe, result.data);
          }
        }
        
        setIsRefreshing(false);
        setLastUpdate(new Date());
        return;
      }

      // Check cache first for normal loads
      const cached = getCachedKlines(symbol, timeframe);
      
      if (cached) {
        // Use cached data immediately
        const transformedData: CandlestickData[] = cached.data.map((kline: any[]) => {
          const timestamp = typeof kline[0] === 'number' ? kline[0] : parseInt(kline[0]);
          return {
            time: timestamp as Time,
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4])
          };
        });

        // Sort data by time (TradingView requires chronological order)
        transformedData.sort((a, b) => (a.time as number) - (b.time as number));
        setKlineData(transformedData);
        
        // Check if we need to fetch recent updates (cache older than 2 minutes)
        const cacheAge = Date.now() - cached.lastUpdate;
        const needsUpdate = cacheAge > 2 * 60 * 1000; // 2 minutes
        
        if (!needsUpdate) {
          setLoading(false);
          return;
        }
        
        // Fetch only recent candles since last cache update
        try {
          const updateResponse = await fetch(`/api/klines?symbol=${symbol}&interval=${timeframe}&since=${cached.lastCandleTime}&limit=100`);
          const updateResult = await updateResponse.json();
          
          if (updateResult.success && updateResult.data.length > 0) {
            // Update cache with new data
            const updated = updateCachedKlines(symbol, timeframe, updateResult.data);
            
            if (updated) {
              // Update chart with merged data
              const updatedTransformed: CandlestickData[] = updated.data.map((kline: any[]) => {
                const timestamp = typeof kline[0] === 'number' ? kline[0] : parseInt(kline[0]);
                return {
                  time: timestamp as Time,
                  open: parseFloat(kline[1]),
                  high: parseFloat(kline[2]),
                  low: parseFloat(kline[3]),
                  close: parseFloat(kline[4])
                };
              });
              
              updatedTransformed.sort((a, b) => (a.time as number) - (b.time as number));
              setKlineData(updatedTransformed);
            }
          }
        } catch (updateError) {
          console.warn('[TradingViewChart] Failed to fetch updates, using cached data:', updateError);
        }
        
        setLoading(false);
        return;
      }

      // No cache available, fetch full 7-day history
      const sevenDayLimit = getCandlesFor7Days(timeframe);
      
      const response = await fetch(`/api/klines?symbol=${symbol}&interval=${timeframe}&limit=${sevenDayLimit}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch kline data');
      }

      // Transform API response to lightweight-charts format
      const transformedData: CandlestickData[] = result.data.map((kline: any[]) => {
        const timestamp = typeof kline[0] === 'number' ? kline[0] : parseInt(kline[0]);
        return {
          time: timestamp as Time,
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4])
        };
      });
      
      // Sort data by time (TradingView requires chronological order)
      transformedData.sort((a, b) => (a.time as number) - (b.time as number));

      // Cache the data
      setCachedKlines(symbol, timeframe, result.data);
      
      setKlineData(transformedData);
    } catch (error) {
      console.error('[TradingViewChart] Error fetching kline data:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch chart data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setLastUpdate(new Date());
    }
  }, [symbol, timeframe]);
  
  // Store function refs for auto-refresh
  fetchKlineDataRef.current = fetchKlineData;

  // Initialize chart
  useEffect(() => {
    // Don't initialize chart if still loading or there's an error or chart is hidden
    if (loading || error || !isVisible) {
      return;
    }
    
    if (!chartContainerRef.current) {
      return;
    }

    const containerWidth = chartContainerRef.current.clientWidth;
    
    try {
      const chart = createChart(chartContainerRef.current, {
        autoSize: true,
        layout: {
          textColor: 'white',
          background: { color: '#1a1a1a' },
        },
        grid: {
          vertLines: { color: 'rgba(197, 203, 206, 0.1)' },
          horzLines: { color: 'rgba(197, 203, 206, 0.1)' },
        },
        crosshair: {
          mode: magnetMode ? 1 : 0, // 0 = normal, 1 = magnet to data points
        },
        rightPriceScale: {
          borderColor: 'rgba(197, 203, 206, 0.5)',
        },
        timeScale: {
          borderColor: 'rgba(197, 203, 206, 0.5)',
          timeVisible: true,
          secondsVisible: false,
        },
      });

      const candlestickSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });

      chartRef.current = chart;
      candlestickSeriesRef.current = candlestickSeries;

      // Track user interactions (scrolling, zooming)
      const handleVisibleLogicalRangeChange = debounce((newRange: any) => {
        if (!newRange) return;
        
        // Mark that user has interacted if this wasn't triggered by initial load
        if (!isInitialLoadRef.current) {
          setHasUserInteracted(true);
        }
        
        // Check if we're approaching the beginning of loaded data
        const firstVisibleBar = Math.floor(newRange.from);
        if (firstVisibleBar < 20 && !loading && loadHistoricalDataRef.current) {
          // User is getting close to the oldest loaded data
          loadHistoricalDataRef.current();
        }
      }, 500);

      chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
    } catch (error) {
      console.error(`[TradingViewChart] Error creating chart:`, error);
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candlestickSeriesRef.current = null;
      }
    };
  }, [loading, error, isVisible, chartHeight]); // Re-initialize when loading/error/visibility states change

  // Fetch data when symbol or timeframe changes
  useEffect(() => {
    if (symbol && timeframe && isVisible) {
      // Reset interaction state for new symbol/timeframe
      setHasUserInteracted(false);
      isInitialLoadRef.current = true;
      
      fetchKlineData();
      fetchLiquidationData();
      fetchOpenOrders();
    }
  }, [symbol, timeframe, isVisible, fetchKlineData, fetchLiquidationData, fetchOpenOrders]);

  // Auto-refresh effect - refreshes at configured interval when enabled
  useEffect(() => {
    if (!autoRefresh || !isVisible || !symbol || !timeframe) {
      return;
    }

    const intervalMs = refreshInterval * 1000;
    const interval = setInterval(() => {
      console.log(`[TradingViewChart] Auto-refresh triggered (${refreshInterval}s interval)`);
      // Use refs to avoid dependency issues
      if (fetchKlineDataRef.current) fetchKlineDataRef.current(true);
      if (fetchLiquidationDataRef.current) fetchLiquidationDataRef.current();
      if (fetchOpenOrdersRef.current) fetchOpenOrdersRef.current();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [autoRefresh, isVisible, symbol, timeframe, refreshInterval]);

  // Update crosshair mode when magnetMode changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        crosshair: {
          mode: magnetMode ? 1 : 0, // 0 = normal, 1 = magnet to data points
        },
      });
    }
  }, [magnetMode]);

  // Update chart data when klineData changes
  useEffect(() => {
    if (candlestickSeriesRef.current && klineData.length > 0) {
      candlestickSeriesRef.current.setData(klineData);
      
      // Only set visible range on initial load or if user hasn't interacted
      if (chartRef.current && klineData.length > 0 && !hasUserInteracted) {
        const totalBars = klineData.length;
        
        // Calculate how many bars to show (e.g., show 60 bars = 1 hour of 1m candles)
        // Adjust this number based on your preference
        const barsToShow = Math.min(60, totalBars); // Show up to 60 bars
        
        // The most recent bar is at index (totalBars - 1)
        // We want it at 2/3 of the visible area, so we need to show more bars on the right
        const lastBarIndex = totalBars - 1;
        const firstBarIndex = Math.max(0, lastBarIndex - barsToShow);
        
        // Add empty space on the right (1/3 of visible area means adding half of barsToShow)
        const rightPadding = Math.floor(barsToShow / 2);
        
        chartRef.current.timeScale().setVisibleLogicalRange({
          from: firstBarIndex,
          to: lastBarIndex + rightPadding,
        });
        
        // Mark that initial load is complete
        isInitialLoadRef.current = false;
      }
    }
  }, [klineData, hasUserInteracted]);

  // Update position indicators when positions change or toggle changes
  useEffect(() => {
    if (showPositions && positions.length > 0) {
      debouncedUpdatePositions(positions, openOrders);
    } else if (!showPositions) {
      // Clear lines when toggle is off
      positionLinesRef.current.forEach(line => {
        try {
          candlestickSeriesRef.current?.removePriceLine(line);
        } catch (_e) {
          // Ignore errors
        }
      });
      positionLinesRef.current = [];
    }
  }, [positions, openOrders, showPositions, debouncedUpdatePositions]);

  // --- Recent orders overlay logic ---
  // Use filled orders from orderStore (same as RecentOrdersTable)
  const [filledOrders, setFilledOrders] = React.useState<any[]>([]);
  useEffect(() => {
    const loadOrders = async () => {
      // Only load if toggle is enabled
      if (!showRecentOrders) {
        setFilledOrders([]);
        return;
      }
      
      // Get ALL orders from store data, then filter locally for this symbol
      const allOrders = orderStore.getOrders().data;
      const symbolFilledOrders = allOrders.filter((order: any) => 
        order.status === 'FILLED' && order.symbol === symbol
      );
      setFilledOrders(symbolFilledOrders);
    };
    
    loadOrders();
    
    // Listen for updates
    const handleUpdate = () => {
      if (!showRecentOrders) return; // Don't update if toggle is off
      // Get ALL orders from store data, then filter locally for this symbol
      const allOrders = orderStore.getOrders().data;
      const symbolFilledOrders = allOrders.filter((order: any) => 
        order.status === 'FILLED' && order.symbol === symbol
      );
      setFilledOrders(symbolFilledOrders);
    };
    orderStore.on('orders:updated', handleUpdate);
    orderStore.on('orders:filtered', handleUpdate);
    return () => {
      orderStore.off('orders:updated', handleUpdate);
      orderStore.off('orders:filtered', handleUpdate);
    };
  }, [symbol, showRecentOrders]);

  // Combine all overlays into one marker array
  React.useEffect(() => {
    if (!candlestickSeriesRef.current) return;
    let markers: any[] = [];
    // Add liquidation markers if enabled
    if (showLiquidations && allLiquidations.length > 0) {
      const groupedLiquidations = groupLiquidationsByTime(allLiquidations, liquidationGrouping);
      const liqMarkers = groupedLiquidations.map(group => ({
        time: Math.floor(group.timestamp / 1000) as Time,
        position: 'belowBar',
        color: getColorByVolume(group.totalVolume, group.side),
        shape: 'circle',
        size: getSizeByVolume(group.totalVolume),
        text: `${group.count}${group.side === 1 ? 'L' : 'S'} $${group.totalVolume >= 1000 ? (group.totalVolume/1000).toFixed(0) + 'K' : group.totalVolume.toFixed(0)}`,
        id: `liq_${group.timestamp}_${group.side}`
      }));
      markers = markers.concat(liqMarkers);
    }
    // Add recent order markers if enabled
    if (showRecentOrders && filledOrders.length > 0) {
      const seenOrderIds = new Set();
      const orderMarkers = filledOrders.map((order: any) => {
        if (!order.orderId || seenOrderIds.has(order.orderId)) return null;
        seenOrderIds.add(order.orderId);
        const orderTime = Number(order.updateTime || order.time || order.transactTime);
        let candle = klineData.find(k => typeof k.time === 'number' && Math.abs((k.time * 1000) - orderTime) < 60 * 1000);
        if (!candle && klineData.length > 0) {
          candle = klineData.reduce((closest, k) => {
            return Math.abs((k.time as number * 1000) - orderTime) < Math.abs((closest.time as number * 1000) - orderTime) ? k : closest;
          }, klineData[0]);
        }
        if (!candle) return null;
        
        // Determine order characteristics
        const isBuy = order.side === 'BUY';
        const isReduceOnly = order.reduceOnly === true || order.reduceOnly === 'true';
        const realizedPnl = order.realizedProfit ? parseFloat(order.realizedProfit) : 0;
        
        // Determine position type based on side and reduce flag
        let positionType = '';
        if (isReduceOnly) {
          // Reduce order - exiting position
          positionType = isBuy ? 'Close SHORT' : 'Close LONG';
        } else {
          // Opening order
          positionType = isBuy ? 'LONG' : 'SHORT';
        }
        
        // Determine color and shape
        let color: string;
        let shape: 'arrowUp' | 'arrowDown' | 'circle';
        let position: 'aboveBar' | 'belowBar';
        
        if (isReduceOnly) {
          // Exit orders - show profit/loss color
          if (realizedPnl > 0) {
            color = '#4caf50'; // Green for profit
            shape = 'arrowDown';
            position = isBuy ? 'aboveBar' : 'belowBar';
          } else if (realizedPnl < 0) {
            color = '#f44336'; // Red for loss
            shape = 'arrowDown';
            position = isBuy ? 'aboveBar' : 'belowBar';
          } else {
            color = '#9e9e9e'; // Gray for breakeven
            shape = 'arrowDown';
            position = isBuy ? 'aboveBar' : 'belowBar';
          }
        } else {
          // Entry orders
          if (isBuy) {
            color = '#26a69a'; // Teal for LONG
            shape = 'arrowUp';
            position = 'belowBar';
          } else {
            color = '#ef5350'; // Red for SHORT
            shape = 'arrowDown';
            position = 'aboveBar';
          }
        }
        
        // Build text label with quantity
        const qty = order.executedQty || order.origQty || '0';
        const price = order.avgPrice || order.price || order.stopPrice || '';
        
        let text = '';
        if (isReduceOnly) {
          // Exit order - show close info with P&L
          if (realizedPnl !== 0) {
            const pnlSign = realizedPnl > 0 ? '+' : '';
            text = `${positionType}\n${qty} @ ${price}\n${pnlSign}$${realizedPnl.toFixed(2)}`;
          } else {
            text = `${positionType}\n${qty} @ ${price}`;
          }
        } else {
          // Entry order - show position type and size
          text = `${positionType}\n${qty} @ ${price}`;
        }
        
        return {
          time: candle.time,
          position,
          color,
          shape,
          size: 2,
          text,
          id: `order_${order.orderId}`,
          type: 'order'
        };
      }).filter(Boolean);
      markers = markers.concat(orderMarkers);
    }
    // Sort all markers by time in ascending order (required by lightweight-charts)
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    
    // Always update markers when dependencies change (don't use complex comparison)
    candlestickSeriesRef.current.setMarkers(markers);
  }, [showLiquidations, allLiquidations, liquidationGrouping, showRecentOrders, filledOrders, klineData]);

  // --- VWAP overlay logic ---
  React.useEffect(() => {
    if (!showVWAP) {
      if (vwapSeriesRef.current && chartRef.current) {
        chartRef.current.removeSeries(vwapSeriesRef.current);
        vwapSeriesRef.current = null;
      }
      return;
    }
    if (!chartRef.current || !symbol) {
      return;
    }
    
    // Get VWAP settings from symbol config (use hunter's settings, not chart timeframe)
    const symbolConfig = config?.symbols?.[symbol];
    const vwapTimeframe = symbolConfig?.vwapTimeframe || '5m';
    // Fetch extended VWAP history (1500 candles - API max) for charting, even if config uses smaller lookback
    // This allows users to see VWAP history while hunter still uses configured lookback for trading
    const vwapFetchLimit = 1500;
    
    // Helper to convert timeframe string to milliseconds
    const timeframeToMs = (tf: string): number => {
      const match = tf.match(/^(\d+)(m|h|d)$/);
      if (!match) return 60000; // default 1m
      const [, num, unit] = match;
      const n = parseInt(num, 10);
      switch (unit) {
        case 'm': return n * 60 * 1000;
        case 'h': return n * 60 * 60 * 1000;
        case 'd': return n * 24 * 60 * 60 * 1000;
        default: return 60000;
      }
    };
    
    // Downsample VWAP data to match chart timeframe
    const downsampleVWAP = (data: Array<{time: number, value: number}>, chartTf: string, vwapTf: string): Array<{time: number, value: number}> => {
      const chartMs = timeframeToMs(chartTf);
      const vwapMs = timeframeToMs(vwapTf);
      
      // If chart timeframe is same or smaller than VWAP timeframe, no downsampling needed
      if (chartMs <= vwapMs) {
        return data;
      }
      
      // Calculate how many VWAP candles fit in one chart candle
      const ratio = chartMs / vwapMs;
      
      // For non-integer ratios (like 30m/5m = 6), use floor
      const step = Math.max(1, Math.floor(ratio));
      
      // Take every nth point to match chart density
      const result: Array<{time: number, value: number}> = [];
      for (let i = 0; i < data.length; i += step) {
        result.push(data[i]);
      }
      
      // Always include the last point for current VWAP value
      if (data.length > 0 && (data.length - 1) % step !== 0) {
        result.push(data[data.length - 1]);
      }
      
      return result;
    };
    
    // Fetch historical VWAP from API
    const fetchVWAP = async () => {
      try {
        // Use the symbol's configured VWAP timeframe but fetch extended history for charting
        const vwapResp = await fetch(`/api/vwap/historical?symbol=${symbol}&timeframe=${vwapTimeframe}&limit=${vwapFetchLimit}`);
        const vwapData = await vwapResp.json();
        
        if (vwapData && vwapData.data && vwapData.data.length > 0) {
          // Remove previous VWAP series if any
          if (vwapSeriesRef.current && chartRef.current) {
            chartRef.current.removeSeries(vwapSeriesRef.current);
            vwapSeriesRef.current = null;
          }
          
          // Create VWAP line series
          vwapSeriesRef.current = chartRef.current.addLineSeries({
            color: '#ffa500',
            lineWidth: 1,
            title: `VWAP (${vwapTimeframe})`,
            priceLineVisible: false,
            lastValueVisible: true,
          });
          
          // Downsample VWAP data to match chart timeframe density
          const downsampledData = downsampleVWAP(vwapData.data, timeframe, vwapTimeframe);
          
          // Set VWAP data
          vwapSeriesRef.current.setData(downsampledData);
        } else {
          console.warn('[TradingViewChart] No VWAP data returned for', symbol, vwapTimeframe, vwapData);
        }
      } catch (err) {
        console.warn('[TradingViewChart] VWAP fetch error', err);
      }
    };
    
    fetchVWAP();
    
    // Optionally, poll for updates every 30s (VWAP changes slowly)
    const interval = setInterval(fetchVWAP, 30000);
    
    return () => {
      clearInterval(interval);
      if (vwapSeriesRef.current) {
        try {
          if (chartRef.current) {
            chartRef.current.removeSeries(vwapSeriesRef.current);
          }
        } catch (err) {
          // Chart may have been removed already, ignore
        }
        vwapSeriesRef.current = null;
      }
    };
  }, [showVWAP, symbol, config, timeframe]);

  // Manual refresh handler
  const handleRefresh = useCallback(() => {
    console.log('[TradingViewChart] Manual refresh triggered');
    if (fetchKlineDataRef.current) fetchKlineDataRef.current(true);
    if (fetchLiquidationDataRef.current) fetchLiquidationDataRef.current();
    if (fetchOpenOrdersRef.current) fetchOpenOrdersRef.current();
  }, []);

  if (!symbol) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center h-96">
          <div className="text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-muted-foreground">Select a symbol to view chart</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        {/* Title Row */}
        <div
          onClick={() => setIsVisible(v => !v)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity w-full mb-2 cursor-pointer"
        >
          {availableSymbols.length > 0 && onSymbolChange ? (
            <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
              <SearchableSelect
                value={symbol}
                onValueChange={onSymbolChange}
                options={availableSymbols}
                placeholder="Select symbol"
                className="w-[130px] sm:w-[150px] h-7"
              />
              <span className="text-sm text-muted-foreground">Chart</span>
            </div>
          ) : (
            <CardTitle className="text-base font-medium">
              {symbol} Chart
            </CardTitle>
          )}
          <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${!isVisible ? '-rotate-90' : ''}`} />
        </div>

        {/* Controls Row */}
        {isVisible && (
          <div className="flex flex-col gap-2 pt-3 border-t">
            {/* Mobile: Stacked vertically */}
            <div className="flex flex-col gap-2 sm:hidden">
              {/* Refresh + Auto-refresh */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2.5 py-1.5 flex-1">
                  <span className="text-sm font-medium text-muted-foreground">Refresh:</span>
                  <Checkbox
                    id="auto-refresh"
                    checked={autoRefresh}
                    onCheckedChange={(checked) => setAutoRefresh(checked as boolean)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="auto-refresh" className="text-sm cursor-pointer font-medium">
                    Auto
                  </Label>
                  {autoRefresh && (
                    <Select
                      value={refreshInterval.toString()}
                      onValueChange={(value) => setRefreshInterval(parseInt(value))}
                    >
                      <SelectTrigger className="h-9 w-[100px] text-base font-medium border-2 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5s</SelectItem>
                        <SelectItem value="10">10s</SelectItem>
                        <SelectItem value="15">15s</SelectItem>
                        <SelectItem value="30">30s</SelectItem>
                        <SelectItem value="60">1m</SelectItem>
                        <SelectItem value="120">2m</SelectItem>
                        <SelectItem value="300">5m</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isRefreshing || loading}
                  className="h-9 px-3 shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                  Now
                </Button>
              </div>

              {/* Timeframe */}
              <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2.5 py-1.5">
                <Label className="text-sm text-muted-foreground font-medium min-w-[80px]">Timeframe</Label>
                <Select value={timeframe} onValueChange={setTimeframe}>
                  <SelectTrigger className="h-9 w-[100px] text-base font-medium border-2 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEFRAMES.map(tf => (
                      <SelectItem key={tf.value} value={tf.value}>
                        {tf.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Overlays */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-recent-orders"
                      checked={showRecentOrders}
                      onCheckedChange={(checked) => setShowRecentOrders(checked as boolean)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="show-recent-orders" className="text-sm cursor-pointer font-medium">
                      Orders
                    </Label>
                  </div>

                  <div className="h-4 w-px bg-border" />

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-positions"
                      checked={showPositions}
                      onCheckedChange={(checked) => setShowPositions(checked as boolean)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="show-positions" className="text-sm cursor-pointer font-medium">
                      TP/SL
                    </Label>
                  </div>

                  <div className="h-4 w-px bg-border" />

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-vwap"
                      checked={showVWAP}
                      onCheckedChange={(checked) => setShowVWAP(checked as boolean)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="show-vwap" className="text-sm cursor-pointer font-medium">
                      VWAP
                    </Label>
                  </div>
                </div>

                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2.5 py-1.5">
                  <Checkbox 
                    id="show-liquidations" 
                    checked={showLiquidations}
                    onCheckedChange={(checked) => setShowLiquidations(checked as boolean)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="show-liquidations" className="text-sm cursor-pointer font-medium min-w-[40px]">
                    Liqs
                  </Label>
                  {showLiquidations && (
                    <Select value={liquidationGrouping} onValueChange={setLiquidationGrouping}>
                      <SelectTrigger className="h-9 w-[100px] text-base font-medium border-2 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LIQUIDATION_GROUPINGS.map(group => (
                          <SelectItem key={group.value} value={group.value}>
                            {group.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Checkbox
                  id="magnet-mode"
                  checked={magnetMode}
                  onCheckedChange={(checked) => setMagnetMode(checked as boolean)}
                  className="h-4 w-4"
                />
                <Label htmlFor="magnet-mode" className="text-xs cursor-pointer">
                  Magnet
                </Label>
              </div>
            </div>

            {/* Desktop: Full width with justified layout */}
            <div className="hidden sm:flex items-center justify-between gap-4">
              {/* Left side: Refresh, Auto-refresh, Timeframe */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Refresh:</span>
                
                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2.5 py-1.5">
                  <Checkbox
                    id="auto-refresh-desktop"
                    checked={autoRefresh}
                    onCheckedChange={(checked) => setAutoRefresh(checked as boolean)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="auto-refresh-desktop" className="text-sm cursor-pointer font-medium">
                    Auto
                  </Label>
                  {autoRefresh && (
                    <Select
                      value={refreshInterval.toString()}
                      onValueChange={(value) => setRefreshInterval(parseInt(value))}
                    >
                      <SelectTrigger className="h-9 w-[100px] text-base font-medium border-2 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5s</SelectItem>
                        <SelectItem value="10">10s</SelectItem>
                        <SelectItem value="15">15s</SelectItem>
                        <SelectItem value="30">30s</SelectItem>
                        <SelectItem value="60">1m</SelectItem>
                        <SelectItem value="120">2m</SelectItem>
                        <SelectItem value="300">5m</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                
                {lastUpdate && (
                  <span className="text-[10px] text-muted-foreground">
                    {lastUpdate.toLocaleTimeString()}
                  </span>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isRefreshing || loading}
                  className="h-9 px-3"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                  Now
                </Button>

                <div className="h-4 w-px bg-border" />

                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2.5 py-1.5">
                  <Label className="text-sm text-muted-foreground font-medium">Timeframe</Label>
                  <Select value={timeframe} onValueChange={setTimeframe}>
                    <SelectTrigger className="h-9 w-[100px] text-base font-medium border-2 bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEFRAMES.map(tf => (
                        <SelectItem key={tf.value} value={tf.value}>
                          {tf.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Right side: Overlays */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Overlays:</span>
                
                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-recent-orders-desktop"
                      checked={showRecentOrders}
                      onCheckedChange={(checked) => setShowRecentOrders(checked as boolean)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="show-recent-orders-desktop" className="text-sm cursor-pointer font-medium">
                      Orders
                    </Label>
                  </div>

                  <div className="h-4 w-px bg-border" />

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-positions-desktop"
                      checked={showPositions}
                      onCheckedChange={(checked) => setShowPositions(checked as boolean)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="show-positions-desktop" className="text-sm cursor-pointer font-medium">
                      TP/SL
                    </Label>
                  </div>

                  <div className="h-4 w-px bg-border" />

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="show-vwap-desktop"
                      checked={showVWAP}
                      onCheckedChange={(checked) => setShowVWAP(checked as boolean)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="show-vwap-desktop" className="text-sm cursor-pointer font-medium">
                      VWAP
                    </Label>
                  </div>
                </div>

                <div className="h-4 w-px bg-border" />

                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2.5 py-1.5">
                  <Checkbox 
                    id="show-liquidations-desktop" 
                    checked={showLiquidations}
                    onCheckedChange={(checked) => setShowLiquidations(checked as boolean)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="show-liquidations-desktop" className="text-sm cursor-pointer font-medium min-w-[40px]">
                    Liqs
                  </Label>
                  {showLiquidations && (
                    <Select value={liquidationGrouping} onValueChange={setLiquidationGrouping}>
                      <SelectTrigger className="h-9 w-[100px] text-base font-medium border-2 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LIQUIDATION_GROUPINGS.map(group => (
                          <SelectItem key={group.value} value={group.value}>
                            {group.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardHeader>
      {isVisible && (
        <CardContent>
        {loading && (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
              <p className="text-muted-foreground">Loading chart data...</p>
            </div>
          </div>
        )}
        
        {error && (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 text-destructive" />
              <p className="text-destructive">{error}</p>
              <Button 
                variant="outline" 
                onClick={() => fetchKlineData()} 
                className="mt-2"
              >
                Retry
              </Button>
            </div>
          </div>
        )}
        
        {!loading && !error && (
          <div className="relative">
            {isLoadingHistorical && (
              <div className="absolute top-2 left-2 z-10 bg-background/90 border border-border rounded-md px-3 py-1.5 flex items-center gap-2 shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-xs text-muted-foreground">Loading history...</span>
              </div>
            )}
            <div 
              ref={chartContainerRef}
              className="w-full bg-background rounded-md border border-border"
              style={{ minHeight: chartHeight, minWidth: '300px', height: chartHeight, width: '100%' }}
            />
          </div>
        )}
        </CardContent>
      )}
    </Card>
  );
}