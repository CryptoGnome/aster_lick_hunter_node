import { EventEmitter } from 'events';
import { logWithTimestamp } from '../utils/timestamp';
import { PaperTradingDatabase } from '../db/paperTradingDb';

export interface VirtualPosition {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  quantity: number;
  leverage: number;
  margin: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  liquidationPrice: number;
  takeProfit?: number;
  stopLoss?: number;
  entryTime: number;
  orderId: string;
}

export interface VirtualOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  quantity: number;
  price?: number;
  stopPrice?: number;
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  reduceOnly?: boolean;
  status: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED';
  createdTime: number;
  filledTime?: number;
  filledPrice?: number;
  filledQuantity: number;
}

export class VirtualPositionTracker extends EventEmitter {
  private positions: Map<string, VirtualPosition> = new Map();
  private openOrders: Map<string, VirtualOrder> = new Map();
  private orderIdCounter = 1;
  private closedPositions: VirtualPosition[] = [];
  private filledOrders: VirtualOrder[] = []; // Track order history
  private maxOrderHistory = 100; // Keep last 100 filled orders
  private db: PaperTradingDatabase;

  constructor() {
    super();
    this.db = PaperTradingDatabase.getInstance();
    // Load positions from database on startup
    this.loadPositionsFromDB().catch(err => {
      logWithTimestamp(`⚠️ Failed to load paper positions from DB: ${err.message}`);
    });
  }

  /**
   * Generate a unique order ID
   */
  private generateOrderId(): string {
    return `PAPER_${Date.now()}_${this.orderIdCounter++}`;
  }

  /**
   * Create a virtual order
   */
  createOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
    quantity: number;
    price?: number;
    stopPrice?: number;
    positionSide?: 'LONG' | 'SHORT' | 'BOTH';
    reduceOnly?: boolean;
  }): VirtualOrder {
    const orderId = this.generateOrderId();
    const order: VirtualOrder = {
      orderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      stopPrice: params.stopPrice,
      positionSide: params.positionSide,
      reduceOnly: params.reduceOnly,
      status: 'NEW',
      createdTime: Date.now(),
      filledQuantity: 0,
    };

    this.openOrders.set(orderId, order);
    logWithTimestamp(`📄 Paper Trading: Created ${params.type} order ${orderId} - ${params.side} ${params.quantity} ${params.symbol} @ ${params.price || 'MARKET'}`);
    
    return order;
  }

  /**
   * Fill an order and update position
   */
  async fillOrder(orderId: string, fillPrice: number, fillQuantity?: number): Promise<VirtualOrder | null> {
    const order = this.openOrders.get(orderId);
    if (!order) {
      logWithTimestamp(`📄 Paper Trading: Order ${orderId} not found`);
      return null;
    }

    const actualFillQty = fillQuantity ?? order.quantity;
    
    order.filledPrice = fillPrice;
    order.filledQuantity = actualFillQty;
    order.filledTime = Date.now();
    order.status = actualFillQty >= order.quantity ? 'FILLED' : 'PARTIALLY_FILLED';

    if (order.status === 'FILLED') {
      this.openOrders.delete(orderId);
      // Add to order history
      this.filledOrders.unshift({ ...order }); // Add to beginning
      if (this.filledOrders.length > this.maxOrderHistory) {
        this.filledOrders.pop(); // Remove oldest
      }
    }

    // Save order to database
    await this.saveOrderToDB(order);

    logWithTimestamp(`📄 Paper Trading: Order ${orderId} ${order.status} - ${actualFillQty} @ ${fillPrice}`);
    
    // If this is opening a position
    if (!order.reduceOnly) {
      await this.openPosition(order, fillPrice, actualFillQty);
    } else {
      // If this is closing a position
      await this.closePosition(order, fillPrice, actualFillQty);
    }

    this.emit('orderFilled', order);
    return order;
  }

  /**
   * Open a new position
   */
  private async openPosition(order: VirtualOrder, entryPrice: number, quantity: number): Promise<void> {
    const positionKey = `${order.symbol}_${order.positionSide || 'BOTH'}`;
    const side = order.side === 'BUY' ? 'LONG' : 'SHORT';
    
    // Calculate margin required (assuming isolated margin)
    // Margin = (Entry Price × Quantity) / Leverage
    // For simplicity, assume 10x leverage if not specified
    const leverage = 10;
    const notionalValue = entryPrice * quantity;
    const margin = notionalValue / leverage;

    // Calculate liquidation price (simplified)
    // For LONG: liquidation = entry * (1 - 1/leverage)
    // For SHORT: liquidation = entry * (1 + 1/leverage)
    const liquidationPrice = side === 'LONG' 
      ? entryPrice * (1 - (1 / leverage) * 0.9) // 90% to account for fees
      : entryPrice * (1 + (1 / leverage) * 0.9);

    const position: VirtualPosition = {
      symbol: order.symbol,
      side,
      entryPrice,
      quantity,
      leverage,
      margin,
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,
      liquidationPrice,
      entryTime: Date.now(),
      orderId: order.orderId,
    };

    this.positions.set(positionKey, position);
    logWithTimestamp(`📄 Paper Trading: 🟢 Opened ${side} position on ${order.symbol} - ${quantity} @ ${entryPrice} (Margin: ${margin.toFixed(2)} USDT)`);
    
    // Save to database
    await this.savePositionToDB(position);
    
    this.emit('positionOpened', position);
  }

  /**
   * Close a position
   */
  private async closePosition(order: VirtualOrder, exitPrice: number, _quantity: number): Promise<void> {
    const positionKey = `${order.symbol}_${order.positionSide || 'BOTH'}`;
    const position = this.positions.get(positionKey);

    if (!position) {
      logWithTimestamp(`📄 Paper Trading: No position found to close for ${order.symbol}`);
      return;
    }

    // Calculate PnL
    const pnl = this.calculatePnL(position, exitPrice);
    
    // Update position with final PnL
    position.unrealizedPnL = pnl;
    
    // Remove from open positions
    this.positions.delete(positionKey);
    
    // Delete from database
    await this.deletePositionFromDB(order.symbol, position.side);
    
    // Add to closed positions history
    this.closedPositions.push({ ...position });

    logWithTimestamp(`📄 Paper Trading: 🔴 Closed ${position.side} position on ${order.symbol} - PnL: ${pnl.toFixed(2)} USDT (${((pnl / position.margin) * 100).toFixed(2)}%)`);
    
    this.emit('positionClosed', { position, pnl, exitPrice });
  }

  /**
   * Update positions with current market prices
   */
  async updatePositionPrices(symbol: string, currentPrice: number): Promise<void> {
    for (const [key, position] of this.positions.entries()) {
      if (position.symbol === symbol) {
        const pnl = this.calculatePnL(position, currentPrice);
        position.unrealizedPnL = pnl;
        position.unrealizedPnLPercent = (pnl / position.margin) * 100;
        
        // Store current price for database persistence
        (position as any).currentPrice = currentPrice;

        // Save updated position to database
        await this.savePositionToDB(position);

        // Check for liquidation
        if (this.isLiquidated(position, currentPrice)) {
          logWithTimestamp(`📄 Paper Trading: ⚠️ LIQUIDATION - ${position.side} ${position.symbol} at ${currentPrice}`);
          this.positions.delete(key);
          this.emit('positionLiquidated', { position, currentPrice });
        }
      }
    }

    this.emit('positionsUpdated', this.getAllPositions());
  }

  /**
   * Calculate PnL for a position
   */
  private calculatePnL(position: VirtualPosition, currentPrice: number): number {
    if (position.side === 'LONG') {
      // Long PnL = (Current Price - Entry Price) × Quantity
      return (currentPrice - position.entryPrice) * position.quantity;
    } else {
      // Short PnL = (Entry Price - Current Price) × Quantity
      return (position.entryPrice - currentPrice) * position.quantity;
    }
  }

  /**
   * Check if position is liquidated
   */
  private isLiquidated(position: VirtualPosition, currentPrice: number): boolean {
    if (position.side === 'LONG') {
      return currentPrice <= position.liquidationPrice;
    } else {
      return currentPrice >= position.liquidationPrice;
    }
  }

  /**
   * Set take profit for a position
   */
  setTakeProfit(symbol: string, price: number): void {
    for (const position of this.positions.values()) {
      if (position.symbol === symbol) {
        position.takeProfit = price;
        logWithTimestamp(`📄 Paper Trading: Set TP for ${symbol} at ${price}`);
      }
    }
  }

  /**
   * Set stop loss for a position
   */
  setStopLoss(symbol: string, price: number): void {
    for (const position of this.positions.values()) {
      if (position.symbol === symbol) {
        position.stopLoss = price;
        logWithTimestamp(`📄 Paper Trading: Set SL for ${symbol} at ${price}`);
      }
    }
  }

  /**
   * Check if TP/SL should trigger
   */
  checkProtectiveOrders(symbol: string, currentPrice: number): VirtualPosition[] {
    const triggeredPositions: VirtualPosition[] = [];

    for (const [key, position] of this.positions.entries()) {
      if (position.symbol === symbol) {
        let shouldClose = false;
        let reason = '';

        // Check Take Profit
        if (position.takeProfit) {
          if (position.side === 'LONG' && currentPrice >= position.takeProfit) {
            shouldClose = true;
            reason = 'Take Profit';
          } else if (position.side === 'SHORT' && currentPrice <= position.takeProfit) {
            shouldClose = true;
            reason = 'Take Profit';
          }
        }

        // Check Stop Loss
        if (position.stopLoss) {
          if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
            shouldClose = true;
            reason = 'Stop Loss';
          } else if (position.side === 'SHORT' && currentPrice >= position.stopLoss) {
            shouldClose = true;
            reason = 'Stop Loss';
          }
        }

        if (shouldClose) {
          const pnl = this.calculatePnL(position, currentPrice);
          position.unrealizedPnL = pnl;
          
          logWithTimestamp(`📄 Paper Trading: ${reason} triggered for ${symbol} at ${currentPrice} - PnL: ${pnl.toFixed(2)} USDT`);
          
          this.positions.delete(key);
          this.closedPositions.push({ ...position });
          triggeredPositions.push(position);
          
          this.emit('protectiveOrderTriggered', { position, reason, currentPrice, pnl });
        }
      }
    }

    return triggeredPositions;
  }

  /**
   * Get all open positions
   */
  getAllPositions(): VirtualPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position for a symbol
   */
  getPosition(symbol: string, positionSide?: 'LONG' | 'SHORT'): VirtualPosition | null {
    const key = `${symbol}_${positionSide || 'BOTH'}`;
    return this.positions.get(key) || null;
  }

  /**
   * Get total unrealized PnL
   */
  getTotalUnrealizedPnL(): number {
    let total = 0;
    for (const position of this.positions.values()) {
      total += position.unrealizedPnL;
    }
    return total;
  }

  /**
   * Get total used margin
   */
  getTotalUsedMargin(): number {
    let total = 0;
    for (const position of this.positions.values()) {
      total += position.margin;
    }
    return total;
  }

  /**
   * Cancel an order
   */
  cancelOrder(orderId: string): boolean {
    const order = this.openOrders.get(orderId);
    if (!order) {
      return false;
    }

    order.status = 'CANCELED';
    this.openOrders.delete(orderId);
    logWithTimestamp(`📄 Paper Trading: Canceled order ${orderId}`);
    
    this.emit('orderCanceled', order);
    return true;
  }

  /**
   * Get all open orders
   */
  getOpenOrders(symbol?: string): VirtualOrder[] {
    const orders = Array.from(this.openOrders.values());
    if (symbol) {
      return orders.filter(o => o.symbol === symbol);
    }
    return orders;
  }

  /**
   * Get filled orders (trade history)
   */
  getFilledOrders(symbol?: string, limit: number = 50): VirtualOrder[] {
    let orders = this.filledOrders;
    if (symbol) {
      orders = orders.filter(o => o.symbol === symbol);
    }
    return orders.slice(0, limit);
  }

  /**
   * Load positions from database
   */
  private async loadPositionsFromDB(): Promise<void> {
    try {
      const rows = await this.db.all<any>('SELECT * FROM positions');
      for (const row of rows) {
        const position: VirtualPosition = {
          symbol: row.symbol,
          side: row.side,
          entryPrice: row.entry_price,
          quantity: row.quantity,
          leverage: row.leverage,
          margin: row.margin,
          unrealizedPnL: row.unrealized_pnl || 0,
          unrealizedPnLPercent: row.unrealized_pnl_percent || 0,
          liquidationPrice: row.liquidation_price,
          takeProfit: row.take_profit || undefined,
          stopLoss: row.stop_loss || undefined,
          entryTime: row.entry_time,
          orderId: row.order_id,
        };
        const positionKey = `${position.symbol}_${position.side}`;
        this.positions.set(positionKey, position);
      }
      if (rows.length > 0) {
        logWithTimestamp(`📄 Paper Trading: Loaded ${rows.length} position(s) from database`);
      }
    } catch (error: any) {
      logWithTimestamp(`⚠️ Failed to load positions from DB: ${error.message}`);
    }
  }

  /**
   * Save position to database
   */
  private async savePositionToDB(position: VirtualPosition): Promise<void> {
    try {
      const sql = `
        INSERT OR REPLACE INTO positions (
          symbol, side, entry_price, quantity, leverage, margin,
          unrealized_pnl, unrealized_pnl_percent, liquidation_price,
          take_profit, stop_loss, entry_time, order_id, current_price, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
      `;
      await this.db.run(sql, [
        position.symbol,
        position.side,
        position.entryPrice,
        position.quantity,
        position.leverage,
        position.margin,
        position.unrealizedPnL,
        position.unrealizedPnLPercent,
        position.liquidationPrice,
        position.takeProfit || null,
        position.stopLoss || null,
        position.entryTime,
        position.orderId,
        (position as any).currentPrice || position.entryPrice,
      ]);
    } catch (error: any) {
      logWithTimestamp(`⚠️ Failed to save position to DB: ${error.message}`);
      console.error('[PaperTrading] savePositionToDB error:', error);
    }
  }

  /**
   * Delete position from database
   */
  private async deletePositionFromDB(symbol: string, side: string): Promise<void> {
    try {
      await this.db.run('DELETE FROM positions WHERE symbol = ? AND side = ?', [symbol, side]);
    } catch (error: any) {
      logWithTimestamp(`⚠️ Failed to delete position from DB: ${error.message}`);
    }
  }

  /**
   * Save order to database
   */
  private async saveOrderToDB(order: VirtualOrder): Promise<void> {
    try {
      const sql = `
        INSERT OR REPLACE INTO orders (
          order_id, symbol, side, type, quantity, price, stop_price,
          position_side, reduce_only, status, created_time, filled_time,
          filled_price, filled_quantity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await this.db.run(sql, [
        order.orderId,
        order.symbol,
        order.side,
        order.type,
        order.quantity,
        order.price || null,
        order.stopPrice || null,
        order.positionSide || null,
        order.reduceOnly ? 1 : 0,
        order.status,
        order.createdTime,
        order.filledTime || null,
        order.filledPrice || null,
        order.filledQuantity,
      ]);
    } catch (error: any) {
      logWithTimestamp(`⚠️ Failed to save order to DB: ${error.message}`);
    }
  }

  /**
   * Clear all positions and orders
   */
  reset(): void {
    this.positions.clear();
    this.openOrders.clear();
    this.closedPositions = [];
    // Clear database
    this.db.run('DELETE FROM positions').catch((err: any) => {
      logWithTimestamp(`⚠️ Failed to clear positions from DB: ${err.message}`);
    });
    this.db.run('DELETE FROM orders').catch((err: any) => {
      logWithTimestamp(`⚠️ Failed to clear orders from DB: ${err.message}`);
    });
    logWithTimestamp('📄 Paper Trading: Reset all positions and orders');
    this.emit('reset');
  }

  /**
   * Get trading statistics
   */
  getStatistics() {
    return {
      openPositions: this.positions.size,
      closedPositions: this.closedPositions.length,
      totalUnrealizedPnL: this.getTotalUnrealizedPnL(),
      totalUsedMargin: this.getTotalUsedMargin(),
      openOrders: this.openOrders.size,
    };
  }
}

// Singleton instance
let virtualPositionTracker: VirtualPositionTracker | null = null;

export function getVirtualPositionTracker(): VirtualPositionTracker {
  if (!virtualPositionTracker) {
    virtualPositionTracker = new VirtualPositionTracker();
  }
  return virtualPositionTracker;
}

export function initializeVirtualPositions(): VirtualPositionTracker {
  virtualPositionTracker = new VirtualPositionTracker();
  return virtualPositionTracker;
}
