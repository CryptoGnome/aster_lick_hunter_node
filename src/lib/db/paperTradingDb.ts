import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'paperTrading.db');
const DB_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

export class PaperTradingDatabase {
  private db: sqlite3.Database;
  private static instance: PaperTradingDatabase;

  private constructor() {
    this.db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening paper trading database:', err);
      } else {
        console.log('Connected to paper trading SQLite database at:', DB_PATH);
        this.optimizeDatabase();
        this.initializeSchema();
      }
    });
  }

  private optimizeDatabase(): void {
    // WAL mode: Better concurrency, faster writes
    this.db.run("PRAGMA journal_mode = WAL");
    // NORMAL sync: Less fsync() calls, still safe with WAL
    this.db.run("PRAGMA synchronous = NORMAL");
    // 64MB cache for better performance
    this.db.run("PRAGMA cache_size = -64000");
    // Temp tables in memory
    this.db.run("PRAGMA temp_store = MEMORY");
    // Larger page size for better I/O
    this.db.run("PRAGMA page_size = 4096");
    
    console.log('[PaperTradingDB] SQLite optimizations applied: WAL mode, NORMAL sync, 64MB cache');
  }

  static getInstance(): PaperTradingDatabase {
    if (!PaperTradingDatabase.instance) {
      PaperTradingDatabase.instance = new PaperTradingDatabase();
    }
    return PaperTradingDatabase.instance;
  }

  private initializeSchema(): void {
    const schema = `
      -- Paper Trading Positions
      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        quantity REAL NOT NULL,
        leverage INTEGER NOT NULL,
        margin REAL NOT NULL,
        unrealized_pnl REAL DEFAULT 0,
        unrealized_pnl_percent REAL DEFAULT 0,
        liquidation_price REAL,
        take_profit REAL,
        stop_loss REAL,
        entry_time INTEGER NOT NULL,
        order_id TEXT NOT NULL UNIQUE,
        current_price REAL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(symbol, side)
      );

      CREATE INDEX IF NOT EXISTS idx_positions_symbol
        ON positions(symbol);

      CREATE INDEX IF NOT EXISTS idx_positions_entry_time
        ON positions(entry_time);

      -- Paper Trading Balance
      CREATE TABLE IF NOT EXISTS balance (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_balance REAL NOT NULL,
        available_balance REAL NOT NULL,
        used_margin REAL DEFAULT 0,
        unrealized_pnl REAL DEFAULT 0,
        session_starting_balance REAL NOT NULL,
        session_pnl REAL DEFAULT 0,
        session_pnl_percent REAL DEFAULT 0,
        session_trades INTEGER DEFAULT 0,
        session_wins INTEGER DEFAULT 0,
        session_losses INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      -- Paper Trading Orders
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity REAL NOT NULL,
        price REAL,
        stop_price REAL,
        position_side TEXT,
        reduce_only INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        created_time INTEGER NOT NULL,
        filled_time INTEGER,
        filled_price REAL,
        filled_quantity REAL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_orders_symbol
        ON orders(symbol);

      CREATE INDEX IF NOT EXISTS idx_orders_status
        ON orders(status);

      CREATE INDEX IF NOT EXISTS idx_orders_created_time
        ON orders(created_time DESC);
    `;

    this.db.exec(schema, (err) => {
      if (err) {
        console.error('[PaperTradingDB] Error creating schema:', err);
      } else {
        console.log('[PaperTradingDB] Database schema initialized');
        this.initializeBalance();
      }
    });
  }

  private initializeBalance(): void {
    // Insert default balance if it doesn't exist
    const sql = `
      INSERT OR IGNORE INTO balance (
        id, total_balance, available_balance, session_starting_balance
      ) VALUES (1, 1000, 1000, 1000)
    `;
    this.db.run(sql, (err) => {
      if (err) {
        console.error('[PaperTradingDB] Error initializing balance:', err);
      }
    });
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T);
      });
    });
  }

  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  close(): void {
    this.db.close((err) => {
      if (err) {
        console.error('[PaperTradingDB] Error closing database:', err);
      } else {
        console.log('[PaperTradingDB] Database connection closed');
      }
    });
  }

  async initialize(): Promise<void> {
    return new Promise((resolve) => {
      if (this.db) {
        resolve();
      } else {
        setTimeout(() => resolve(), 100);
      }
    });
  }
}
