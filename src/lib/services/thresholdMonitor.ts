import { EventEmitter } from 'events';
import { Config, LiquidationEvent } from '../types';

export interface ThresholdStatus {
  symbol: string;
  longThreshold: number;
  shortThreshold: number;
  recentLongVolume: number;
  recentShortVolume: number;
  longProgress: number; // 0-100% towards threshold
  shortProgress: number; // 0-100% towards threshold
  timeWindow: number; // in milliseconds (60 seconds default)
  lastUpdate: number;
  // Cooldown tracking to prevent trade spam
  lastLongTrigger: number; // timestamp of last long trade trigger
  lastShortTrigger: number; // timestamp of last short trade trigger
  recentLiquidations: {
    long: LiquidationEvent[]; // SELL liquidations (we might go LONG)
    short: LiquidationEvent[]; // BUY liquidations (we might go SHORT)
  };
}

export interface ThresholdUpdate {
  symbol: string;
  side: 'long' | 'short';
  currentVolume: number;
  threshold: number;
  progress: number;
  remainingVolume: number;
  recentLiquidations: LiquidationEvent[];
  willTrigger: boolean;
}

export class ThresholdMonitor extends EventEmitter {
  private config: Config = {
    symbols: {},
    global: { paperMode: true, riskPercent: 1 },
    api: { apiKey: '', secretKey: '' },
    server: {},
    rateLimits: {},
    version: 1
  };
  private thresholdStatuses: Map<string, ThresholdStatus> = new Map();
  private timeWindow: number = 60 * 1000; // 60 seconds default (matches your requirement)
  private cooldownPeriod: number = 30 * 1000; // 30 seconds cooldown between trades on same threshold
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Config, timeWindow: number = 60 * 1000, cooldownPeriod: number = 30 * 1000) {
    super();
    if (config) {
      this.config = config;
    }
    this.timeWindow = timeWindow;
    this.cooldownPeriod = cooldownPeriod;
    this.initializeThresholds();
    this.startCleanupTimer();
  }

  private initializeThresholds(): void {
    // Initialize threshold status for all configured symbols
    for (const [symbol, symbolConfig] of Object.entries(this.config.symbols)) {
      this.thresholdStatuses.set(symbol, {
        symbol,
        longThreshold: symbolConfig.longVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 10000,
        shortThreshold: symbolConfig.shortVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 10000,
        recentLongVolume: 0,
        recentShortVolume: 0,
        longProgress: 0,
        shortProgress: 0,
        timeWindow: this.timeWindow,
        lastUpdate: Date.now(),
        lastLongTrigger: 0,
        lastShortTrigger: 0,
        recentLiquidations: {
          long: [],
          short: []
        }
      });
    }
  }

  public updateConfig(newConfig: Config): void {
    this.config = newConfig;

    // Update existing thresholds or add new ones
    for (const [symbol, symbolConfig] of Object.entries(newConfig.symbols)) {
      const existing = this.thresholdStatuses.get(symbol);
      if (existing) {
        // Update thresholds
        existing.longThreshold = symbolConfig.longVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 10000;
        existing.shortThreshold = symbolConfig.shortVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 10000;
        existing.lastUpdate = Date.now();
        this.recalculateProgress(existing);
      } else {
        // Add new symbol
        this.thresholdStatuses.set(symbol, {
          symbol,
          longThreshold: symbolConfig.longVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 10000,
          shortThreshold: symbolConfig.shortVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 10000,
          recentLongVolume: 0,
          recentShortVolume: 0,
          longProgress: 0,
          shortProgress: 0,
          timeWindow: this.timeWindow,
          lastUpdate: Date.now(),
          lastLongTrigger: 0,
          lastShortTrigger: 0,
          recentLiquidations: {
            long: [],
            short: []
          }
        });
      }
    }

    // Remove symbols no longer in config
    const configSymbols = new Set(Object.keys(newConfig.symbols));
    for (const symbol of this.thresholdStatuses.keys()) {
      if (!configSymbols.has(symbol)) {
        this.thresholdStatuses.delete(symbol);
      }
    }
  }

  public processLiquidation(liquidation: LiquidationEvent): ThresholdStatus | null {
    const status = this.thresholdStatuses.get(liquidation.symbol);
    if (!status) return null;

    const now = Date.now();

    // Determine which side this liquidation affects
    // SELL liquidation means longs are getting liquidated, we might want to BUY (long)
    // BUY liquidation means shorts are getting liquidated, we might want to SELL (short)
    const isLongOpportunity = liquidation.side === 'SELL';

    if (isLongOpportunity) {
      status.recentLiquidations.long.push(liquidation);
    } else {
      status.recentLiquidations.short.push(liquidation);
    }

    // Clean old liquidations within the time window
    this.cleanOldLiquidations(status, now);

    // Recalculate volumes and progress
    this.recalculateProgress(status);

    status.lastUpdate = now;

    // Emit threshold updates with cooldown logic
    if (isLongOpportunity && status.longThreshold > 0) {
      const thresholdMet = status.recentLongVolume >= status.longThreshold;
      const cooledDown = (now - status.lastLongTrigger) >= this.cooldownPeriod;
      const willTrigger = thresholdMet && cooledDown;

      // Update last trigger time if we're triggering
      if (willTrigger) {
        status.lastLongTrigger = now;
      }

      this.emit('thresholdUpdate', {
        symbol: liquidation.symbol,
        side: 'long',
        currentVolume: status.recentLongVolume,
        threshold: status.longThreshold,
        progress: status.longProgress,
        remainingVolume: Math.max(0, status.longThreshold - status.recentLongVolume),
        recentLiquidations: status.recentLiquidations.long.slice(-5), // Last 5 liquidations
        willTrigger
      } as ThresholdUpdate);
    } else if (!isLongOpportunity && status.shortThreshold > 0) {
      const thresholdMet = status.recentShortVolume >= status.shortThreshold;
      const cooledDown = (now - status.lastShortTrigger) >= this.cooldownPeriod;
      const willTrigger = thresholdMet && cooledDown;

      // Update last trigger time if we're triggering
      if (willTrigger) {
        status.lastShortTrigger = now;
      }

      this.emit('thresholdUpdate', {
        symbol: liquidation.symbol,
        side: 'short',
        currentVolume: status.recentShortVolume,
        threshold: status.shortThreshold,
        progress: status.shortProgress,
        remainingVolume: Math.max(0, status.shortThreshold - status.recentShortVolume),
        recentLiquidations: status.recentLiquidations.short.slice(-5), // Last 5 liquidations
        willTrigger
      } as ThresholdUpdate);
    }

    return { ...status }; // Return copy
  }

  private cleanOldLiquidations(status: ThresholdStatus, now: number): void {
    const cutoff = now - this.timeWindow;

    status.recentLiquidations.long = status.recentLiquidations.long.filter(
      liq => liq.eventTime > cutoff
    );

    status.recentLiquidations.short = status.recentLiquidations.short.filter(
      liq => liq.eventTime > cutoff
    );
  }

  private recalculateProgress(status: ThresholdStatus): void {
    // Calculate total volume for each side
    status.recentLongVolume = status.recentLiquidations.long.reduce(
      (sum, liq) => sum + (liq.qty * liq.price), 0
    );

    status.recentShortVolume = status.recentLiquidations.short.reduce(
      (sum, liq) => sum + (liq.qty * liq.price), 0
    );

    // Calculate progress percentages
    status.longProgress = status.longThreshold > 0
      ? Math.min(100, (status.recentLongVolume / status.longThreshold) * 100)
      : 0;

    status.shortProgress = status.shortThreshold > 0
      ? Math.min(100, (status.recentShortVolume / status.shortThreshold) * 100)
      : 0;
  }

  public getThresholdStatus(symbol: string): ThresholdStatus | null {
    const status = this.thresholdStatuses.get(symbol);
    if (!status) return null;

    // Clean old liquidations before returning
    this.cleanOldLiquidations(status, Date.now());
    this.recalculateProgress(status);

    return { ...status }; // Return a copy
  }

  public getAllThresholdStatuses(): ThresholdStatus[] {
    const now = Date.now();
    const statuses: ThresholdStatus[] = [];

    for (const status of this.thresholdStatuses.values()) {
      // Clean old liquidations and recalculate
      this.cleanOldLiquidations(status, now);
      this.recalculateProgress(status);

      statuses.push({ ...status }); // Return copies
    }

    return statuses.sort((a, b) => {
      // Sort by highest progress first, then by symbol name
      const maxProgressA = Math.max(a.longProgress, a.shortProgress);
      const maxProgressB = Math.max(b.longProgress, b.shortProgress);

      if (maxProgressA !== maxProgressB) {
        return maxProgressB - maxProgressA;
      }

      return a.symbol.localeCompare(b.symbol);
    });
  }

  public getSymbolsNearThreshold(progressThreshold: number = 80): ThresholdStatus[] {
    return this.getAllThresholdStatuses().filter(status =>
      status.longProgress >= progressThreshold || status.shortProgress >= progressThreshold
    );
  }

  public setTimeWindow(timeWindowMs: number): void {
    this.timeWindow = timeWindowMs;

    // Update all statuses
    for (const status of this.thresholdStatuses.values()) {
      status.timeWindow = timeWindowMs;
      this.cleanOldLiquidations(status, Date.now());
      this.recalculateProgress(status);
    }
  }

  public setCooldownPeriod(cooldownMs: number): void {
    this.cooldownPeriod = cooldownMs;
  }

  public getCooldownPeriod(): number {
    return this.cooldownPeriod;
  }

  private startCleanupTimer(): void {
    // Clean up old liquidations every 10 seconds
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();

      for (const status of this.thresholdStatuses.values()) {
        // Store previous progress to detect changes
        const prevLongProgress = status.longProgress;
        const prevShortProgress = status.shortProgress;

        this.cleanOldLiquidations(status, now);
        this.recalculateProgress(status);

        // Emit updates if progress changed significantly (more than 1%)
        if (status.longThreshold > 0 && Math.abs(status.longProgress - prevLongProgress) > 1) {
          this.emit('thresholdUpdate', {
            symbol: status.symbol,
            side: 'long',
            currentVolume: status.recentLongVolume,
            threshold: status.longThreshold,
            progress: status.longProgress,
            remainingVolume: Math.max(0, status.longThreshold - status.recentLongVolume),
            recentLiquidations: status.recentLiquidations.long.slice(-5),
            willTrigger: false // Cleanup updates don't trigger trades
          } as ThresholdUpdate);
        }

        if (status.shortThreshold > 0 && Math.abs(status.shortProgress - prevShortProgress) > 1) {
          this.emit('thresholdUpdate', {
            symbol: status.symbol,
            side: 'short',
            currentVolume: status.recentShortVolume,
            threshold: status.shortThreshold,
            progress: status.shortProgress,
            remainingVolume: Math.max(0, status.shortThreshold - status.recentShortVolume),
            recentLiquidations: status.recentLiquidations.short.slice(-5),
            willTrigger: false // Cleanup updates don't trigger trades
          } as ThresholdUpdate);
        }
      }
    }, 10000);
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.thresholdStatuses.clear();
    this.removeAllListeners();
  }
}

// Export singleton instance with 30-second cooldown
export const thresholdMonitor = new ThresholdMonitor(undefined, 60 * 1000, 30 * 1000);