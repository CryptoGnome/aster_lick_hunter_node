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
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  positionSide: string;
  triggerType: 'breakeven' | 'trim_level' | 'trailing_tp';
  triggerPercent: number;
  quantity: number;
  price: number;
  createdAt: number;
  trailPercent?: number; // For trailing TP
}

export class ProtectiveOrderService extends EventEmitter {
  private config: Config;
  private activeOrders: Map<string, ProtectiveOrder[]> = new Map(); // key: "BTCUSDT_LONG"
  private isRunning = false;
  private monitorInterval?: NodeJS.Timeout;
  private deactivatingKeys: Set<string> = new Set(); // Track positions being manually deactivated
  private trailingStops: Map<string, { trailPercent: number; highestPrice: number; orderId: string; entryPrice: number; enableDCA: boolean }> = new Map();
  private trailingStopMonitor?: NodeJS.Timeout;
  private disabledDefaultTPSL: Set<string> = new Set(); // Track positions with disabled default TP/SL (key: "BTCUSDT_LONG")

  constructor(config: Config) {
    super();
    this.config = config;
  }

  public updateConfig(newConfig: Config): void {
    this.config = newConfig;
  }

  public start(): void {
    if (this.isRunning) {
      logWithTimestamp('ProtectiveOrderService: Already running, skipping duplicate start');
      return;
    }
    this.isRunning = true;
    
    // Note: No monitoring interval needed - scale out orders are activated on-demand via UI
    logWithTimestamp('ProtectiveOrderService: Started (on-demand mode)');
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

  /**
   * Activate protective orders for a specific position with custom settings
   * This is used by the UI when a user manually activates protection
   */
  public async activateProtection(
    symbol: string,
    side: 'LONG' | 'SHORT',
    entryPrice: number,
    currentQuantity: number,
    settings: {
      enableBreakeven: boolean;
      breakevenTrimPercent?: number;
      trimLevels: Array<{ profitPercent: number; trimPercent: number }>;
      enableTrailingTakeProfit: boolean;
      trailingTakeProfitPercent?: number;
      trailingActivationPercent?: number;
      enableDCAOnDrop?: boolean;
      disableDefaultTPSL?: boolean;
    }
  ): Promise<void> {
    if (currentQuantity <= 0) {
      throw new Error('Invalid position quantity');
    }

    // Create a mock position for the protective order logic
    const positionSide = side; // 'LONG' or 'SHORT'
    const posAmt = side === 'LONG' ? currentQuantity : -currentQuantity;
    
    const mockPosition: ExchangePosition = {
      symbol,
      positionAmt: posAmt.toString(),
      entryPrice: entryPrice.toString(),
      markPrice: entryPrice.toString(), // We'll use current market price
      unRealizedProfit: '0',
      liquidationPrice: '0',
      leverage: '10',
      marginType: 'isolated',
      isolatedMargin: '0',
      isAutoAddMargin: 'false',
      positionSide: positionSide,
      updateTime: Date.now(),
    };

    const key = this.getPositionKey(symbol, positionSide);

    // Clear any existing protective orders for this position
    this.clearProtectiveOrders(symbol, positionSide);

    // Cancel default TP/SL if requested and mark position to skip future recreations
    if (settings.disableDefaultTPSL) {
      this.disabledDefaultTPSL.add(key);
      await this.cancelDefaultTPSL(symbol, positionSide);
    } else {
      // Ensure we remove the flag if user re-enables default TP/SL
      this.disabledDefaultTPSL.delete(key);
    }

    logWithTimestamp(
      `ProtectiveOrderService: Activating scale out for ${symbol} ${side} - Breakeven: ${settings.enableBreakeven}, Trim levels: ${settings.trimLevels.length}, Trailing TP: ${settings.enableTrailingTakeProfit}, DCA: ${settings.enableDCAOnDrop || false}, Disable Default TP/SL: ${settings.disableDefaultTPSL || false}`
    );

    // Place breakeven order if enabled
    if (settings.enableBreakeven) {
      const trimPercent = settings.breakevenTrimPercent || 25; // Default 25%
      await this.placeBreakevenOrder(mockPosition, entryPrice, trimPercent, key);
    }

    // Place trim level orders
    for (const level of settings.trimLevels) {
      await this.placeTrimLevelOrder(
        mockPosition,
        entryPrice,
        level.profitPercent,
        level.trimPercent,
        key
      );
    }

    // Place trailing take profit if enabled
    if (settings.enableTrailingTakeProfit) {
      const trailPercent = settings.trailingTakeProfitPercent || 2; // Default 2%
      const activationPercent = settings.trailingActivationPercent || 0; // Default 0% (immediate)
      const enableDCA = settings.enableDCAOnDrop || false;
      await this.placeTrailingTakeProfit(mockPosition, entryPrice, trailPercent, activationPercent, enableDCA, key);
    }

    logWithTimestamp(
      `ProtectiveOrderService: Scale out activated for ${symbol} ${side}`
    );
  }

  /**
   * Place a breakeven protective order
   */
  private async placeBreakevenOrder(
    position: ExchangePosition,
    entryPrice: number,
    trimPercent: number,
    key: string
  ): Promise<void> {
    const symbol = position.symbol;
    const posAmt = parseFloat(position.positionAmt);
    const isLong = posAmt > 0;

    // Breakeven is exactly at entry price
    const triggerPrice = entryPrice;

    // Calculate quantity to trim
    const trimQuantity = Math.abs(posAmt) * (trimPercent / 100);
    const formattedQty = symbolPrecision.formatQuantity(symbol, trimQuantity);

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
        newClientOrderId: clientOrderId,
      };

      // In one-way mode, use reduceOnly. In hedge mode, don't use it.
      if (this.config.global.positionMode !== 'HEDGE') {
        orderParams.reduceOnly = true;
      }

      logWithTimestamp(
        `ProtectiveOrderService: Placing breakeven order for ${symbol}:`,
        JSON.stringify({ ...orderParams, apiKey: '***' }, null, 2)
      );

      const order = await placeOrder(orderParams, this.config.api);

      logWithTimestamp(
        `ProtectiveOrderService: ✅ Binance response for breakeven order:`,
        JSON.stringify(order, null, 2)
      );

      const protectiveOrder: ProtectiveOrder = {
        orderId: order.orderId,
        symbol,
        side,
        positionSide: position.positionSide,
        triggerType: 'breakeven',
        triggerPercent: 0,
        quantity: trimQuantity,
        price: triggerPrice,
        createdAt: Date.now(),
      };

      if (!this.activeOrders.has(key)) {
        this.activeOrders.set(key, []);
      }
      this.activeOrders.get(key)!.push(protectiveOrder);

      logWithTimestamp(
        `ProtectiveOrderService: ✅ Placed breakeven order #${order.orderId} for ${symbol} at ${triggerPrice.toFixed(2)} (${trimPercent}% of position)`
      );

      this.emit('protectiveOrderPlaced', protectiveOrder);
    } catch (error: any) {
      logErrorWithTimestamp(
        `ProtectiveOrderService: Failed to place breakeven order for ${symbol}:`,
        error?.response?.data || error?.message
      );
      throw error;
    }
  }

  /**
   * Place a trim level protective order at a specific profit percentage
   */
  private async placeTrimLevelOrder(
    position: ExchangePosition,
    entryPrice: number,
    profitPercent: number,
    trimPercent: number,
    key: string
  ): Promise<void> {
    const symbol = position.symbol;
    const posAmt = parseFloat(position.positionAmt);
    const isLong = posAmt > 0;

    // Calculate trigger price
    const priceMultiplier = isLong
      ? 1 + profitPercent / 100
      : 1 - profitPercent / 100;
    const triggerPrice = entryPrice * priceMultiplier;

    // Calculate quantity to trim
    const trimQuantity = Math.abs(posAmt) * (trimPercent / 100);
    const formattedQty = symbolPrecision.formatQuantity(symbol, trimQuantity);

    try {
      const side = isLong ? 'SELL' : 'BUY';
      const clientOrderId = `po_trim_${symbol}_${profitPercent}_${Date.now()}`;

      const orderParams: any = {
        symbol,
        side,
        type: 'LIMIT',
        quantity: formattedQty,
        price: symbolPrecision.formatPrice(symbol, triggerPrice),
        timeInForce: 'GTC',
        positionSide: position.positionSide,
        newClientOrderId: clientOrderId,
      };

      // In one-way mode, use reduceOnly. In hedge mode, don't use it.
      if (this.config.global.positionMode !== 'HEDGE') {
        orderParams.reduceOnly = true;
      }

      logWithTimestamp(
        `ProtectiveOrderService: Placing trim order for ${symbol} (+${profitPercent}%):`,
        JSON.stringify({ ...orderParams, apiKey: '***' }, null, 2)
      );

      const order = await placeOrder(orderParams, this.config.api);

      const protectiveOrder: ProtectiveOrder = {
        orderId: order.orderId,
        symbol,
        side,
        positionSide: position.positionSide,
        triggerType: 'trim_level',
        triggerPercent: profitPercent,
        quantity: trimQuantity,
        price: triggerPrice,
        createdAt: Date.now(),
      };

      if (!this.activeOrders.has(key)) {
        this.activeOrders.set(key, []);
      }
      this.activeOrders.get(key)!.push(protectiveOrder);

      logWithTimestamp(
        `ProtectiveOrderService: ✅ Placed trim order #${order.orderId} for ${symbol} at ${triggerPrice.toFixed(2)} (+${profitPercent}%, ${trimPercent}% of position)`
      );

      this.emit('protectiveOrderPlaced', protectiveOrder);
    } catch (error: any) {
      logErrorWithTimestamp(
        `ProtectiveOrderService: Failed to place trim order for ${symbol} at ${profitPercent}%:`,
        error?.response?.data || error?.message
      );
      throw error;
    }
  }

  /**
   * Place a trailing take profit order (never goes below entry - profit protection only)
   */
  private async placeTrailingTakeProfit(
    position: ExchangePosition,
    entryPrice: number,
    trailPercent: number,
    activationPercent: number,
    enableDCA: boolean,
    key: string
  ): Promise<void> {
    const symbol = position.symbol;
    const posAmt = parseFloat(position.positionAmt);
    const isLong = posAmt > 0;

    // Calculate activation price (when trailing starts)
    const stopDistance = trailPercent / 100;
    const activationDistance = activationPercent / 100;
    
    const activationPrice = activationPercent > 0
      ? (isLong ? entryPrice * (1 + activationDistance) : entryPrice * (1 - activationDistance))
      : entryPrice;
    
    // Calculate initial TP price - NEVER below entry for profit protection
    const idealTpPrice = isLong
      ? activationPrice * (1 - stopDistance)
      : activationPrice * (1 + stopDistance);
    
    // Enforce minimum TP at entry price (break-even) to prevent losses
    const initialTpPrice = isLong
      ? Math.max(idealTpPrice, entryPrice)
      : Math.min(idealTpPrice, entryPrice);

    // Full position quantity for the stop
    const stopQuantity = Math.abs(posAmt);
    const formattedQty = symbolPrecision.formatQuantity(symbol, stopQuantity);

    try {
      const side = isLong ? 'SELL' : 'BUY';
      const clientOrderId = `po_trail_${symbol}_${Date.now()}`;

      const orderParams: any = {
        symbol,
        side,
        type: 'STOP_MARKET',
        quantity: formattedQty,
        stopPrice: symbolPrecision.formatPrice(symbol, initialTpPrice),
        positionSide: position.positionSide,
        newClientOrderId: clientOrderId,
        workingType: 'MARK_PRICE', // Use mark price to avoid liquidation wick manipulation
      };

      // In one-way mode, use reduceOnly. In hedge mode, don't use it.
      if (this.config.global.positionMode !== 'HEDGE') {
        orderParams.reduceOnly = true;
      }

      logWithTimestamp(
        `ProtectiveOrderService: Placing trailing TP for ${symbol}:`,
        JSON.stringify({ ...orderParams, apiKey: '***' }, null, 2)
      );

      const order = await placeOrder(orderParams, this.config.api);

      logWithTimestamp(
        `ProtectiveOrderService: ✅ Binance response for trailing TP:`,
        JSON.stringify(order, null, 2)
      );

      const protectiveOrder: ProtectiveOrder = {
        orderId: order.orderId,
        symbol,
        side,
        positionSide: position.positionSide,
        triggerType: 'trailing_tp',
        triggerPercent: 0,
        quantity: stopQuantity,
        price: initialTpPrice,
        createdAt: Date.now(),
        trailPercent,
      };

      if (!this.activeOrders.has(key)) {
        this.activeOrders.set(key, []);
      }
      this.activeOrders.get(key)!.push(protectiveOrder);

      // Track trailing TP state
      this.trailingStops.set(key, {
        trailPercent,
        highestPrice: activationPrice, // Start tracking from activation price
        orderId: order.orderId,
        entryPrice,
        enableDCA,
      });

      logWithTimestamp(
        `ProtectiveOrderService: ✅ Placed trailing TP #${order.orderId} for ${symbol} at ${initialTpPrice.toFixed(2)} (activates at ${activationPercent}% profit, trails ${trailPercent}%, break-even protected)`
      );

      // Start monitoring if not already running
      this.startTrailingTakeProfitMonitoring();

      this.emit('protectiveOrderPlaced', protectiveOrder);
    } catch (error: any) {
      logErrorWithTimestamp(
        `ProtectiveOrderService: Failed to place trailing stop for ${symbol}:`,
        error?.response?.data || error?.message
      );
      throw error;
    }
  }

  // DEPRECATED: Old config-based methods (not used - protective orders are now on-demand via UI)
  /*
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
  */

// 
//   private async checkBreakevenOrder(
//     position: ExchangePosition,
//     currentPrice: number,
//     pnlPercent: number,
//     key: string
//   ): Promise<void> {
//     const symbol = position.symbol;
//     const symbolConfig = this.config.symbols[symbol];
//     const breakeven = symbolConfig.protectiveBreakeven!;
//     const entryPrice = parseFloat(position.entryPrice);
//     const posAmt = parseFloat(position.positionAmt);
//     const isLong = posAmt > 0;
// 
//     // Check if we already have a breakeven order
//     const existingOrders = this.activeOrders.get(key) || [];
//     const hasBreakevenOrder = existingOrders.some(o => o.triggerType === 'breakeven');
// 
//     if (hasBreakevenOrder) {
//       return; // Already placed
//     }
// 
//     // Calculate trigger price with offset
//     const offsetMultiplier = 1 + (breakeven.triggerOffset / 100);
//     const triggerPrice = entryPrice * offsetMultiplier;
// 
//     // Check if current price has crossed the trigger
//     const shouldTrigger = isLong
//       ? currentPrice >= triggerPrice
//       : currentPrice <= triggerPrice;
// 
//     if (!shouldTrigger) {
//       return; // Not at trigger price yet
//     }
// 
//     // Calculate quantity to trim
//     const trimQuantity = Math.abs(posAmt) * (breakeven.trimPercent / 100);
//     const formattedQty = symbolPrecision.formatQuantity(symbol, trimQuantity);
// 
//     // Place protective order
//     try {
//       const side = isLong ? 'SELL' : 'BUY';
//       const clientOrderId = `po_be_${symbol}_${Date.now()}`;
// 
//       const orderParams: any = {
//         symbol,
//         side,
//         type: 'LIMIT',
//         quantity: formattedQty,
//         price: symbolPrecision.formatPrice(symbol, triggerPrice),
//         timeInForce: 'GTC',
//         positionSide: position.positionSide,
//         reduceOnly: true,
//         newClientOrderId: clientOrderId,
//       };
// 
//       const order = await placeOrder(orderParams, this.config.api);
// 
//       const protectiveOrder: ProtectiveOrder = {
//         orderId: order.orderId,
//         symbol,
//         side,
//         positionSide: position.positionSide,
//         triggerType: 'breakeven',
//         triggerPercent: breakeven.triggerOffset,
//         quantity: trimQuantity,
//         price: triggerPrice,
//         createdAt: Date.now(),
//       };
// 
//       // Track the order
//       if (!this.activeOrders.has(key)) {
//         this.activeOrders.set(key, []);
//       }
//       this.activeOrders.get(key)!.push(protectiveOrder);
// 
//       logWithTimestamp(
//         `ProtectiveOrderService: Placed breakeven trim order for ${symbol} at ${triggerPrice.toFixed(2)} (${breakeven.trimPercent}% of position)`
//       );
// 
//       this.emit('protectiveOrderPlaced', protectiveOrder);
//     } catch (error: any) {
//       logErrorWithTimestamp(
//         `ProtectiveOrderService: Failed to place breakeven order for ${symbol}:`,
//         error?.response?.data || error?.message
//       );
// 
//       await errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
//         type: 'trading',
//         severity: 'medium',
//         context: {
//           component: 'ProtectiveOrderService',
//           symbol,
//           userAction: 'Place breakeven protective order',
//         },
//       });
//     }
//   }
// 
//   private async checkTrimLevelOrders(
//     position: ExchangePosition,
//     currentPrice: number,
//     pnlPercent: number,
//     key: string
//   ): Promise<void> {
//     const symbol = position.symbol;
//     const symbolConfig = this.config.symbols[symbol];
//     const trimLevels = symbolConfig.protectiveTrimLevels!;
//     const entryPrice = parseFloat(position.entryPrice);
//     const posAmt = parseFloat(position.positionAmt);
//     const isLong = posAmt > 0;
// 
//     const existingOrders = this.activeOrders.get(key) || [];
// 
//     // Check each trim level
//     for (const level of trimLevels) {
//       // Skip if we already have an order for this level
//       const hasLevelOrder = existingOrders.some(
//         o => o.triggerType === 'trim_level' && o.triggerPercent === level.triggerPercent
//       );
// 
//       if (hasLevelOrder) {
//         continue;
//       }
// 
//       // Check if we've reached this P&L level
//       const shouldTrigger = isLong
//         ? pnlPercent >= level.triggerPercent
//         : pnlPercent >= level.triggerPercent;
// 
//       if (!shouldTrigger) {
//         continue;
//       }
// 
//       // Calculate trigger price based on P&L percentage
//       const priceMultiplier = 1 + (level.triggerPercent / 100);
//       const triggerPrice = isLong
//         ? entryPrice * priceMultiplier
//         : entryPrice * (2 - priceMultiplier);
// 
//       // Calculate quantity to trim (percentage of current position)
//       const currentPosQty = Math.abs(posAmt);
//       const trimQuantity = currentPosQty * (level.trimPercent / 100);
//       const formattedQty = symbolPrecision.formatQuantity(symbol, trimQuantity);
// 
//       // Place protective order
//       try {
//         const side = isLong ? 'SELL' : 'BUY';
//         const clientOrderId = `po_tl_${symbol}_${level.triggerPercent}_${Date.now()}`;
// 
//         const orderParams: any = {
//           symbol,
//           side,
//           type: 'LIMIT',
//           quantity: formattedQty,
//           price: symbolPrecision.formatPrice(symbol, triggerPrice),
//           timeInForce: 'GTC',
//           positionSide: position.positionSide,
//           reduceOnly: true,
//           newClientOrderId: clientOrderId,
//         };
// 
//         const order = await placeOrder(orderParams, this.config.api);
// 
//         const protectiveOrder: ProtectiveOrder = {
//           orderId: order.orderId,
//           symbol,
//           side,
//           positionSide: position.positionSide,
//           triggerType: 'trim_level',
//           triggerPercent: level.triggerPercent,
//           quantity: trimQuantity,
//           price: triggerPrice,
//           createdAt: Date.now(),
//         };
// 
//         // Track the order
//         if (!this.activeOrders.has(key)) {
//           this.activeOrders.set(key, []);
//         }
//         this.activeOrders.get(key)!.push(protectiveOrder);
// 
//         logWithTimestamp(
//           `ProtectiveOrderService: Placed trim level order for ${symbol} at ${triggerPrice.toFixed(2)} (${level.trimPercent}% at ${level.triggerPercent}% P&L)`
//         );
// 
//         this.emit('protectiveOrderPlaced', protectiveOrder);
//       } catch (error: any) {
//         logErrorWithTimestamp(
//           `ProtectiveOrderService: Failed to place trim level order for ${symbol}:`,
//           error?.response?.data || error?.message
//         );
// 
//         await errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
//           type: 'trading',
//           severity: 'medium',
//           context: {
//             component: 'ProtectiveOrderService',
//             symbol,
//             userAction: 'Place trim level protective order',
//           },
//         });
//       }
//     }
//   }
// 
  // Remove protective orders when position closes
  public clearProtectiveOrders(symbol: string, positionSide: string): void {
    const key = this.getPositionKey(symbol, positionSide);
    this.activeOrders.delete(key);
    logWithTimestamp(`ProtectiveOrderService: Cleared scale out orders for ${key}`);
  }

  /**
   * Check if a position has active scale out
   */
  public isProtectionActive(symbol: string, side: string): boolean {
    const key = this.getPositionKey(symbol, side);
    const orders = this.activeOrders.get(key);
    return orders !== undefined && orders.length > 0;
  }

  /**
   * Cancel default TP/SL orders for a position
   */
  private async cancelDefaultTPSL(symbol: string, positionSide: string): Promise<void> {
    try {
      const { getOpenOrders } = await import('../api/market');
      const { cancelOrder } = await import('../api/orders');
      const openOrders = await getOpenOrders(symbol, this.config.api);
      
      // Filter for TP/SL orders (TAKE_PROFIT_MARKET, STOP_MARKET, STOP, TAKE_PROFIT)
      // Exclude protective orders (po_ prefix)
      const tpslOrders = openOrders.filter((order: any) => {
        const isTPSL = ['TAKE_PROFIT_MARKET', 'STOP_MARKET', 'STOP', 'TAKE_PROFIT'].includes(order.type);
        const isProtective = order.clientOrderId?.startsWith('po_');
        const matchesPositionSide = order.positionSide === positionSide;
        return isTPSL && !isProtective && matchesPositionSide;
      });

      if (tpslOrders.length === 0) {
        logWithTimestamp(`ProtectiveOrderService: No default TP/SL orders found for ${symbol} ${positionSide}`);
        return;
      }

      logWithTimestamp(`ProtectiveOrderService: Cancelling ${tpslOrders.length} default TP/SL orders for ${symbol} ${positionSide}`);

      for (const order of tpslOrders) {
        try {
          await cancelOrder({ symbol, orderId: order.orderId }, this.config.api);
          logWithTimestamp(`ProtectiveOrderService: Cancelled default ${order.type} order #${order.orderId}`);
        } catch (error: any) {
          logErrorWithTimestamp(`ProtectiveOrderService: Failed to cancel order ${order.orderId}:`, error.message);
        }
      }
    } catch (error: any) {
      logErrorWithTimestamp(`ProtectiveOrderService: Failed to cancel default TP/SL for ${symbol}:`, error.message);
    }
  }

  /**
   * Deactivate scale out for a position (cancel all scale out orders)
   */
  public async deactivateProtection(symbol: string, side: string): Promise<void> {
    const key = this.getPositionKey(symbol, side);
    const orders = this.activeOrders.get(key);
    
    if (!orders || orders.length === 0) {
      logWithTimestamp(`ProtectiveOrderService: No active scale out for ${key}`);
      return;
    }

    // Mark this position as being manually deactivated
    this.deactivatingKeys.add(key);

    logWithTimestamp(`ProtectiveOrderService: Deactivating scale out for ${key} - Cancelling ${orders.length} orders`);

    // Cancel all protective orders
    const cancelOrder = (await import('../api/orders')).cancelOrder;
    
    for (const order of orders) {
      try {
        await cancelOrder({ symbol, orderId: Number(order.orderId) }, this.config.api);
        logWithTimestamp(`ProtectiveOrderService: Cancelled ${order.triggerType} order for ${symbol}`);
      } catch (error: any) {
        logErrorWithTimestamp(`ProtectiveOrderService: Failed to cancel order ${order.orderId}:`, error.message);
      }
    }

    // Clear from tracking
    this.activeOrders.delete(key);
    this.trailingStops.delete(key); // Also clear trailing stop tracking
    this.disabledDefaultTPSL.delete(key); // Allow default TP/SL to resume
    
    // Remove from deactivating set after a delay (to handle race conditions with ORDER_TRADE_UPDATE)
    setTimeout(() => {
      this.deactivatingKeys.delete(key);
    }, 2000);
    
    logWithTimestamp(`ProtectiveOrderService: Scale out deactivated for ${key}`);
  }

  // Handle order fill events to remove from tracking
  public handleOrderFilled(orderId: string | number): void {
    const orderIdStr = String(orderId);
    for (const [key, orders] of this.activeOrders.entries()) {
      const index = orders.findIndex(o => o.orderId === orderIdStr);
      if (index !== -1) {
        const order = orders[index];
        orders.splice(index, 1);
        logWithTimestamp(
          `ProtectiveOrderService: Protective order filled - ${order.symbol} ${order.triggerType} at ${order.price.toFixed(2)}`
        );
        this.emit('protectiveOrderFilled', order);
        
        // If it was a trailing TP, clean up tracking
        if (order.triggerType === 'trailing_tp') {
          this.trailingStops.delete(key);
        }
        
        // If no orders left, clean up
        if (orders.length === 0) {
          this.activeOrders.delete(key);
          this.trailingStops.delete(key);
        }
        break;
      }
    }
  }
  
  // Check if a position is being manually deactivated
  public isDeactivating(symbol: string, side: string): boolean {
    const key = this.getPositionKey(symbol, side);
    return this.deactivatingKeys.has(key);
  }

  /**
   * Start monitoring trailing TPs to adjust them as price moves
   */
  private startTrailingTakeProfitMonitoring(): void {
    if (this.trailingStopMonitor) {
      return; // Already monitoring
    }

    logWithTimestamp('ProtectiveOrderService: Starting trailing TP monitoring');

    this.trailingStopMonitor = setInterval(async () => {
      await this.checkAndAdjustTrailingTakeProfits();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Stop monitoring trailing TPs
   */
  private stopTrailingTakeProfitMonitoring(): void {
    if (this.trailingStopMonitor) {
      clearInterval(this.trailingStopMonitor);
      this.trailingStopMonitor = undefined;
      logWithTimestamp('ProtectiveOrderService: Stopped trailing TP monitoring');
    }
  }

  /**
   * Check all active trailing TPs and adjust if needed
   */
  private async checkAndAdjustTrailingTakeProfits(): Promise<void> {
    if (this.trailingStops.size === 0) {
      this.stopTrailingTakeProfitMonitoring();
      return;
    }

    try {
      // Get current mark prices for all symbols
      const { getMarkPrice } = await import('../api/market');
      const markPrices = (await getMarkPrice()) as any[];
      const priceMap = new Map<string, number>(markPrices.map((p: any) => [p.symbol, parseFloat(p.markPrice)]));

      for (const [key, trailData] of this.trailingStops.entries()) {
        const [symbol, positionSide] = key.split('_');
        const currentPrice = priceMap.get(symbol);
        
        if (!currentPrice) continue;

        const isLong = positionSide === 'LONG';
        
        // Check if we have a new high (for LONG) or new low (for SHORT)
        let needsAdjustment = false;
        let newHighestPrice = trailData.highestPrice;

        if (isLong && currentPrice > trailData.highestPrice) {
          newHighestPrice = currentPrice;
          needsAdjustment = true;
        } else if (!isLong && currentPrice < trailData.highestPrice) {
          newHighestPrice = currentPrice;
          needsAdjustment = true;
        }

        if (needsAdjustment) {
          // Calculate new TP price
          const stopDistance = trailData.trailPercent / 100;
          const idealTpPrice = isLong
            ? newHighestPrice * (1 - stopDistance)
            : newHighestPrice * (1 + stopDistance);
          
          // Enforce break-even: never let TP go below entry price
          const newTpPrice = isLong
            ? Math.max(idealTpPrice, trailData.entryPrice)
            : Math.min(idealTpPrice, trailData.entryPrice);

          // Update the TP order
          await this.adjustTrailingTakeProfit(symbol, positionSide, trailData.orderId, newTpPrice);
          
          // Update tracking
          trailData.highestPrice = newHighestPrice;
        }
      }
    } catch (error: any) {
      logErrorWithTimestamp('ProtectiveOrderService: Error checking trailing TPs:', error.message);
    }
  }

  /**
   * Adjust a trailing TP order to a new price
   */
  private async adjustTrailingTakeProfit(
    symbol: string,
    positionSide: string,
    oldOrderId: string,
    newStopPrice: number
  ): Promise<void> {
    try {
      const { cancelOrder } = await import('../api/orders');
      const key = this.getPositionKey(symbol, positionSide);
      
      // Find the order in tracking
      const orders = this.activeOrders.get(key);
      const orderIndex = orders?.findIndex(o => o.orderId === oldOrderId);
      
      if (orderIndex === undefined || orderIndex === -1 || !orders) {
        logWarnWithTimestamp(`ProtectiveOrderService: Trailing TP order ${oldOrderId} not found in tracking`);
        return;
      }

      const oldOrder = orders[orderIndex];
      const quantity = oldOrder.quantity;
      const side = oldOrder.side;

      // Cancel old order
      await cancelOrder({ symbol, orderId: Number(oldOrderId) }, this.config.api);

      // Place new order at adjusted price
      const clientOrderId = `po_trail_${symbol}_${Date.now()}`;
      const orderParams: any = {
        symbol,
        side,
        type: 'STOP_MARKET',
        quantity: symbolPrecision.formatQuantity(symbol, quantity),
        stopPrice: symbolPrecision.formatPrice(symbol, newStopPrice),
        positionSide,
        newClientOrderId: clientOrderId,
        workingType: 'MARK_PRICE',
      };

      if (this.config.global.positionMode !== 'HEDGE') {
        orderParams.reduceOnly = true;
      }

      const newOrder = await placeOrder(orderParams, this.config.api);

      // Update tracking
      orders[orderIndex] = {
        ...oldOrder,
        orderId: newOrder.orderId,
        price: newStopPrice,
      };

      // Update trail data
      const trailData = this.trailingStops.get(key);
      if (trailData) {
        trailData.orderId = newOrder.orderId;
      }

      logWithTimestamp(
        `ProtectiveOrderService: ✅ Adjusted trailing TP for ${symbol} from ${oldOrder.price.toFixed(2)} to ${newStopPrice.toFixed(2)}`
      );
    } catch (error: any) {
      logErrorWithTimestamp(
        `ProtectiveOrderService: Failed to adjust trailing TP for ${symbol}:`,
        error?.response?.data || error?.message
      );
    }
  }

  // DEPRECATED: Placeholder for old automatic monitoring
//   private async checkAndPlaceProtectiveOrders(): Promise<void> {
//     // This will be called by position manager when it has position updates
//     // For now, it's a placeholder for future integration
//   }

  private getPositionKey(symbol: string, positionSide: string): string {
    return `${symbol}_${positionSide}`;
  }

  // Get all active protective orders for a position
  public getProtectiveOrders(symbol: string, positionSide: string): ProtectiveOrder[] {
    const key = this.getPositionKey(symbol, positionSide);
    return this.activeOrders.get(key) || [];
  }

  // Check if default TP/SL is disabled for this position
  public isDefaultTPSLDisabled(symbol: string, positionSide: string): boolean {
    const key = this.getPositionKey(symbol, positionSide);
    return this.disabledDefaultTPSL.has(key);
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

// Export singleton for API usage
export const protectiveOrderService = new Proxy({} as ProtectiveOrderService, {
  get(_target, prop) {
    if (!protectiveOrderServiceInstance) {
      throw new Error('ProtectiveOrderService not initialized. Call initializeProtectiveOrderService() first.');
    }
    return (protectiveOrderServiceInstance as any)[prop];
  },
});
