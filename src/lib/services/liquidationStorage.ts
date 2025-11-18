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
  async saveLiquidation(event: LiquidationEvent, volumeUSDT: number): Promise<void> {
    const sql = `
      INSERT INTO liquidations (
        symbol, side, order_type, quantity, price, average_price,
        volume_usdt, order_status, order_last_filled_quantity,
        order_filled_accumulated_quantity, order_trade_time,
        event_time, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

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

    try {
      await db.run(sql, params);
    } catch (error) {
      console.error('Error saving liquidation:', error);
    }
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
}

export const liquidationStorage = new LiquidationStorage();