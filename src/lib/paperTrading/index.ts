import { EventEmitter } from 'events';
import { initializeVirtualBalance, getVirtualBalanceTracker, VirtualBalanceState } from './virtualBalance';
import { initializeVirtualPositions, getVirtualPositionTracker, VirtualPosition } from './virtualPositions';
import { getOrderSimulator, SimulatedOrderResult } from './orderSimulator';
import { initializeProtectiveOrderMonitor, getProtectiveOrderMonitor } from './protectiveOrderMonitor';
import { logWithTimestamp } from '../utils/timestamp';

/**
 * Main Paper Trading Manager
 * Coordinates all paper trading components
 */
export class PaperTradingManager extends EventEmitter {
  private isInitialized = false;
  private initialBalance: number;

  constructor(initialBalance: number = 1000) {
    super();
    this.initialBalance = initialBalance;
  }

  /**
   * Initialize paper trading system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logWithTimestamp('📄 Paper Trading: Already initialized');
      return;
    }

    logWithTimestamp('📄 Paper Trading: Initializing...');

    // Initialize components
    initializeVirtualBalance(this.initialBalance);
    initializeVirtualPositions();
    initializeProtectiveOrderMonitor();

    // Start protective order monitoring
    const monitor = getProtectiveOrderMonitor();
    monitor.start(1000); // Check every second

    // Set up event listeners
    this.setupEventListeners();

    this.isInitialized = true;
    logWithTimestamp(`📄 Paper Trading: Initialized with ${this.initialBalance} USDT starting balance`);
    logWithTimestamp('📄 Paper Trading: ⚠️  All trades are SIMULATED - no real money at risk');
  }

  /**
   * Set up event listeners between components
   */
  private setupEventListeners(): void {
    const balanceTracker = getVirtualBalanceTracker();
    const positionTracker = getVirtualPositionTracker();
    const monitor = getProtectiveOrderMonitor();

    // Forward balance updates
    balanceTracker.on('balanceUpdate', (balance: VirtualBalanceState) => {
      this.emit('balanceUpdate', balance);
    });

    // Forward position events
    positionTracker.on('positionOpened', (position: VirtualPosition) => {
      monitor.addSymbol(position.symbol);
      this.emit('positionOpened', position);
    });

    positionTracker.on('positionClosed', (data: any) => {
      this.emit('positionClosed', data);
    });

    positionTracker.on('positionLiquidated', (data: any) => {
      this.emit('positionLiquidated', data);
    });

    positionTracker.on('protectiveOrderTriggered', (data: any) => {
      this.emit('protectiveOrderTriggered', data);
    });

    // Forward order events
    positionTracker.on('orderFilled', (order: any) => {
      this.emit('orderFilled', order);
    });

    positionTracker.on('orderCanceled', (order: any) => {
      this.emit('orderCanceled', order);
    });
  }

  /**
   * Set simulation configuration for paper trading
   */
  setSimulationConfig(config: any): void {
    const simulator = getOrderSimulator();
    simulator.setConfig(config);
    logWithTimestamp(`📄 Paper Trading: Simulation configuration updated`);
  }

  /**
   * Update market price for a symbol (from websocket or API)
   */
  updateMarketPrice(symbol: string, price: number): void {
    const monitor = getProtectiveOrderMonitor();
    monitor.updatePrice(symbol, price);
    monitor.updateAllUnrealizedPnL();
  }

  /**
   * Place an order (simulated)
   */
  async placeOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
    quantity: number;
    price?: number;
    stopPrice?: number;
    reduceOnly?: boolean;
    positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  }): Promise<SimulatedOrderResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const simulator = getOrderSimulator();
    const result = await simulator.simulateOrder(params);

    logWithTimestamp(`📄 Paper Trading: Placed ${params.type} order - ${params.side} ${params.quantity} ${params.symbol} @ ${params.price || 'MARKET'}`);

    return result;
  }

  /**
   * Cancel an order (simulated)
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    const simulator = getOrderSimulator();
    return await simulator.cancelOrder(orderId);
  }

  /**
   * Get current balance state
   */
  getBalance(): VirtualBalanceState {
    return getVirtualBalanceTracker().getBalance();
  }

  /**
   * Get all open positions
   */
  getPositions(): VirtualPosition[] {
    return getVirtualPositionTracker().getAllPositions();
  }

  /**
   * Get position for a specific symbol
   */
  getPosition(symbol: string, positionSide?: 'LONG' | 'SHORT'): VirtualPosition | null {
    return getVirtualPositionTracker().getPosition(symbol, positionSide);
  }

  /**
   * Get session statistics
   */
  getSessionStats() {
    const balanceTracker = getVirtualBalanceTracker();
    const positionTracker = getVirtualPositionTracker();
    
    return {
      ...balanceTracker.getSessionStats(),
      ...positionTracker.getStatistics(),
    };
  }

  /**
   * Reset paper trading (clear all positions and reset balance)
   */
  reset(newBalance?: number): void {
    const balanceTracker = getVirtualBalanceTracker();
    const positionTracker = getVirtualPositionTracker();
    const monitor = getProtectiveOrderMonitor();

    balanceTracker.reset(newBalance ?? this.initialBalance);
    positionTracker.reset();
    monitor.clear();

    logWithTimestamp(`📄 Paper Trading: Reset to ${newBalance ?? this.initialBalance} USDT`);
    this.emit('reset');
  }

  /**
   * Stop paper trading
   */
  stop(): void {
    const monitor = getProtectiveOrderMonitor();
    monitor.stop();

    this.isInitialized = false;
    logWithTimestamp('📄 Paper Trading: Stopped');
  }

  /**
   * Check if paper trading is initialized
   */
  isActive(): boolean {
    return this.isInitialized;
  }

  /**
   * Get all open position symbols for price subscription
   */
  getOpenPositionSymbols(): string[] {
    const positionTracker = getVirtualPositionTracker();
    const positions = positionTracker.getAllPositions();
    return [...new Set(positions.map(p => p.symbol))];
  }

  /**
   * Reset paper trading system with new starting balance
   */
  async resetWithNewBalance(newBalance?: number): Promise<void> {
    logWithTimestamp(`📄 Paper Trading: Resetting with new balance: ${newBalance} USDT`);
    
    // Stop current session
    this.stop();
    
    // Update balance
    this.initialBalance = newBalance;
    this.isInitialized = false;
    
    // Reinitialize
    await this.initialize();
  }

  /**
   * Get current starting balance
   */
  getStartingBalance(): number {
    return this.initialBalance;
  }
}

// Singleton instance
let paperTradingManager: PaperTradingManager | null = null;

export function getPaperTradingManager(initialBalance?: number): PaperTradingManager {
  if (!paperTradingManager) {
    paperTradingManager = new PaperTradingManager(initialBalance || 1000);
  }
  return paperTradingManager;
}

export function initializePaperTrading(initialBalance: number = 1000): PaperTradingManager {
  if (paperTradingManager) {
    paperTradingManager.stop();
  }
  paperTradingManager = new PaperTradingManager(initialBalance);
  return paperTradingManager;
}
