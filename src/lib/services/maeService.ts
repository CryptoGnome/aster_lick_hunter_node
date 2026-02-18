/**
 * MAE/MFE Tracking Service
 * 
 * Tracks Maximum Adverse Excursion (MAE) and Maximum Favorable Excursion (MFE)
 * for each trade to help optimize stop-loss and take-profit placement.
 * 
 * MAE = Maximum drawdown during a trade before it closed (how far against you)
 * MFE = Maximum profit during a trade before it closed (how far in your favor)
 * 
 * This data helps answer:
 * - Are stop-losses too tight? (getting stopped out before price reverses)
 * - Are take-profits too tight? (leaving money on the table)
 * - What's the typical heat on winning vs losing trades?
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import path from 'path';
import { getPriceService } from './priceService';

// Track live position price extremes
interface PositionExcursion {
  positionId: string;        // symbol_side_timestamp
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTime: number;
  quantity: number;
  leverage: number;
  
  // Track extremes
  highPrice: number;         // Highest price seen while position open
  lowPrice: number;          // Lowest price seen while position open
  highPriceTime: number;     // When high was hit
  lowPriceTime: number;      // When low was hit
  
  // Quality score at entry (if available)
  qualityScore?: number;
  
  // Last update time
  lastUpdate: number;
}

// Final MAE/MFE record when position closes
export interface MAEMFERecord {
  id?: number;
  positionId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  quantity: number;
  leverage: number;
  
  // Excursion metrics
  maePercent: number;        // Max adverse excursion as % of entry
  mfePercent: number;        // Max favorable excursion as % of entry  
  maePrice: number;          // Price at max adverse point
  mfePrice: number;          // Price at max favorable point
  maeTime: number;           // Time of max adverse
  mfeTime: number;           // Time of max favorable
  
  // Trade outcome
  pnlPercent: number;        // Final P&L as % of entry
  pnlUSDT: number;           // Final P&L in USDT
  isWinner: boolean;
  
  // Duration
  durationSeconds: number;
  
  // Quality score at entry
  qualityScore?: number;
  
  // Analysis helpers
  maeToMfeRatio: number;     // How much heat vs profit potential
  capturedMfePercent: number; // How much of MFE was captured (exit vs peak)
}

class MAEService extends EventEmitter {
  private db: Database.Database | null = null;
  private activePositions: Map<string, PositionExcursion> = new Map();
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    super();
  }

  /**
   * Initialize the service and database
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    try {
      // Initialize database
      const dbPath = path.join(process.cwd(), 'data', 'trade_quality.db');
      this.db = new Database(dbPath);
      
      // Create MAE/MFE table if not exists
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS mae_mfe_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          position_id TEXT NOT NULL UNIQUE,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          entry_price REAL NOT NULL,
          exit_price REAL NOT NULL,
          entry_time INTEGER NOT NULL,
          exit_time INTEGER NOT NULL,
          quantity REAL NOT NULL,
          leverage INTEGER NOT NULL,
          
          mae_percent REAL NOT NULL,
          mfe_percent REAL NOT NULL,
          mae_price REAL NOT NULL,
          mfe_price REAL NOT NULL,
          mae_time INTEGER NOT NULL,
          mfe_time INTEGER NOT NULL,
          
          pnl_percent REAL NOT NULL,
          pnl_usdt REAL NOT NULL,
          is_winner INTEGER NOT NULL,
          
          duration_seconds INTEGER NOT NULL,
          quality_score INTEGER,
          
          mae_to_mfe_ratio REAL NOT NULL,
          captured_mfe_percent REAL NOT NULL,
          
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_mae_symbol ON mae_mfe_records(symbol);
        CREATE INDEX IF NOT EXISTS idx_mae_side ON mae_mfe_records(side);
        CREATE INDEX IF NOT EXISTS idx_mae_winner ON mae_mfe_records(is_winner);
        CREATE INDEX IF NOT EXISTS idx_mae_entry_time ON mae_mfe_records(entry_time DESC);
      `);
      
      // Start price monitoring
      this.startPriceMonitoring();
      
      this.isRunning = true;
      console.log('📊 MAE/MFE Service: Started');
    } catch (error) {
      console.error('❌ MAE/MFE Service: Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
    
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    this.activePositions.clear();
    this.isRunning = false;
    console.log('📊 MAE/MFE Service: Stopped');
  }

  /**
   * Start tracking a new position
   */
  trackPosition(
    symbol: string,
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    quantity: number,
    leverage: number,
    qualityScore?: number
  ): string {
    const now = Date.now();
    const positionId = `${symbol}_${side}_${now}`;
    
    const excursion: PositionExcursion = {
      positionId,
      symbol,
      side,
      entryPrice,
      entryTime: now,
      quantity,
      leverage,
      highPrice: entryPrice,
      lowPrice: entryPrice,
      highPriceTime: now,
      lowPriceTime: now,
      qualityScore,
      lastUpdate: now
    };
    
    this.activePositions.set(positionId, excursion);
    console.log(`📊 MAE/MFE: Tracking ${symbol} ${side} @ ${entryPrice}`);
    
    return positionId;
  }

  /**
   * Find and track an existing position by symbol/side
   */
  findOrCreatePosition(
    symbol: string,
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    quantity: number,
    leverage: number,
    qualityScore?: number
  ): string {
    // Look for existing position with same symbol/side
    for (const [id, pos] of Array.from(this.activePositions.entries())) {
      if (pos.symbol === symbol && pos.side === side) {
        return id;
      }
    }
    
    // Create new tracking
    return this.trackPosition(symbol, side, entryPrice, quantity, leverage, qualityScore);
  }

  /**
   * Update position with current price
   */
  updatePrice(symbol: string, currentPrice: number): void {
    const now = Date.now();
    
    for (const [_id, position] of Array.from(this.activePositions.entries())) {
      if (position.symbol !== symbol) continue;
      
      // Update high price
      if (currentPrice > position.highPrice) {
        position.highPrice = currentPrice;
        position.highPriceTime = now;
      }
      
      // Update low price
      if (currentPrice < position.lowPrice) {
        position.lowPrice = currentPrice;
        position.lowPriceTime = now;
      }
      
      position.lastUpdate = now;
    }
  }

  /**
   * Close position and record final MAE/MFE
   */
  closePosition(
    symbol: string,
    side: 'LONG' | 'SHORT',
    exitPrice: number,
    pnlUSDT: number
  ): MAEMFERecord | null {
    // Find the position
    let positionId: string | null = null;
    let position: PositionExcursion | null = null;
    
    for (const [id, pos] of Array.from(this.activePositions.entries())) {
      if (pos.symbol === symbol && pos.side === side) {
        positionId = id;
        position = pos;
        break;
      }
    }
    
    if (!position || !positionId) {
      console.log(`📊 MAE/MFE: No tracked position found for ${symbol} ${side}`);
      return null;
    }
    
    const now = Date.now();
    
    // Calculate excursions based on position direction
    let maePercent: number;
    let mfePercent: number;
    let maePrice: number;
    let mfePrice: number;
    let maeTime: number;
    let mfeTime: number;
    
    if (side === 'LONG') {
      // For LONG: MAE is when price went lowest, MFE is when price went highest
      maePercent = ((position.entryPrice - position.lowPrice) / position.entryPrice) * 100;
      mfePercent = ((position.highPrice - position.entryPrice) / position.entryPrice) * 100;
      maePrice = position.lowPrice;
      mfePrice = position.highPrice;
      maeTime = position.lowPriceTime;
      mfeTime = position.highPriceTime;
    } else {
      // For SHORT: MAE is when price went highest, MFE is when price went lowest
      maePercent = ((position.highPrice - position.entryPrice) / position.entryPrice) * 100;
      mfePercent = ((position.entryPrice - position.lowPrice) / position.entryPrice) * 100;
      maePrice = position.highPrice;
      mfePrice = position.lowPrice;
      maeTime = position.highPriceTime;
      mfeTime = position.lowPriceTime;
    }
    
    // Calculate P&L percent
    const pnlPercent = side === 'LONG'
      ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100
      : ((position.entryPrice - exitPrice) / position.entryPrice) * 100;
    
    // Calculate how much of MFE was captured
    const capturedMfePercent = mfePercent > 0 ? (pnlPercent / mfePercent) * 100 : 0;
    
    // MAE to MFE ratio (lower is better - less heat for same profit potential)
    const maeToMfeRatio = mfePercent > 0 ? maePercent / mfePercent : maePercent;
    
    const record: MAEMFERecord = {
      positionId,
      symbol,
      side,
      entryPrice: position.entryPrice,
      exitPrice,
      entryTime: position.entryTime,
      exitTime: now,
      quantity: position.quantity,
      leverage: position.leverage,
      maePercent,
      mfePercent,
      maePrice,
      mfePrice,
      maeTime,
      mfeTime,
      pnlPercent,
      pnlUSDT,
      isWinner: pnlUSDT > 0,
      durationSeconds: Math.floor((now - position.entryTime) / 1000),
      qualityScore: position.qualityScore,
      maeToMfeRatio,
      capturedMfePercent
    };
    
    // Save to database
    this.saveRecord(record);
    
    // Remove from active tracking
    this.activePositions.delete(positionId);
    
    // Log summary
    const winLoss = record.isWinner ? '✅ WIN' : '❌ LOSS';
    console.log(`📊 MAE/MFE: ${symbol} ${side} closed - ${winLoss}`);
    console.log(`   Entry: $${position.entryPrice.toFixed(4)} → Exit: $${exitPrice.toFixed(4)}`);
    console.log(`   MAE: ${maePercent.toFixed(2)}% | MFE: ${mfePercent.toFixed(2)}% | P&L: ${pnlPercent.toFixed(2)}%`);
    console.log(`   Captured ${capturedMfePercent.toFixed(0)}% of max favorable move`);
    
    this.emit('positionClosed', record);
    
    return record;
  }

  /**
   * Save record to database
   */
  private saveRecord(record: MAEMFERecord): void {
    if (!this.db) return;
    
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO mae_mfe_records (
          position_id, symbol, side, entry_price, exit_price,
          entry_time, exit_time, quantity, leverage,
          mae_percent, mfe_percent, mae_price, mfe_price, mae_time, mfe_time,
          pnl_percent, pnl_usdt, is_winner,
          duration_seconds, quality_score,
          mae_to_mfe_ratio, captured_mfe_percent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        record.positionId,
        record.symbol,
        record.side,
        record.entryPrice,
        record.exitPrice,
        record.entryTime,
        record.exitTime,
        record.quantity,
        record.leverage,
        record.maePercent,
        record.mfePercent,
        record.maePrice,
        record.mfePrice,
        record.maeTime,
        record.mfeTime,
        record.pnlPercent,
        record.pnlUSDT,
        record.isWinner ? 1 : 0,
        record.durationSeconds,
        record.qualityScore ?? null,
        record.maeToMfeRatio,
        record.capturedMfePercent
      );
    } catch (error) {
      console.error('📊 MAE/MFE: Failed to save record:', error);
    }
  }

  /**
   * Get statistics for a symbol or all symbols
   */
  getStats(symbol?: string): {
    totalTrades: number;
    winners: number;
    losers: number;
    avgMaeWinners: number;
    avgMaeLosers: number;
    avgMfeWinners: number;
    avgMfeLosers: number;
    avgCapturedMfe: number;
    avgMaeToMfeRatio: number;
  } | null {
    if (!this.db) return null;
    
    try {
      const whereClause = symbol ? 'WHERE symbol = ?' : '';
      const params = symbol ? [symbol] : [];
      
      const stats = this.db.prepare(`
        SELECT
          COUNT(*) as total_trades,
          SUM(CASE WHEN is_winner = 1 THEN 1 ELSE 0 END) as winners,
          SUM(CASE WHEN is_winner = 0 THEN 1 ELSE 0 END) as losers,
          AVG(CASE WHEN is_winner = 1 THEN mae_percent ELSE NULL END) as avg_mae_winners,
          AVG(CASE WHEN is_winner = 0 THEN mae_percent ELSE NULL END) as avg_mae_losers,
          AVG(CASE WHEN is_winner = 1 THEN mfe_percent ELSE NULL END) as avg_mfe_winners,
          AVG(CASE WHEN is_winner = 0 THEN mfe_percent ELSE NULL END) as avg_mfe_losers,
          AVG(captured_mfe_percent) as avg_captured_mfe,
          AVG(mae_to_mfe_ratio) as avg_mae_to_mfe_ratio
        FROM mae_mfe_records
        ${whereClause}
      `).get(...params) as any;
      
      return {
        totalTrades: stats.total_trades || 0,
        winners: stats.winners || 0,
        losers: stats.losers || 0,
        avgMaeWinners: stats.avg_mae_winners || 0,
        avgMaeLosers: stats.avg_mae_losers || 0,
        avgMfeWinners: stats.avg_mfe_winners || 0,
        avgMfeLosers: stats.avg_mfe_losers || 0,
        avgCapturedMfe: stats.avg_captured_mfe || 0,
        avgMaeToMfeRatio: stats.avg_mae_to_mfe_ratio || 0
      };
    } catch (error) {
      console.error('📊 MAE/MFE: Failed to get stats:', error);
      return null;
    }
  }

  /**
   * Get recent records
   */
  getRecentRecords(limit: number = 20, symbol?: string): MAEMFERecord[] {
    if (!this.db) return [];
    
    try {
      const whereClause = symbol ? 'WHERE symbol = ?' : '';
      const params = symbol ? [symbol, limit] : [limit];
      
      const rows = this.db.prepare(`
        SELECT * FROM mae_mfe_records
        ${whereClause}
        ORDER BY exit_time DESC
        LIMIT ?
      `).all(...params) as any[];
      
      return rows.map(row => ({
        id: row.id,
        positionId: row.position_id,
        symbol: row.symbol,
        side: row.side as 'LONG' | 'SHORT',
        entryPrice: row.entry_price,
        exitPrice: row.exit_price,
        entryTime: row.entry_time,
        exitTime: row.exit_time,
        quantity: row.quantity,
        leverage: row.leverage,
        maePercent: row.mae_percent,
        mfePercent: row.mfe_percent,
        maePrice: row.mae_price,
        mfePrice: row.mfe_price,
        maeTime: row.mae_time,
        mfeTime: row.mfe_time,
        pnlPercent: row.pnl_percent,
        pnlUSDT: row.pnl_usdt,
        isWinner: row.is_winner === 1,
        durationSeconds: row.duration_seconds,
        qualityScore: row.quality_score,
        maeToMfeRatio: row.mae_to_mfe_ratio,
        capturedMfePercent: row.captured_mfe_percent
      }));
    } catch (error) {
      console.error('📊 MAE/MFE: Failed to get recent records:', error);
      return [];
    }
  }

  /**
   * Get active positions being tracked
   */
  getActivePositions(): PositionExcursion[] {
    return Array.from(this.activePositions.values());
  }

  /**
   * Start monitoring prices for active positions
   */
  private startPriceMonitoring(): void {
    // Check for price updates every second
    this.priceUpdateInterval = setInterval(() => {
      if (this.activePositions.size === 0) return;
      
      try {
        const priceService = getPriceService();
        
        for (const position of Array.from(this.activePositions.values())) {
          const priceData = priceService.getMarkPrice(position.symbol);
          if (priceData && priceData.markPrice) {
            const price = parseFloat(priceData.markPrice);
            if (!isNaN(price)) {
              this.updatePrice(position.symbol, price);
            }
          }
        }
      } catch {
        // Price service may not be available yet
      }
    }, 1000);
  }
}

// Singleton instance
let maeService: MAEService | null = null;

export function getMAEService(): MAEService {
  if (!maeService) {
    maeService = new MAEService();
  }
  return maeService;
}

export function initializeMAEService(): MAEService {
  const service = getMAEService();
  service.start();
  return service;
}
