import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

export interface ErrorLog {
  id?: number;
  timestamp: string;
  error_type: 'websocket' | 'api' | 'trading' | 'config' | 'general' | 'system';
  error_code?: string;
  message: string;
  details?: string; // JSON string
  stack_trace?: string;
  component?: string;
  symbol?: string;
  user_action?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  session_id: string;
  resolved: boolean;
  notes?: string;
  created_at?: string;
}

export interface ErrorStats {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  recentCount: number;
  topErrors: Array<{ message: string; count: number }>;
}

class ErrorLogsDatabase {
  private static instance: ErrorLogsDatabase;
  private db: sqlite3.Database | null = null;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  public static getInstance(): ErrorLogsDatabase {
    if (!ErrorLogsDatabase.instance) {
      ErrorLogsDatabase.instance = new ErrorLogsDatabase();
    }
    return ErrorLogsDatabase.instance;
  }

  public async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initializeDb();
    await this.initPromise;
  }

  private async initializeDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const dbPath = path.join(process.cwd(), 'data', 'error_logs.db');
        const dataDir = path.join(process.cwd(), 'data');

        // Ensure data directory exists
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }

        this.db = new sqlite3.Database(dbPath, (err) => {
          if (err) {
            console.error('Failed to open error logs database:', err);
            reject(err);
            return;
          }

          // Apply SQLite optimizations
          this.db!.run("PRAGMA journal_mode = WAL");
          this.db!.run("PRAGMA synchronous = NORMAL");
          this.db!.run("PRAGMA cache_size = -32000"); // 32MB cache
          this.db!.run("PRAGMA temp_store = MEMORY");

          // Create tables
          this.db!.serialize(() => {
            this.db!.run(`
              CREATE TABLE IF NOT EXISTS error_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                error_type TEXT NOT NULL,
                error_code TEXT,
                message TEXT NOT NULL,
                details TEXT,
                stack_trace TEXT,
                component TEXT,
                symbol TEXT,
                user_action TEXT,
                severity TEXT NOT NULL,
                session_id TEXT NOT NULL,
                resolved INTEGER DEFAULT 0,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
              )
            `);

            this.db!.run(`CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp DESC)`);
            this.db!.run(`CREATE INDEX IF NOT EXISTS idx_error_logs_type ON error_logs(error_type)`);
            this.db!.run(`CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity)`);
            this.db!.run(`CREATE INDEX IF NOT EXISTS idx_error_logs_session ON error_logs(session_id)`);
            this.db!.run(`CREATE INDEX IF NOT EXISTS idx_error_logs_component ON error_logs(component)`);
            this.db!.run(`CREATE INDEX IF NOT EXISTS idx_error_logs_symbol ON error_logs(symbol)`, (err) => {
              if (err) {
                console.error('Failed to create indexes:', err);
                reject(err);
              } else {
                console.log('Error logs database initialized');
                resolve();
              }
            });
          });
        });
      } catch (error) {
        console.error('Failed to initialize error logs database:', error);
        reject(error);
      }
    });
  }

  public async logError(error: Omit<ErrorLog, 'id' | 'created_at'>): Promise<number> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const stmt = this.db!.prepare(`
        INSERT INTO error_logs (
          timestamp, error_type, error_code, message, details,
          stack_trace, component, symbol, user_action, severity,
          session_id, resolved, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        error.timestamp,
        error.error_type,
        error.error_code || null,
        error.message,
        error.details || null,
        error.stack_trace || null,
        error.component || null,
        error.symbol || null,
        error.user_action || null,
        error.severity,
        error.session_id,
        error.resolved ? 1 : 0,
        error.notes || null,
        function(this: any, err: Error | null) {
          if (err) {
            console.error('Failed to log error:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );

      stmt.finalize();
    });
  }

  public async getErrors(
    limit: number = 100,
    offset: number = 0,
    filters?: {
      type?: string;
      severity?: string;
      component?: string;
      symbol?: string;
      sessionId?: string;
      startTime?: string;
      endTime?: string;
      resolved?: boolean;
    }
  ): Promise<ErrorLog[]> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM error_logs WHERE 1=1';
      const params: any[] = [];

      if (filters) {
        if (filters.type) {
          query += ' AND error_type = ?';
          params.push(filters.type);
        }
        if (filters.severity) {
          query += ' AND severity = ?';
          params.push(filters.severity);
        }
        if (filters.component) {
          query += ' AND component = ?';
          params.push(filters.component);
        }
        if (filters.symbol) {
          query += ' AND symbol = ?';
          params.push(filters.symbol);
        }
        if (filters.sessionId) {
          query += ' AND session_id = ?';
          params.push(filters.sessionId);
        }
        if (filters.startTime) {
          query += ' AND timestamp >= ?';
          params.push(filters.startTime);
        }
        if (filters.endTime) {
          query += ' AND timestamp <= ?';
          params.push(filters.endTime);
        }
        if (filters.resolved !== undefined) {
          query += ' AND resolved = ?';
          params.push(filters.resolved ? 1 : 0);
        }
      }

      query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      this.db!.all(query, params, (err, rows: any[]) => {
        if (err) {
          console.error('Failed to get errors:', err);
          reject(err);
        } else {
          const errors = rows.map(row => ({
            ...row,
            resolved: row.resolved === 1
          }));
          resolve(errors);
        }
      });
    });
  }

  public async getError(id: number): Promise<ErrorLog | null> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.get('SELECT * FROM error_logs WHERE id = ?', [id], (err, row: any) => {
        if (err) {
          console.error('Failed to get error:', err);
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            ...row,
            resolved: row.resolved === 1
          });
        }
      });
    });
  }

  public async getErrorStats(hours: number = 24): Promise<ErrorStats> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const getTotal = (): Promise<number> => {
      return new Promise((resolve, reject) => {
        this.db!.get('SELECT COUNT(*) as count FROM error_logs', (err, row: any) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });
    };

    const getRecentCount = (): Promise<number> => {
      return new Promise((resolve, reject) => {
        this.db!.get('SELECT COUNT(*) as count FROM error_logs WHERE timestamp >= ?', [cutoffTime], (err, row: any) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });
    };

    const getByType = (): Promise<Record<string, number>> => {
      return new Promise((resolve, reject) => {
        this.db!.all(`
          SELECT error_type, COUNT(*) as count
          FROM error_logs
          WHERE timestamp >= ?
          GROUP BY error_type
        `, [cutoffTime], (err, rows: any[]) => {
          if (err) reject(err);
          else {
            const byType: Record<string, number> = {};
            rows.forEach(row => {
              byType[row.error_type] = row.count;
            });
            resolve(byType);
          }
        });
      });
    };

    const getBySeverity = (): Promise<Record<string, number>> => {
      return new Promise((resolve, reject) => {
        this.db!.all(`
          SELECT severity, COUNT(*) as count
          FROM error_logs
          WHERE timestamp >= ?
          GROUP BY severity
        `, [cutoffTime], (err, rows: any[]) => {
          if (err) reject(err);
          else {
            const bySeverity: Record<string, number> = {};
            rows.forEach(row => {
              bySeverity[row.severity] = row.count;
            });
            resolve(bySeverity);
          }
        });
      });
    };

    const getTopErrors = (): Promise<Array<{ message: string; count: number }>> => {
      return new Promise((resolve, reject) => {
        this.db!.all(`
          SELECT message, COUNT(*) as count
          FROM error_logs
          WHERE timestamp >= ?
          GROUP BY message
          ORDER BY count DESC
          LIMIT 10
        `, [cutoffTime], (err, rows: any[]) => {
          if (err) reject(err);
          else {
            resolve(rows.map(row => ({
              message: row.message,
              count: row.count
            })));
          }
        });
      });
    };

    try {
      const [total, recentCount, byType, bySeverity, topErrors] = await Promise.all([
        getTotal(),
        getRecentCount(),
        getByType(),
        getBySeverity(),
        getTopErrors()
      ]);

      return {
        total,
        byType,
        bySeverity,
        recentCount,
        topErrors
      };
    } catch (error) {
      console.error('Failed to get error stats:', error);
      throw error;
    }
  }

  public async clearOldErrors(daysToKeep: number = 30): Promise<number> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const cutoffTime = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
      this.db!.run('DELETE FROM error_logs WHERE timestamp < ? AND resolved = 1', [cutoffTime], function(this: any, err: Error | null) {
        if (err) {
          console.error('Failed to clear old errors:', err);
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  public async clearAllErrors(): Promise<number> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run('DELETE FROM error_logs', [], function(this: any, err: Error | null) {
        if (err) {
          console.error('Failed to clear all errors:', err);
          reject(err);
        } else {
          resolve(this.changes);
        }
      });
    });
  }

  public async markResolved(id: number, notes?: string): Promise<void> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run('UPDATE error_logs SET resolved = 1, notes = ? WHERE id = ?', [notes || null, id], (err) => {
        if (err) {
          console.error('Failed to mark error as resolved:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  public async exportErrors(
    sessionId?: string,
    hours: number = 24
  ): Promise<{ errors: ErrorLog[]; stats: ErrorStats }> {
    await this.initialize();
    if (!this.db) throw new Error('Database not initialized');

    try {
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

      const filters: any = {
        startTime: cutoffTime
      };

      if (sessionId) {
        filters.sessionId = sessionId;
      }

      const errors = await this.getErrors(1000, 0, filters);
      const stats = await this.getErrorStats(hours);

      return { errors, stats };
    } catch (error) {
      console.error('Failed to export errors:', error);
      throw error;
    }
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

export const errorLogsDb = ErrorLogsDatabase.getInstance();