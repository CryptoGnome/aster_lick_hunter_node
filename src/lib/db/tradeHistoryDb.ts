/**
 * Trade History Database
 * 
 * Persists all order fills and trade events to local SQLite for:
 * - Deep history in Recent Orders (beyond exchange API limits)
 * - Trade markers on TradingView chart going back months
 * - Performance analytics without hitting exchange rate limits
 * - Offline access to trade history
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const DB_PATH = path.join(dataDir, 'trade_history.db');

export interface TradeHistoryRecord {
  id?: number;
  symbol: string;
  orderId: number;
  clientOrderId?: string;
  side: string;         // BUY or SELL
  positionSide: string; // BOTH, LONG, SHORT
  orderType: string;    // MARKET, LIMIT, STOP_MARKET, TAKE_PROFIT_MARKET, etc.
  origType?: string;    // Original order type (for SL/TP orders)
  status: string;       // FILLED, PARTIALLY_FILLED, CANCELED, etc.
  price: string;        // Order price (may be "0" for MARKET orders)
  avgPrice: string;     // Actual fill price
  origQty: string;      // Original quantity
  executedQty: string;  // Filled quantity
  lastFilledQty?: string;
  lastFilledPrice?: string;
  quoteQty?: string;    // Quote asset volume (notional)
  commission?: string;
  commissionAsset?: string;
  realizedPnl: string;  // Realized profit/loss for this fill
  reduceOnly: boolean;
  closePosition: boolean;
  isMaker: boolean;
  tradeId?: number;
  orderTime: number;    // When the order was placed
  updateTime: number;   // When this status update happened
  // Source of the record
  source: 'websocket' | 'api_backfill';
}

export interface TradeHistoryFilter {
  symbol?: string;
  side?: string;
  status?: string | string[];
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
  orderType?: string | string[];
  reduceOnly?: boolean;
}

class TradeHistoryDb {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trade_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        order_id INTEGER NOT NULL,
        client_order_id TEXT,
        side TEXT NOT NULL,
        position_side TEXT DEFAULT 'BOTH',
        order_type TEXT NOT NULL,
        orig_type TEXT,
        status TEXT NOT NULL,
        price TEXT DEFAULT '0',
        avg_price TEXT DEFAULT '0',
        orig_qty TEXT DEFAULT '0',
        executed_qty TEXT DEFAULT '0',
        last_filled_qty TEXT,
        last_filled_price TEXT,
        quote_qty TEXT,
        commission TEXT DEFAULT '0',
        commission_asset TEXT,
        realized_pnl TEXT DEFAULT '0',
        reduce_only INTEGER DEFAULT 0,
        close_position INTEGER DEFAULT 0,
        is_maker INTEGER DEFAULT 0,
        trade_id INTEGER,
        order_time INTEGER NOT NULL,
        update_time INTEGER NOT NULL,
        source TEXT DEFAULT 'websocket',
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(symbol, order_id, update_time)
      );

      CREATE INDEX IF NOT EXISTS idx_trade_history_symbol ON trade_history(symbol);
      CREATE INDEX IF NOT EXISTS idx_trade_history_update_time ON trade_history(update_time);
      CREATE INDEX IF NOT EXISTS idx_trade_history_status ON trade_history(status);
      CREATE INDEX IF NOT EXISTS idx_trade_history_order_id ON trade_history(order_id);
      CREATE INDEX IF NOT EXISTS idx_trade_history_symbol_time ON trade_history(symbol, update_time);

      -- Income history table for PnL, commissions, funding fees
      CREATE TABLE IF NOT EXISTS income_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tran_id INTEGER UNIQUE,
        symbol TEXT,
        income_type TEXT NOT NULL,
        income TEXT NOT NULL,
        asset TEXT DEFAULT 'USDT',
        info TEXT,
        trade_id TEXT,
        time INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_income_time ON income_history(time);
      CREATE INDEX IF NOT EXISTS idx_income_type ON income_history(income_type);
      CREATE INDEX IF NOT EXISTS idx_income_symbol ON income_history(symbol);

      -- Metadata table for tracking backfill progress
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);
  }

  /**
   * Insert or update a trade/order event
   * Uses UPSERT to handle duplicate WebSocket events
   */
  upsertTrade(record: TradeHistoryRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO trade_history (
        symbol, order_id, client_order_id, side, position_side,
        order_type, orig_type, status, price, avg_price,
        orig_qty, executed_qty, last_filled_qty, last_filled_price,
        quote_qty, commission, commission_asset, realized_pnl,
        reduce_only, close_position, is_maker, trade_id,
        order_time, update_time, source
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(symbol, order_id, update_time) DO UPDATE SET
        status = excluded.status,
        avg_price = excluded.avg_price,
        executed_qty = excluded.executed_qty,
        last_filled_qty = excluded.last_filled_qty,
        last_filled_price = excluded.last_filled_price,
        quote_qty = excluded.quote_qty,
        commission = excluded.commission,
        commission_asset = excluded.commission_asset,
        realized_pnl = excluded.realized_pnl,
        is_maker = excluded.is_maker,
        trade_id = excluded.trade_id
    `);

    stmt.run(
      record.symbol,
      record.orderId,
      record.clientOrderId || null,
      record.side,
      record.positionSide || 'BOTH',
      record.orderType,
      record.origType || null,
      record.status,
      record.price || '0',
      record.avgPrice || '0',
      record.origQty || '0',
      record.executedQty || '0',
      record.lastFilledQty || null,
      record.lastFilledPrice || null,
      record.quoteQty || null,
      record.commission || '0',
      record.commissionAsset || null,
      record.realizedPnl || '0',
      record.reduceOnly ? 1 : 0,
      record.closePosition ? 1 : 0,
      record.isMaker ? 1 : 0,
      record.tradeId || null,
      record.orderTime,
      record.updateTime,
      record.source
    );
  }

  /**
   * Batch insert for backfill operations
   */
  batchUpsertTrades(records: TradeHistoryRecord[]): void {
    const transaction = this.db.transaction((recs: TradeHistoryRecord[]) => {
      for (const rec of recs) {
        this.upsertTrade(rec);
      }
    });
    transaction(records);
  }

  /**
   * Insert income record (PnL, commission, funding)
   */
  upsertIncome(record: {
    tranId: number;
    symbol: string;
    incomeType: string;
    income: string;
    asset: string;
    info?: string;
    tradeId?: string;
    time: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO income_history (
        tran_id, symbol, income_type, income, asset, info, trade_id, time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.tranId,
      record.symbol || null,
      record.incomeType,
      record.income,
      record.asset || 'USDT',
      record.info || null,
      record.tradeId || null,
      record.time
    );
  }

  /**
   * Batch insert income records
   */
  batchUpsertIncome(records: Array<{
    tranId: number;
    symbol: string;
    incomeType: string;
    income: string;
    asset: string;
    info?: string;
    tradeId?: string;
    time: number;
  }>): void {
    const transaction = this.db.transaction((recs: typeof records) => {
      for (const rec of recs) {
        this.upsertIncome(rec);
      }
    });
    transaction(records);
  }

  /**
   * Query trade history with flexible filtering
   */
  queryTrades(filter: TradeHistoryFilter = {}): TradeHistoryRecord[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.symbol) {
      conditions.push('symbol = ?');
      params.push(filter.symbol);
    }
    if (filter.side) {
      conditions.push('side = ?');
      params.push(filter.side);
    }
    if (filter.status) {
      if (Array.isArray(filter.status)) {
        conditions.push(`status IN (${filter.status.map(() => '?').join(',')})`);
        params.push(...filter.status);
      } else {
        conditions.push('status = ?');
        params.push(filter.status);
      }
    }
    if (filter.startTime) {
      conditions.push('update_time >= ?');
      params.push(filter.startTime);
    }
    if (filter.endTime) {
      conditions.push('update_time <= ?');
      params.push(filter.endTime);
    }
    if (filter.orderType) {
      if (Array.isArray(filter.orderType)) {
        conditions.push(`order_type IN (${filter.orderType.map(() => '?').join(',')})`);
        params.push(...filter.orderType);
      } else {
        conditions.push('order_type = ?');
        params.push(filter.orderType);
      }
    }
    if (filter.reduceOnly !== undefined) {
      conditions.push('reduce_only = ?');
      params.push(filter.reduceOnly ? 1 : 0);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit || 200;
    const offset = filter.offset || 0;

    const sql = `
      SELECT * FROM trade_history
      ${where}
      ORDER BY update_time DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    return this.db.prepare(sql).all(...params) as any[];
  }

  /**
   * Get the most recent FILLED trades (for Recent Orders display)
   * Returns in the Order format expected by the UI
   */
  getRecentFilledOrders(options: {
    symbol?: string;
    limit?: number;
    startTime?: number;
  } = {}): any[] {
    const conditions = ["status = 'FILLED'"];
    const params: any[] = [];

    if (options.symbol) {
      conditions.push('symbol = ?');
      params.push(options.symbol);
    }
    if (options.startTime) {
      conditions.push('update_time >= ?');
      params.push(options.startTime);
    }

    const limit = options.limit || 100;
    const where = conditions.join(' AND ');

    const rows = this.db.prepare(`
      SELECT * FROM trade_history
      WHERE ${where}
      ORDER BY update_time DESC
      LIMIT ?
    `).all(...params, limit) as any[];

    // Convert to Order format for UI compatibility
    return rows.map(row => ({
      symbol: row.symbol,
      orderId: row.order_id,
      clientOrderId: row.client_order_id,
      price: row.price,
      origQty: row.orig_qty,
      executedQty: row.executed_qty,
      status: row.status,
      timeInForce: 'GTC',
      type: row.order_type,
      side: row.side,
      stopPrice: '0',
      time: row.order_time,
      updateTime: row.update_time,
      positionSide: row.position_side,
      closePosition: !!row.close_position,
      reduceOnly: !!row.reduce_only,
      avgPrice: row.avg_price,
      origType: row.orig_type,
      realizedProfit: row.realized_pnl,
      commission: row.commission,
      commissionAsset: row.commission_asset,
      isMaker: !!row.is_maker,
      lastFilledQty: row.last_filled_qty,
      lastFilledPrice: row.last_filled_price,
      tradeId: row.trade_id,
    }));
  }

  /**
   * Get trade markers for TradingView chart
   * Returns simplified records optimized for chart markers
   */
  getChartMarkers(symbol: string, startTime: number, endTime?: number): Array<{
    time: number;
    side: string;
    price: number;
    qty: number;
    pnl: number;
    reduceOnly: boolean;
    orderType: string;
  }> {
    const conditions = ["symbol = ?", "status = 'FILLED'"];
    const params: any[] = [symbol];

    conditions.push('update_time >= ?');
    params.push(startTime);

    if (endTime) {
      conditions.push('update_time <= ?');
      params.push(endTime);
    }

    const rows = this.db.prepare(`
      SELECT update_time, side, avg_price, executed_qty, realized_pnl, reduce_only, order_type
      FROM trade_history
      WHERE ${conditions.join(' AND ')}
      ORDER BY update_time ASC
    `).all(...params) as any[];

    return rows.map(row => ({
      time: row.update_time,
      side: row.side,
      price: parseFloat(row.avg_price),
      qty: parseFloat(row.executed_qty),
      pnl: parseFloat(row.realized_pnl || '0'),
      reduceOnly: !!row.reduce_only,
      orderType: row.order_type,
    }));
  }

  /**
   * Get income breakdown for analytics
   */
  getIncomeBreakdown(options: {
    startTime?: number;
    endTime?: number;
    symbol?: string;
  } = {}): {
    realizedPnl: number;
    commission: number;
    funding: number;
    netProfit: number;
  } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.startTime) {
      conditions.push('time >= ?');
      params.push(options.startTime);
    }
    if (options.endTime) {
      conditions.push('time <= ?');
      params.push(options.endTime);
    }
    if (options.symbol) {
      conditions.push('symbol = ?');
      params.push(options.symbol);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = this.db.prepare(`
      SELECT income_type, SUM(CAST(income AS REAL)) as total
      FROM income_history
      ${where}
      GROUP BY income_type
    `).all(...params) as any[];

    const result = {
      realizedPnl: 0,
      commission: 0,
      funding: 0,
      netProfit: 0,
    };

    for (const row of rows) {
      switch (row.income_type) {
        case 'REALIZED_PNL':
          result.realizedPnl = row.total;
          break;
        case 'COMMISSION':
          result.commission = row.total;
          break;
        case 'FUNDING_FEE':
          result.funding = row.total;
          break;
      }
    }

    result.netProfit = result.realizedPnl + result.commission + result.funding;
    return result;
  }

  /**
   * Get total trade count (for stats)
   */
  getTradeCount(filter?: { symbol?: string; status?: string }): number {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.symbol) {
      conditions.push('symbol = ?');
      params.push(filter.symbol);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM trade_history ${where}`).get(...params) as any;
    return row?.count || 0;
  }

  /**
   * Get sync metadata (for tracking backfill progress)
   */
  getSyncMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get(key) as any;
    return row?.value || null;
  }

  /**
   * Set sync metadata
   */
  setSyncMeta(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO sync_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, Date.now());
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

// Singleton export
export const tradeHistoryDb = new TradeHistoryDb();
