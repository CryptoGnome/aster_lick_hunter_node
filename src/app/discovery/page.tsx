'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DashboardLayout } from '@/components/dashboard-layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Search, 
  RefreshCw, 
  Database, 
  Clock, 
  Flame,
  ArrowUpDown,
  Plus,
  ExternalLink,
  Zap,
  Activity,
  Bitcoin,
  ChevronDown,
  ChevronRight,
  Layers
} from 'lucide-react';

interface DepthLevel {
  percentFromMid: number;
  bidLiquidity: number;
  askLiquidity: number;
  totalLiquidity: number;
}

interface DepthData {
  symbol: string;
  timestamp: number;
  midPrice: number;
  spread: number;
  spreadPercent: number;
  bestBid: number;
  bestAsk: number;
  bidAskImbalance: number;
  levels: DepthLevel[];
  totalBidLiquidity: number;
  totalAskLiquidity: number;
}

interface SymbolStats {
  symbol: string;
  liq_count: number;
  total_volume: number;
  avg_volume: number;
  max_volume: number;
  min_volume: number;
  long_liqs: number;
  short_liqs: number;
  long_volume: number;
  short_volume: number;
  whale_volume: number;
  whale_count: number;
  first_liq_time: number;
  last_liq_time: number;
  frequency_per_hour: number;
  long_ratio: number;
  whale_percent: number;
  hourly_opportunity: number;
}

interface HourlyData {
  hour: number;
  count: number;
  volume: number;
}

interface DailyData {
  day_of_week: number;
  count: number;
  volume: number;
}

interface CalendarData {
  date: string;
  day_of_week: number;
  count: number;
  volume: number;
  unique_symbols: number;
}

interface LargeLiqData {
  symbol: string;
  side: string;
  volume_usdt: number;
  price: number;
  event_time: number;
}

interface BtcVolumeDay {
  date: string;
  timestamp: number;
  volume: number;
  price: number;
  priceChange: number;
}

interface BtcVolumeData {
  days: number;
  source: string;
  dailyData: BtcVolumeDay[];
  stats: {
    avgVolume: number;
    maxVolume: number;
    minVolume: number;
    currentVolume: number;
  };
}

interface DatabaseInfo {
  totalRecords: number;
  oldestRecord: number;
  newestRecord: number;
  uniqueSymbols: number;
  dataSpanDays: number;
}

interface DiscoveryData {
  timeWindow: number;
  timeWindowLabel: string;
  totals: {
    count: number;
    volume: number;
    uniqueSymbols: number;
    longCount: number;
    shortCount: number;
    longVolume: number;
    shortVolume: number;
  };
  symbols: SymbolStats[];
  hourlyDistribution: HourlyData[];
  dailyDistribution: DailyData[];
  calendarHeatmap: CalendarData[];
  recentLargeLiqs: LargeLiqData[];
  databaseInfo: DatabaseInfo;
}

type SortField = 'liq_count' | 'total_volume' | 'avg_volume' | 'frequency_per_hour' | 'long_ratio' | 'whale_percent' | 'hourly_opportunity';
type SortDirection = 'asc' | 'desc';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Helper to format time ago
function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Calculate Pearson correlation coefficient
function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export default function DiscoveryPage() {
  const [data, setData] = useState<DiscoveryData | null>(null);
  const [btcVolume, setBtcVolume] = useState<BtcVolumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState('30d');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('total_volume');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [configuredSymbols, setConfiguredSymbols] = useState<string[]>([]);
  const [suggestionFilter, setSuggestionFilter] = useState<'all' | 'suggested' | 'low-activity' | 'configured'>('all');
  
  // Depth expansion state
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [depthData, setDepthData] = useState<DepthData | null>(null);
  const [depthLoading, setDepthLoading] = useState(false);
  const [depthError, setDepthError] = useState<string | null>(null);

  // Fetch configured symbols
  useEffect(() => {
    async function fetchConfig() {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          setConfiguredSymbols(Object.keys(config.symbols || {}));
        }
      } catch (err) {
        console.error('Failed to fetch config:', err);
      }
    }
    fetchConfig();
  }, []);

  // Fetch BTC volume data from CoinGecko
  const fetchBtcVolume = async () => {
    try {
      const response = await fetch('/api/btc-volume?days=30');
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setBtcVolume(result.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch BTC volume:', err);
    }
  };

  useEffect(() => {
    fetchBtcVolume();
  }, []);

  // Fetch discovery data
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/liquidations/discovery?timeWindow=${timeWindow}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      if (result.success) {
        setData(result.data);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [timeWindow]);

  // Fetch depth data for expanded symbol
  const fetchDepthData = async (symbol: string) => {
    setDepthLoading(true);
    setDepthError(null);
    try {
      const response = await fetch(`/api/depth/${symbol}`);
      if (!response.ok) throw new Error('Failed to fetch depth');
      const result = await response.json();
      if (result.success) {
        setDepthData(result.data);
      } else {
        throw new Error(result.error || 'Unknown error');
      }
    } catch (err) {
      setDepthError(err instanceof Error ? err.message : 'Failed to fetch depth');
    } finally {
      setDepthLoading(false);
    }
  };

  // Auto-refresh depth data every 5 seconds while expanded
  useEffect(() => {
    if (!expandedSymbol) {
      setDepthData(null);
      return;
    }
    
    // Initial fetch
    fetchDepthData(expandedSymbol);
    
    // Set up interval
    const interval = setInterval(() => {
      fetchDepthData(expandedSymbol);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [expandedSymbol]);

  // Toggle symbol expansion
  const toggleExpand = (symbol: string) => {
    setExpandedSymbol(prev => prev === symbol ? null : symbol);
  };

  // Helper to check if symbol meets recommendation criteria
  const isSymbolRecommended = (s: SymbolStats) => {
    const meetsFrequency = s.frequency_per_hour >= 0.5;
    const meetsAvgSize = s.avg_volume >= 5000;
    const meetsMinCount = s.liq_count >= 50;
    return meetsFrequency && meetsAvgSize && meetsMinCount;
  };

  // Filter and sort symbols
  const filteredSymbols = useMemo(() => {
    if (!data?.symbols) return [];
    
    let filtered = data.symbols.filter(s => 
      s.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Apply suggestion filter
    if (suggestionFilter === 'suggested') {
      filtered = filtered.filter(s => !configuredSymbols.includes(s.symbol) && isSymbolRecommended(s));
    } else if (suggestionFilter === 'low-activity') {
      filtered = filtered.filter(s => configuredSymbols.includes(s.symbol) && !isSymbolRecommended(s));
    } else if (suggestionFilter === 'configured') {
      filtered = filtered.filter(s => configuredSymbols.includes(s.symbol));
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const multiplier = sortDirection === 'desc' ? -1 : 1;
      return (aVal - bVal) * multiplier;
    });

    return filtered;
  }, [data?.symbols, searchQuery, sortField, sortDirection, suggestionFilter, configuredSymbols]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(2)}M`;
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`;
    return `$${vol.toFixed(0)}`;
  };

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toFixed(0);
  };

  const formatTime = (ts: number) => {
    if (!ts) return 'N/A';
    return new Date(ts * 1000).toLocaleString();
  };

  // Generate hourly chart bars - use useMemo and handle edge cases
  const maxHourlyCount = useMemo(() => {
    const dist = data?.hourlyDistribution;
    if (!dist || dist.length === 0) return 1;
    const counts = dist.map(h => h.count);
    return Math.max(...counts, 1);
  }, [data?.hourlyDistribution]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6" />
              Liquidation Discovery
            </h1>
            <p className="text-muted-foreground mt-1">
              Analyze liquidation patterns to discover tradeable symbols
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={timeWindow} onValueChange={setTimeWindow}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">1 Hour</SelectItem>
                <SelectItem value="6h">6 Hours</SelectItem>
                <SelectItem value="24h">24 Hours</SelectItem>
                <SelectItem value="7d">7 Days</SelectItem>
                <SelectItem value="30d">30 Days</SelectItem>
                <SelectItem value="60d">60 Days</SelectItem>
                <SelectItem value="90d">90 Days</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Flame className="h-4 w-4" />
                Total Liquidations
              </div>
              <div className="text-2xl font-bold mt-1">
                {formatNumber(data?.totals?.count || 0)}
              </div>
              <div className="text-xs text-muted-foreground">
                in {data?.timeWindowLabel || timeWindow}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <TrendingUp className="h-4 w-4" />
                Total Volume
              </div>
              <div className="text-2xl font-bold mt-1">
                {formatVolume(data?.totals?.volume || 0)}
              </div>
              <div className="text-xs text-muted-foreground">
                across all symbols
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <BarChart3 className="h-4 w-4" />
                Unique Symbols
              </div>
              <div className="text-2xl font-bold mt-1">
                {data?.totals?.uniqueSymbols || 0}
              </div>
              <div className="text-xs text-muted-foreground">
                with liquidations
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Database className="h-4 w-4" />
                Database Records
              </div>
              <div className="text-2xl font-bold mt-1">
                {formatNumber(data?.databaseInfo?.totalRecords || 0)}
              </div>
              <div className="text-xs text-muted-foreground">
                {(data?.databaseInfo?.dataSpanDays || 0).toFixed(1)} days of data
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Long vs Short Sentiment */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Long vs Short Liquidations
            </CardTitle>
            <CardDescription>
              Market sentiment indicator based on Aster DEX liquidations only. More short liqs = bullish pressure, more long liqs = bearish pressure.
              <span className="block mt-1 text-yellow-600 dark:text-yellow-500 text-[11px]">
                ⚠ Single-exchange data may not reflect broader market conditions. Use as one of many indicators, not as trading advice.
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const longCount = data?.totals?.longCount || 0;
              const shortCount = data?.totals?.shortCount || 0;
              const totalCount = longCount + shortCount;
              const longPercent = totalCount > 0 ? (longCount / totalCount) * 100 : 50;
              const shortPercent = totalCount > 0 ? (shortCount / totalCount) * 100 : 50;
              
              const longVol = data?.totals?.longVolume || 0;
              const shortVol = data?.totals?.shortVolume || 0;
              const totalVol = longVol + shortVol;
              const longVolPercent = totalVol > 0 ? (longVol / totalVol) * 100 : 50;
              const shortVolPercent = totalVol > 0 ? (shortVol / totalVol) * 100 : 50;
              
              // Determine sentiment
              const ratio = shortCount / (longCount || 1);
              let sentiment = '';
              let sentimentColor = '';
              if (ratio > 1.2) {
                sentiment = 'Bullish';
                sentimentColor = 'text-green-500';
              } else if (ratio > 0.83) {
                sentiment = 'Neutral';
                sentimentColor = 'text-yellow-500';
              } else {
                sentiment = 'Bearish';
                sentimentColor = 'text-red-500';
              }
              
              return (
                <div className="space-y-4">
                  {/* Sentiment Badge */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Sentiment:</span>
                      <span className={`font-semibold ${sentimentColor}`}>{sentiment}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Short/Long Ratio: {ratio.toFixed(2)}x
                    </div>
                  </div>
                  
                  {/* Count Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>By Count</span>
                      <span>{formatNumber(longCount)} longs vs {formatNumber(shortCount)} shorts</span>
                    </div>
                    <div className="h-6 rounded-full overflow-hidden flex bg-muted">
                      <div 
                        className="bg-red-500 flex items-center justify-center text-[10px] font-medium text-white transition-all"
                        style={{ width: `${longPercent}%` }}
                      >
                        {longPercent > 15 && `${longPercent.toFixed(0)}%`}
                      </div>
                      <div 
                        className="bg-green-500 flex items-center justify-center text-[10px] font-medium text-white transition-all"
                        style={{ width: `${shortPercent}%` }}
                      >
                        {shortPercent > 15 && `${shortPercent.toFixed(0)}%`}
                      </div>
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span className="text-red-500">▼ Longs Liquidated</span>
                      <span className="text-green-500">Shorts Liquidated ▲</span>
                    </div>
                  </div>
                  
                  {/* Volume Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>By Volume</span>
                      <span>{formatVolume(longVol)} vs {formatVolume(shortVol)}</span>
                    </div>
                    <div className="h-6 rounded-full overflow-hidden flex bg-muted">
                      <div 
                        className="bg-red-500/70 flex items-center justify-center text-[10px] font-medium text-white transition-all"
                        style={{ width: `${longVolPercent}%` }}
                      >
                        {longVolPercent > 15 && `${longVolPercent.toFixed(0)}%`}
                      </div>
                      <div 
                        className="bg-green-500/70 flex items-center justify-center text-[10px] font-medium text-white transition-all"
                        style={{ width: `${shortVolPercent}%` }}
                      >
                        {shortVolPercent > 15 && `${shortVolPercent.toFixed(0)}%`}
                      </div>
                    </div>
                  </div>
                  
                  {/* Explanation */}
                  <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded">
                    {shortPercent > 55 ? (
                      <span>More shorts getting liquidated suggests upward price pressure. Traders betting against the market are being forced out.</span>
                    ) : longPercent > 55 ? (
                      <span>More longs getting liquidated suggests downward price pressure. Leveraged bulls are being shaken out.</span>
                    ) : (
                      <span>Roughly balanced liquidations. Market is choppy with no clear directional bias.</span>
                    )}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Charts Grid - 2x2 layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Hourly Distribution Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Hourly Activity (UTC)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex gap-[2px] h-16 items-end">
                  {Array.from({ length: 24 }, (_, hour) => {
                    const hourData = data?.hourlyDistribution?.find(h => h.hour === hour);
                    const count = hourData?.count || 0;
                    const heightPercent = maxHourlyCount > 0 ? (count / maxHourlyCount) * 100 : 0;
                    return (
                      <div 
                        key={hour} 
                        className="flex-1 bg-primary hover:bg-primary/80 rounded-t cursor-default transition-colors"
                        style={{ height: `${Math.max(heightPercent, 3)}%` }}
                        title={`${hour}:00 UTC\n${count} liquidations`}
                      />
                    );
                  })}
                </div>
                <div className="flex gap-[2px]">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <div key={hour} className="flex-1 text-center">
                      <span className="text-[9px] text-muted-foreground">
                        {hour % 4 === 0 ? hour : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Daily Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4" />
                Daily Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex gap-1 h-16 items-end">
                  {Array.from({ length: 7 }, (_, day) => {
                    const dayData = data?.dailyDistribution?.find(d => d.day_of_week === day);
                    const count = dayData?.count || 0;
                    const maxDailyCount = Math.max(...(data?.dailyDistribution?.map(d => d.count) || [1]), 1);
                    const heightPercent = maxDailyCount > 0 ? (count / maxDailyCount) * 100 : 0;
                    return (
                      <div 
                        key={day} 
                        className="flex-1 bg-primary hover:bg-primary/80 rounded-t cursor-default transition-colors"
                        style={{ height: `${Math.max(heightPercent, 5)}%` }}
                        title={`${DAY_NAMES[day]}\n${count} liquidations`}
                      />
                    );
                  })}
                </div>
                <div className="flex gap-1">
                  {DAY_NAMES.map((name, i) => (
                    <div key={i} className="flex-1 text-center">
                      <span className="text-[9px] text-muted-foreground">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 30-Day Calendar Heatmap */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Flame className="h-4 w-4" />
                30-Day Calendar
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                // Generate last 30 days
                const today = new Date();
                const days: { date: Date; dateStr: string }[] = [];
                for (let i = 29; i >= 0; i--) {
                  const d = new Date(today);
                  d.setDate(d.getDate() - i);
                  days.push({
                    date: d,
                    dateStr: d.toISOString().split('T')[0],
                  });
                }

                // Find the first day's day of week to know where to start
                const firstDayOfWeek = days[0].date.getDay();
                
                // Calculate max count for intensity
                const maxCount = Math.max(
                  ...(data?.calendarHeatmap?.map(c => c.count) || [1]),
                  1
                );

                // Group days into weeks for display
                const weeks: typeof days[] = [];
                let currentWeek: typeof days = [];
                
                // Add empty slots for the first week
                for (let i = 0; i < firstDayOfWeek; i++) {
                  currentWeek.push({ date: new Date(0), dateStr: '' });
                }
                
                days.forEach((day, index) => {
                  currentWeek.push(day);
                  if ((firstDayOfWeek + index + 1) % 7 === 0) {
                    weeks.push(currentWeek);
                    currentWeek = [];
                  }
                });
                
                // Push the last incomplete week
                if (currentWeek.length > 0) {
                  weeks.push(currentWeek);
                }

                return (
                  <div className="space-y-1">
                    {/* Day of week labels */}
                    <div className="flex gap-1">
                      <div className="w-6" />
                      {DAY_NAMES_SHORT.map((name, i) => (
                        <div key={i} className="flex-1 text-center">
                          <span className="text-[8px] text-muted-foreground">{name}</span>
                        </div>
                      ))}
                    </div>
                    
                    {/* Calendar grid */}
                    {weeks.map((week, weekIndex) => (
                      <div key={weekIndex} className="flex gap-1 items-center">
                        {/* Week label */}
                        <div className="w-6 text-right pr-1">
                          {week.some(d => d.dateStr && new Date(d.dateStr).getDate() <= 7) && (
                            <span className="text-[8px] text-muted-foreground">
                              {week.find(d => d.dateStr && new Date(d.dateStr).getDate() <= 7)?.date.toLocaleDateString('en', { month: 'short' })}
                            </span>
                          )}
                        </div>
                        
                        {/* Days of the week */}
                        {Array.from({ length: 7 }, (_, dayIndex) => {
                          const day = week[dayIndex];
                          if (!day || !day.dateStr) {
                            return <div key={dayIndex} className="flex-1 h-5" />;
                          }
                          
                          const dayData = data?.calendarHeatmap?.find(c => c.date === day.dateStr);
                          const count = dayData?.count || 0;
                          const volume = dayData?.volume || 0;
                          const intensity = maxCount > 0 ? count / maxCount : 0;
                          const dateNum = day.date.getDate();
                          
                          return (
                            <div
                              key={dayIndex}
                              className="flex-1 h-5 rounded-sm cursor-default transition-colors flex items-center justify-center"
                              style={{
                                backgroundColor: count > 0
                                  ? `hsl(142 76% 36% / ${Math.max(intensity * 0.85 + 0.15, 0.15)})`
                                  : 'hsl(var(--muted) / 0.2)'
                              }}
                              title={`${day.date.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}\n${count} liquidations\n$${(volume / 1000).toFixed(1)}K volume`}
                            >
                              <span className={`text-[8px] ${count > maxCount * 0.5 ? 'text-white' : 'text-muted-foreground'}`}>
                                {dateNum}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Recent Large Liquidations */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4" />
                Recent Large Liquidations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 max-h-[180px] overflow-y-auto">
                {data?.recentLargeLiqs?.length ? (
                  data.recentLargeLiqs.map((liq, i) => {
                    const timeAgo = getTimeAgo(liq.event_time);
                    const isLong = liq.side?.toLowerCase() === 'buy';
                    return (
                      <div key={i} className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-mono ${isLong ? 'text-red-500' : 'text-green-500'}`}>
                            {isLong ? '▼' : '▲'}
                          </span>
                          <span className="text-sm font-medium">{liq.symbol.replace('USDT', '')}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-mono">${(liq.volume_usdt / 1000).toFixed(1)}K</span>
                          <span className="w-12 text-right">{timeAgo}</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-4">
                    No large liquidations in the last 30 days
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* BTC Volume vs Liquidations Correlation */}
        {btcVolume && data?.calendarHeatmap && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                BTC Volume vs Liquidations (30 Day)
              </CardTitle>
              <CardDescription>
                Correlation between market-wide BTC volume (CoinGecko) and liquidation activity
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                // Match dates between BTC volume and liquidation data
                const btcByDate = new Map(btcVolume.dailyData.map(d => [d.date, d]));
                const liqByDate = new Map(data.calendarHeatmap.map(d => [d.date, d]));
                
                // Get all dates that exist in both datasets
                const commonDates = btcVolume.dailyData
                  .filter(d => liqByDate.has(d.date))
                  .map(d => d.date)
                  .sort();
                
                // Extract matched data for correlation
                const btcVolumes: number[] = [];
                const liqCounts: number[] = [];
                const liqVolumes: number[] = [];
                const chartData: Array<{
                  date: string;
                  btcVol: number;
                  liqCount: number;
                  liqVol: number;
                  priceChange: number;
                }> = [];
                
                commonDates.forEach(date => {
                  const btc = btcByDate.get(date);
                  const liq = liqByDate.get(date);
                  if (btc && liq) {
                    btcVolumes.push(btc.volume);
                    liqCounts.push(liq.count);
                    liqVolumes.push(liq.volume);
                    chartData.push({
                      date,
                      btcVol: btc.volume,
                      liqCount: liq.count,
                      liqVol: liq.volume,
                      priceChange: btc.priceChange,
                    });
                  }
                });
                
                // Calculate correlations
                const volCountCorr = calculateCorrelation(btcVolumes, liqCounts);
                const volVolCorr = calculateCorrelation(btcVolumes, liqVolumes);
                
                // Find max values for scaling
                const maxBtcVol = Math.max(...btcVolumes);
                const maxLiqCount = Math.max(...liqCounts);
                
                // Get correlation interpretation
                const getCorrelationLabel = (r: number) => {
                  const abs = Math.abs(r);
                  if (abs < 0.2) return { label: 'Very Weak', color: 'text-muted-foreground' };
                  if (abs < 0.4) return { label: 'Weak', color: 'text-yellow-500' };
                  if (abs < 0.6) return { label: 'Moderate', color: 'text-orange-500' };
                  if (abs < 0.8) return { label: 'Strong', color: 'text-green-500' };
                  return { label: 'Very Strong', color: 'text-green-600' };
                };
                
                const countCorr = getCorrelationLabel(volCountCorr);
                const volCorr = getCorrelationLabel(volVolCorr);
                
                return (
                  <div className="space-y-4">
                    {/* Correlation Stats */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-lg bg-muted/50">
                        <div className="text-xs text-muted-foreground mb-1">BTC Vol → Liq Count</div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl font-bold">{(volCountCorr * 100).toFixed(0)}%</span>
                          <span className={`text-xs ${countCorr.color}`}>{countCorr.label}</span>
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">
                        <div className="text-xs text-muted-foreground mb-1">BTC Vol → Liq Volume</div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl font-bold">{(volVolCorr * 100).toFixed(0)}%</span>
                          <span className={`text-xs ${volCorr.color}`}>{volCorr.label}</span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Dual-axis chart */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground px-1">
                        <span>BTC Volume (gray) vs Liquidations (green)</span>
                        <span>{chartData.length} days</span>
                      </div>
                      <div className="relative h-28">
                        {/* Combined SVG for both bars and line */}
                        <svg className="w-full h-full" viewBox={`0 0 ${chartData.length * 12} 100`} preserveAspectRatio="none">
                          {/* BTC Volume bars */}
                          {chartData.map((d, i) => {
                            const heightPercent = maxBtcVol > 0 ? (d.btcVol / maxBtcVol) * 100 : 0;
                            const barWidth = 10;
                            const x = i * 12 + 1;
                            return (
                              <rect
                                key={`btc-${i}`}
                                x={x}
                                y={100 - heightPercent}
                                width={barWidth}
                                height={heightPercent}
                                fill="hsl(var(--muted))"
                                opacity={0.6}
                                rx={1}
                              >
                                <title>{`${d.date}\nBTC Vol: $${(d.btcVol / 1e9).toFixed(1)}B\nLiqs: ${d.liqCount}\nPrice: ${d.priceChange >= 0 ? '+' : ''}${d.priceChange.toFixed(1)}%`}</title>
                              </rect>
                            );
                          })}
                          {/* Liquidation line */}
                          <polyline
                            fill="none"
                            stroke="hsl(142 76% 46%)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                            points={chartData.map((d, i) => {
                              const x = i * 12 + 6;
                              const y = 100 - (maxLiqCount > 0 ? (d.liqCount / maxLiqCount) * 95 : 0) - 2;
                              return `${x},${y}`;
                            }).join(' ')}
                          />
                          {/* Dots on line for each data point */}
                          {chartData.map((d, i) => {
                            const x = i * 12 + 6;
                            const y = 100 - (maxLiqCount > 0 ? (d.liqCount / maxLiqCount) * 95 : 0) - 2;
                            return (
                              <circle
                                key={`dot-${i}`}
                                cx={x}
                                cy={y}
                                r="3"
                                fill="hsl(142 76% 46%)"
                                vectorEffect="non-scaling-stroke"
                              >
                                <title>{`${d.date}\nLiquidations: ${d.liqCount}\nLiq Volume: $${(d.liqVol / 1000).toFixed(0)}K`}</title>
                              </circle>
                            );
                          })}
                        </svg>
                      </div>
                      <div className="flex justify-between text-[9px] text-muted-foreground px-1">
                        <span>{chartData[0]?.date?.slice(5)}</span>
                        <span>{chartData[chartData.length - 1]?.date?.slice(5)}</span>
                      </div>
                    </div>
                    
                    {/* Insight */}
                    <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded">
                      {volCountCorr > 0.4 ? (
                        <span className="text-green-500">✓ Higher BTC volume correlates with more liquidations - good for scalping!</span>
                      ) : volCountCorr > 0.2 ? (
                        <span>↗ Moderate correlation - volume helps but isn&apos;t everything</span>
                      ) : (
                        <span className="text-yellow-500">⚠ Weak correlation - liquidations may be driven by other factors</span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Symbol Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle>Symbol Analysis</CardTitle>
                <CardDescription>
                  <span className="font-medium">Whale%</span> = volume from $10K+ liqs (higher = fewer, bigger trades).
                  <span className="ml-2 font-medium">$/hr</span> = expected hourly liq volume (frequency × avg size).
                  <br/>
                  <span className="text-blue-500">Blue = suggested to add</span>
                  <span className="ml-2 text-orange-500">Orange = consider removing</span>
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={suggestionFilter} onValueChange={(v) => setSuggestionFilter(v as typeof suggestionFilter)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Symbols</SelectItem>
                    <SelectItem value="suggested">Suggested</SelectItem>
                    <SelectItem value="low-activity">Low Activity</SelectItem>
                    <SelectItem value="configured">Configured</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-8 w-[140px]"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                {error}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Symbol</TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('liq_count')}
                      >
                        <div className="flex items-center gap-1">
                          Count
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('total_volume')}
                      >
                        <div className="flex items-center gap-1">
                          Volume
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('avg_volume')}
                      >
                        <div className="flex items-center gap-1">
                          Avg Size
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('frequency_per_hour')}
                      >
                        <div className="flex items-center gap-1">
                          Freq/hr
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('whale_percent')}
                      >
                        <div className="flex items-center gap-1">
                          Whale%
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('hourly_opportunity')}
                      >
                        <div className="flex items-center gap-1">
                          $/hr
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('long_ratio')}
                      >
                        <div className="flex items-center gap-1">
                          Sentiment
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSymbols.slice(0, 100).map(s => {
                      const isConfigured = configuredSymbols.includes(s.symbol);
                      const isRecommended = isSymbolRecommended(s);
                      const isExpanded = expandedSymbol === s.symbol;
                      
                      // Suggestion logic
                      const shouldAdd = !isConfigured && isRecommended;
                      const shouldRemove = isConfigured && !isRecommended;
                      
                      return (
                        <React.Fragment key={s.symbol}>
                          <TableRow 
                            className={`cursor-pointer ${
                              shouldRemove ? 'bg-red-500/5' :
                              isConfigured ? 'bg-green-500/5' : 
                              shouldAdd ? 'bg-blue-500/5' : ''
                            } ${isExpanded ? 'border-b-0' : ''}`}
                            onClick={() => toggleExpand(s.symbol)}
                          >
                            <TableCell className="font-mono font-medium">
                              <div className="flex items-center gap-2 flex-wrap">
                                {isExpanded ? (
                                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                )}
                                {s.symbol.replace('USDT', '')}
                                {isConfigured && (
                                  <Badge variant="outline" className="text-[10px] text-green-600 border-green-600">
                                    Active
                                  </Badge>
                                )}
                                {shouldAdd && (
                                  <Badge className="text-[10px] bg-blue-500 hover:bg-blue-600">
                                    Suggested
                                  </Badge>
                                )}
                                {shouldRemove && (
                                  <Badge variant="outline" className="text-[10px] text-orange-500 border-orange-500">
                                    Low Activity
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{formatNumber(s.liq_count)}</TableCell>
                            <TableCell className="font-medium">{formatVolume(s.total_volume)}</TableCell>
                            <TableCell>{formatVolume(s.avg_volume)}</TableCell>
                            <TableCell>
                              <span className={s.frequency_per_hour >= 1 ? 'text-green-600 font-medium' : ''}>
                                {s.frequency_per_hour.toFixed(2)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div 
                                className="flex items-center gap-1"
                                title={`${s.whale_count} whale liqs (≥$10K) out of ${s.liq_count} total`}
                              >
                                <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full ${s.whale_percent > 70 ? 'bg-purple-500' : s.whale_percent > 40 ? 'bg-blue-500' : 'bg-green-500'}`}
                                    style={{ width: `${Math.min(s.whale_percent, 100)}%` }}
                                  />
                                </div>
                                <span className={`text-xs ${s.whale_percent > 70 ? 'text-purple-500' : ''}`}>
                                  {s.whale_percent.toFixed(0)}%
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span 
                                className={`font-mono ${s.hourly_opportunity >= 10000 ? 'text-green-600 font-medium' : 'text-muted-foreground'}`}
                                title={`Expected ${formatVolume(s.hourly_opportunity)} in liquidations per hour`}
                              >
                                {formatVolume(s.hourly_opportunity)}
                              </span>
                            </TableCell>
                            <TableCell>
                              {(() => {
                                // Calculate sentiment from short/long ratio
                                const shortLongRatio = s.long_liqs > 0 ? s.short_liqs / s.long_liqs : s.short_liqs > 0 ? 999 : 1;
                                let label = '';
                                let bgColor = '';
                                let textColor = '';
                                
                                if (shortLongRatio > 1.2) {
                                  label = 'Bullish';
                                  bgColor = 'bg-green-500/20';
                                  textColor = 'text-green-600';
                                } else if (shortLongRatio < 0.83) {
                                  label = 'Bearish';
                                  bgColor = 'bg-red-500/20';
                                  textColor = 'text-red-600';
                                } else {
                                  label = 'Neutral';
                                  bgColor = 'bg-yellow-500/20';
                                  textColor = 'text-yellow-600';
                                }
                                
                                return (
                                  <div className="flex items-center gap-1.5" title={`${s.short_liqs} shorts / ${s.long_liqs} longs = ${shortLongRatio.toFixed(2)}x`}>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${bgColor} ${textColor}`}>
                                      {label}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {shortLongRatio.toFixed(1)}x
                                    </span>
                                  </div>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => {
                                    const url = isConfigured 
                                      ? `/config?symbol=${s.symbol}` 
                                      : `/config?symbol=${s.symbol}&add=true`;
                                    window.location.href = url;
                                  }}
                                  title={isConfigured ? 'Edit Config' : 'Add to Config'}
                                >
                                  {isConfigured ? (
                                    <ExternalLink className="h-3 w-3" />
                                  ) : (
                                    <Plus className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {/* Expanded Depth Panel */}
                          {isExpanded && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={9} className="p-0">
                                <div className="px-4 py-3">
                                  {depthLoading && !depthData ? (
                                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                      <RefreshCw className="h-3 w-3 animate-spin" />
                                      Loading depth data...
                                    </div>
                                  ) : depthError ? (
                                    <div className="text-destructive text-sm">{depthError}</div>
                                  ) : depthData ? (
                                    <div className="space-y-3">
                                      {/* Header row */}
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4 text-sm">
                                          <div className="flex items-center gap-2">
                                            <Layers className="h-4 w-4 text-muted-foreground" />
                                            <span className="font-medium">Order Book Depth</span>
                                          </div>
                                          <div className="text-muted-foreground">
                                            Spread: <span className={`font-mono ${depthData.spreadPercent < 0.05 ? 'text-green-500' : depthData.spreadPercent > 0.1 ? 'text-red-500' : 'text-yellow-500'}`}>
                                              {depthData.spreadPercent.toFixed(3)}%
                                            </span>
                                          </div>
                                          <div className="text-muted-foreground">
                                            Mid: <span className="font-mono">${depthData.midPrice.toFixed(depthData.midPrice < 1 ? 4 : 2)}</span>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                          {depthLoading && <RefreshCw className="h-3 w-3 animate-spin" />}
                                          Auto-refresh: 5s
                                        </div>
                                      </div>
                                      
                                      {/* Bid/Ask Imbalance Bar */}
                                      <div className="space-y-1">
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                          <span>Bid/Ask Imbalance (within 1%)</span>
                                          <span>
                                            {depthData.bidAskImbalance > 0.1 ? '🟢 More Bids' : 
                                             depthData.bidAskImbalance < -0.1 ? '🔴 More Asks' : '⚪ Balanced'}
                                          </span>
                                        </div>
                                        <div className="h-2 rounded-full overflow-hidden flex bg-muted">
                                          <div 
                                            className="bg-green-500 transition-all"
                                            style={{ width: `${Math.max(0, 50 + depthData.bidAskImbalance * 50)}%` }}
                                          />
                                          <div 
                                            className="bg-red-500 transition-all"
                                            style={{ width: `${Math.max(0, 50 - depthData.bidAskImbalance * 50)}%` }}
                                          />
                                        </div>
                                        <div className="flex justify-between text-[10px] text-muted-foreground">
                                          <span className="text-green-500">Bids</span>
                                          <span className="text-red-500">Asks</span>
                                        </div>
                                      </div>

                                      {/* Depth Levels Table */}
                                      <div className="grid grid-cols-4 gap-2 text-xs">
                                        <div className="font-medium text-muted-foreground">% from Mid</div>
                                        <div className="font-medium text-muted-foreground text-right">Bid Liquidity</div>
                                        <div className="font-medium text-muted-foreground text-right">Ask Liquidity</div>
                                        <div className="font-medium text-muted-foreground text-right">Total</div>
                                        {depthData.levels.map(level => (
                                          <React.Fragment key={level.percentFromMid}>
                                            <div className="font-mono">±{level.percentFromMid}%</div>
                                            <div className="font-mono text-right text-green-500">{formatVolume(level.bidLiquidity)}</div>
                                            <div className="font-mono text-right text-red-500">{formatVolume(level.askLiquidity)}</div>
                                            <div className="font-mono text-right">{formatVolume(level.totalLiquidity)}</div>
                                          </React.Fragment>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
                {filteredSymbols.length > 100 && (
                  <div className="text-center text-sm text-muted-foreground py-2">
                    Showing 100 of {filteredSymbols.length} symbols
                  </div>
                )}
                {filteredSymbols.length === 0 && !loading && (
                  <div className="text-center text-muted-foreground py-8">
                    No symbols found matching your search
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Database Info */}
        {data?.databaseInfo && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" />
                Database Info
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Total Records</div>
                  <div className="font-medium">{formatNumber(data.databaseInfo.totalRecords)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Unique Symbols</div>
                  <div className="font-medium">{data.databaseInfo.uniqueSymbols}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Oldest Record</div>
                  <div className="font-medium">{formatTime(data.databaseInfo.oldestRecord)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Newest Record</div>
                  <div className="font-medium">{formatTime(data.databaseInfo.newestRecord)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
