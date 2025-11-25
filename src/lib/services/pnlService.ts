import { EventEmitter } from 'events';

export interface PnLSnapshot {
  timestamp: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  balance: number;
  commission: number;
  fundingFee: number;
}

export interface SessionPnL {
  startTime: number;
  startBalance: number;
  currentBalance: number;
  startingAccumulatedPnl: number;  // Track starting accumulated PnL
  currentAccumulatedPnl: number;    // Track current accumulated PnL
  realizedPnl: number;              // Session realized PnL (current - starting)
  unrealizedPnl: number;
  totalPnl: number;
  commission: number;
  fundingFee: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  maxDrawdown: number;
  peak: number;
}

export interface RealtimePnLData {
  symbol?: string;
  realizedPnl: number;
  unrealizedPnl: number;
  balance: number;
  timestamp: number;
  reason?: string; // ORDER, FUNDING_FEE, etc.
}

class PnLService extends EventEmitter {
  private sessionPnL: SessionPnL;
  private snapshots: PnLSnapshot[] = [];
  private maxSnapshots = 1440; // Keep 24 hours of minute-by-minute data
  private lastUpdateTime = 0;

  constructor() {
    super();
    this.sessionPnL = this.initializeSession();
  }

  private initializeSession(): SessionPnL {
    return {
      startTime: Date.now(),
      startBalance: 0,
      currentBalance: 0,
      startingAccumulatedPnl: 0,
      currentAccumulatedPnl: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      commission: 0,
      fundingFee: 0,
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      maxDrawdown: 0,
      peak: 0,
    };
  }

  public resetSession(startBalance: number): void {
    this.sessionPnL = this.initializeSession();
    this.sessionPnL.startBalance = startBalance;
    this.sessionPnL.currentBalance = startBalance;
    this.sessionPnL.peak = startBalance;
    this.snapshots = [];
    this.lastUpdateTime = Date.now();
  }

  public updateFromAccountEvent(event: any): void {
    const now = Date.now();

    // Parse ACCOUNT_UPDATE event
    if (event.e === 'ACCOUNT_UPDATE' && event.a) {
      const accountData = event.a;
      const reason = accountData.m; // ORDER, FUNDING_FEE, etc.

      // Update balances
      if (accountData.B && accountData.B.length > 0) {
        const usdtBalance = accountData.B.find((b: any) => b.a === 'USDT');
        if (usdtBalance) {
          const walletBalance = parseFloat(usdtBalance.wb);
          const balanceChange = parseFloat(usdtBalance.bc || '0');

          // Initialize start balance if this is the first update
          if (this.sessionPnL.startBalance === 0) {
            this.sessionPnL.startBalance = walletBalance - balanceChange;
            this.sessionPnL.peak = this.sessionPnL.startBalance;
          }

          this.sessionPnL.currentBalance = walletBalance;

          // Track funding fees
          if (reason === 'FUNDING_FEE') {
            this.sessionPnL.fundingFee += balanceChange;
          }
        }
      }

      // Update unrealized PnL from positions
      let totalUnrealizedPnl = 0;
      let totalAccumulatedPnl = 0;

      if (accountData.P && accountData.P.length > 0) {
        accountData.P.forEach((pos: any) => {
          const unrealizedPnl = parseFloat(pos.up || '0');
          const accumulatedPnl = parseFloat(pos.cr || '0'); // This is lifetime accumulated

          totalUnrealizedPnl += unrealizedPnl;
          totalAccumulatedPnl += accumulatedPnl;
        });
      }

      // Initialize starting accumulated PnL on first update
      if (this.sessionPnL.startingAccumulatedPnl === 0 && totalAccumulatedPnl !== 0) {
        this.sessionPnL.startingAccumulatedPnl = totalAccumulatedPnl;
      }

      // Update session PnL
      const _previousAccumulated = this.sessionPnL.currentAccumulatedPnl;
      this.sessionPnL.currentAccumulatedPnl = totalAccumulatedPnl;
      this.sessionPnL.unrealizedPnl = totalUnrealizedPnl;

      // Session realized PnL is the difference from starting point
      this.sessionPnL.realizedPnl = totalAccumulatedPnl - this.sessionPnL.startingAccumulatedPnl;
      this.sessionPnL.totalPnl = this.sessionPnL.realizedPnl + totalUnrealizedPnl;

      // Trade counting is now handled in updateFromOrderEvent via the rp field
      // We only track accumulated PnL changes here for verification

      // Update drawdown
      const currentValue = this.sessionPnL.currentBalance + this.sessionPnL.unrealizedPnl;
      if (currentValue > this.sessionPnL.peak) {
        this.sessionPnL.peak = currentValue;
      }
      const drawdown = this.sessionPnL.peak - currentValue;
      if (drawdown > this.sessionPnL.maxDrawdown) {
        this.sessionPnL.maxDrawdown = drawdown;
      }

      // Create snapshot
      const snapshot: PnLSnapshot = {
        timestamp: now,
        realizedPnl: this.sessionPnL.realizedPnl,
        unrealizedPnl: this.sessionPnL.unrealizedPnl,
        totalPnl: this.sessionPnL.totalPnl,
        balance: this.sessionPnL.currentBalance,
        commission: this.sessionPnL.commission,
        fundingFee: this.sessionPnL.fundingFee,
      };

      this.addSnapshot(snapshot);

      // Emit update event
      this.emit('pnl_update', {
        session: this.sessionPnL,
        snapshot,
        reason,
      });

      this.lastUpdateTime = now;
    }
  }

  public updateFromOrderEvent(event: any): void {
    // Parse ORDER_TRADE_UPDATE for commission and trade PnL tracking
    if (event.e === 'ORDER_TRADE_UPDATE' && event.o) {
      const order = event.o;

      // Track commission on filled orders
      if (order.X === 'FILLED' || order.X === 'PARTIALLY_FILLED') {
        // Commission field 'n' - already negative from exchange
        const commission = parseFloat(order.n || '0');
        if (commission !== 0) {
          this.sessionPnL.commission += commission; // Add the negative commission
        }

        // Track trades and their PnL
        if (order.X === 'FILLED') {
          // Track realized profit from the trade (rp field)
          const realizedProfit = parseFloat(order.rp || '0');

          // Count closing trades (reduce-only or trades with realized PnL)
          const isReduceOnly = order.R === true || order.R === 'true';
          if (isReduceOnly || realizedProfit !== 0) {
            this.sessionPnL.tradeCount++;

            // Track win/loss based on realized profit
            if (realizedProfit > 0) {
              this.sessionPnL.winCount++;
            } else if (realizedProfit < 0) {
              this.sessionPnL.lossCount++;
            }
          }
        }
      }
    }
  }

  private addSnapshot(snapshot: PnLSnapshot): void {
    this.snapshots.push(snapshot);

    // Keep only the latest snapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  public getSessionPnL(): SessionPnL {
    return { ...this.sessionPnL };
  }

  public getSnapshots(minutes?: number): PnLSnapshot[] {
    if (!minutes) {
      return [...this.snapshots];
    }

    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.snapshots.filter(s => s.timestamp >= cutoff);
  }

  public getLatestSnapshot(): PnLSnapshot | null {
    return this.snapshots.length > 0
      ? { ...this.snapshots[this.snapshots.length - 1] }
      : null;
  }

  public getSessionMetrics(): {
    duration: number;
    returnPercent: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    sharpeRatio: number;
  } {
    const duration = Date.now() - this.sessionPnL.startTime;
    const returnPercent = this.sessionPnL.startBalance > 0
      ? ((this.sessionPnL.currentBalance - this.sessionPnL.startBalance) / this.sessionPnL.startBalance) * 100
      : 0;

    const winRate = this.sessionPnL.tradeCount > 0
      ? (this.sessionPnL.winCount / this.sessionPnL.tradeCount) * 100
      : 0;

    // Calculate average win/loss from snapshots
    let totalWin = 0;
    let totalLoss = 0;
    let lastRealized = 0;

    this.snapshots.forEach(snapshot => {
      const change = snapshot.realizedPnl - lastRealized;
      if (change > 0) {
        totalWin += change;
      } else if (change < 0) {
        totalLoss += Math.abs(change);
      }
      lastRealized = snapshot.realizedPnl;
    });

    const avgWin = this.sessionPnL.winCount > 0 ? totalWin / this.sessionPnL.winCount : 0;
    const avgLoss = this.sessionPnL.lossCount > 0 ? totalLoss / this.sessionPnL.lossCount : 0;
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

    // Simplified Sharpe ratio calculation
    let sharpeRatio = 0;
    if (this.snapshots.length > 1) {
      const returns: number[] = [];
      for (let i = 1; i < this.snapshots.length; i++) {
        const prevBalance = this.snapshots[i - 1].balance;
        const currBalance = this.snapshots[i].balance;
        if (prevBalance > 0) {
          returns.push((currBalance - prevBalance) / prevBalance);
        }
      }

      if (returns.length > 0) {
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const stdDev = Math.sqrt(variance);
        if (stdDev > 0) {
          // Annualized Sharpe (assuming data points are minutes, ~525600 minutes/year)
          sharpeRatio = (avgReturn / stdDev) * Math.sqrt(525600 / returns.length);
        }
      }
    }

    return {
      duration,
      returnPercent,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      sharpeRatio,
    };
  }

  // Method to inject historical data for chart initialization
  public injectHistoricalSnapshot(snapshot: PnLSnapshot): void {
    // Insert in chronological order
    const index = this.snapshots.findIndex(s => s.timestamp > snapshot.timestamp);
    if (index === -1) {
      this.snapshots.push(snapshot);
    } else {
      this.snapshots.splice(index, 0, snapshot);
    }

    // Maintain max snapshots limit
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }
}

// Export singleton instance
export const pnlService = new PnLService();
export default pnlService;