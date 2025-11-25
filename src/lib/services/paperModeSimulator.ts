import { EventEmitter } from 'events';
import { Config } from '../types';
import { getMarkPrice } from '../api/market';
import { logWithTimestamp, logErrorWithTimestamp } from '../utils/timestamp';

/**
 * Paper Mode Position Simulator
 *
 * Simulates the full position lifecycle in paper mode:
 * - Tracks simulated positions with real market prices
 * - Monitors SL/TP triggers based on actual market data
 * - Calculates realistic P&L
 * - Broadcasts events to UI for real-time updates
 *
 * This service runs ONLY in paper mode and does not affect live trading.
 */

interface SimulatedPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  leverage: number;
  slPrice: number;
  tpPrice: number;
  openTime: number;
  lastPnL: number;
  lastMarkPrice: number;
}

export class PaperModeSimulator extends EventEmitter {
  private positions: Map<string, SimulatedPosition> = new Map();
  private config: Config | null = null;
  private monitorInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    super();
  }

  /**
   * Initialize the paper mode simulator with config
   */
  public initialize(config: Config): void {
    this.config = config;
    logWithTimestamp('PaperModeSimulator: Initialized');
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Config): void {
    this.config = config;
    logWithTimestamp('PaperModeSimulator: Configuration updated');
  }

  /**
   * Start monitoring simulated positions
   */
  public start(): void {
    if (this.isRunning) return;
    if (!this.config) {
      logErrorWithTimestamp('PaperModeSimulator: Cannot start - no config loaded');
      return;
    }

    this.isRunning = true;
    logWithTimestamp('PaperModeSimulator: Starting position monitoring...');

    // Monitor positions every 5 seconds
    this.monitorInterval = setInterval(() => {
      this.monitorPositions();
    }, 5000);

    logWithTimestamp('PaperModeSimulator: Monitoring active (checking every 5s)');
  }

  /**
   * Stop monitoring
   */
  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    logWithTimestamp('PaperModeSimulator: Stopped');
  }

  /**
   * Open a new simulated position
   */
  public async openPosition(data: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    leverage: number;
    slPercent: number;
    tpPercent: number;
  }): Promise<void> {
    try {
      // Fetch current market price for accurate entry
      const markPriceData = await getMarkPrice(data.symbol);
      const entryPrice = parseFloat(
        Array.isArray(markPriceData) ? markPriceData[0].markPrice : markPriceData.markPrice
      );

      const isLong = data.side === 'BUY';
      const positionSide = isLong ? 'LONG' : 'SHORT';

      // Calculate SL and TP prices
      const slPrice = isLong
        ? entryPrice * (1 - data.slPercent / 100)
        : entryPrice * (1 + data.slPercent / 100);

      const tpPrice = isLong
        ? entryPrice * (1 + data.tpPercent / 100)
        : entryPrice * (1 - data.tpPercent / 100);

      const position: SimulatedPosition = {
        symbol: data.symbol,
        side: positionSide,
        quantity: data.quantity,
        entryPrice,
        leverage: data.leverage,
        slPrice,
        tpPrice,
        openTime: Date.now(),
        lastPnL: 0,
        lastMarkPrice: entryPrice,
      };

      const key = `${data.symbol}_${positionSide}`;
      this.positions.set(key, position);

      logWithTimestamp(
        `PaperModeSimulator: Opened ${positionSide} position for ${data.symbol} ` +
        `at $${entryPrice.toFixed(2)} (SL: $${slPrice.toFixed(2)}, TP: $${tpPrice.toFixed(2)})`
      );

      // Emit position opened event
      this.emit('positionOpened', {
        symbol: data.symbol,
        side: positionSide,
        quantity: data.quantity,
        entryPrice,
        slPrice,
        tpPrice,
        leverage: data.leverage,
      });
    } catch (error) {
      logErrorWithTimestamp(`PaperModeSimulator: Failed to open position for ${data.symbol}:`, error);
    }
  }

  /**
   * Close a simulated position
   */
  public async closePosition(symbol: string, side: 'LONG' | 'SHORT', reason: string = 'Manual close'): Promise<boolean> {
    const key = `${symbol}_${side}`;
    const position = this.positions.get(key);

    if (!position) {
      logErrorWithTimestamp(`PaperModeSimulator: No position found for ${symbol} ${side}`);
      return false;
    }

    try {
      // Fetch current market price for accurate exit
      const markPriceData = await getMarkPrice(symbol);
      const exitPrice = parseFloat(
        Array.isArray(markPriceData) ? markPriceData[0].markPrice : markPriceData.markPrice
      );

      // Calculate final P&L
      const isLong = side === 'LONG';
      const pnlPercent = isLong
        ? ((exitPrice - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - exitPrice) / position.entryPrice) * 100;

      const pnlUSDT = (pnlPercent / 100) * position.quantity * position.entryPrice * position.leverage;
      const holdTime = Date.now() - position.openTime;

      logWithTimestamp(
        `PaperModeSimulator: Closed ${side} position for ${symbol} ` +
        `at $${exitPrice.toFixed(2)} (Entry: $${position.entryPrice.toFixed(2)}) ` +
        `P&L: ${pnlPercent.toFixed(2)}% ($${pnlUSDT.toFixed(2)} USDT) ` +
        `Hold: ${(holdTime / 1000).toFixed(0)}s - ${reason}`
      );

      // Emit position closed event
      this.emit('positionClosed', {
        symbol,
        side,
        entryPrice: position.entryPrice,
        exitPrice,
        pnlPercent,
        pnlUSDT,
        holdTime,
        reason,
      });

      // Remove position
      this.positions.delete(key);
      return true;
    } catch (error) {
      logErrorWithTimestamp(`PaperModeSimulator: Failed to close position ${symbol} ${side}:`, error);
      return false;
    }
  }

  /**
   * Monitor all open positions and check SL/TP triggers
   */
  private async monitorPositions(): Promise<void> {
    if (this.positions.size === 0) return;

    for (const [key, position] of this.positions.entries()) {
      try {
        // Fetch current market price
        const markPriceData = await getMarkPrice(position.symbol);
        const markPrice = parseFloat(
          Array.isArray(markPriceData) ? markPriceData[0].markPrice : markPriceData.markPrice
        );

        position.lastMarkPrice = markPrice;

        // Calculate current P&L
        const isLong = position.side === 'LONG';
        const pnlPercent = isLong
          ? ((markPrice - position.entryPrice) / position.entryPrice) * 100
          : ((position.entryPrice - markPrice) / position.entryPrice) * 100;

        const pnlUSDT = (pnlPercent / 100) * position.quantity * position.entryPrice * position.leverage;

        // Only log if P&L changed significantly (> 0.1%)
        if (Math.abs(pnlPercent - position.lastPnL) > 0.1) {
          logWithTimestamp(
            `PaperModeSimulator: ${position.symbol} ${position.side} @ $${markPrice.toFixed(2)} ` +
            `P&L: ${pnlPercent.toFixed(2)}% ($${pnlUSDT.toFixed(2)} USDT)`
          );
          position.lastPnL = pnlPercent;
        }

        // Emit P&L update for UI
        this.emit('pnlUpdate', {
          symbol: position.symbol,
          side: position.side,
          markPrice,
          pnlPercent,
          pnlUSDT,
        });

        // Check SL trigger
        const slTriggered = isLong
          ? markPrice <= position.slPrice
          : markPrice >= position.slPrice;

        if (slTriggered) {
          logWithTimestamp(
            `PaperModeSimulator: 🛑 STOP LOSS triggered for ${position.symbol} ${position.side} ` +
            `at $${markPrice.toFixed(2)} (SL: $${position.slPrice.toFixed(2)})`
          );
          await this.closePosition(position.symbol, position.side, 'Stop Loss triggered');
          continue;
        }

        // Check TP trigger
        const tpTriggered = isLong
          ? markPrice >= position.tpPrice
          : markPrice <= position.tpPrice;

        if (tpTriggered) {
          logWithTimestamp(
            `PaperModeSimulator: 🎯 TAKE PROFIT triggered for ${position.symbol} ${position.side} ` +
            `at $${markPrice.toFixed(2)} (TP: $${position.tpPrice.toFixed(2)})`
          );
          await this.closePosition(position.symbol, position.side, 'Take Profit triggered');
          continue;
        }
      } catch (error) {
        logErrorWithTimestamp(`PaperModeSimulator: Error monitoring ${key}:`, error);
      }
    }
  }

  /**
   * Get all open positions
   */
  public getPositions(): SimulatedPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get specific position
   */
  public getPosition(symbol: string, side: 'LONG' | 'SHORT'): SimulatedPosition | undefined {
    return this.positions.get(`${symbol}_${side}`);
  }

  /**
   * Check if position exists
   */
  public hasPosition(symbol: string, side: 'LONG' | 'SHORT'): boolean {
    return this.positions.has(`${symbol}_${side}`);
  }

  /**
   * Get position count
   */
  public getPositionCount(): number {
    return this.positions.size;
  }

  /**
   * Close all positions
   */
  public async closeAllPositions(): Promise<void> {
    logWithTimestamp(`PaperModeSimulator: Closing all ${this.positions.size} position(s)...`);

    const positions = Array.from(this.positions.values());
    for (const position of positions) {
      await this.closePosition(position.symbol, position.side, 'Close all requested');
    }

    logWithTimestamp('PaperModeSimulator: All positions closed');
  }
}

// Export singleton instance
export const paperModeSimulator = new PaperModeSimulator();
