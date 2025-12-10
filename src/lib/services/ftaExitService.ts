/**
 * FTA (First Trouble Area) Early Exit Service
 * 
 * Implements Spicy's concept of cutting losers early:
 * - Place an invalidation level between entry and stop (around -0.5R)
 * - If price closes through FTA → cut early, take smaller loss
 * 
 * Benefits:
 * - Reduces average loss size
 * - Gets out of trades that aren't behaving like winners
 * - Preserves capital for better opportunities
 * 
 * Reference: spicy_mean_reversion_extracted.md - Lesson 7
 */

import { EventEmitter } from 'events';
import { getPriceService } from './priceService';
import { logWithTimestamp, logWarnWithTimestamp } from '../utils/timestamp';

// Position being monitored for FTA exit
export interface MonitoredPosition {
  symbol: string;
  side: 'BUY' | 'SELL';  // BUY = long, SELL = short
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  ftaPrice: number;           // First Trouble Area price
  ftaRatio: number;           // Where FTA is placed (0.5 = halfway to SL)
  openTime: number;           // When position was opened
  qualityScore: number;       // Trade quality score (0-3)
  positionKey: string;        // Unique identifier
  
  // FTA monitoring state
  isActive: boolean;          // Still being monitored
  ftaTriggered: boolean;      // Has FTA been triggered
  ftaTriggerTime?: number;    // When FTA was triggered
  ftaTriggerPrice?: number;   // Price when FTA triggered
  
  // Time-based invalidation
  maxDurationMs: number;      // Max time before time invalidation
  expectedWinDurationMs: number; // Average winning trade duration
}

// FTA exit recommendation
export interface FTAExitSignal {
  symbol: string;
  positionKey: string;
  exitType: 'FTA_PRICE' | 'TIME_INVALIDATION' | 'ABNORMAL_MAE';
  currentPrice: number;
  entryPrice: number;
  ftaPrice: number;
  unrealizedPnlPercent: number;
  durationMs: number;
  reason: string;
  recommendation: 'EXIT_NOW' | 'MONITOR' | 'HOLD';
  confidence: number; // 0-100
}

// Trade duration statistics for time-based invalidation
interface DurationStats {
  averageWinDurationMs: number;
  averageLossDurationMs: number;
  maxWinDurationMs: number;
  sampleCount: number;
}

export class FTAExitService extends EventEmitter {
  // Positions being monitored
  private monitoredPositions: Map<string, MonitoredPosition> = new Map();
  
  // Track which signals have already been emitted (to prevent spam)
  // Key: `${positionKey}_${exitType}`, Value: timestamp of last emission
  private emittedSignals: Map<string, number> = new Map();
  
  // Minimum time between repeated signals for the same position/type (5 minutes)
  private readonly SIGNAL_THROTTLE_MS = 5 * 60 * 1000;
  
  // Historical trade durations for calibration
  private tradeDurations: Array<{
    symbol: string;
    durationMs: number;
    isWinner: boolean;
    pnlPercent: number;
    timestamp: number;
  }> = [];
  
  // Duration stats per symbol
  private durationStats: Map<string, DurationStats> = new Map();
  
  // Global duration stats
  private globalDurationStats: DurationStats = {
    averageWinDurationMs: 30 * 60 * 1000,  // Default: 30 minutes
    averageLossDurationMs: 60 * 60 * 1000, // Default: 60 minutes  
    maxWinDurationMs: 120 * 60 * 1000,     // Default: 2 hours
    sampleCount: 0,
  };
  
  // Configuration
  private readonly DEFAULT_FTA_RATIO = 0.5;  // FTA at 50% to stop loss
  private readonly HIGH_QUALITY_FTA_RATIO = 0.3;  // Tighter FTA for high quality trades
  private readonly LOW_QUALITY_FTA_RATIO = 0.7;   // Wider FTA for low quality trades
  private readonly TIME_MULTIPLIER_THRESHOLD = 3;  // If 3x average duration, consider time invalidation
  
  private monitorInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    super();
  }

  /**
   * Start the FTA monitoring service
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Monitor positions every second
    this.monitorInterval = setInterval(() => {
      this.checkAllPositions();
    }, 1000);

    logWithTimestamp('📊 FTA Exit Service: Started');
  }

  /**
   * Stop the service
   */
  stop(): void {
    this.isRunning = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    logWithTimestamp('📊 FTA Exit Service: Stopped');
  }

  /**
   * Add a position to be monitored for FTA exit
   */
  addPosition(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    qualityScore?: number;  // 0-3
    positionKey?: string;
  }): MonitoredPosition {
    const { symbol, side, entryPrice, stopLossPrice, takeProfitPrice, qualityScore = 2 } = params;
    const positionKey = params.positionKey || `${symbol}_${side}_${Date.now()}`;
    
    // Calculate FTA ratio based on quality score
    // Higher quality = tighter FTA (can cut faster)
    // Lower quality = wider FTA (needs more room)
    let ftaRatio: number;
    if (qualityScore >= 3) {
      ftaRatio = this.HIGH_QUALITY_FTA_RATIO;  // 0.3 - tight FTA
    } else if (qualityScore <= 1) {
      ftaRatio = this.LOW_QUALITY_FTA_RATIO;   // 0.7 - wide FTA
    } else {
      ftaRatio = this.DEFAULT_FTA_RATIO;       // 0.5 - standard
    }
    
    // Calculate FTA price
    // FTA is placed between entry and stop loss
    // For LONG: FTA = Entry - (Entry - StopLoss) * ftaRatio
    // For SHORT: FTA = Entry + (StopLoss - Entry) * ftaRatio
    let ftaPrice: number;
    if (side === 'BUY') {
      // Long position
      const distanceToSL = entryPrice - stopLossPrice;
      ftaPrice = entryPrice - (distanceToSL * ftaRatio);
    } else {
      // Short position
      const distanceToSL = stopLossPrice - entryPrice;
      ftaPrice = entryPrice + (distanceToSL * ftaRatio);
    }

    // Get expected duration based on historical data
    const stats = this.getSymbolDurationStats(symbol);
    const expectedWinDurationMs = stats.averageWinDurationMs || this.globalDurationStats.averageWinDurationMs;
    const maxDurationMs = stats.maxWinDurationMs * this.TIME_MULTIPLIER_THRESHOLD || 
                          this.globalDurationStats.maxWinDurationMs * this.TIME_MULTIPLIER_THRESHOLD;

    const position: MonitoredPosition = {
      symbol,
      side,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      ftaPrice,
      ftaRatio,
      openTime: Date.now(),
      qualityScore,
      positionKey,
      isActive: true,
      ftaTriggered: false,
      maxDurationMs,
      expectedWinDurationMs,
    };

    this.monitoredPositions.set(positionKey, position);

    logWithTimestamp(`📊 FTA Exit Service: Monitoring ${symbol} ${side}`);
    logWithTimestamp(`  Entry: $${entryPrice.toFixed(4)}, SL: $${stopLossPrice.toFixed(4)}, FTA: $${ftaPrice.toFixed(4)} (${(ftaRatio * 100).toFixed(0)}% to SL)`);
    logWithTimestamp(`  Quality: ${qualityScore}/3, Max duration: ${(maxDurationMs / 60000).toFixed(0)} min`);

    this.emit('positionAdded', position);

    return position;
  }

  /**
   * Remove a position from monitoring
   */
  removePosition(positionKey: string, reason: 'closed' | 'cancelled' | 'other' = 'closed'): void {
    const position = this.monitoredPositions.get(positionKey);
    if (position) {
      position.isActive = false;
      this.monitoredPositions.delete(positionKey);
      
      // Clean up throttle tracking for this position
      for (const key of this.emittedSignals.keys()) {
        if (key.startsWith(positionKey)) {
          this.emittedSignals.delete(key);
        }
      }
      
      logWithTimestamp(`📊 FTA Exit Service: Stopped monitoring ${position.symbol} (${reason})`);
      
      this.emit('positionRemoved', { positionKey, reason });
    }
  }

  /**
   * Record a completed trade for duration statistics
   */
  recordTrade(params: {
    symbol: string;
    durationMs: number;
    isWinner: boolean;
    pnlPercent: number;
  }): void {
    const { symbol, durationMs, isWinner, pnlPercent } = params;
    
    this.tradeDurations.push({
      symbol,
      durationMs,
      isWinner,
      pnlPercent,
      timestamp: Date.now(),
    });

    // Keep only last 100 trades
    if (this.tradeDurations.length > 100) {
      this.tradeDurations.shift();
    }

    // Update stats
    this.updateDurationStats();
  }

  /**
   * Check all monitored positions for FTA/time triggers
   */
  private checkAllPositions(): void {
    const priceService = getPriceService();
    if (!priceService) return;

    for (const [positionKey, position] of this.monitoredPositions.entries()) {
      if (!position.isActive) continue;

      const markPriceData = priceService.getMarkPrice(position.symbol);
      if (!markPriceData) continue;

      const markPrice = parseFloat(markPriceData.markPrice);
      this.checkPosition(position, markPrice);
    }
  }

  /**
   * Check a single position for FTA/time triggers
   */
  private checkPosition(position: MonitoredPosition, currentPrice: number): void {
    const now = Date.now();
    const durationMs = now - position.openTime;
    
    // Calculate unrealized PnL
    let unrealizedPnlPercent: number;
    if (position.side === 'BUY') {
      unrealizedPnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
    } else {
      unrealizedPnlPercent = ((position.entryPrice - currentPrice) / position.entryPrice) * 100;
    }

    // Check FTA price trigger
    const ftaTriggered = this.checkFTATrigger(position, currentPrice);
    
    // Check time-based invalidation
    const timeInvalidation = this.checkTimeInvalidation(position, durationMs);
    
    // Check abnormal MAE (Maximum Adverse Excursion)
    const abnormalMAE = this.checkAbnormalMAE(position, unrealizedPnlPercent);

    // Generate signal if any trigger is hit
    if (ftaTriggered || timeInvalidation || abnormalMAE) {
      let exitType: FTAExitSignal['exitType'];
      let reason: string;
      let confidence: number;
      
      if (ftaTriggered) {
        exitType = 'FTA_PRICE';
        reason = `Price crossed FTA level at $${position.ftaPrice.toFixed(4)}`;
        confidence = 85;
      } else if (timeInvalidation) {
        exitType = 'TIME_INVALIDATION';
        reason = `Trade duration (${(durationMs / 60000).toFixed(0)} min) exceeds ${this.TIME_MULTIPLIER_THRESHOLD}x average winning duration`;
        confidence = 70;
      } else {
        exitType = 'ABNORMAL_MAE';
        reason = `Unrealized loss (${unrealizedPnlPercent.toFixed(2)}%) is abnormally high for winning trades`;
        confidence = 75;
      }

      // Throttle repeated signals - only emit if we haven't signaled this position/type recently
      const signalKey = `${position.positionKey}_${exitType}`;
      const now = Date.now();
      const lastEmitted = this.emittedSignals.get(signalKey);
      
      if (lastEmitted && (now - lastEmitted) < this.SIGNAL_THROTTLE_MS) {
        // Skip - already signaled recently
        return;
      }
      
      // Update throttle timestamp
      this.emittedSignals.set(signalKey, now);

      const signal: FTAExitSignal = {
        symbol: position.symbol,
        positionKey: position.positionKey,
        exitType,
        currentPrice,
        entryPrice: position.entryPrice,
        ftaPrice: position.ftaPrice,
        unrealizedPnlPercent,
        durationMs,
        reason,
        recommendation: unrealizedPnlPercent < -2 ? 'EXIT_NOW' : 'MONITOR',
        confidence,
      };

      this.emit('ftaExit', signal);
      
      logWarnWithTimestamp(`📊 FTA Exit Signal: ${position.symbol} ${position.side}`);
      logWarnWithTimestamp(`  Type: ${exitType}`);
      logWarnWithTimestamp(`  Reason: ${reason}`);
      logWarnWithTimestamp(`  Current PnL: ${unrealizedPnlPercent.toFixed(2)}%`);
      logWarnWithTimestamp(`  Recommendation: ${signal.recommendation}`);
    }
  }

  /**
   * Check if price has crossed FTA level
   */
  private checkFTATrigger(position: MonitoredPosition, currentPrice: number): boolean {
    if (position.ftaTriggered) return false;  // Already triggered
    
    let triggered = false;
    
    if (position.side === 'BUY') {
      // Long position: FTA triggered if price drops below FTA
      triggered = currentPrice < position.ftaPrice;
    } else {
      // Short position: FTA triggered if price rises above FTA
      triggered = currentPrice > position.ftaPrice;
    }
    
    if (triggered) {
      position.ftaTriggered = true;
      position.ftaTriggerTime = Date.now();
      position.ftaTriggerPrice = currentPrice;
    }
    
    return triggered;
  }

  /**
   * Check if trade has exceeded time threshold
   */
  private checkTimeInvalidation(position: MonitoredPosition, durationMs: number): boolean {
    // Only trigger time invalidation if trade is in the red
    // Winners can take time, but losers that drag on are bad
    const priceService = getPriceService();
    const markPriceData = priceService?.getMarkPrice(position.symbol);
    if (!markPriceData) return false;

    const currentPrice = parseFloat(markPriceData.markPrice);
    let inProfit: boolean;
    if (position.side === 'BUY') {
      inProfit = currentPrice > position.entryPrice;
    } else {
      inProfit = currentPrice < position.entryPrice;
    }

    // If in profit, don't trigger time invalidation
    if (inProfit) return false;

    // Check if duration exceeds threshold
    return durationMs > position.maxDurationMs;
  }

  /**
   * Check if unrealized loss is abnormally high
   * Based on MAE (Maximum Adverse Excursion) concept
   */
  private checkAbnormalMAE(position: MonitoredPosition, unrealizedPnlPercent: number): boolean {
    // Only check if in a loss
    if (unrealizedPnlPercent >= 0) return false;

    // Calculate what % of the way to stop loss we are
    const distanceToSL = Math.abs(position.entryPrice - position.stopLossPrice) / position.entryPrice * 100;
    const currentDrawdownPercent = Math.abs(unrealizedPnlPercent);
    const percentTowardsStop = currentDrawdownPercent / distanceToSL;

    // Higher quality trades should not go this far against us
    // Quality 3: Flag at 50% to SL
    // Quality 2: Flag at 60% to SL  
    // Quality 1: Flag at 70% to SL
    // Quality 0: Flag at 80% to SL
    const threshold = 0.5 + (3 - position.qualityScore) * 0.1;

    return percentTowardsStop >= threshold;
  }

  /**
   * Update duration statistics from recorded trades
   */
  private updateDurationStats(): void {
    const winners = this.tradeDurations.filter(t => t.isWinner);
    const losers = this.tradeDurations.filter(t => !t.isWinner);

    if (winners.length > 0) {
      this.globalDurationStats.averageWinDurationMs = 
        winners.reduce((sum, t) => sum + t.durationMs, 0) / winners.length;
      this.globalDurationStats.maxWinDurationMs = 
        Math.max(...winners.map(t => t.durationMs));
    }

    if (losers.length > 0) {
      this.globalDurationStats.averageLossDurationMs = 
        losers.reduce((sum, t) => sum + t.durationMs, 0) / losers.length;
    }

    this.globalDurationStats.sampleCount = this.tradeDurations.length;

    // Update per-symbol stats
    const symbolGroups = new Map<string, typeof this.tradeDurations>();
    for (const trade of this.tradeDurations) {
      const group = symbolGroups.get(trade.symbol) || [];
      group.push(trade);
      symbolGroups.set(trade.symbol, group);
    }

    for (const [symbol, trades] of symbolGroups) {
      const symbolWinners = trades.filter(t => t.isWinner);
      const symbolLosers = trades.filter(t => !t.isWinner);

      const stats: DurationStats = {
        averageWinDurationMs: symbolWinners.length > 0 
          ? symbolWinners.reduce((sum, t) => sum + t.durationMs, 0) / symbolWinners.length 
          : this.globalDurationStats.averageWinDurationMs,
        averageLossDurationMs: symbolLosers.length > 0 
          ? symbolLosers.reduce((sum, t) => sum + t.durationMs, 0) / symbolLosers.length 
          : this.globalDurationStats.averageLossDurationMs,
        maxWinDurationMs: symbolWinners.length > 0 
          ? Math.max(...symbolWinners.map(t => t.durationMs)) 
          : this.globalDurationStats.maxWinDurationMs,
        sampleCount: trades.length,
      };

      this.durationStats.set(symbol, stats);
    }
  }

  /**
   * Get duration statistics for a symbol
   */
  getSymbolDurationStats(symbol: string): DurationStats {
    return this.durationStats.get(symbol) || this.globalDurationStats;
  }

  /**
   * Get all monitored positions
   */
  getMonitoredPositions(): MonitoredPosition[] {
    return Array.from(this.monitoredPositions.values());
  }

  /**
   * Get FTA price for a new position calculation
   */
  calculateFTAPrice(params: {
    side: 'BUY' | 'SELL';
    entryPrice: number;
    stopLossPrice: number;
    qualityScore: number;
  }): { ftaPrice: number; ftaRatio: number } {
    const { side, entryPrice, stopLossPrice, qualityScore } = params;

    let ftaRatio: number;
    if (qualityScore >= 3) {
      ftaRatio = this.HIGH_QUALITY_FTA_RATIO;
    } else if (qualityScore <= 1) {
      ftaRatio = this.LOW_QUALITY_FTA_RATIO;
    } else {
      ftaRatio = this.DEFAULT_FTA_RATIO;
    }

    let ftaPrice: number;
    if (side === 'BUY') {
      const distanceToSL = entryPrice - stopLossPrice;
      ftaPrice = entryPrice - (distanceToSL * ftaRatio);
    } else {
      const distanceToSL = stopLossPrice - entryPrice;
      ftaPrice = entryPrice + (distanceToSL * ftaRatio);
    }

    return { ftaPrice, ftaRatio };
  }
}

// Export singleton instance
export const ftaExitService = new FTAExitService();
