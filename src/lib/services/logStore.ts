/**
 * In-memory log storage service for UI consumption
 * Stores recent logs in a circular buffer with categorization
 */

export interface LogEntry {
  id: string;
  timestamp: number;
  timestampFormatted: string;
  level: 'info' | 'warn' | 'error';
  component: string;
  message: string;
  data?: any;
}

class LogStore {
  private static instance: LogStore;
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // Keep last 1000 logs
  private logId = 0;

  private constructor() {}

  public static getInstance(): LogStore {
    if (!LogStore.instance) {
      LogStore.instance = new LogStore();
    }
    return LogStore.instance;
  }

  /**
   * Add a log entry to the store
   */
  public addLog(
    level: 'info' | 'warn' | 'error',
    component: string,
    message: string,
    data?: any
  ): void {
    const now = new Date();
    const entry: LogEntry = {
      id: `${Date.now()}-${this.logId++}`,
      timestamp: now.getTime(),
      timestampFormatted: this.formatTimestamp(now),
      level,
      component,
      message,
      data,
    };

    this.logs.push(entry);

    // Maintain circular buffer
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  /**
   * Get logs with optional filtering
   */
  public getLogs(params?: {
    component?: string;
    level?: 'info' | 'warn' | 'error';
    limit?: number;
    since?: number; // timestamp in ms
  }): LogEntry[] {
    let filtered = [...this.logs];

    if (params?.component) {
      const componentLower = params.component.toLowerCase();
      filtered = filtered.filter(log => 
        log.component.toLowerCase().includes(componentLower)
      );
    }

    if (params?.level) {
      filtered = filtered.filter(log => log.level === params.level);
    }

    if (params?.since !== undefined) {
      filtered = filtered.filter(log => log.timestamp >= params.since!);
    }

    // Return most recent first
    filtered.reverse();

    if (params?.limit) {
      filtered = filtered.slice(0, params.limit);
    }

    return filtered;
  }

  /**
   * Get available components for filtering
   */
  public getComponents(): string[] {
    const components = new Set<string>();
    this.logs.forEach(log => components.add(log.component));
    return Array.from(components).sort();
  }

  /**
   * Clear all logs
   */
  public clear(): void {
    this.logs = [];
    this.logId = 0;
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  }
}

export const logStore = LogStore.getInstance();
