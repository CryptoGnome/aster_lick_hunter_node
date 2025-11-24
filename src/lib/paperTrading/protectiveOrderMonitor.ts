import { EventEmitter } from 'events';
import { getVirtualPositionTracker } from './virtualPositions';
import { getVirtualBalanceTracker } from './virtualBalance';
import { getOrderSimulator } from './orderSimulator';
import { logWithTimestamp } from '../utils/timestamp';

/**
 * Monitors market prices and triggers protective orders (TP/SL) for paper trading
 */
export class ProtectiveOrderMonitor extends EventEmitter {
  private priceMonitorInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;
  private monitoredSymbols: Set<string> = new Set();
  private currentPrices: Map<string, number> = new Map();

  constructor() {
    super();
  }

  /**
   * Start monitoring prices for protective order triggers
   */
  start(intervalMs: number = 1000): void {
    if (this.isMonitoring) {
      logWithTimestamp('📄 Paper Trading: Protective order monitor already running');
      return;
    }

    this.isMonitoring = true;
    
    this.priceMonitorInterval = setInterval(async () => {
      await this.checkProtectiveOrders();
    }, intervalMs);

    logWithTimestamp(`📄 Paper Trading: Started protective order monitor (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.priceMonitorInterval) {
      clearInterval(this.priceMonitorInterval);
      this.priceMonitorInterval = null;
    }

    this.isMonitoring = false;
    logWithTimestamp('📄 Paper Trading: Stopped protective order monitor');
  }

  /**
   * Add a symbol to monitor
   */
  addSymbol(symbol: string): void {
    this.monitoredSymbols.add(symbol);
  }

  /**
   * Remove a symbol from monitoring
   */
  removeSymbol(symbol: string): void {
    this.monitoredSymbols.delete(symbol);
    this.currentPrices.delete(symbol);
  }

  /**
   * Update current price for a symbol
   */
  updatePrice(symbol: string, price: number): void {
    this.currentPrices.set(symbol, price);
    
    // Also add to monitored symbols if not already there
    if (!this.monitoredSymbols.has(symbol)) {
      this.addSymbol(symbol);
    }

    // Check protective orders immediately when price updates
    this.checkProtectiveOrdersForSymbol(symbol, price);
  }

  /**
   * Check all protective orders
   */
  private async checkProtectiveOrders(): Promise<void> {
    const positionTracker = getVirtualPositionTracker();
    const positions = positionTracker.getAllPositions();

    // Update unrealized PnL for all positions
    for (const position of positions) {
      const currentPrice = this.currentPrices.get(position.symbol);
      if (currentPrice) {
        await positionTracker.updatePositionPrices(position.symbol, currentPrice);
        this.checkProtectiveOrdersForSymbol(position.symbol, currentPrice);
      }
    }

    // Also check pending limit orders
    const orderSimulator = getOrderSimulator();
    for (const symbol of this.monitoredSymbols) {
      const currentPrice = this.currentPrices.get(symbol);
      if (currentPrice) {
        orderSimulator.checkAndFillPendingOrders(symbol, currentPrice);
      }
    }
  }

  /**
   * Check protective orders for a specific symbol
   */
  private checkProtectiveOrdersForSymbol(symbol: string, currentPrice: number): void {
    const positionTracker = getVirtualPositionTracker();
    const balanceTracker = getVirtualBalanceTracker();
    
    // Check if any protective orders should trigger
    const triggeredPositions = positionTracker.checkProtectiveOrders(symbol, currentPrice);

    // Realize PnL for triggered positions
    for (const position of triggeredPositions) {
      const pnl = position.unrealizedPnL;
      
      // Release margin
      balanceTracker.releaseMargin(position.margin);
      
      // Calculate exit fees (taker fee for market close)
      const takerFeeRate = 0.0004;
      const notionalValue = currentPrice * position.quantity;
      const fees = notionalValue * takerFeeRate;
      
      // Realize PnL after fees
      balanceTracker.realizePnL(pnl - fees, position.margin);
      balanceTracker.applyFees(fees);

      // Emit event
      this.emit('protectiveOrderTriggered', {
        symbol,
        position,
        currentPrice,
        pnl,
        fees,
      });
    }
  }

  /**
   * Get current price for a symbol
   */
  getCurrentPrice(symbol: string): number | null {
    return this.currentPrices.get(symbol) || null;
  }

  /**
   * Check if monitoring is active
   */
  isActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * Get list of monitored symbols
   */
  getMonitoredSymbols(): string[] {
    return Array.from(this.monitoredSymbols);
  }

  /**
   * Clear all monitored symbols
   */
  clear(): void {
    this.monitoredSymbols.clear();
    this.currentPrices.clear();
  }

  /**
   * Update unrealized PnL for all positions based on current prices
   */
  updateAllUnrealizedPnL(): void {
    const positionTracker = getVirtualPositionTracker();
    const balanceTracker = getVirtualBalanceTracker();
    
    let totalUnrealizedPnL = 0;

    for (const [symbol, price] of this.currentPrices.entries()) {
      positionTracker.updatePositionPrices(symbol, price);
    }

    // Get total unrealized PnL from all positions
    totalUnrealizedPnL = positionTracker.getTotalUnrealizedPnL();
    
    // Update balance tracker
    balanceTracker.updateUnrealizedPnL(totalUnrealizedPnL);
  }
}

// Singleton instance
let protectiveOrderMonitor: ProtectiveOrderMonitor | null = null;

export function getProtectiveOrderMonitor(): ProtectiveOrderMonitor {
  if (!protectiveOrderMonitor) {
    protectiveOrderMonitor = new ProtectiveOrderMonitor();
  }
  return protectiveOrderMonitor;
}

export function initializeProtectiveOrderMonitor(): ProtectiveOrderMonitor {
  if (protectiveOrderMonitor) {
    protectiveOrderMonitor.stop();
  }
  protectiveOrderMonitor = new ProtectiveOrderMonitor();
  return protectiveOrderMonitor;
}
