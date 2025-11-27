'use client';

import { useState, useEffect, useMemo } from 'react';
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
  Zap
} from 'lucide-react';

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
  first_liq_time: number;
  last_liq_time: number;
  frequency_per_hour: number;
  long_ratio: number;
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
  };
  symbols: SymbolStats[];
  hourlyDistribution: HourlyData[];
  dailyDistribution: DailyData[];
  calendarHeatmap: CalendarData[];
  recentLargeLiqs: LargeLiqData[];
  databaseInfo: DatabaseInfo;
}

type SortField = 'liq_count' | 'total_volume' | 'avg_volume' | 'frequency_per_hour' | 'long_ratio';
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

export default function DiscoveryPage() {
  const [data, setData] = useState<DiscoveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState('30d');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('total_volume');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [configuredSymbols, setConfiguredSymbols] = useState<string[]>([]);

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

  // Filter and sort symbols
  const filteredSymbols = useMemo(() => {
    if (!data?.symbols) return [];
    
    let filtered = data.symbols.filter(s => 
      s.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const multiplier = sortDirection === 'desc' ? -1 : 1;
      return (aVal - bVal) * multiplier;
    });

    return filtered;
  }, [data?.symbols, searchQuery, sortField, sortDirection]);

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

        {/* Symbol Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle>Symbol Analysis</CardTitle>
                <CardDescription>
                  Click column headers to sort. Green = already configured.
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-auto">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search symbols..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-8 w-full sm:w-[200px]"
                />
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
                        onClick={() => handleSort('long_ratio')}
                      >
                        <div className="flex items-center gap-1">
                          Long %
                          <ArrowUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead>Long/Short</TableHead>
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSymbols.slice(0, 100).map(s => {
                      const isConfigured = configuredSymbols.includes(s.symbol);
                      return (
                        <TableRow 
                          key={s.symbol} 
                          className={isConfigured ? 'bg-green-500/5' : ''}
                        >
                          <TableCell className="font-mono font-medium">
                            <div className="flex items-center gap-2">
                              {s.symbol.replace('USDT', '')}
                              {isConfigured && (
                                <Badge variant="outline" className="text-[10px] text-green-600 border-green-600">
                                  Configured
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
                            <div className="flex items-center gap-1">
                              {s.long_ratio > 0.6 ? (
                                <TrendingUp className="h-3 w-3 text-green-500" />
                              ) : s.long_ratio < 0.4 ? (
                                <TrendingDown className="h-3 w-3 text-red-500" />
                              ) : null}
                              {(s.long_ratio * 100).toFixed(0)}%
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-xs">
                              <span className="text-green-600">{s.long_liqs}</span>
                              <span>/</span>
                              <span className="text-red-500">{s.short_liqs}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
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
