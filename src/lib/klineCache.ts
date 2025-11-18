// Kline caching utility for 7-day historical data
export interface CachedKlineData {
  symbol: string;
  interval: string;
  data: number[][]; // [timestamp, open, high, low, close, volume]
  lastUpdate: number;
  lastCandleTime: number;
}

// Calculate candles needed for 7 days based on timeframe
export const getCandlesFor7Days = (interval: string): number => {
  const minutesInInterval = {
    '1m': 1,
    '3m': 3,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '1h': 60,
    '2h': 120,
    '4h': 240,
    '6h': 360,
    '8h': 480,
    '12h': 720,
    '1d': 1440,
    '3d': 4320,
    '1w': 10080,
    '1M': 43200 // Approximate 30 days
  } as const;

  const minutes = minutesInInterval[interval as keyof typeof minutesInInterval];
  if (!minutes) return 500; // Default fallback

  const minutesIn7Days = 7 * 24 * 60; // 10,080 minutes
  const candlesNeeded = Math.ceil(minutesIn7Days / minutes);
  
  // Cap at API limit but ensure we get at least 7 days
  return Math.min(candlesNeeded, 1500);
};

// In-memory cache
const klineCache = new Map<string, CachedKlineData>();

export const getCacheKey = (symbol: string, interval: string): string => {
  return `${symbol}_${interval}`;
};

export const getCachedKlines = (symbol: string, interval: string): CachedKlineData | null => {
  const key = getCacheKey(symbol, interval);
  const cached = klineCache.get(key);
  
  if (!cached) return null;
  
  // Check if cache is still valid (within 5 minutes for most recent data)
  const now = Date.now();
  const cacheAge = now - cached.lastUpdate;
  const maxAge = 5 * 60 * 1000; // 5 minutes
  
  if (cacheAge > maxAge) {
    // Cache is stale, but we can still use historical data
    // We'll just need to fetch recent candles
    return cached;
  }
  
  return cached;
};

export const setCachedKlines = (symbol: string, interval: string, data: number[][]): void => {
  const key = getCacheKey(symbol, interval);
  const now = Date.now();
  
  if (data.length === 0) return;
  
  // Sort data by timestamp to ensure correct order
  const sortedData = [...data].sort((a, b) => a[0] - b[0]);
  
  const cached: CachedKlineData = {
    symbol,
    interval,
    data: sortedData,
    lastUpdate: now,
    lastCandleTime: sortedData[sortedData.length - 1][0] * 1000 // Convert back to milliseconds
  };
  
  klineCache.set(key, cached);
};

export const updateCachedKlines = (symbol: string, interval: string, newData: number[][]): CachedKlineData | null => {
  const key = getCacheKey(symbol, interval);
  const cached = klineCache.get(key);
  
  if (!cached || newData.length === 0) return null;
  
  // Merge new data with existing cache
  const existingData = cached.data;
  const newTimestamps = new Set(newData.map(candle => candle[0]));
  
  // Remove any existing candles that are being updated
  const filteredExisting = existingData.filter(candle => !newTimestamps.has(candle[0]));
  
  // Combine and sort
  const combinedData = [...filteredExisting, ...newData].sort((a, b) => a[0] - b[0]);
  
  // Keep only the most recent candles (limit to prevent memory issues)
  const maxCandles = getCandlesFor7Days(interval) + 100; // Extra buffer
  const trimmedData = combinedData.slice(-maxCandles);
  
  const updated: CachedKlineData = {
    symbol,
    interval,
    data: trimmedData,
    lastUpdate: Date.now(),
    lastCandleTime: trimmedData[trimmedData.length - 1][0] * 1000
  };
  
  klineCache.set(key, updated);
  return updated;
};

export const clearCache = (): void => {
  klineCache.clear();
};

export const getCacheStats = (): { size: number; keys: string[] } => {
  return {
    size: klineCache.size,
    keys: Array.from(klineCache.keys())
  };
};