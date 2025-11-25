import { db } from './database';
import { Tranche, TrancheEvent } from '../types';

// Initialize tranche tables
export async function initTrancheTables(): Promise<void> {
  // Tranches table
  await db.run(`
    CREATE TABLE IF NOT EXISTS tranches (
      -- Identity
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      position_side TEXT NOT NULL,

      -- Entry details
      entry_price REAL NOT NULL,
      quantity REAL NOT NULL,
      margin_used REAL NOT NULL,
      leverage INTEGER NOT NULL,
      entry_time INTEGER NOT NULL,
      entry_order_id TEXT,

      -- Exit details
      exit_price REAL,
      exit_time INTEGER,
      exit_order_id TEXT,

      -- P&L tracking
      unrealized_pnl REAL DEFAULT 0,
      realized_pnl REAL DEFAULT 0,

      -- Risk management
      tp_percent REAL NOT NULL,
      sl_percent REAL NOT NULL,
      tp_price REAL NOT NULL,
      sl_price REAL NOT NULL,

      -- Status
      status TEXT DEFAULT 'active',
      isolated INTEGER DEFAULT 0,
      isolation_time INTEGER,
      isolation_price REAL,

      -- Metadata
      notes TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Indexes for performance
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_tranches_symbol_side_status
      ON tranches(symbol, side, status)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_tranches_status
      ON tranches(status)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_tranches_entry_time
      ON tranches(entry_time DESC)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_tranches_isolated
      ON tranches(isolated, status)
  `);

  // Tranche events table (audit trail)
  await db.run(`
    CREATE TABLE IF NOT EXISTS tranche_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tranche_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_time INTEGER NOT NULL,

      -- Event details
      price REAL,
      quantity REAL,
      pnl REAL,

      -- Context
      trigger TEXT,
      metadata TEXT,

      FOREIGN KEY (tranche_id) REFERENCES tranches(id)
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_tranche_events_tranche_id
      ON tranche_events(tranche_id)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_tranche_events_time
      ON tranche_events(event_time DESC)
  `);
}

// Helper to convert DB row to Tranche object
function rowToTranche(row: any): Tranche {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side as 'LONG' | 'SHORT',
    positionSide: row.position_side as 'LONG' | 'SHORT' | 'BOTH',
    entryPrice: row.entry_price,
    quantity: row.quantity,
    marginUsed: row.margin_used,
    leverage: row.leverage,
    entryTime: row.entry_time,
    entryOrderId: row.entry_order_id || undefined,
    exitPrice: row.exit_price || undefined,
    exitTime: row.exit_time || undefined,
    exitOrderId: row.exit_order_id || undefined,
    unrealizedPnl: row.unrealized_pnl,
    realizedPnl: row.realized_pnl,
    tpPercent: row.tp_percent,
    slPercent: row.sl_percent,
    tpPrice: row.tp_price,
    slPrice: row.sl_price,
    status: row.status as 'active' | 'closed' | 'liquidated',
    isolated: Boolean(row.isolated),
    isolationTime: row.isolation_time || undefined,
    isolationPrice: row.isolation_price || undefined,
    notes: row.notes || undefined,
  };
}

// Create a new tranche
export async function createTranche(tranche: Tranche): Promise<void> {
  await db.run(
    `
    INSERT INTO tranches (
      id, symbol, side, position_side,
      entry_price, quantity, margin_used, leverage, entry_time, entry_order_id,
      exit_price, exit_time, exit_order_id,
      unrealized_pnl, realized_pnl,
      tp_percent, sl_percent, tp_price, sl_price,
      status, isolated, isolation_time, isolation_price,
      notes
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?
    )
  `,
    [
      tranche.id,
      tranche.symbol,
      tranche.side,
      tranche.positionSide,
      tranche.entryPrice,
      tranche.quantity,
      tranche.marginUsed,
      tranche.leverage,
      tranche.entryTime,
      tranche.entryOrderId || null,
      tranche.exitPrice || null,
      tranche.exitTime || null,
      tranche.exitOrderId || null,
      tranche.unrealizedPnl,
      tranche.realizedPnl,
      tranche.tpPercent,
      tranche.slPercent,
      tranche.tpPrice,
      tranche.slPrice,
      tranche.status,
      tranche.isolated ? 1 : 0,
      tranche.isolationTime || null,
      tranche.isolationPrice || null,
      tranche.notes || null,
    ]
  );
}

// Get a single tranche by ID
export async function getTranche(id: string): Promise<Tranche | null> {
  const row = await db.get('SELECT * FROM tranches WHERE id = ?', [id]);
  return row ? rowToTranche(row) : null;
}

// Get all active tranches for a symbol and side
export async function getActiveTranches(symbol: string, side: string): Promise<Tranche[]> {
  const rows = await db.all<any>(
    `
    SELECT * FROM tranches
    WHERE symbol = ? AND side = ? AND status = 'active'
    ORDER BY entry_time ASC
  `,
    [symbol, side]
  );

  return rows.map(rowToTranche);
}

// Get all isolated tranches for a symbol and side
export async function getIsolatedTranches(symbol: string, side: string): Promise<Tranche[]> {
  const rows = await db.all<any>(
    `
    SELECT * FROM tranches
    WHERE symbol = ? AND side = ? AND status = 'active' AND isolated = 1
    ORDER BY isolation_time ASC
  `,
    [symbol, side]
  );

  return rows.map(rowToTranche);
}

// Get all tranches (active and closed) for a symbol
export async function getAllTranchesForSymbol(symbol: string): Promise<Tranche[]> {
  const rows = await db.all<any>(
    `
    SELECT * FROM tranches
    WHERE symbol = ?
    ORDER BY entry_time DESC
  `,
    [symbol]
  );

  return rows.map(rowToTranche);
}

// Update a tranche
export async function updateTranche(id: string, updates: Partial<Tranche>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];

  // Build dynamic UPDATE statement
  if (updates.quantity !== undefined) {
    fields.push('quantity = ?');
    values.push(updates.quantity);
  }
  if (updates.marginUsed !== undefined) {
    fields.push('margin_used = ?');
    values.push(updates.marginUsed);
  }
  if (updates.unrealizedPnl !== undefined) {
    fields.push('unrealized_pnl = ?');
    values.push(updates.unrealizedPnl);
  }
  if (updates.realizedPnl !== undefined) {
    fields.push('realized_pnl = ?');
    values.push(updates.realizedPnl);
  }
  if (updates.exitPrice !== undefined) {
    fields.push('exit_price = ?');
    values.push(updates.exitPrice);
  }
  if (updates.exitTime !== undefined) {
    fields.push('exit_time = ?');
    values.push(updates.exitTime);
  }
  if (updates.exitOrderId !== undefined) {
    fields.push('exit_order_id = ?');
    values.push(updates.exitOrderId);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.isolated !== undefined) {
    fields.push('isolated = ?');
    values.push(updates.isolated ? 1 : 0);
  }
  if (updates.isolationTime !== undefined) {
    fields.push('isolation_time = ?');
    values.push(updates.isolationTime);
  }
  if (updates.isolationPrice !== undefined) {
    fields.push('isolation_price = ?');
    values.push(updates.isolationPrice);
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?');
    values.push(updates.notes);
  }

  if (fields.length === 0) return; // No updates

  // Always update timestamp
  fields.push('updated_at = strftime("%s", "now")');

  values.push(id); // Add ID for WHERE clause

  const sql = `UPDATE tranches SET ${fields.join(', ')} WHERE id = ?`;
  await db.run(sql, values);
}

// Update unrealized P&L for a tranche (fast path for frequent updates)
export async function updateTrancheUnrealizedPnl(id: string, pnl: number): Promise<void> {
  await db.run(
    `
    UPDATE tranches
    SET unrealized_pnl = ?, updated_at = strftime('%s', 'now')
    WHERE id = ?
  `,
    [pnl, id]
  );
}

// Isolate a tranche
export async function isolateTranche(id: string, price: number): Promise<void> {
  await db.run(
    `
    UPDATE tranches
    SET isolated = 1, isolation_time = ?, isolation_price = ?, updated_at = strftime('%s', 'now')
    WHERE id = ?
  `,
    [Date.now(), price, id]
  );
}

// Close a tranche
export async function closeTranche(
  id: string,
  exitPrice: number,
  realizedPnl: number,
  orderId?: string
): Promise<void> {
  await db.run(
    `
    UPDATE tranches
    SET status = 'closed', exit_price = ?, exit_time = ?, exit_order_id = ?,
        realized_pnl = ?, updated_at = strftime('%s', 'now')
    WHERE id = ?
  `,
    [exitPrice, Date.now(), orderId || null, realizedPnl, id]
  );
}

// Liquidate a tranche
export async function liquidateTranche(id: string, liquidationPrice: number): Promise<void> {
  await db.run(
    `
    UPDATE tranches
    SET status = 'liquidated', exit_price = ?, exit_time = ?, updated_at = strftime('%s', 'now')
    WHERE id = ?
  `,
    [liquidationPrice, Date.now(), id]
  );
}

// Log a tranche event
export async function logTrancheEvent(
  trancheId: string,
  eventType: 'created' | 'isolated' | 'closed' | 'liquidated' | 'updated',
  data: {
    price?: number;
    quantity?: number;
    pnl?: number;
    trigger?: string;
    metadata?: any;
  }
): Promise<void> {
  await db.run(
    `
    INSERT INTO tranche_events (
      tranche_id, event_type, event_time, price, quantity, pnl, trigger, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      trancheId,
      eventType,
      Date.now(),
      data.price || null,
      data.quantity || null,
      data.pnl || null,
      data.trigger || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]
  );
}

// Get event history for a tranche
export async function getTrancheHistory(trancheId: string): Promise<TrancheEvent[]> {
  const rows = await db.all<any>(
    `
    SELECT * FROM tranche_events
    WHERE tranche_id = ?
    ORDER BY event_time DESC
  `,
    [trancheId]
  );

  return rows.map((row) => ({
    id: row.id,
    trancheId: row.tranche_id,
    eventType: row.event_type,
    eventTime: row.event_time,
    price: row.price || undefined,
    quantity: row.quantity || undefined,
    pnl: row.pnl || undefined,
    trigger: row.trigger || undefined,
    metadata: row.metadata || undefined,
  }));
}

// Clean up old closed tranches
export async function cleanupOldTranches(daysToKeep: number = 30): Promise<number> {
  const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

  await db.run(
    `
    DELETE FROM tranches
    WHERE status IN ('closed', 'liquidated') AND exit_time < ?
  `,
    [cutoffTime]
  );

  // Return approximate count (sqlite3 doesn't support RETURNING)
  const result = await db.get<{ count: number }>(
    `
    SELECT COUNT(*) as count FROM tranches
    WHERE status IN ('closed', 'liquidated') AND exit_time < ?
  `,
    [cutoffTime]
  );

  return result?.count || 0;
}

// Get statistics
export async function getTrancheStats(): Promise<{
  totalActive: number;
  totalIsolated: number;
  totalClosed: number;
  totalLiquidated: number;
  totalPnl: number;
}> {
  const row = await db.get<any>(`
    SELECT
      SUM(CASE WHEN status = 'active' AND isolated = 0 THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'active' AND isolated = 1 THEN 1 ELSE 0 END) as isolated,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN status = 'liquidated' THEN 1 ELSE 0 END) as liquidated,
      SUM(CASE WHEN status IN ('closed', 'liquidated') THEN realized_pnl ELSE 0 END) as total_pnl
    FROM tranches
  `);

  return {
    totalActive: row?.active || 0,
    totalIsolated: row?.isolated || 0,
    totalClosed: row?.closed || 0,
    totalLiquidated: row?.liquidated || 0,
    totalPnl: row?.total_pnl || 0,
  };
}
