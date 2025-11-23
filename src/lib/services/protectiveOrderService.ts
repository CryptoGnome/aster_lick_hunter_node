import { EventEmitter } from 'events';
import { Config } from '../types';
import { placeOrder } from '../api/orders';
import { symbolPrecision } from '../utils/symbolPrecision';
import { logWithTimestamp, logErrorWithTimestamp, logWarnWithTimestamp } from '../utils/timestamp';
import { errorLogger } from './errorLogger';

// Exchange position interface (from positionManager)
interface ExchangePosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  isolatedMargin: string;
  isAutoAddMargin: string;
  positionSide: string;
  updateTime: number;
}

interface ProtectiveOrder {
  orderId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  positionSide: string;
  triggerType: 'breakeven' | 'trim_level';
  triggerPercent: number;
  quantity: number;
  price: number;
  createdAt: number;
}

export class ProtectiveOrderService extends EventEmitter {
  private config: Config;
  private activeOrders: Map<string, ProtectiveOrder[]> = new Map(); // key: "BTCUSDT_LONG"
  private isRunning = false;
  private monitorInterval?: NodeJS.Timeout;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  public updateConfig(newConfig: Config): void {
    this.config = newConfig;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Monitor positions every 10 seconds to place/update protective orders
    this.monitorInterval = setInterval(() => {
      this.checkAndPlaceProtectiveOrders().catch(error => {
        logErrorWithTimestamp('ProtectiveOrderService: Error in monitor interval:', error);
      });
    }, 10000);

    logWithTimestamp('ProtectiveOrderService: Started');
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }

    logWithTimestamp('ProtectiveOrderService: Stopped');
  }

  // Check if protective orders should be placed for a position
  public async checkPositionForProtectiveOrders(
    position: ExchangePosition,
    currentPrice: number
  ): Promise<void> {
    const symbol = position.symbol;
    const symbolConfig = this.config.symbols[symbol];

    if (!symbolConfig?.enableProtectiveOrders) {
      return; // Protective orders not enabled for this symbol
    }

    const posAmt = parseFloat(position.positionAmt);
    if (Math.abs(posAmt) < 0.0001) {
      return; // No position
    }

    const entryPrice = parseFloat(position.entryPrice);
    const isLong = posAmt > 0;
    const key = this.getPositionKey(symbol, position.positionSide);

    // Calculate current P&L percentage
    const pnlPercent = isLong
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;

    // Check if we should place breakeven protective order
    if (symbolConfig.protectiveBreakeven?.enabled) {
      await this.checkBreakevenOrder(position, currentPrice, pnlPercent, key);
    }

    // Check if we should place trim level orders
    if (symbolConfig.protectiveTrimLevels && symbolConfig.protectiveTrimLevels.length > 0) {
      await this.checkTrimLevelOrders(position, currentPrice, pnlPercent, key);
    }
  }

  private async checkBreakevenOrder(
    position: ExchangePosition,
    currentPrice: number,
    pnlPercent: number,
    key: string
  ): Promise<void> {
    const symbol = position.symbol;
    const symbolConfig = this.config.symbols[symbol];
    const breakeven = symbolConfig.protectiveBreakeven!;
    const entryPrice = parseFloat(position.entryPrice);
    const posAmt = parseFloat(position.positionAmt);
    const isLong = posAmt > 0;

    // Check if we already have a breakeven order
    const existingOrders = this.activeOrders.get(key) || [];
    const hasBreakevenOrder = existingOrders.some(o => o.triggerType === 'breakeven');

    if (hasBreakevenOrder) {
      return; // Already placed
    }

    // Calculate trigger price with offset
    const offsetMultiplier = 1 + (breakeven.triggerOffset / 100);
    const triggerPrice = entryPrice * offsetMultiplier;

    // Check if current price has crossed the trigger
    const shouldTrigger = isLong
      ? currentPrice >= triggerPrice
      : currentPrice <= triggerPrice;

    if (!shouldTrigger) {
      return; // Not at trigger price yet
    }

    // Calculate quantity to trim
    const trimQuantity = Math.abs(posAmt) * (breakeven.trimPercent / 100);
    const formattedQty = symbolPrecision.formatQuantity(symbol, trimQuantity);

    // Place protective order
    try {
      const side = isLong ? 'SELL' : 'BUY';
      const clientOrderId = `po_be_${symbol}_${Date.now()}`;

      const orderParams: any = {
        symbol,
        side,
        type: 'LIMIT',
        quantity: formattedQty,
        price: symbolPrecision.formatPrice(symbol, triggerPrice),
        timeInForce: 'GTC',
        positionSide: position.positionSide,
        reduceOnly: true,
        newClientOrderId: clientOrderId,
      };

      const order = await placeOrder(orderParams, this.config.api);

      const protectiveOrder: ProtectiveOrder = {
        orderId: order.orderId,
        symbol,
        side,
        positionSide: position.positionSide,
        triggerType: 'breakeven',
        triggerPercent: breakeven.triggerOffset,
        quantity: trimQuantity,
        price: triggerPrice,
        createdAt: Date.now(),
      };

      // Track the order
      if (!this.activeOrders.has(key)) {
        this.activeOrders.set(key, []);
      }
      this.activeOrders.get(key)!.push(protectiveOrder);

      logWithTimestamp(
        `ProtectiveOrderService: Placed breakeven trim order for ${symbol} at ${triggerPrice.toFixed(2)} (${breakeven.trimPercent}% of position)`
      );

      this.emit('protectiveOrderPlaced', protectiveOrder);
    } catch (error: any) {
      logErrorWithTimestamp(
        `ProtectiveOrderService: Failed to place breakeven order for ${symbol}:`,
        error?.response?.data || error?.message
      );

      await errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
        type: 'trading',
        severity: 'medium',
        context: {
          component: 'ProtectiveOrderService',
          symbol,
          userAction: 'Place breakeven protective order',
        },
      });
    }
  }

  private async checkTrimLevelOrders(
    position: ExchangePosition,
    currentPrice: number,
    pnlPercent: number,
    key: string
  ): Promise<void> {
    const symbol = position.symbol;
    const symbolConfig = this.config.symbols[symbol];
    const trimLevels = symbolConfig.protectiveTrimLevels!;
    const entryPrice = parseFloat(position.entryPrice);
    const posAmt = parseFloat(position.positionAmt);
    const isLong = posAmt > 0;

    const existingOrders = this.activeOrders.get(key) || [];

    // Check each trim level
    for (const level of trimLevels) {
      // Skip if we already have an order for this level
      const hasLevelOrder = existingOrders.some(
        o => o.triggerType === 'trim_level' && o.triggerPercent === level.triggerPercent
      );

      if (hasLevelOrder) {
        continue;
      }

      // Check if we've reached this P&L level
      const shouldTrigger = isLong
        ? pnlPercent >= level.triggerPercent
        : pnlPercent >= level.triggerPercent;

      if (!shouldTrigger) {
        continue;
      }

      // Calculate trigger price based on P&L percentage
      const priceMultiplier = 1 + (level.triggerPercent / 100);
      const triggerPrice = isLong
        ? entryPrice * priceMultiplier
        : entryPrice * (2 - priceMultiplier);

      // Calculate quantity to trim (percentage of current position)
      const currentPosQty = Math.abs(posAmt);
      const trimQuantity = currentPosQty * (level.trimPercent / 100);
      const formattedQty = symbolPrecision.formatQuantity(symbol, trimQuantity);

      // Place protective order
      try {
        const side = isLong ? 'SELL' : 'BUY';
        const clientOrderId = `po_tl_${symbol}_${level.triggerPercent}_${Date.now()}`;

        const orderParams: any = {
          symbol,
          side,
          type: 'LIMIT',
          quantity: formattedQty,
          price: symbolPrecision.formatPrice(symbol, triggerPrice),
          timeInForce: 'GTC',
          positionSide: position.positionSide,
          reduceOnly: true,
          newClientOrderId: clientOrderId,
        };

        const order = await placeOrder(orderParams, this.config.api);

        const protectiveOrder: ProtectiveOrder = {
          orderId: order.orderId,
          symbol,
          side,
          positionSide: position.positionSide,
          triggerType: 'trim_level',
          triggerPercent: level.triggerPercent,
          quantity: trimQuantity,
          price: triggerPrice,
          createdAt: Date.now(),
        };

        // Track the order
        if (!this.activeOrders.has(key)) {
          this.activeOrders.set(key, []);
        }
        this.activeOrders.get(key)!.push(protectiveOrder);

        logWithTimestamp(
          `ProtectiveOrderService: Placed trim level order for ${symbol} at ${triggerPrice.toFixed(2)} (${level.trimPercent}% at ${level.triggerPercent}% P&L)`
        );

        this.emit('protectiveOrderPlaced', protectiveOrder);
      } catch (error: any) {
        logErrorWithTimestamp(
          `ProtectiveOrderService: Failed to place trim level order for ${symbol}:`,
          error?.response?.data || error?.message
        );

        await errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
          type: 'trading',
          severity: 'medium',
          context: {
            component: 'ProtectiveOrderService',
            symbol,
            userAction: 'Place trim level protective order',
          },
        });
      }
    }
  }

  // Remove protective orders when position closes
  public clearProtectiveOrders(symbol: string, positionSide: string): void {
    const key = this.getPositionKey(symbol, positionSide);
    this.activeOrders.delete(key);
    logWithTimestamp(`ProtectiveOrderService: Cleared protective orders for ${key}`);
  }

  // Handle order fill events to remove from tracking
  public handleOrderFilled(orderId: number): void {
    for (const [key, orders] of this.activeOrders.entries()) {
      const index = orders.findIndex(o => o.orderId === orderId);
      if (index !== -1) {
        const order = orders[index];
        orders.splice(index, 1);
        logWithTimestamp(
          `ProtectiveOrderService: Protective order filled - ${order.symbol} ${order.triggerType} at ${order.price.toFixed(2)}`
        );
        this.emit('protectiveOrderFilled', order);
        break;
      }
    }
  }

  private async checkAndPlaceProtectiveOrders(): Promise<void> {
    // This will be called by position manager when it has position updates
    // For now, it's a placeholder for future integration
  }

  private getPositionKey(symbol: string, positionSide: string): string {
    return `${symbol}_${positionSide}`;
  }

  // Get all active protective orders for a position
  public getProtectiveOrders(symbol: string, positionSide: string): ProtectiveOrder[] {
    const key = this.getPositionKey(symbol, positionSide);
    return this.activeOrders.get(key) || [];
  }
}

// Singleton instance
let protectiveOrderServiceInstance: ProtectiveOrderService | null = null;

export function getProtectiveOrderService(): ProtectiveOrderService | null {
  return protectiveOrderServiceInstance;
}

export function initializeProtectiveOrderService(config: Config): ProtectiveOrderService {
  if (!protectiveOrderServiceInstance) {
    protectiveOrderServiceInstance = new ProtectiveOrderService(config);
  } else {
    protectiveOrderServiceInstance.updateConfig(config);
  }
  return protectiveOrderServiceInstance;
}
