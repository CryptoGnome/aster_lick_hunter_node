import { getVirtualPositionTracker, VirtualOrder } from './virtualPositions';
import { getVirtualBalanceTracker } from './virtualBalance';
import { logWithTimestamp } from '../utils/timestamp';
import { Order, OrderStatus, OrderType, OrderSide, TimeInForce, PositionSide } from '../types/order';
import { getMarkPrice } from '../api/market';
import { PaperTradingConfig } from '../types';

export interface SimulatedOrderResult {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  status: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED';
  executedQty: string;
  price: string;
  origQty: string;
  updateTime: number;
  clientOrderId?: string;
  avgPrice?: string;
}

export class OrderSimulator {
  private makerFeeRate = 0.0002; // 0.02% maker fee
  private takerFeeRate = 0.0004; // 0.04% taker fee
  private config: PaperTradingConfig = {};

  /**
   * Set paper trading configuration
   */
  setConfig(config: PaperTradingConfig): void {
    this.config = config;
  }

  /**
   * Apply slippage to execution price
   */
  private applySlippage(price: number, side: 'BUY' | 'SELL'): number {
    const slippageBps = this.config.slippageBps || 0;
    if (slippageBps === 0) return price;

    const slippagePercent = slippageBps / 10000; // Convert bps to decimal
    
    // Buy orders get worse price (higher), sell orders get worse price (lower)
    if (side === 'BUY') {
      return price * (1 + slippagePercent);
    } else {
      return price * (1 - slippagePercent);
    }
  }

  /**
   * Check if order should be rejected
   */
  private shouldRejectOrder(): boolean {
    const rejectionRate = this.config.rejectionRate || 0;
    if (rejectionRate === 0) return false;
    
    return Math.random() * 100 < rejectionRate;
  }

  /**
   * Calculate partial fill quantity
   */
  private getPartialFillQuantity(fullQuantity: number): number {
    const partialFillPercent = this.config.partialFillPercent || 0;
    if (partialFillPercent === 0) return fullQuantity;
    
    if (Math.random() * 100 < partialFillPercent) {
      // Partial fill: 50-95% of order
      const fillPercent = 0.5 + (Math.random() * 0.45);
      return fullQuantity * fillPercent;
    }
    
    return fullQuantity;
  }

  /**
   * Apply simulated network latency
   */
  private async applyLatency(): Promise<void> {
    const latencyMs = this.config.latencyMs || 0;
    if (latencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, latencyMs));
    }
  }

  /**
   * Simulate placing an order
   */
  async simulateOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
    quantity: number;
    price?: number;
    stopPrice?: number;
    reduceOnly?: boolean;
    positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  }): Promise<SimulatedOrderResult> {
    const positionTracker = getVirtualPositionTracker();
    const balanceTracker = getVirtualBalanceTracker();

    // Apply network latency simulation
    await this.applyLatency();

    // Check for order rejection
    if (this.shouldRejectOrder()) {
      logWithTimestamp(`📄 Paper Trading: ❌ Order rejected (simulated rejection)`);
      return {
        orderId: `REJECTED_${Date.now()}`,
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        status: 'REJECTED',
        executedQty: '0',
        price: '0',
        origQty: params.quantity.toString(),
        updateTime: Date.now(),
      };
    }

    // Get current market price
    const currentPrice = await this.getCurrentPrice(params.symbol);

    // Determine execution price
    let executionPrice = currentPrice;
    let shouldFillImmediately = false;
    let isMakerOrder = false;

    if (params.type === 'MARKET') {
      // Market orders fill immediately at current price
      shouldFillImmediately = true;
      executionPrice = currentPrice;
      isMakerOrder = false;
    } else if (params.type === 'LIMIT') {
      // Limit orders
      if (params.price) {
        executionPrice = params.price;
        
        // Check if limit order would fill immediately
        if (params.side === 'BUY' && params.price >= currentPrice) {
          // Buy limit at or above current price - fills immediately as taker
          shouldFillImmediately = true;
          executionPrice = currentPrice;
          isMakerOrder = false;
        } else if (params.side === 'SELL' && params.price <= currentPrice) {
          // Sell limit at or below current price - fills immediately as taker
          shouldFillImmediately = true;
          executionPrice = currentPrice;
          isMakerOrder = false;
        } else {
          // Limit order below/above current price - will be filled as maker when price reaches it
          shouldFillImmediately = true; // For simplicity in paper trading, fill immediately at limit price
          executionPrice = params.price;
          isMakerOrder = true;
        }
      }
    } else if (params.type === 'STOP_MARKET' || params.type === 'TAKE_PROFIT_MARKET') {
      // Stop and TP orders are placed but not filled immediately
      shouldFillImmediately = false;
      executionPrice = params.stopPrice || currentPrice;
    }

    // Apply slippage to execution price
    executionPrice = this.applySlippage(executionPrice, params.side);

    // Calculate partial fill quantity
    const fillQuantity = shouldFillImmediately ? this.getPartialFillQuantity(params.quantity) : params.quantity;
    const isPartialFill = fillQuantity < params.quantity;

    // Create the virtual order
    const virtualOrder = positionTracker.createOrder(params);

    // Check if we should fill immediately
    if (shouldFillImmediately) {
      // Calculate required margin for opening position
      if (!params.reduceOnly) {
        const leverage = 10; // Default leverage, should come from config
        const notionalValue = executionPrice * fillQuantity;
        const requiredMargin = notionalValue / leverage;

        // Calculate fees
        const feeRate = isMakerOrder ? this.makerFeeRate : this.takerFeeRate;
        const fees = notionalValue * feeRate;

        // Check if sufficient balance
        if (!balanceTracker.hasAvailableBalance(requiredMargin + fees)) {
          logWithTimestamp(`📄 Paper Trading: ❌ Insufficient balance for order. Required: ${(requiredMargin + fees).toFixed(2)} USDT`);
          
          return {
            orderId: virtualOrder.orderId,
            symbol: params.symbol,
            side: params.side,
            type: params.type,
            status: 'REJECTED',
            executedQty: '0',
            price: executionPrice.toString(),
            origQty: params.quantity.toString(),
            updateTime: Date.now(),
          };
        }

        // Reserve margin
        balanceTracker.reserveMargin(requiredMargin);
        
        // Apply fees
        balanceTracker.applyFees(fees);
        
        logWithTimestamp(`📄 Paper Trading: Applied ${isMakerOrder ? 'maker' : 'taker'} fee: ${fees.toFixed(4)} USDT`);
      }

      // Fill the order
      await positionTracker.fillOrder(virtualOrder.orderId, executionPrice, fillQuantity);

      const slippageMsg = this.config?.slippageBps ? ` (slippage: ${this.config.slippageBps}bps)` : '';
      const partialFillMsg = isPartialFill ? ` 🔸 PARTIAL FILL: ${fillQuantity}/${params.quantity}` : '';
      
      return {
        orderId: virtualOrder.orderId,
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        status: isPartialFill ? 'PARTIALLY_FILLED' : 'FILLED',
        executedQty: fillQuantity.toString(),
        price: executionPrice.toString(),
        origQty: params.quantity.toString(),
        updateTime: Date.now(),
        avgPrice: executionPrice.toString() + slippageMsg + partialFillMsg,
      };
    }

    // Order placed but not filled
    return {
      orderId: virtualOrder.orderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      status: 'NEW',
      executedQty: '0',
      price: (params.price || params.stopPrice || currentPrice).toString(),
      origQty: params.quantity.toString(),
      updateTime: Date.now(),
    };
  }

  /**
   * Get current market price
   */
  private async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const markPriceData = await getMarkPrice(symbol);
      
      if (Array.isArray(markPriceData)) {
        const symbolData = markPriceData.find(item => item.symbol === symbol);
        if (symbolData && symbolData.markPrice) {
          return parseFloat(symbolData.markPrice);
        }
      } else if (markPriceData && markPriceData.markPrice) {
        return parseFloat(markPriceData.markPrice);
      }
      
      throw new Error(`Could not get mark price for ${symbol}`);
    } catch (_error) {
      logWithTimestamp(`📄 Paper Trading: Error getting price for ${symbol}, using fallback`);
      // Fallback to a reasonable price (should not happen in normal operation)
      return 0;
    }
  }

  /**
   * Check pending orders and fill them if price conditions are met
   */
  async checkAndFillPendingOrders(symbol: string, currentPrice: number): Promise<void> {
    const positionTracker = getVirtualPositionTracker();
    const balanceTracker = getVirtualBalanceTracker();
    const pendingOrders = positionTracker.getOpenOrders(symbol);

    for (const order of pendingOrders) {
      let shouldFill = false;
      let fillPrice = currentPrice;

      if (order.type === 'LIMIT') {
        if (order.side === 'BUY' && currentPrice <= (order.price || 0)) {
          shouldFill = true;
          fillPrice = order.price || currentPrice;
        } else if (order.side === 'SELL' && currentPrice >= (order.price || 0)) {
          shouldFill = true;
          fillPrice = order.price || currentPrice;
        }
      } else if (order.type === 'STOP_MARKET') {
        if (order.side === 'BUY' && currentPrice >= (order.stopPrice || 0)) {
          shouldFill = true;
          fillPrice = currentPrice;
        } else if (order.side === 'SELL' && currentPrice <= (order.stopPrice || 0)) {
          shouldFill = true;
          fillPrice = currentPrice;
        }
      } else if (order.type === 'TAKE_PROFIT_MARKET') {
        if (order.side === 'BUY' && currentPrice <= (order.stopPrice || 0)) {
          shouldFill = true;
          fillPrice = currentPrice;
        } else if (order.side === 'SELL' && currentPrice >= (order.stopPrice || 0)) {
          shouldFill = true;
          fillPrice = currentPrice;
        }
      }

      if (shouldFill) {
        // If closing position, realize PnL
        if (order.reduceOnly) {
          const position = positionTracker.getPosition(symbol, order.positionSide as 'LONG' | 'SHORT');
          if (position) {
            // Calculate PnL
            const pnl = position.side === 'LONG' 
              ? (fillPrice - position.entryPrice) * order.quantity
              : (position.entryPrice - fillPrice) * order.quantity;

            // Calculate fees
            const notionalValue = fillPrice * order.quantity;
            const fees = notionalValue * this.takerFeeRate;

            // Release margin
            balanceTracker.releaseMargin(position.margin);
            
            // Realize PnL (after fees)
            balanceTracker.realizePnL(pnl - fees, position.margin);
            balanceTracker.applyFees(fees);
          }
        }

        // Fill the order
        await positionTracker.fillOrder(order.orderId, fillPrice, order.quantity);
      }
    }
  }

  /**
   * Simulate order cancellation
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    const positionTracker = getVirtualPositionTracker();
    return positionTracker.cancelOrder(orderId);
  }

  /**
   * Convert virtual order to API-compatible order format
   */
  convertToApiOrder(virtualOrder: VirtualOrder): Order {
    // Generate a numeric order ID from timestamp
    const numericOrderId = Math.floor(virtualOrder.createdTime / 1000);
    
    return {
      orderId: numericOrderId,
      symbol: virtualOrder.symbol,
      status: virtualOrder.status as OrderStatus,
      clientOrderId: virtualOrder.orderId,
      price: (virtualOrder.filledPrice?.toString() || virtualOrder.price?.toString() || '0'),
      avgPrice: (virtualOrder.filledPrice?.toString() || '0'),
      origQty: virtualOrder.quantity.toString(),
      executedQty: virtualOrder.filledQuantity.toString(),
      cumulativeQuoteQty: '0',
      timeInForce: TimeInForce.GTC,
      type: virtualOrder.type as OrderType,
      reduceOnly: virtualOrder.reduceOnly || false,
      closePosition: false,
      side: virtualOrder.side as OrderSide,
      positionSide: (virtualOrder.positionSide as PositionSide) || PositionSide.BOTH,
      stopPrice: virtualOrder.stopPrice?.toString() || '0',
      priceProtect: false,
      origType: virtualOrder.type as OrderType,
      updateTime: virtualOrder.filledTime || virtualOrder.createdTime,
      time: virtualOrder.createdTime,
    };
  }
}

// Singleton instance
let orderSimulator: OrderSimulator | null = null;

export function getOrderSimulator(): OrderSimulator {
  if (!orderSimulator) {
    orderSimulator = new OrderSimulator();
  }
  return orderSimulator;
}
