import { liquidationStorage } from './liquidationStorage';
import { loadConfig } from '../bot/config';

export class CleanupScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly retentionDays: number;

  constructor(intervalHours: number = 24, retentionDays: number = 90) {
    this.intervalMs = intervalHours * 60 * 60 * 1000;
    this.retentionDays = retentionDays;
  }

  start(): void {
    if (this.intervalId) {
      console.log('Cleanup scheduler already running');
      return;
    }

    console.log(`Starting cleanup scheduler (runs every ${this.intervalMs / (1000 * 60 * 60)} hours, keeps ${this.retentionDays} days of data)`);

    this.runCleanup();

    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('Cleanup scheduler stopped');
    }
  }

  private async runCleanup(): Promise<void> {
    try {
      console.log('Running liquidation cleanup...');
      const startTime = Date.now();

      // Load current config to get retention settings
      const config = await loadConfig();
      const retentionDays = config.global.liquidationDatabase?.retentionDays ?? this.retentionDays;

      const deletedCount = await liquidationStorage.cleanupOldLiquidations(retentionDays);

      const duration = Date.now() - startTime;
      console.log(`Cleanup completed in ${duration}ms. Deleted ${deletedCount} records.`);

      const stats = await liquidationStorage.getStatistics();
      console.log('Database statistics after cleanup:', {
        totalRecords: stats.total_count,
        last24hVolume: stats.total_volume_usdt?.toFixed(2),
        activeSymbols: stats.symbols.length
      });
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  async runOnce(): Promise<void> {
    await this.runCleanup();
  }
}

// Default: cleanup every 24 hours, keep 90 days of liquidation data
// To disable cleanup: set retentionDays to 0
// To keep more data: increase retentionDays (e.g., 365 for 1 year)
export const cleanupScheduler = new CleanupScheduler(24, 90);