/**
 * Trade Quality Scoring Service
 * 
 * Implements concepts from Spicy's Mean Reversion Strategy:
 * 1. VWAP Cross Counter - detect choppy vs trending markets
 * 2. Trade Quality Score - rate each opportunity 0-3
 * 3. Regime Detection - identify optimal trading conditions
 * 4. Position Sizing based on quality
 * 
 * Reference: spicy_mean_reversion_extracted.md
 */

import { EventEmitter } from 'events';
import { vwapStreamer } from './vwapStreamer';
import { LiquidationEvent } from '../types';

// Quality score breakdown
export interface TradeQualityScore {
  symbol: string;
  side: 'BUY' | 'SELL';
  totalScore: number;  // 0-3
  
  // Individual criteria scores (0 or 1 each)
  spikeScore: number;           // Fast spike approach (good) vs slow grind (bad)
  volumeTrendScore: number;     // Decreasing/flat volume (good) vs increasing (bad)
  regimeScore: number;          // Choppy range (good) vs trending (bad)
  
  // Detailed metrics
  metrics: {
    // Spike analysis
    priceChangePercent: number;   // How much price moved in the spike
    spikeTimeSeconds: number;     // How fast the spike occurred
    spikeVelocity: number;        // Price change per second
    
    // Volume analysis
    recentVolumeRatio: number;    // Recent volume vs average (< 1 = decreasing)
    
    // Regime analysis (VWAP-based)
    vwapCrossCount: number;       // Crosses in lookback period
    vwapCrossesPerHour: number;   // Normalized cross rate
    isChoppyRegime: boolean;      // True if >3 crosses/hour
    isTrendingRegime: boolean;    // True if <1 cross/hour
    
    // Current VWAP position
    vwapDistance: number;         // % distance from VWAP
    isAboveVwap: boolean;
  };
  
  // Recommendations
  recommendation: 'STRONG' | 'NORMAL' | 'WEAK' | 'SKIP';
  positionSizeMultiplier: number;  // 0.5, 1.0, 1.5 based on quality
  targetMultiplier: number;        // For wider targets on high quality
  
  // Reasoning
  reasons: string[];
}

// VWAP cross tracking
interface VWAPCrossEvent {
  symbol: string;
  timestamp: number;
  direction: 'up' | 'down';
  price: number;
  vwap: number;
}

// Price spike tracking for detecting fast moves
interface PriceSpike {
  symbol: string;
  startPrice: number;
  endPrice: number;
  startTime: number;
  endTime: number;
  changePercent: number;
  direction: 'up' | 'down';
}

// Volume window for trend detection
interface VolumeWindow {
  symbol: string;
  timestamp: number;
  volume: number;
}

export class TradeQualityService extends EventEmitter {
  // VWAP cross tracking per symbol
  private vwapCrosses: Map<string, VWAPCrossEvent[]> = new Map();
  private lastVwapPosition: Map<string, 'above' | 'below'> = new Map();
  
  // Price tracking for spike detection
  private priceHistory: Map<string, Array<{price: number, time: number}>> = new Map();
  private recentSpikes: Map<string, PriceSpike[]> = new Map();
  
  // Volume tracking for trend detection
  private volumeHistory: Map<string, VolumeWindow[]> = new Map();
  
  // Configuration
  private readonly VWAP_CROSS_LOOKBACK_MS = 60 * 60 * 1000;  // 1 hour
  private readonly PRICE_HISTORY_LOOKBACK_MS = 5 * 60 * 1000; // 5 minutes
  private readonly SPIKE_THRESHOLD_PERCENT = 0.5;  // 0.5% move in short time = spike
  private readonly SPIKE_TIME_WINDOW_MS = 60 * 1000; // 1 minute window for spike detection
  private readonly CHOPPY_THRESHOLD_CROSSES_PER_HOUR = 3;
  private readonly TRENDING_THRESHOLD_CROSSES_PER_HOUR = 1;
  
  private cleanupInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    super();
  }

  /**
   * Start the trade quality service
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Listen to VWAP updates from the streamer
    vwapStreamer.on('vwap', (vwapData) => {
      this.trackVWAPCross(vwapData);
    });

    // Cleanup old data every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 60000);

    console.log('📊 Trade Quality Service: Started');
  }

  /**
   * Stop the service
   */
  stop(): void {
    this.isRunning = false;
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.vwapCrosses.clear();
    this.lastVwapPosition.clear();
    this.priceHistory.clear();
    this.recentSpikes.clear();
    this.volumeHistory.clear();

    console.log('📊 Trade Quality Service: Stopped');
  }

  /**
   * Track VWAP crosses to detect market regime
   */
  private trackVWAPCross(vwapData: { symbol: string; vwap: number; currentPrice: number; position: 'above' | 'below'; timestamp: number }): void {
    const { symbol, vwap, currentPrice, position, timestamp } = vwapData;
    
    // Check if position changed (crossed VWAP)
    const lastPosition = this.lastVwapPosition.get(symbol);
    
    if (lastPosition && lastPosition !== position) {
      // VWAP cross detected!
      const crossEvent: VWAPCrossEvent = {
        symbol,
        timestamp,
        direction: position === 'above' ? 'up' : 'down',
        price: currentPrice,
        vwap,
      };

      // Store the cross
      const crosses = this.vwapCrosses.get(symbol) || [];
      crosses.push(crossEvent);
      this.vwapCrosses.set(symbol, crosses);

      // Emit event for monitoring
      this.emit('vwapCross', crossEvent);
    }

    this.lastVwapPosition.set(symbol, position);
    
    // Track price for spike detection using real-time VWAP streamer data
    this.trackPrice(symbol, currentPrice, timestamp);
    
    // Also detect spikes from the streaming price data (not just liquidations)
    this.detectSpike(symbol, currentPrice, timestamp);
  }

  /**
   * Track price history for spike detection
   */
  private trackPrice(symbol: string, price: number, timestamp: number): void {
    const history = this.priceHistory.get(symbol) || [];
    history.push({ price, time: timestamp });
    
    // Keep only recent history
    const cutoff = timestamp - this.PRICE_HISTORY_LOOKBACK_MS;
    const filtered = history.filter(h => h.time >= cutoff);
    this.priceHistory.set(symbol, filtered);
  }

  /**
   * Record a liquidation event for volume tracking
   */
  recordLiquidation(liquidation: LiquidationEvent, volumeUSDT: number): void {
    const { symbol, eventTime } = liquidation;
    
    // Track volume
    const volumes = this.volumeHistory.get(symbol) || [];
    volumes.push({
      symbol,
      timestamp: eventTime,
      volume: volumeUSDT,
    });
    
    // Keep only recent volumes (last 5 minutes)
    const cutoff = eventTime - this.PRICE_HISTORY_LOOKBACK_MS;
    const filtered = volumes.filter(v => v.timestamp >= cutoff);
    this.volumeHistory.set(symbol, filtered);
    
    // Track price from liquidation
    this.trackPrice(symbol, liquidation.price, eventTime);
    
    // Detect spikes
    this.detectSpike(symbol, liquidation.price, eventTime);
  }

  /**
   * Detect if a fast spike just occurred
   */
  private detectSpike(symbol: string, currentPrice: number, timestamp: number): void {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length < 2) return;

    // Look at price movement in the last SPIKE_TIME_WINDOW_MS
    const windowStart = timestamp - this.SPIKE_TIME_WINDOW_MS;
    const recentPrices = history.filter(h => h.time >= windowStart);
    
    if (recentPrices.length < 2) return;

    const startPrice = recentPrices[0].price;
    const endPrice = currentPrice;
    const changePercent = ((endPrice - startPrice) / startPrice) * 100;
    
    // Check if this qualifies as a spike
    if (Math.abs(changePercent) >= this.SPIKE_THRESHOLD_PERCENT) {
      const spike: PriceSpike = {
        symbol,
        startPrice,
        endPrice,
        startTime: recentPrices[0].time,
        endTime: timestamp,
        changePercent,
        direction: changePercent > 0 ? 'up' : 'down',
      };

      const spikes = this.recentSpikes.get(symbol) || [];
      spikes.push(spike);
      this.recentSpikes.set(symbol, spikes);

      this.emit('spikeDetected', spike);
    }
  }

  /**
   * Clean up old data to prevent memory leaks
   */
  private cleanupOldData(): void {
    const now = Date.now();
    
    // Clean VWAP crosses older than lookback
    for (const [symbol, crosses] of this.vwapCrosses.entries()) {
      const cutoff = now - this.VWAP_CROSS_LOOKBACK_MS;
      const filtered = crosses.filter(c => c.timestamp >= cutoff);
      this.vwapCrosses.set(symbol, filtered);
    }
    
    // Clean spikes older than 5 minutes
    for (const [symbol, spikes] of this.recentSpikes.entries()) {
      const cutoff = now - this.PRICE_HISTORY_LOOKBACK_MS;
      const filtered = spikes.filter(s => s.endTime >= cutoff);
      this.recentSpikes.set(symbol, filtered);
    }
    
    // Clean price history
    for (const [symbol, history] of this.priceHistory.entries()) {
      const cutoff = now - this.PRICE_HISTORY_LOOKBACK_MS;
      const filtered = history.filter(h => h.time >= cutoff);
      this.priceHistory.set(symbol, filtered);
    }
    
    // Clean volume history
    for (const [symbol, volumes] of this.volumeHistory.entries()) {
      const cutoff = now - this.PRICE_HISTORY_LOOKBACK_MS;
      const filtered = volumes.filter(v => v.timestamp >= cutoff);
      this.volumeHistory.set(symbol, filtered);
    }
  }

  /**
   * Calculate trade quality score for a potential entry
   * 
   * Based on Spicy's 3 variables:
   * 1. How did price approach the level? (fast spike = good)
   * 2. What did volume look like? (decreasing = good)
   * 3. How does left-side price action look? (choppy range = good)
   */
  calculateQualityScore(
    symbol: string,
    side: 'BUY' | 'SELL',
    liquidationPrice: number,
    liquidationVolume: number
  ): TradeQualityScore {
    const now = Date.now();
    const reasons: string[] = [];
    
    // === 1. SPIKE SCORE - How did price approach? ===
    let spikeScore = 0;
    let priceChangePercent = 0;
    let spikeTimeSeconds = 0;
    let spikeVelocity = 0;

    const recentSpikes = this.recentSpikes.get(symbol) || [];
    const veryRecentSpikes = recentSpikes.filter(s => (now - s.endTime) < 30000); // Last 30 seconds
    
    if (veryRecentSpikes.length > 0) {
      // Find the most recent spike in the expected direction
      // For BUY entries, we want a down spike (price crashed into support)
      // For SELL entries, we want an up spike (price pumped into resistance)
      const expectedDirection = side === 'BUY' ? 'down' : 'up';
      const relevantSpike = veryRecentSpikes
        .filter(s => s.direction === expectedDirection)
        .sort((a, b) => b.endTime - a.endTime)[0];
      
      if (relevantSpike) {
        priceChangePercent = Math.abs(relevantSpike.changePercent);
        spikeTimeSeconds = (relevantSpike.endTime - relevantSpike.startTime) / 1000;
        spikeVelocity = priceChangePercent / Math.max(spikeTimeSeconds, 0.1);
        
        // Score: Fast spike (high velocity) = good
        if (spikeVelocity > 0.5) { // >0.5% per second
          spikeScore = 1;
          reasons.push(`✅ Fast spike detected: ${priceChangePercent.toFixed(2)}% in ${spikeTimeSeconds.toFixed(1)}s`);
        } else {
          reasons.push(`⚠️ Slow approach: ${priceChangePercent.toFixed(2)}% over ${spikeTimeSeconds.toFixed(1)}s`);
        }
      } else {
        reasons.push(`❌ No recent spike in expected direction`);
      }
    } else {
      reasons.push(`❌ No recent price spike detected`);
    }

    // === 2. VOLUME TREND SCORE - Is volume decreasing? ===
    let volumeTrendScore = 0;
    let recentVolumeRatio = 1;

    const volumeHistory = this.volumeHistory.get(symbol) || [];
    if (volumeHistory.length >= 3) {
      // Compare recent volume to older volume
      const midpoint = Math.floor(volumeHistory.length / 2);
      const olderVolumes = volumeHistory.slice(0, midpoint);
      const recentVolumes = volumeHistory.slice(midpoint);
      
      const avgOlder = olderVolumes.reduce((s, v) => s + v.volume, 0) / olderVolumes.length;
      const avgRecent = recentVolumes.reduce((s, v) => s + v.volume, 0) / recentVolumes.length;
      
      if (avgOlder > 0) {
        recentVolumeRatio = avgRecent / avgOlder;
        
        // Score: Decreasing or flat volume = good for reversals
        if (recentVolumeRatio <= 1.1) { // Volume flat or decreasing
          volumeTrendScore = 1;
          reasons.push(`✅ Volume trend favorable: ${(recentVolumeRatio * 100 - 100).toFixed(0)}% change`);
        } else {
          reasons.push(`⚠️ Volume increasing: +${((recentVolumeRatio - 1) * 100).toFixed(0)}% (momentum building)`);
        }
      }
    } else {
      // Not enough volume data, give benefit of doubt
      volumeTrendScore = 0;
      reasons.push(`⚠️ Insufficient volume history for trend analysis`);
    }

    // === 3. REGIME SCORE - Is market choppy (good) or trending (bad)? ===
    let regimeScore = 0;
    let vwapCrossCount = 0;
    let vwapCrossesPerHour = 0;
    let isChoppyRegime = false;
    let isTrendingRegime = false;

    const crosses = this.vwapCrosses.get(symbol) || [];
    const crossesInLastHour = crosses.filter(c => (now - c.timestamp) < this.VWAP_CROSS_LOOKBACK_MS);
    vwapCrossCount = crossesInLastHour.length;
    
    // Calculate time span for normalization
    const hourInMs = 60 * 60 * 1000;
    vwapCrossesPerHour = vwapCrossCount; // Already looking at 1 hour window

    if (vwapCrossesPerHour >= this.CHOPPY_THRESHOLD_CROSSES_PER_HOUR) {
      isChoppyRegime = true;
      regimeScore = 1;
      reasons.push(`✅ Choppy regime: ${vwapCrossCount} VWAP crosses/hour (good for reversals)`);
    } else if (vwapCrossesPerHour <= this.TRENDING_THRESHOLD_CROSSES_PER_HOUR) {
      isTrendingRegime = true;
      regimeScore = 0;
      reasons.push(`❌ Trending regime: ${vwapCrossCount} VWAP crosses/hour (bad for reversals)`);
    } else {
      regimeScore = 0;
      reasons.push(`⚠️ Neutral regime: ${vwapCrossCount} VWAP crosses/hour`);
    }

    // === VWAP Position Analysis ===
    let vwapDistance = 0;
    let isAboveVwap = false;
    
    const currentVwap = vwapStreamer.getCurrentVWAP(symbol);
    if (currentVwap) {
      isAboveVwap = currentVwap.position === 'above';
      vwapDistance = ((currentVwap.currentPrice - currentVwap.vwap) / currentVwap.vwap) * 100;
      
      // Additional VWAP-based validation
      // For BUY: price should be below VWAP (already handled by VWAP filter in hunter)
      // For SELL: price should be above VWAP
    }

    // === CALCULATE TOTAL SCORE ===
    const totalScore = spikeScore + volumeTrendScore + regimeScore;

    // === DETERMINE RECOMMENDATION ===
    let recommendation: TradeQualityScore['recommendation'];
    let positionSizeMultiplier: number;
    let targetMultiplier: number;

    if (totalScore === 3) {
      recommendation = 'STRONG';
      positionSizeMultiplier = 1.5;  // 50% larger position
      targetMultiplier = 1.5;        // Wider target
      reasons.push(`🎯 HIGH QUALITY: All 3 criteria met - increase size and targets`);
    } else if (totalScore === 2) {
      recommendation = 'NORMAL';
      positionSizeMultiplier = 1.0;  // Standard position
      targetMultiplier = 1.0;        // Standard target
      reasons.push(`✓ NORMAL QUALITY: 2/3 criteria met - standard execution`);
    } else if (totalScore === 1) {
      recommendation = 'WEAK';
      positionSizeMultiplier = 0.5;  // Reduced position
      targetMultiplier = 0.75;       // Tighter target
      reasons.push(`⚠️ LOW QUALITY: Only 1/3 criteria met - reduce size, tighter target`);
    } else {
      recommendation = 'SKIP';
      positionSizeMultiplier = 0;    // Don't trade
      targetMultiplier = 0;
      reasons.push(`❌ SKIP TRADE: 0/3 criteria met - consider opposite direction or wait`);
    }

    const qualityScore: TradeQualityScore = {
      symbol,
      side,
      totalScore,
      spikeScore,
      volumeTrendScore,
      regimeScore,
      metrics: {
        priceChangePercent,
        spikeTimeSeconds,
        spikeVelocity,
        recentVolumeRatio,
        vwapCrossCount,
        vwapCrossesPerHour,
        isChoppyRegime,
        isTrendingRegime,
        vwapDistance,
        isAboveVwap,
      },
      recommendation,
      positionSizeMultiplier,
      targetMultiplier,
      reasons,
    };

    // Emit for monitoring
    this.emit('qualityScoreCalculated', qualityScore);

    return qualityScore;
  }

  /**
   * Get current market regime for a symbol
   */
  getMarketRegime(symbol: string): {
    regime: 'choppy' | 'trending' | 'neutral';
    vwapCrossesPerHour: number;
    confidence: number;
  } {
    const now = Date.now();
    const crosses = this.vwapCrosses.get(symbol) || [];
    const crossesInLastHour = crosses.filter(c => (now - c.timestamp) < this.VWAP_CROSS_LOOKBACK_MS);
    const vwapCrossesPerHour = crossesInLastHour.length;

    let regime: 'choppy' | 'trending' | 'neutral';
    let confidence: number;

    if (vwapCrossesPerHour >= this.CHOPPY_THRESHOLD_CROSSES_PER_HOUR) {
      regime = 'choppy';
      confidence = Math.min(100, (vwapCrossesPerHour / 5) * 100); // >5 crosses = 100% confidence
    } else if (vwapCrossesPerHour <= this.TRENDING_THRESHOLD_CROSSES_PER_HOUR) {
      regime = 'trending';
      confidence = Math.min(100, ((2 - vwapCrossesPerHour) / 2) * 100); // 0 crosses = 100% confidence
    } else {
      regime = 'neutral';
      confidence = 50;
    }

    return { regime, vwapCrossesPerHour, confidence };
  }

  /**
   * Get recent VWAP crosses for a symbol
   */
  getRecentVWAPCrosses(symbol: string, lookbackMs: number = 3600000): VWAPCrossEvent[] {
    const now = Date.now();
    const crosses = this.vwapCrosses.get(symbol) || [];
    return crosses.filter(c => (now - c.timestamp) < lookbackMs);
  }

  /**
   * Get all regime data for dashboard display
   */
  getAllRegimeData(): Map<string, ReturnType<typeof this.getMarketRegime>> {
    const result = new Map();
    
    for (const symbol of this.vwapCrosses.keys()) {
      result.set(symbol, this.getMarketRegime(symbol));
    }
    
    return result;
  }
}

// Export singleton instance
export const tradeQualityService = new TradeQualityService();
