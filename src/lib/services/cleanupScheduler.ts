import { liquidationStorage } from './liquidationStorage';

export class CleanupScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;

  constructor(intervalHours: number = 24) {
    this.intervalMs = intervalHours * 60 * 60 * 1000;
  }

  start(): void {
    if (this.intervalId) {
      console.log('Cleanup scheduler already running');
      return;
    }

    console.log(`Starting cleanup scheduler (runs every ${this.intervalMs / (1000 * 60 * 60)} hours)`);

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

      const deletedCount = await liquidationStorage.cleanupOldLiquidations();

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

export const cleanupScheduler = new CleanupScheduler(24);