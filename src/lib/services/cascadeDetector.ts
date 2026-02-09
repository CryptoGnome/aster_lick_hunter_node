/**
 * Cascade Detector - Real-time market regime detection for liquidation cascade protection
 * 
 * PURPOSE:
 * Detects when the market enters a liquidation cascade — a period where liquidations breed 
 * more liquidations, and mean reversion strategies FAIL because the trend hasn't exhausted.
 * During cascades, the bot pauses new entries to prevent correlated blowup scenarios.
 * 
 * HOW IT WORKS:
 * 1. Tracks ALL liquidations (not just configured symbols) in rolling time windows
 * 2. Maintains a rolling baseline of "normal" liquidation volume over a longer window
 * 3. Detects cascade conditions via multiple signals:
 *    - Volume spike: current window volume exceeds baseline by N multiplier
 *    - Cross-symbol correlation: many symbols liquidating simultaneously
 *    - Directional skew: overwhelming majority of liqs in same direction (trend, not chop)
 * 4. Once a cascade is detected, enters PAUSED state with a cooldown timer
 * 5. After cooldown, resumes normal operation (new entries allowed again)
 * 
 * INTEGRATION:
 * - Fed every liquidation from the WebSocket stream (before symbol filtering)
 * - hunter.ts checks isCascadeActive() before placing any trade
 * - Existing positions are NOT affected — SL/TP remain in place
 * - Emits events for UI/logging visibility
 */

import { EventEmitter } from 'events';
import { LiquidationEvent } from '../types';
import { logWithTimestamp, logWarnWithTimestamp } from '../utils/timestamp';

export interface CascadeProtectionConfig {
  enabled: boolean;
  // Rolling window for detecting abnormal activity (default: 5 minutes)
  rollingWindowMs: number;
  // Baseline window for calculating "normal" volume (default: 30 minutes)
  baselineWindowMs: number;
  // Volume multiplier over baseline that triggers cascade detection (default: 3.0)
  volumeMultiplierThreshold: number;
  // Minimum number of distinct symbols liquidating in the rolling window to signal cascade (default: 3)
  minSymbolsForCascade: number;
  // Directional skew threshold — if >80% of liquidations are same direction, it's a trend (default: 0.8)
  directionalSkewThreshold: number;
  // Cooldown after cascade detected before resuming (default: 10 minutes)
  cooldownMs: number;
  // Minimum volume in the rolling window before cascade logic kicks in (prevents false positives on low volume)
  minVolumeForDetection: number;
}

export interface CascadeState {
  isActive: boolean;
  detectedAt: number | null;
  resumesAt: number | null;
  reason: string | null;
  // Current metrics for UI/logging
  currentWindowVolume: number;
  baselineWindowVolume: number;
  volumeMultiplier: number;
  activeSymbolCount: number;
  activeSymbols: string[];
  directionalSkew: number;  // -1.0 (all shorts liq'd) to +1.0 (all longs liq'd)
  dominantDirection: 'LONG_LIQUIDATIONS' | 'SHORT_LIQUIDATIONS' | 'BALANCED';
  // Rolling window stats
  windowLiquidationCount: number;
  baselineLiquidationCount: number;
}

interface LiquidationRecord {
  symbol: string;
  side: 'BUY' | 'SELL';
  volumeUSDT: number;
  timestamp: number;
}

const DEFAULT_CONFIG: CascadeProtectionConfig = {
  enabled: true,
  rollingWindowMs: 5 * 60 * 1000,        // 5 minutes
  baselineWindowMs: 30 * 60 * 1000,       // 30 minutes
  volumeMultiplierThreshold: 3.0,          // 3x above normal
  minSymbolsForCascade: 3,                 // 3+ symbols simultaneously
  directionalSkewThreshold: 0.8,           // 80%+ same direction
  cooldownMs: 10 * 60 * 1000,             // 10 minutes cooldown
  minVolumeForDetection: 50000,            // $50k minimum in window to even check
};

export class CascadeDetector extends EventEmitter {
  private config: CascadeProtectionConfig;
  private liquidations: LiquidationRecord[] = [];
  private cascadeActive: boolean = false;
  private cascadeDetectedAt: number | null = null;
  private cascadeResumesAt: number | null = null;
  private cascadeReason: string | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private cascadeCount: number = 0; // Total cascades detected this session

  constructor(config?: Partial<CascadeProtectionConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Start periodic cleanup every 60 seconds to prune old data
    this.cleanupInterval = setInterval(() => {
      this.pruneOldData();
    }, 60_000);
  }

  /**
   * Update configuration at runtime (e.g., from config reload)
   */
  public updateConfig(config: Partial<CascadeProtectionConfig>): void {
    this.config = { ...this.config, ...config };
    logWithTimestamp(`CascadeDetector: Config updated - window: ${this.config.rollingWindowMs / 1000}s, multiplier: ${this.config.volumeMultiplierThreshold}x, cooldown: ${this.config.cooldownMs / 1000}s`);
  }

  /**
   * Feed a liquidation event into the detector.
   * Called for EVERY liquidation from the WebSocket, including unconfigured symbols.
   * This gives us a full market-wide picture.
   */
  public processLiquidation(liquidation: LiquidationEvent, volumeUSDT: number): void {
    if (!this.config.enabled) return;

    const record: LiquidationRecord = {
      symbol: liquidation.symbol,
      side: liquidation.side,
      volumeUSDT,
      timestamp: Date.now(),
    };

    this.liquidations.push(record);

    // Check for cascade conditions
    this.evaluate();
  }

  /**
   * The main gate — called by hunter.ts before placing any trade.
   * Returns true if trading should be BLOCKED.
   */
  public isCascadeActive(): boolean {
    if (!this.config.enabled) return false;

    // Check if cooldown has expired
    if (this.cascadeActive && this.cascadeResumesAt) {
      if (Date.now() >= this.cascadeResumesAt) {
        this.deactivateCascade();
      }
    }

    return this.cascadeActive;
  }

  /**
   * Get the full current state for logging/UI
   */
  public getState(): CascadeState {
    const now = Date.now();
    const windowCutoff = now - this.config.rollingWindowMs;
    const baselineCutoff = now - this.config.baselineWindowMs;

    const windowLiqs = this.liquidations.filter(l => l.timestamp >= windowCutoff);
    const baselineLiqs = this.liquidations.filter(l => l.timestamp >= baselineCutoff);

    const windowVolume = windowLiqs.reduce((sum, l) => sum + l.volumeUSDT, 0);
    const baselineVolume = baselineLiqs.reduce((sum, l) => sum + l.volumeUSDT, 0);

    // Baseline rate: normalize baseline to same window length for comparison
    const baselineRatePerWindow = this.config.baselineWindowMs > 0
      ? (baselineVolume / this.config.baselineWindowMs) * this.config.rollingWindowMs
      : 0;

    const volumeMultiplier = baselineRatePerWindow > 0
      ? windowVolume / baselineRatePerWindow
      : 0;

    // Active symbols in window
    const activeSymbols = [...new Set(windowLiqs.map(l => l.symbol))];

    // Directional skew in window
    const sellLiqVolume = windowLiqs
      .filter(l => l.side === 'SELL')
      .reduce((sum, l) => sum + l.volumeUSDT, 0);
    const buyLiqVolume = windowLiqs
      .filter(l => l.side === 'BUY')
      .reduce((sum, l) => sum + l.volumeUSDT, 0);
    const totalVolume = sellLiqVolume + buyLiqVolume;

    // Skew: positive = mostly longs getting liquidated (SELL liqs), negative = mostly shorts
    const directionalSkew = totalVolume > 0
      ? (sellLiqVolume - buyLiqVolume) / totalVolume
      : 0;

    const dominantDirection = Math.abs(directionalSkew) < 0.3
      ? 'BALANCED' as const
      : directionalSkew > 0
        ? 'LONG_LIQUIDATIONS' as const
        : 'SHORT_LIQUIDATIONS' as const;

    return {
      isActive: this.cascadeActive,
      detectedAt: this.cascadeDetectedAt,
      resumesAt: this.cascadeResumesAt,
      reason: this.cascadeReason,
      currentWindowVolume: windowVolume,
      baselineWindowVolume: baselineVolume,
      volumeMultiplier,
      activeSymbolCount: activeSymbols.length,
      activeSymbols,
      directionalSkew,
      dominantDirection,
      windowLiquidationCount: windowLiqs.length,
      baselineLiquidationCount: baselineLiqs.length,
    };
  }

  /**
   * Core evaluation — runs after each new liquidation
   */
  private evaluate(): void {
    if (this.cascadeActive) return; // Already in cascade, no need to re-evaluate

    const now = Date.now();
    const windowCutoff = now - this.config.rollingWindowMs;
    const baselineCutoff = now - this.config.baselineWindowMs;

    // Get liquidations in each window
    const windowLiqs = this.liquidations.filter(l => l.timestamp >= windowCutoff);
    const baselineLiqs = this.liquidations.filter(l => l.timestamp >= baselineCutoff);

    // ── Metric 1: Volume in current window ──
    const windowVolume = windowLiqs.reduce((sum, l) => sum + l.volumeUSDT, 0);

    // Don't trigger on low volume — avoid false positives during quiet periods
    if (windowVolume < this.config.minVolumeForDetection) return;

    // ── Metric 2: Volume multiplier vs baseline ──
    // Normalize baseline to the same window length for fair comparison
    const baselineVolume = baselineLiqs.reduce((sum, l) => sum + l.volumeUSDT, 0);
    const baselineRatePerWindow = this.config.baselineWindowMs > 0
      ? (baselineVolume / this.config.baselineWindowMs) * this.config.rollingWindowMs
      : 0;

    const volumeMultiplier = baselineRatePerWindow > 0
      ? windowVolume / baselineRatePerWindow
      : 0;

    // ── Metric 3: Cross-symbol count ──
    const activeSymbols = [...new Set(windowLiqs.map(l => l.symbol))];
    const symbolCount = activeSymbols.length;

    // ── Metric 4: Directional skew ──
    const sellLiqVolume = windowLiqs
      .filter(l => l.side === 'SELL')
      .reduce((sum, l) => sum + l.volumeUSDT, 0);
    const buyLiqVolume = windowLiqs
      .filter(l => l.side === 'BUY')
      .reduce((sum, l) => sum + l.volumeUSDT, 0);
    const totalVolume = sellLiqVolume + buyLiqVolume;
    const skew = totalVolume > 0
      ? Math.max(sellLiqVolume, buyLiqVolume) / totalVolume
      : 0;

    // ── CASCADE DETECTION LOGIC ──
    // Require MULTIPLE signals to confirm — no single signal can trigger alone
    // This prevents false positives from a single whale liquidation
    const reasons: string[] = [];
    let signalCount = 0;

    // Signal 1: Volume spike (most important)
    const volumeSpiking = volumeMultiplier >= this.config.volumeMultiplierThreshold;
    if (volumeSpiking) {
      signalCount++;
      reasons.push(`Volume ${volumeMultiplier.toFixed(1)}x above baseline ($${windowVolume.toFixed(0)} vs norm $${baselineRatePerWindow.toFixed(0)} per ${this.config.rollingWindowMs / 1000}s)`);
    }

    // Signal 2: Many symbols liquidating simultaneously
    const multiSymbol = symbolCount >= this.config.minSymbolsForCascade;
    if (multiSymbol) {
      signalCount++;
      reasons.push(`${symbolCount} symbols liquidating simultaneously: ${activeSymbols.join(', ')}`);
    }

    // Signal 3: Heavy directional skew (market moving one way hard)
    const skewed = skew >= this.config.directionalSkewThreshold;
    if (skewed) {
      signalCount++;
      const direction = sellLiqVolume > buyLiqVolume ? 'LONGS' : 'SHORTS';
      reasons.push(`Directional skew ${(skew * 100).toFixed(0)}% — ${direction} being liquidated (cascade direction)`);
    }

    // ── TRIGGER: Need volume spike + at least one other signal ──
    // Volume spike alone could be a whale — need confirmation
    if (volumeSpiking && signalCount >= 2) {
      this.activateCascade(reasons);
    }
  }

  /**
   * Activate cascade protection
   */
  private activateCascade(reasons: string[]): void {
    this.cascadeActive = true;
    this.cascadeDetectedAt = Date.now();
    this.cascadeResumesAt = Date.now() + this.config.cooldownMs;
    this.cascadeReason = reasons.join(' | ');
    this.cascadeCount++;

    const cooldownMin = this.config.cooldownMs / 60000;

    logWarnWithTimestamp(`🚨 CASCADE DETECTED (#${this.cascadeCount}) — New entries PAUSED for ${cooldownMin.toFixed(1)} minutes`);
    reasons.forEach(r => logWarnWithTimestamp(`  ⚠️ ${r}`));
    logWarnWithTimestamp(`  📍 Resumes at: ${new Date(this.cascadeResumesAt).toISOString()}`);

    this.emit('cascadeDetected', {
      detectedAt: this.cascadeDetectedAt,
      resumesAt: this.cascadeResumesAt,
      reasons,
      state: this.getState(),
    });
  }

  /**
   * Deactivate cascade protection after cooldown
   */
  private deactivateCascade(): void {
    const duration = this.cascadeDetectedAt
      ? ((Date.now() - this.cascadeDetectedAt) / 60000).toFixed(1)
      : '?';

    logWithTimestamp(`✅ CASCADE CLEARED — Trading resumed after ${duration} minute pause`);
    logWithTimestamp(`  📊 Session cascade count: ${this.cascadeCount}`);

    this.cascadeActive = false;
    this.cascadeDetectedAt = null;
    this.cascadeResumesAt = null;
    this.cascadeReason = null;

    this.emit('cascadeCleared', {
      clearedAt: Date.now(),
      totalCascades: this.cascadeCount,
    });
  }

  /**
   * Prune old liquidation data to prevent memory growth
   * Keeps data up to 2x the baseline window for safe margin
   */
  private pruneOldData(): void {
    const cutoff = Date.now() - (this.config.baselineWindowMs * 2);
    const before = this.liquidations.length;
    this.liquidations = this.liquidations.filter(l => l.timestamp >= cutoff);
    const pruned = before - this.liquidations.length;
    if (pruned > 0) {
      logWithTimestamp(`CascadeDetector: Pruned ${pruned} old records, ${this.liquidations.length} remaining`);
    }
  }

  /**
   * Get time remaining until cascade cooldown expires (for UI display)
   */
  public getCooldownRemaining(): number {
    if (!this.cascadeActive || !this.cascadeResumesAt) return 0;
    return Math.max(0, this.cascadeResumesAt - Date.now());
  }

  /**
   * Force-clear a cascade (manual override from UI)
   */
  public forceClear(): void {
    if (this.cascadeActive) {
      logWithTimestamp('CascadeDetector: Cascade manually cleared by user');
      this.deactivateCascade();
    }
  }

  /**
   * Cleanup on shutdown
   */
  public stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.liquidations = [];
    this.removeAllListeners();
    logWithTimestamp('CascadeDetector: Stopped');
  }
}

// Singleton instance
export const cascadeDetector = new CascadeDetector();
