import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const DB_PATH = path.join(dataDir, 'trade_quality.db');

// Trade quality signal record
export interface TradeQualityRecord {
  id: number;
  timestamp: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  recommendation: 'STRONG' | 'NORMAL' | 'WEAK' | 'SKIP';
  totalScore: number;
  spikeScore: number;
  volumeTrendScore: number;
  regimeScore: number;
  positionSizeMultiplier: number;
  liquidationVolume: number;
  priceImpact: number;
  confidence: number;
  reason: string;
  // Metrics
  priceChangePercent: number;
  spikeTimeSeconds: number;
  spikeVelocity: number;
  recentVolumeRatio: number;
  vwapCrossCount: number;
  vwapCrossesPerHour: number;
  isChoppyRegime: boolean;
  isTrendingRegime: boolean;
  vwapDistance: number;
  isAboveVwap: boolean;
  // Outcome tracking
  wasExecuted: boolean;
  wasBlocked: boolean;
  blockReason: string | null;
  reasons: string; // JSON array of reasons
}

// FTA Exit signal record
export interface FTAExitRecord {
  id: number;
  timestamp: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  exitType: string;
  reason: string;
  confidence: number;
}

class TradeQualityDatabase {
  private db: Database.Database | null = null;
  private initialized = false;

  private getDb(): Database.Database {
    if (!this.db) {
      this.db = new Database(DB_PATH);
      this.db.pragma('journal_mode = WAL');
      
      if (!this.initialized) {
        this.initializeSchema();
        this.initialized = true;
      }
    }
    return this.db;
  }

  private initializeSchema(): void {
    const db = this.db!;

    // Trade quality signals table
    db.exec(`
      CREATE TABLE IF NOT EXISTS trade_quality_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        total_score INTEGER NOT NULL,
        spike_score INTEGER NOT NULL,
        volume_trend_score INTEGER NOT NULL,
        regime_score INTEGER NOT NULL,
        position_size_multiplier REAL NOT NULL DEFAULT 1.0,
        liquidation_volume REAL NOT NULL DEFAULT 0,
        price_impact REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        reason TEXT,
        price_change_percent REAL DEFAULT 0,
        spike_time_seconds REAL DEFAULT 0,
        spike_velocity REAL DEFAULT 0,
        recent_volume_ratio REAL DEFAULT 1,
        vwap_cross_count INTEGER DEFAULT 0,
        vwap_crosses_per_hour REAL DEFAULT 0,
        is_choppy_regime INTEGER DEFAULT 0,
        is_trending_regime INTEGER DEFAULT 0,
        vwap_distance REAL DEFAULT 0,
        is_above_vwap INTEGER DEFAULT 0,
        was_executed INTEGER DEFAULT 0,
        was_blocked INTEGER DEFAULT 0,
        block_reason TEXT,
        reasons TEXT,
        signal_price REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // FTA exit signals table
    db.exec(`
      CREATE TABLE IF NOT EXISTS fta_exit_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        exit_type TEXT NOT NULL,
        reason TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for efficient queries
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tqs_timestamp ON trade_quality_signals(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_tqs_symbol ON trade_quality_signals(symbol);
      CREATE INDEX IF NOT EXISTS idx_tqs_recommendation ON trade_quality_signals(recommendation);
      CREATE INDEX IF NOT EXISTS idx_fta_timestamp ON fta_exit_signals(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_fta_symbol ON fta_exit_signals(symbol);
    `);

    // Add signal_price column if it doesn't exist (migration for existing databases)
    try {
      db.exec(`ALTER TABLE trade_quality_signals ADD COLUMN signal_price REAL DEFAULT 0`);
      console.log('[TradeQualityDB] Added signal_price column to existing database');
    } catch {
      // Column already exists, ignore
    }

    console.log('[TradeQualityDB] Database schema initialized');
  }

  // Save a trade quality signal
  saveTradeSignal(data: {
    symbol: string;
    side: 'BUY' | 'SELL';
    recommendation: string;
    totalScore: number;
    spikeScore: number;
    volumeTrendScore: number;
    regimeScore: number;
    positionSizeMultiplier: number;
    liquidationVolume: number;
    priceImpact: number;
    confidence: number;
    reason: string;
    metrics?: {
      priceChangePercent?: number;
      spikeTimeSeconds?: number;
      spikeVelocity?: number;
      recentVolumeRatio?: number;
      vwapCrossCount?: number;
      vwapCrossesPerHour?: number;
      isChoppyRegime?: boolean;
      isTrendingRegime?: boolean;
      vwapDistance?: number;
      isAboveVwap?: boolean;
    };
    wasExecuted?: boolean;
    wasBlocked?: boolean;
    blockReason?: string;
    reasons?: string[];
    signalPrice?: number;
  }): number {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO trade_quality_signals (
        timestamp, symbol, side, recommendation,
        total_score, spike_score, volume_trend_score, regime_score,
        position_size_multiplier, liquidation_volume, price_impact, confidence,
        reason, price_change_percent, spike_time_seconds, spike_velocity,
        recent_volume_ratio, vwap_cross_count, vwap_crosses_per_hour,
        is_choppy_regime, is_trending_regime, vwap_distance, is_above_vwap,
        was_executed, was_blocked, block_reason, reasons, signal_price
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    const metrics = data.metrics || {};
    const result = stmt.run(
      Date.now(),
      data.symbol,
      data.side,
      data.recommendation,
      data.totalScore,
      data.spikeScore,
      data.volumeTrendScore,
      data.regimeScore,
      data.positionSizeMultiplier,
      data.liquidationVolume,
      data.priceImpact,
      data.confidence,
      data.reason,
      metrics.priceChangePercent || 0,
      metrics.spikeTimeSeconds || 0,
      metrics.spikeVelocity || 0,
      metrics.recentVolumeRatio || 1,
      metrics.vwapCrossCount || 0,
      metrics.vwapCrossesPerHour || 0,
      metrics.isChoppyRegime ? 1 : 0,
      metrics.isTrendingRegime ? 1 : 0,
      metrics.vwapDistance || 0,
      metrics.isAboveVwap ? 1 : 0,
      data.wasExecuted ? 1 : 0,
      data.wasBlocked ? 1 : 0,
      data.blockReason || null,
      data.reasons ? JSON.stringify(data.reasons) : null,
      data.signalPrice || 0
    );

    return result.lastInsertRowid as number;
  }

  // Save an FTA exit signal
  saveFTASignal(data: {
    symbol: string;
    side: 'BUY' | 'SELL';
    exitType: string;
    reason: string;
    confidence: number;
  }): number {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO fta_exit_signals (timestamp, symbol, side, exit_type, reason, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      Date.now(),
      data.symbol,
      data.side,
      data.exitType,
      data.reason,
      data.confidence
    );

    return result.lastInsertRowid as number;
  }

  // Get recent trade signals
  getRecentSignals(options: {
    limit?: number;
    symbol?: string;
    recommendation?: string;
    since?: number; // timestamp
  } = {}): TradeQualityRecord[] {
    const db = this.getDb();
    const { limit = 50, symbol, recommendation, since } = options;

    let query = `
      SELECT 
        id, timestamp, symbol, side, recommendation,
        total_score as totalScore, spike_score as spikeScore,
        volume_trend_score as volumeTrendScore, regime_score as regimeScore,
        position_size_multiplier as positionSizeMultiplier,
        liquidation_volume as liquidationVolume, price_impact as priceImpact,
        confidence, reason,
        price_change_percent as priceChangePercent,
        spike_time_seconds as spikeTimeSeconds,
        spike_velocity as spikeVelocity,
        recent_volume_ratio as recentVolumeRatio,
        vwap_cross_count as vwapCrossCount,
        vwap_crosses_per_hour as vwapCrossesPerHour,
        is_choppy_regime as isChoppyRegime,
        is_trending_regime as isTrendingRegime,
        vwap_distance as vwapDistance,
        is_above_vwap as isAboveVwap,
        was_executed as wasExecuted,
        was_blocked as wasBlocked,
        block_reason as blockReason,
        reasons,
        signal_price as signalPrice
      FROM trade_quality_signals
      WHERE 1=1
    `;
    const params: any[] = [];

    if (symbol) {
      query += ' AND symbol = ?';
      params.push(symbol);
    }

    if (recommendation) {
      query += ' AND recommendation = ?';
      params.push(recommendation);
    }

    if (since) {
      query += ' AND timestamp >= ?';
      params.push(since);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params) as any[];
    
    return rows.map(row => ({
      ...row,
      isChoppyRegime: row.isChoppyRegime === 1,
      isTrendingRegime: row.isTrendingRegime === 1,
      isAboveVwap: row.isAboveVwap === 1,
      wasExecuted: row.wasExecuted === 1,
      wasBlocked: row.wasBlocked === 1,
      reasons: row.reasons ? JSON.parse(row.reasons) : []
    }));
  }

  // Get recent FTA signals
  getRecentFTASignals(options: {
    limit?: number;
    symbol?: string;
    since?: number;
  } = {}): FTAExitRecord[] {
    const db = this.getDb();
    const { limit = 20, symbol, since } = options;

    let query = `
      SELECT id, timestamp, symbol, side, exit_type as exitType, reason, confidence
      FROM fta_exit_signals
      WHERE 1=1
    `;
    const params: any[] = [];

    if (symbol) {
      query += ' AND symbol = ?';
      params.push(symbol);
    }

    if (since) {
      query += ' AND timestamp >= ?';
      params.push(since);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return db.prepare(query).all(...params) as FTAExitRecord[];
  }

  // Get statistics summary
  getStats(timeframeMs: number = 24 * 60 * 60 * 1000): {
    totalSignals: number;
    strongSignals: number;
    normalSignals: number;
    weakSignals: number;
    skippedSignals: number;
    executedSignals: number;
    avgQuality: number;
    bySymbol: Record<string, { count: number; avgScore: number }>;
  } {
    const db = this.getDb();
    const since = Date.now() - timeframeMs;

    const totalRow = db.prepare(`
      SELECT COUNT(*) as count FROM trade_quality_signals WHERE timestamp >= ?
    `).get(since) as any;

    const byRecommendation = db.prepare(`
      SELECT recommendation, COUNT(*) as count
      FROM trade_quality_signals
      WHERE timestamp >= ?
      GROUP BY recommendation
    `).all(since) as any[];

    const avgRow = db.prepare(`
      SELECT AVG(total_score) as avg FROM trade_quality_signals WHERE timestamp >= ?
    `).get(since) as any;

    const executedRow = db.prepare(`
      SELECT COUNT(*) as count FROM trade_quality_signals WHERE timestamp >= ? AND was_executed = 1
    `).get(since) as any;

    const bySymbolRows = db.prepare(`
      SELECT symbol, COUNT(*) as count, AVG(total_score) as avgScore
      FROM trade_quality_signals
      WHERE timestamp >= ?
      GROUP BY symbol
    `).all(since) as any[];

    const recMap: Record<string, number> = {};
    byRecommendation.forEach(r => { recMap[r.recommendation] = r.count; });

    const bySymbol: Record<string, { count: number; avgScore: number }> = {};
    bySymbolRows.forEach(r => {
      bySymbol[r.symbol] = { count: r.count, avgScore: r.avgScore };
    });

    return {
      totalSignals: totalRow?.count || 0,
      strongSignals: recMap['STRONG'] || 0,
      normalSignals: recMap['NORMAL'] || 0,
      weakSignals: recMap['WEAK'] || 0,
      skippedSignals: recMap['SKIP'] || 0,
      executedSignals: executedRow?.count || 0,
      avgQuality: avgRow?.avg || 0,
      bySymbol
    };
  }

  // Cleanup old records
  cleanup(retentionDays: number = 30): number {
    const db = this.getDb();
    const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    const signalResult = db.prepare(`
      DELETE FROM trade_quality_signals WHERE timestamp < ?
    `).run(cutoff);

    const ftaResult = db.prepare(`
      DELETE FROM fta_exit_signals WHERE timestamp < ?
    `).run(cutoff);

    const totalDeleted = (signalResult.changes || 0) + (ftaResult.changes || 0);
    if (totalDeleted > 0) {
      console.log(`[TradeQualityDB] Cleaned up ${totalDeleted} old records`);
    }

    return totalDeleted;
  }

  // Close database connection
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
}

// Export singleton instance
export const tradeQualityDb = new TradeQualityDatabase();
