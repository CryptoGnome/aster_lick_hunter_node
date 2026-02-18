import { EventEmitter } from 'events';
import { logWithTimestamp } from '../utils/timestamp';
import { PaperTradingDatabase } from '../db/paperTradingDb';

export interface VirtualBalanceState {
  totalBalance: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnL: number;
  realizedPnL: number;
  totalPnL: number;
  sessionStartBalance: number;
  sessionPnL: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
}

export class VirtualBalanceTracker extends EventEmitter {
  private totalBalance: number;
  private usedMargin: number;
  private unrealizedPnL: number;
  private realizedPnL: number;
  private sessionStartBalance: number;
  private trades: number;
  private wins: number;
  private losses: number;
  private db: PaperTradingDatabase;

  constructor(initialBalance: number = 1000) {
    super();
    this.db = PaperTradingDatabase.getInstance();
    this.totalBalance = initialBalance;
    this.usedMargin = 0;
    this.unrealizedPnL = 0;
    this.realizedPnL = 0;
    this.sessionStartBalance = initialBalance;
    this.trades = 0;
    this.wins = 0;
    this.losses = 0;

    // Load from database if exists, otherwise use initialBalance
    this.loadFromDB(initialBalance);

    logWithTimestamp(`📄 Paper Trading: Starting with virtual balance of ${initialBalance} USDT`);
  }

  /**
   * Get current balance state
   */
  getBalance(): VirtualBalanceState {
    const availableBalance = this.totalBalance + this.unrealizedPnL - this.usedMargin;
    const totalPnL = this.realizedPnL + this.unrealizedPnL;
    const sessionPnL = totalPnL;

    return {
      totalBalance: this.totalBalance,
      availableBalance: Math.max(0, availableBalance),
      usedMargin: this.usedMargin,
      unrealizedPnL: this.unrealizedPnL,
      realizedPnL: this.realizedPnL,
      totalPnL,
      sessionStartBalance: this.sessionStartBalance,
      sessionPnL,
      trades: this.trades,
      wins: this.wins,
      losses: this.losses,
      winRate: this.trades > 0 ? (this.wins / this.trades) * 100 : 0,
    };
  }

  /**
   * Check if there's enough available balance for a trade
   */
  hasAvailableBalance(requiredMargin: number): boolean {
    const state = this.getBalance();
    return state.availableBalance >= requiredMargin;
  }

  /**
   * Reserve margin for a new position
   */
  reserveMargin(margin: number): boolean {
    if (!this.hasAvailableBalance(margin)) {
      logWithTimestamp(`📄 Paper Trading: Insufficient balance. Required: ${margin} USDT, Available: ${this.getBalance().availableBalance} USDT`);
      return false;
    }

    this.usedMargin += margin;
    logWithTimestamp(`📄 Paper Trading: Reserved ${margin} USDT margin. Used: ${this.usedMargin} USDT`);
    this.emitUpdate();
    return true;
  }

  /**
   * Release margin when a position is closed
   */
  releaseMargin(margin: number): void {
    this.usedMargin = Math.max(0, this.usedMargin - margin);
    logWithTimestamp(`📄 Paper Trading: Released ${margin} USDT margin. Used: ${this.usedMargin} USDT`);
    this.emitUpdate();
  }

  /**
   * Update unrealized PnL from open positions
   */
  updateUnrealizedPnL(pnl: number): void {
    this.unrealizedPnL = pnl;
    this.emitUpdate();
  }

  /**
   * Realize profit/loss when position is closed
   */
  realizePnL(pnl: number, tradeSize: number): void {
    this.realizedPnL += pnl;
    this.totalBalance += pnl;
    this.trades++;

    if (pnl > 0) {
      this.wins++;
      logWithTimestamp(`📄 Paper Trading: 🟢 WIN - Realized +${pnl.toFixed(2)} USDT (Trade size: ${tradeSize} USDT)`);
    } else if (pnl < 0) {
      this.losses++;
      logWithTimestamp(`📄 Paper Trading: 🔴 LOSS - Realized ${pnl.toFixed(2)} USDT (Trade size: ${tradeSize} USDT)`);
    }

    const state = this.getBalance();
    logWithTimestamp(`📄 Paper Trading: Balance: ${this.totalBalance.toFixed(2)} USDT | Session P&L: ${state.sessionPnL.toFixed(2)} USDT | Win Rate: ${state.winRate.toFixed(1)}%`);
    
    this.emitUpdate();
  }

  /**
   * Apply trading fees
   */
  applyFees(fees: number): void {
    this.totalBalance -= fees;
    this.realizedPnL -= fees;
    logWithTimestamp(`📄 Paper Trading: Applied ${fees.toFixed(4)} USDT in trading fees`);
    this.emitUpdate();
  }

  /**
   * Reset balance to initial state
   */
  reset(newBalance?: number): void {
    const balance = newBalance ?? this.sessionStartBalance;
    this.totalBalance = balance;
    this.usedMargin = 0;
    this.unrealizedPnL = 0;
    this.realizedPnL = 0;
    this.sessionStartBalance = balance;
    this.trades = 0;
    this.wins = 0;
    this.losses = 0;

    logWithTimestamp(`📄 Paper Trading: Reset to ${balance} USDT`);
    this.emitUpdate();
  }

  /**
   * Get total equity (balance + unrealized PnL)
   */
  getEquity(): number {
    return this.totalBalance + this.unrealizedPnL;
  }

  /**
   * Get available margin for trading
   */
  getAvailableMargin(): number {
    return this.getBalance().availableBalance;
  }

  /**
   * Emit balance update event
   */
  private emitUpdate(): void {
    this.emit('balanceUpdate', this.getBalance());
    // Save to database after every update
    this.saveToDB();
  }

  /**
   * Load balance from database
   */
  private async loadFromDB(defaultBalance: number): Promise<void> {
    try {
      const row = await this.db.get<any>('SELECT * FROM balance WHERE id = 1');
      if (row) {
        this.totalBalance = row.total_balance;
        this.usedMargin = row.used_margin || 0;
        this.unrealizedPnL = row.unrealized_pnl || 0;
        this.sessionStartBalance = row.session_starting_balance;
        this.realizedPnL = row.session_pnl || 0;
        this.trades = row.session_trades || 0;
        this.wins = row.session_wins || 0;
        this.losses = row.session_losses || 0;
        logWithTimestamp(`📄 Paper Trading: Loaded balance from database: ${this.totalBalance} USDT`);
      } else {
        // Initialize database with default balance
        this.totalBalance = defaultBalance;
        this.sessionStartBalance = defaultBalance;
        await this.saveToDB();
      }
    } catch (error: any) {
      logWithTimestamp(`⚠️ Failed to load balance from DB: ${error.message}`);
      this.totalBalance = defaultBalance;
      this.sessionStartBalance = defaultBalance;
    }
  }

  /**
   * Save balance to database
   */
  private async saveToDB(): Promise<void> {
    try {
      const state = this.getBalance();
      const pnlPercent = (state.sessionPnL / this.sessionStartBalance) * 100;
      
      const sql = `
        INSERT OR REPLACE INTO balance (
          id, total_balance, available_balance, used_margin, unrealized_pnl,
          session_starting_balance, session_pnl, session_pnl_percent,
          session_trades, session_wins, session_losses, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
      `;
      await this.db.run(sql, [
        this.totalBalance,
        state.availableBalance,
        this.usedMargin,
        this.unrealizedPnL,
        this.sessionStartBalance,
        state.sessionPnL,
        pnlPercent,
        this.trades,
        this.wins,
        this.losses,
      ]);
    } catch (error: any) {
      // Don't log on every update to avoid spam
      // logWithTimestamp(`⚠️ Failed to save balance to DB: ${error.message}`);
    }
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    startBalance: number;
    currentBalance: number;
    pnl: number;
    pnlPercent: number;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
  } {
    const state = this.getBalance();
    const pnl = state.sessionPnL;
    const pnlPercent = (pnl / this.sessionStartBalance) * 100;

    return {
      startBalance: this.sessionStartBalance,
      currentBalance: this.totalBalance,
      pnl,
      pnlPercent,
      trades: this.trades,
      wins: this.wins,
      losses: this.losses,
      winRate: state.winRate,
    };
  }
}

// Singleton instance
let virtualBalanceTracker: VirtualBalanceTracker | null = null;

export function getVirtualBalanceTracker(): VirtualBalanceTracker {
  if (!virtualBalanceTracker) {
    virtualBalanceTracker = new VirtualBalanceTracker(1000); // Default 1000 USDT
  }
  return virtualBalanceTracker;
}

export function initializeVirtualBalance(initialBalance: number): VirtualBalanceTracker {
  virtualBalanceTracker = new VirtualBalanceTracker(initialBalance);
  return virtualBalanceTracker;
}

export function resetVirtualBalance(newBalance?: number): void {
  if (virtualBalanceTracker) {
    virtualBalanceTracker.reset(newBalance);
  }
}
