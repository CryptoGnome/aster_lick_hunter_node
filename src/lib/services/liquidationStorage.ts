import { db } from '../db/database';
import { LiquidationEvent } from '../types';

export interface StoredLiquidation {
  id: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  order_type: string;
  quantity: number;
  price: number;
  average_price: number;
  volume_usdt: number;
  order_status: string;
  order_last_filled_quantity: number;
  order_filled_accumulated_quantity: number;
  order_trade_time: number;
  event_time: number;
  created_at: number;
  metadata: string | null;
}

export interface LiquidationQueryParams {
  symbol?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface LiquidationStats {
  total_count: number;
  total_volume_usdt: number;
  avg_volume_usdt: number;
  max_volume_usdt: number;
  symbols: Array<{
    symbol: string;
    count: number;
    volume_usdt: number;
  }>;
}

export class LiquidationStorage {
  private buffer: Array<{ event: LiquidationEvent; volumeUSDT: number }> = [];
  private flushTimeout: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 50; // Flush after 50 liquidations
  private readonly FLUSH_INTERVAL = 10000; // Or every 10 seconds
  private isShuttingDown = false;

  async saveLiquidation(event: LiquidationEvent, volumeUSDT: number): Promise<void> {
    // Add to buffer instead of immediate write
    this.buffer.push({ event, volumeUSDT });

    // Flush if buffer is full
    if (this.buffer.length >= this.BUFFER_SIZE) {
      await this.flushBuffer();
    } else {
      // Schedule a flush if not already scheduled
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimeout) return; // Already scheduled
    
    this.flushTimeout = setTimeout(async () => {
      this.flushTimeout = null;
      await this.flushBuffer();
    }, this.FLUSH_INTERVAL);
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const itemsToFlush = [...this.buffer];
    this.buffer = []; // Clear buffer immediately to accept new events

    try {
      // Use transaction for batch insert
      await db.run('BEGIN TRANSACTION');

      const sql = `
        INSERT OR IGNORE INTO liquidations (
          symbol, side, order_type, quantity, price, average_price,
          volume_usdt, order_status, order_last_filled_quantity,
          order_filled_accumulated_quantity, order_trade_time,
          event_time, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      for (const { event, volumeUSDT } of itemsToFlush) {
        const metadata = JSON.stringify({
          orderType: event.orderType,
          originalQty: event.qty,
          originalTime: event.time
        });

        const params = [
          event.symbol,
          event.side,
          event.orderType,
          event.quantity,
          event.price,
          event.averagePrice,
          volumeUSDT,
          event.orderStatus,
          event.orderLastFilledQuantity,
          event.orderFilledAccumulatedQuantity,
          event.orderTradeTime,
          event.eventTime,
          metadata
        ];

        await db.run(sql, params);
      }

      await db.run('COMMIT');
    } catch (error) {
      await db.run('ROLLBACK').catch(() => {}); // Rollback on error
      console.error(`Error flushing ${itemsToFlush.length} liquidations:`, error);
    }
  }

  // Flush on shutdown to prevent data loss
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    await this.flushBuffer();
  }

  async getLiquidations(params: LiquidationQueryParams = {}): Promise<{
    liquidations: StoredLiquidation[];
    total: number;
  }> {
    const conditions: string[] = [];
    const queryParams: any[] = [];

    if (params.symbol) {
      conditions.push('symbol = ?');
      queryParams.push(params.symbol);
    }

    if (params.from) {
      conditions.push('event_time >= ?');
      queryParams.push(params.from);
    }

    if (params.to) {
      conditions.push('event_time <= ?');
      queryParams.push(params.to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) as total FROM liquidations ${whereClause}`;
    const countResult = await db.get<{ total: number }>(countSql, queryParams);
    const total = countResult?.total || 0;

    const limit = params.limit || 100;
    const offset = params.offset || 0;

    const sql = `
      SELECT * FROM liquidations
      ${whereClause}
      ORDER BY event_time DESC
      LIMIT ? OFFSET ?
    `;

    const liquidations = await db.all<StoredLiquidation>(
      sql,
      [...queryParams, limit, offset]
    );

    return { liquidations, total };
  }

  async cleanupOldLiquidations(retentionDays: number = 90): Promise<number> {
    // If retentionDays is 0, disable cleanup entirely
    if (retentionDays <= 0) {
      console.log('Liquidation cleanup disabled (retentionDays = 0)');
      return 0;
    }
    
    const cutoffTime = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);

    const countSql = 'SELECT COUNT(*) as count FROM liquidations WHERE created_at < ?';
    const countResult = await db.get<{ count: number }>(countSql, [cutoffTime]);
    const deletedCount = countResult?.count || 0;

    const sql = 'DELETE FROM liquidations WHERE created_at < ?';
    await db.run(sql, [cutoffTime]);

    console.log(`Cleaned up ${deletedCount} liquidations older than ${retentionDays} days`);
    return deletedCount;
  }

  async getStatistics(timeWindowSeconds: number = 86400): Promise<LiquidationStats> {
    try {
      const since = Math.floor(Date.now() / 1000) - timeWindowSeconds;

      const statsSql = `
        SELECT
          COUNT(*) as total_count,
          SUM(volume_usdt) as total_volume_usdt,
          AVG(volume_usdt) as avg_volume_usdt,
          MAX(volume_usdt) as max_volume_usdt
        FROM liquidations
        WHERE created_at >= ?
      `;

      const stats = await db.get<{
        total_count: number;
        total_volume_usdt: number;
        avg_volume_usdt: number;
        max_volume_usdt: number;
      }>(statsSql, [since]);

      const symbolsSql = `
        SELECT
          symbol,
          COUNT(*) as count,
          SUM(volume_usdt) as volume_usdt
        FROM liquidations
        WHERE created_at >= ?
        GROUP BY symbol
        ORDER BY volume_usdt DESC
        LIMIT 10
      `;

      const symbols = await db.all<{
        symbol: string;
        count: number;
        volume_usdt: number;
      }>(symbolsSql, [since]);

      return {
        total_count: stats?.total_count || 0,
        total_volume_usdt: stats?.total_volume_usdt || 0,
        avg_volume_usdt: stats?.avg_volume_usdt || 0,
        max_volume_usdt: stats?.max_volume_usdt || 0,
        symbols: symbols || []
      };
    } catch (error) {
      console.error('Error getting liquidation statistics:', error);
      // Return empty stats on error
      return {
        total_count: 0,
        total_volume_usdt: 0,
        avg_volume_usdt: 0,
        max_volume_usdt: 0,
        symbols: []
      };
    }
  }

  async getRecentLiquidations(limit: number = 50): Promise<StoredLiquidation[]> {
    const sql = `
      SELECT * FROM liquidations
      ORDER BY event_time DESC
      LIMIT ?
    `;

    return await db.all<StoredLiquidation>(sql, [limit]);
  }

  async getUniqueSymbols(): Promise<string[]> {
    try {
      const sql = `
        SELECT DISTINCT symbol
        FROM liquidations
        ORDER BY symbol ASC
      `;

      const result = await db.all<{ symbol: string }>(sql, []);
      return result.map(row => row.symbol);
    } catch (error) {
      console.error('Error getting unique symbols:', error);
      return [];
    }
  }

  /**
   * Get comprehensive discovery stats for all symbols
   * Returns aggregated data useful for finding tradeable symbols
   * @param timeWindowSeconds - Time window in seconds, or 0 for all time
   */
  async getDiscoveryStats(timeWindowSeconds: number = 86400): Promise<DiscoveryStats> {
    try {
      // For "all time" (0), use a very old timestamp
      const isAllTime = timeWindowSeconds === 0;
      const since = isAllTime ? 0 : Math.floor(Date.now() / 1000) - timeWindowSeconds;

      // Get per-symbol comprehensive stats
      const symbolStatsSql = `
        SELECT
          symbol,
          COUNT(*) as liq_count,
          SUM(volume_usdt) as total_volume,
          AVG(volume_usdt) as avg_volume,
          MAX(volume_usdt) as max_volume,
          MIN(volume_usdt) as min_volume,
          SUM(CASE WHEN side = 'BUY' THEN 1 ELSE 0 END) as long_liqs,
          SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) as short_liqs,
          SUM(CASE WHEN side = 'BUY' THEN volume_usdt ELSE 0 END) as long_volume,
          SUM(CASE WHEN side = 'SELL' THEN volume_usdt ELSE 0 END) as short_volume,
          SUM(CASE WHEN volume_usdt >= 10000 THEN volume_usdt ELSE 0 END) as whale_volume,
          COUNT(CASE WHEN volume_usdt >= 10000 THEN 1 END) as whale_count,
          MIN(event_time) as first_liq_time,
          MAX(event_time) as last_liq_time
        FROM liquidations
        WHERE created_at >= ?
        GROUP BY symbol
        ORDER BY total_volume DESC
      `;

      const symbolStats = await db.all<{
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
      }>(symbolStatsSql, [since]);

      // Calculate frequency (liqs per hour) for each symbol
      // event_time is in milliseconds, so divide by 1000 to get seconds
      const symbolsWithFrequency = symbolStats.map(s => {
        const timeSpanHours = Math.max(1, (s.last_liq_time - s.first_liq_time) / 1000 / 3600);
        const frequency = s.liq_count / timeSpanHours;
        const whalePercent = s.total_volume > 0 ? (s.whale_volume / s.total_volume) * 100 : 0;
        const hourlyOpportunity = frequency * s.avg_volume;
        return {
          ...s,
          frequency_per_hour: frequency,
          long_ratio: s.liq_count > 0 ? s.long_liqs / s.liq_count : 0,
          whale_percent: whalePercent,
          hourly_opportunity: hourlyOpportunity,
        };
      });

      // Get hourly distribution (what hours are busiest)
      // event_time is in milliseconds, so divide by 1000 first
      const hourlyDistSql = `
        SELECT
          CAST(((event_time / 1000) % 86400) / 3600 AS INTEGER) as hour,
          COUNT(*) as count,
          SUM(volume_usdt) as volume
        FROM liquidations
        WHERE created_at >= ?
        GROUP BY hour
        ORDER BY hour
      `;

      const hourlyDist = await db.all<{
        hour: number;
        count: number;
        volume: number;
      }>(hourlyDistSql, [since]);

      // Get daily distribution (what days of week are busiest)
      // 0 = Sunday, 1 = Monday, etc.
      const dailyDistSql = `
        SELECT
          CAST(strftime('%w', datetime(event_time / 1000, 'unixepoch')) AS INTEGER) as day_of_week,
          COUNT(*) as count,
          SUM(volume_usdt) as volume
        FROM liquidations
        WHERE created_at >= ?
        GROUP BY day_of_week
        ORDER BY day_of_week
      `;

      const dailyDist = await db.all<{
        day_of_week: number;
        count: number;
        volume: number;
      }>(dailyDistSql, [since]);

      // Get calendar heatmap - last 30 days with daily stats
      const calendarSql = `
        SELECT
          date(datetime(event_time / 1000, 'unixepoch')) as date,
          CAST(strftime('%w', datetime(event_time / 1000, 'unixepoch')) AS INTEGER) as day_of_week,
          COUNT(*) as count,
          SUM(volume_usdt) as volume,
          COUNT(DISTINCT symbol) as unique_symbols
        FROM liquidations
        WHERE event_time >= ?
        GROUP BY date
        ORDER BY date ASC
      `;

      // Get data for the last 30 days regardless of the selected time window
      const thirtyDaysAgo = (Date.now() - 30 * 24 * 60 * 60 * 1000);
      const calendarData = await db.all<{
        date: string;
        day_of_week: number;
        count: number;
        volume: number;
        unique_symbols: number;
      }>(calendarSql, [thirtyDaysAgo]);

      // Get overall totals including long/short breakdown
      const totalsSql = `
        SELECT
          COUNT(*) as total_count,
          SUM(volume_usdt) as total_volume,
          COUNT(DISTINCT symbol) as unique_symbols,
          SUM(CASE WHEN side = 'BUY' THEN 1 ELSE 0 END) as long_count,
          SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) as short_count,
          SUM(CASE WHEN side = 'BUY' THEN volume_usdt ELSE 0 END) as long_volume,
          SUM(CASE WHEN side = 'SELL' THEN volume_usdt ELSE 0 END) as short_volume
        FROM liquidations
        WHERE created_at >= ?
      `;

      const totals = await db.get<{
        total_count: number;
        total_volume: number;
        unique_symbols: number;
        long_count: number;
        short_count: number;
        long_volume: number;
        short_volume: number;
      }>(totalsSql, [since]);

      // Get recent large liquidations (top 10 by volume in time window)
      const largeLiqsSql = `
        SELECT
          symbol,
          side,
          volume_usdt,
          price,
          event_time
        FROM liquidations
        WHERE created_at >= ?
        ORDER BY volume_usdt DESC
        LIMIT 10
      `;

      const largeLiqs = await db.all<{
        symbol: string;
        side: string;
        volume_usdt: number;
        price: number;
        event_time: number;
      }>(largeLiqsSql, [since]);

      return {
        timeWindow: timeWindowSeconds,
        totals: {
          count: totals?.total_count || 0,
          volume: totals?.total_volume || 0,
          uniqueSymbols: totals?.unique_symbols || 0,
          longCount: totals?.long_count || 0,
          shortCount: totals?.short_count || 0,
          longVolume: totals?.long_volume || 0,
          shortVolume: totals?.short_volume || 0,
        },
        symbols: symbolsWithFrequency,
        hourlyDistribution: hourlyDist,
        dailyDistribution: dailyDist,
        calendarHeatmap: calendarData,
        recentLargeLiqs: largeLiqs,
      };
    } catch (error) {
      console.error('Error getting discovery stats:', error);
      return {
        timeWindow: timeWindowSeconds,
        totals: { count: 0, volume: 0, uniqueSymbols: 0, longCount: 0, shortCount: 0, longVolume: 0, shortVolume: 0 },
        symbols: [],
        hourlyDistribution: [],
        dailyDistribution: [],
        calendarHeatmap: [],
        recentLargeLiqs: [],
      };
    }
  }

  /**
   * Get detailed stats for a specific symbol
   */
  async getSymbolDetails(symbol: string, timeWindowSeconds: number = 86400): Promise<SymbolDetailStats | null> {
    try {
      const since = Math.floor(Date.now() / 1000) - timeWindowSeconds;

      // Basic stats
      const statsSql = `
        SELECT
          COUNT(*) as liq_count,
          SUM(volume_usdt) as total_volume,
          AVG(volume_usdt) as avg_volume,
          MAX(volume_usdt) as max_volume,
          MIN(volume_usdt) as min_volume,
          SUM(CASE WHEN side = 'BUY' THEN 1 ELSE 0 END) as long_liqs,
          SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) as short_liqs,
          SUM(CASE WHEN side = 'BUY' THEN volume_usdt ELSE 0 END) as long_volume,
          SUM(CASE WHEN side = 'SELL' THEN volume_usdt ELSE 0 END) as short_volume
        FROM liquidations
        WHERE symbol = ? AND created_at >= ?
      `;

      const stats = await db.get<{
        liq_count: number;
        total_volume: number;
        avg_volume: number;
        max_volume: number;
        min_volume: number;
        long_liqs: number;
        short_liqs: number;
        long_volume: number;
        short_volume: number;
      }>(statsSql, [symbol, since]);

      if (!stats || stats.liq_count === 0) {
        return null;
      }

      // Hourly distribution for this symbol
      // event_time is in milliseconds, so divide by 1000 first
      const hourlyDistSql = `
        SELECT
          CAST(((event_time / 1000) % 86400) / 3600 AS INTEGER) as hour,
          COUNT(*) as count,
          SUM(volume_usdt) as volume
        FROM liquidations
        WHERE symbol = ? AND created_at >= ?
        GROUP BY hour
        ORDER BY hour
      `;

      const hourlyDist = await db.all<{
        hour: number;
        count: number;
        volume: number;
      }>(hourlyDistSql, [symbol, since]);

      // Recent liquidations
      const recentSql = `
        SELECT * FROM liquidations
        WHERE symbol = ? AND created_at >= ?
        ORDER BY event_time DESC
        LIMIT 20
      `;

      const recent = await db.all<StoredLiquidation>(recentSql, [symbol, since]);

      // Time between liquidations (for frequency analysis)
      const timesBetweenSql = `
        SELECT event_time FROM liquidations
        WHERE symbol = ? AND created_at >= ?
        ORDER BY event_time ASC
      `;

      const times = await db.all<{ event_time: number }>(timesBetweenSql, [symbol, since]);
      
      // event_time is in milliseconds, convert intervals to seconds
      let avgTimeBetween = 0;
      if (times.length > 1) {
        const intervals: number[] = [];
        for (let i = 1; i < times.length; i++) {
          intervals.push((times[i].event_time - times[i - 1].event_time) / 1000);
        }
        avgTimeBetween = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      }

      return {
        symbol,
        stats: {
          count: stats.liq_count,
          totalVolume: stats.total_volume,
          avgVolume: stats.avg_volume,
          maxVolume: stats.max_volume,
          minVolume: stats.min_volume,
          longLiqs: stats.long_liqs,
          shortLiqs: stats.short_liqs,
          longVolume: stats.long_volume,
          shortVolume: stats.short_volume,
          longRatio: stats.liq_count > 0 ? stats.long_liqs / stats.liq_count : 0,
          avgTimeBetweenSeconds: avgTimeBetween,
          frequencyPerHour: avgTimeBetween > 0 ? 3600 / avgTimeBetween : 0,
        },
        hourlyDistribution: hourlyDist,
        recentLiquidations: recent,
      };
    } catch (error) {
      console.error('Error getting symbol details:', error);
      return null;
    }
  }

  /**
   * Get database summary info
   */
  async getDatabaseInfo(): Promise<DatabaseInfo> {
    try {
      const infoSql = `
        SELECT
          COUNT(*) as total_records,
          MIN(created_at) as oldest_record,
          MAX(created_at) as newest_record,
          COUNT(DISTINCT symbol) as unique_symbols
        FROM liquidations
      `;

      const info = await db.get<{
        total_records: number;
        oldest_record: number;
        newest_record: number;
        unique_symbols: number;
      }>(infoSql, []);

      return {
        totalRecords: info?.total_records || 0,
        oldestRecord: info?.oldest_record || 0,
        newestRecord: info?.newest_record || 0,
        uniqueSymbols: info?.unique_symbols || 0,
        dataSpanDays: info?.oldest_record && info?.newest_record 
          ? (info.newest_record - info.oldest_record) / 86400 
          : 0,
      };
    } catch (error) {
      console.error('Error getting database info:', error);
      return {
        totalRecords: 0,
        oldestRecord: 0,
        newestRecord: 0,
        uniqueSymbols: 0,
        dataSpanDays: 0,
      };
    }
  }
}

// New interfaces for discovery
export interface DiscoveryStats {
  timeWindow: number;
  totals: {
    count: number;
    volume: number;
    uniqueSymbols: number;
  };
  symbols: Array<{
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
  }>;
  hourlyDistribution: Array<{
    hour: number;
    count: number;
    volume: number;
  }>;
  dailyDistribution: Array<{
    day_of_week: number;
    count: number;
    volume: number;
  }>;
  calendarHeatmap: Array<{
    date: string;
    day_of_week: number;
    count: number;
    volume: number;
    unique_symbols: number;
  }>;
  recentLargeLiqs: Array<{
    symbol: string;
    side: string;
    volume_usdt: number;
    price: number;
    event_time: number;
  }>;
}

export interface SymbolDetailStats {
  symbol: string;
  stats: {
    count: number;
    totalVolume: number;
    avgVolume: number;
    maxVolume: number;
    minVolume: number;
    longLiqs: number;
    shortLiqs: number;
    longVolume: number;
    shortVolume: number;
    longRatio: number;
    avgTimeBetweenSeconds: number;
    frequencyPerHour: number;
  };
  hourlyDistribution: Array<{
    hour: number;
    count: number;
    volume: number;
  }>;
  recentLiquidations: StoredLiquidation[];
}

export interface DatabaseInfo {
  totalRecords: number;
  oldestRecord: number;
  newestRecord: number;
  uniqueSymbols: number;
  dataSpanDays: number;
}

export const liquidationStorage = new LiquidationStorage();