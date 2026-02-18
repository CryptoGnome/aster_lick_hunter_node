/**
 * Account Health Monitor - Tracks account drawdown over time to prevent slow-bleed liquidation
 * 
 * PURPOSE:
 * The real liquidation risk isn't sudden 5-minute cascades (those are actually great trade signals).
 * It's slow multi-day/week drawdowns where underwater positions accumulate and margin erodes.
 * This monitor tracks the account's equity curve and pauses NEW position entries when the 
 * account is bleeding too much — while ALWAYS allowing DCA into existing positions (to improve entry).
 * 
 * KEY DESIGN DECISIONS:
 * - DCA is NEVER blocked (adding to existing positions improves avg entry during drawdowns)
 * - Only NEW positions are blocked when health thresholds are breached
 * - Peak balance uses a session high-watermark (resets on bot restart)
 * - Hysteresis: resume threshold < pause threshold to prevent rapid on/off flipping
 * - Optional emergency close-all at extreme drawdown
 * 
 * INTEGRATION:
 * - Hunter checks shouldBlockNewPositions() before opening new positions (not DCA)
 * - PositionManager's checkRisk() feeds account data into this monitor
 * - Emits events for UI/logging visibility
 */

import { EventEmitter } from 'events';
import { AccountHealthConfig } from '../types';
import { getAccountInfo } from '../api/market';
import { ApiCredentials } from '../types';
import { logWithTimestamp, logWarnWithTimestamp, logErrorWithTimestamp } from '../utils/timestamp';

export interface AccountHealthState {
  // Current metrics
  currentBalance: number;
  peakBalance: number;          // Session high watermark
  drawdownPercent: number;      // Current drawdown from peak (0-100)
  totalUnrealizedPnL: number;   // Sum of all unrealized PnL
  unrealizedLossPercent: number; // Unrealized loss as % of balance (0-100, always positive)
  
  // Status
  isHealthy: boolean;           // Are we in a healthy state?
  newPositionsBlocked: boolean; // Are new positions currently blocked?
  blockedSince: number | null;  // Timestamp when blocking started
  blockReason: string | null;   // Why positions are blocked
  
  // Historical
  sessionLow: number;          // Lowest balance this session
  totalBlockedTrades: number;   // How many trades were blocked this session
  lastCheckTime: number;        // When the last health check ran
}

const DEFAULT_CONFIG: Required<AccountHealthConfig> = {
  enabled: true,
  maxDrawdownPercent: 25,           // Pause new trades at 25% drawdown from peak
  maxUnrealizedLossPercent: 20,     // Pause if unrealized loss > 20% of balance
  resumeAtDrawdownPercent: 15,      // Resume when drawdown recovers to 15%
  checkIntervalSeconds: 60,         // Check every 60 seconds
  closeAllAtDrawdownPercent: 0,     // Disabled by default (0 = off)
  maxPositionNotional: 0,           // Disabled by default (0 = unlimited)
  maxDCAEntries: 0,                 // Disabled by default (0 = unlimited)
};

export class AccountHealthMonitor extends EventEmitter {
  private config: Required<AccountHealthConfig>;
  private peakBalance: number = 0;
  private sessionLow: number = Infinity;
  private currentBalance: number = 0;
  private totalUnrealizedPnL: number = 0;
  private newPositionsBlocked: boolean = false;
  private blockedSince: number | null = null;
  private blockReason: string | null = null;
  private totalBlockedTrades: number = 0;
  private lastCheckTime: number = 0;
  private checkInterval: NodeJS.Timeout | null = null;
  private credentials: ApiCredentials | null = null;
  private initialized: boolean = false;

  constructor(config?: Partial<AccountHealthConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize with API credentials and start periodic checking
   */
  public async initialize(credentials: ApiCredentials): Promise<void> {
    this.credentials = credentials;

    // Get initial balance to set peak
    try {
      const accountInfo = await getAccountInfo(credentials);
      this.currentBalance = parseFloat(accountInfo.totalWalletBalance || '0');
      this.peakBalance = this.currentBalance;
      this.sessionLow = this.currentBalance;
      this.totalUnrealizedPnL = parseFloat(accountInfo.totalUnrealizedProfit || '0');
      this.initialized = true;
      this.lastCheckTime = Date.now();

      logWithTimestamp(`AccountHealthMonitor: Initialized — Balance: $${this.currentBalance.toFixed(2)}, Peak: $${this.peakBalance.toFixed(2)}`);
      logWithTimestamp(`  Drawdown pause at: ${this.config.maxDrawdownPercent}%, Resume at: ${this.config.resumeAtDrawdownPercent}%`);
      logWithTimestamp(`  Max unrealized loss: ${this.config.maxUnrealizedLossPercent}%`);
      if (this.config.closeAllAtDrawdownPercent > 0) {
        logWithTimestamp(`  Emergency close-all at: ${this.config.closeAllAtDrawdownPercent}%`);
      }
      if (this.config.maxPositionNotional > 0) {
        logWithTimestamp(`  DCA guardrail — max position notional: $${this.config.maxPositionNotional}`);
      }
      if (this.config.maxDCAEntries > 0) {
        logWithTimestamp(`  DCA guardrail — max DCA entries: ${this.config.maxDCAEntries}`);
      }

      // Start periodic checking
      this.startPeriodicCheck();
    } catch (error) {
      logWarnWithTimestamp(`AccountHealthMonitor: Failed to initialize — ${error instanceof Error ? error.message : error}`);
      // Don't block trading if health monitor can't initialize
      this.initialized = false;
    }
  }

  /**
   * Update configuration at runtime
   */
  public getConfig(): Required<AccountHealthConfig> {
    return { ...this.config };
  }

  public updateConfig(config: Partial<AccountHealthConfig>): void {
    this.config = { ...this.config, ...config };
    logWithTimestamp(`AccountHealthMonitor: Config updated — drawdown pause: ${this.config.maxDrawdownPercent}%, resume: ${this.config.resumeAtDrawdownPercent}%`);
    
    // Restart interval if check interval changed
    if (this.checkInterval) {
      this.stopPeriodicCheck();
      this.startPeriodicCheck();
    }
  }

  /**
   * THE MAIN GATE — called by Hunter before opening NEW positions (not DCA).
   * Returns true if new positions should be BLOCKED.
   * DCA is always allowed — caller is responsible for checking isAddingToExisting first.
   */
  public shouldBlockNewPositions(): boolean {
    if (!this.config.enabled || !this.initialized) return false;
    return this.newPositionsBlocked;
  }

  /**
   * Get full state for logging/UI
   */
  public getState(): AccountHealthState {
    const drawdownPercent = this.peakBalance > 0
      ? ((this.peakBalance - this.currentBalance) / this.peakBalance) * 100
      : 0;
    
    const unrealizedLossPercent = this.currentBalance > 0
      ? (Math.abs(Math.min(0, this.totalUnrealizedPnL)) / this.currentBalance) * 100
      : 0;

    return {
      currentBalance: this.currentBalance,
      peakBalance: this.peakBalance,
      drawdownPercent: Math.max(0, drawdownPercent),
      totalUnrealizedPnL: this.totalUnrealizedPnL,
      unrealizedLossPercent,
      isHealthy: !this.newPositionsBlocked,
      newPositionsBlocked: this.newPositionsBlocked,
      blockedSince: this.blockedSince,
      blockReason: this.blockReason,
      sessionLow: this.sessionLow === Infinity ? this.currentBalance : this.sessionLow,
      totalBlockedTrades: this.totalBlockedTrades,
      lastCheckTime: this.lastCheckTime,
    };
  }

  /**
   * Increment blocked trade counter (called by Hunter when a trade is blocked)
   */
  public recordBlockedTrade(): void {
    this.totalBlockedTrades++;
  }

  /**
   * Run a health check — called periodically and can be called manually
   */
  public async checkHealth(): Promise<AccountHealthState> {
    if (!this.credentials || !this.config.enabled) {
      return this.getState();
    }

    try {
      const accountInfo = await getAccountInfo(this.credentials);
      this.currentBalance = parseFloat(accountInfo.totalWalletBalance || '0');
      this.totalUnrealizedPnL = parseFloat(accountInfo.totalUnrealizedProfit || '0');
      this.lastCheckTime = Date.now();

      // Update high watermark (only goes up)
      if (this.currentBalance > this.peakBalance) {
        this.peakBalance = this.currentBalance;
      }

      // Update session low
      if (this.currentBalance < this.sessionLow) {
        this.sessionLow = this.currentBalance;
      }

      // Calculate metrics
      const drawdownPercent = this.peakBalance > 0
        ? ((this.peakBalance - this.currentBalance) / this.peakBalance) * 100
        : 0;

      const unrealizedLossPercent = this.currentBalance > 0
        ? (Math.abs(Math.min(0, this.totalUnrealizedPnL)) / this.currentBalance) * 100
        : 0;

      // ── EVALUATE HEALTH ──

      if (this.newPositionsBlocked) {
        // Currently blocked — check if we should RESUME (hysteresis)
        const shouldResume = drawdownPercent <= this.config.resumeAtDrawdownPercent
          && unrealizedLossPercent < this.config.maxUnrealizedLossPercent;

        if (shouldResume) {
          this.resumeTrading();
        }
      } else {
        // Currently healthy — check if we should BLOCK
        const reasons: string[] = [];

        if (drawdownPercent >= this.config.maxDrawdownPercent) {
          reasons.push(`Drawdown ${drawdownPercent.toFixed(1)}% exceeds max ${this.config.maxDrawdownPercent}% (peak: $${this.peakBalance.toFixed(2)}, current: $${this.currentBalance.toFixed(2)})`);
        }

        if (unrealizedLossPercent >= this.config.maxUnrealizedLossPercent) {
          reasons.push(`Unrealized loss ${unrealizedLossPercent.toFixed(1)}% exceeds max ${this.config.maxUnrealizedLossPercent}% (PnL: $${this.totalUnrealizedPnL.toFixed(2)})`);
        }

        if (reasons.length > 0) {
          this.pauseTrading(reasons);
        }
      }

      // ── EMERGENCY CLOSE-ALL CHECK ──
      if (this.config.closeAllAtDrawdownPercent > 0 && drawdownPercent >= this.config.closeAllAtDrawdownPercent) {
        logErrorWithTimestamp(`🔴 EMERGENCY: Drawdown ${drawdownPercent.toFixed(1)}% exceeds emergency threshold ${this.config.closeAllAtDrawdownPercent}%!`);
        this.emit('emergencyCloseAll', {
          drawdownPercent,
          currentBalance: this.currentBalance,
          peakBalance: this.peakBalance,
          reason: `Drawdown ${drawdownPercent.toFixed(1)}% exceeded emergency close threshold ${this.config.closeAllAtDrawdownPercent}%`,
        });
      }

      // Periodic status log (every check when blocked, or every 5 checks when healthy)
      const state = this.getState();
      if (this.newPositionsBlocked) {
        logWarnWithTimestamp(`📊 Account Health: BLOCKED — Drawdown: ${drawdownPercent.toFixed(1)}%, Unrealized PnL: $${this.totalUnrealizedPnL.toFixed(2)} (${unrealizedLossPercent.toFixed(1)}%), Balance: $${this.currentBalance.toFixed(2)}/$${this.peakBalance.toFixed(2)} peak`);
        logWarnWithTimestamp(`  DCA still allowed. New positions resume at ${this.config.resumeAtDrawdownPercent}% drawdown.`);
      }

      this.emit('healthUpdate', state);
      return state;

    } catch (error) {
      logWarnWithTimestamp(`AccountHealthMonitor: Health check failed — ${error instanceof Error ? error.message : error}`);
      // On failure, don't change state — better to keep trading than block on API error
      return this.getState();
    }
  }

  /**
   * Force resume trading (manual override from UI)
   */
  public forceResume(): void {
    if (this.newPositionsBlocked) {
      logWithTimestamp('AccountHealthMonitor: Manually resumed by user');
      this.resumeTrading();
    }
  }

  /**
   * Force update peak balance (e.g., after deposit)
   */
  public resetPeakBalance(newPeak?: number): void {
    this.peakBalance = newPeak ?? this.currentBalance;
    logWithTimestamp(`AccountHealthMonitor: Peak balance reset to $${this.peakBalance.toFixed(2)}`);
    // Re-evaluate immediately
    if (this.credentials) {
      this.checkHealth();
    }
  }

  public stop(): void {
    this.stopPeriodicCheck();
    this.removeAllListeners();
    logWithTimestamp('AccountHealthMonitor: Stopped');
  }

  // ── Private methods ──

  private pauseTrading(reasons: string[]): void {
    this.newPositionsBlocked = true;
    this.blockedSince = Date.now();
    this.blockReason = reasons.join(' | ');

    logWarnWithTimestamp(`⚠️ ACCOUNT HEALTH: New positions PAUSED (DCA still allowed)`);
    reasons.forEach(r => logWarnWithTimestamp(`  ⚠️ ${r}`));
    logWarnWithTimestamp(`  Will resume when drawdown recovers to ${this.config.resumeAtDrawdownPercent}%`);

    this.emit('tradingPaused', {
      reasons,
      state: this.getState(),
    });
  }

  private resumeTrading(): void {
    const duration = this.blockedSince
      ? ((Date.now() - this.blockedSince) / 60000).toFixed(1)
      : '?';

    logWithTimestamp(`✅ ACCOUNT HEALTH: Trading resumed after ${duration} minute pause`);
    logWithTimestamp(`  Balance: $${this.currentBalance.toFixed(2)}, Peak: $${this.peakBalance.toFixed(2)}, Blocked trades: ${this.totalBlockedTrades}`);

    this.newPositionsBlocked = false;
    this.blockedSince = null;
    this.blockReason = null;

    this.emit('tradingResumed', {
      clearedAt: Date.now(),
      state: this.getState(),
    });
  }

  private startPeriodicCheck(): void {
    const intervalMs = this.config.checkIntervalSeconds * 1000;
    this.checkInterval = setInterval(() => {
      this.checkHealth().catch(err => {
        logWarnWithTimestamp(`AccountHealthMonitor: Periodic check error — ${err}`);
      });
    }, intervalMs);
  }

  private stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

// Singleton
export const accountHealthMonitor = new AccountHealthMonitor();
