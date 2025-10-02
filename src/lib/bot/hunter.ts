import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { Config, LiquidationEvent, SymbolConfig } from '../types';
import { getMarkPrice, getExchangeInfo } from '../api/market';
import { placeOrder, setLeverage } from '../api/orders';
import { calculateOptimalPrice, validateOrderParams, analyzeOrderBookDepth, getSymbolFilters } from '../api/pricing';
import { getPositionSide, getPositionMode } from '../api/positionMode';
import { PositionTracker } from './positionManager';
import { liquidationStorage } from '../services/liquidationStorage';
import { vwapService } from '../services/vwapService';
import { vwapStreamer } from '../services/vwapStreamer';
import { thresholdMonitor } from '../services/thresholdMonitor';
import { symbolPrecision } from '../utils/symbolPrecision';
import {
  parseExchangeError,
  NotionalError,
  RateLimitError,
  InsufficientBalanceError,
  ReduceOnlyError,
  PricePrecisionError,
  QuantityPrecisionError,
  PositionModeError
} from '../errors/TradingErrors';
import { errorLogger } from '../services/errorLogger';

export class Hunter extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Config;
  private isRunning = false;
  private statusBroadcaster: any; // Will be injected
  private isHedgeMode: boolean;
  private positionTracker: PositionTracker | null = null;
  private pendingOrders: Map<string, { symbol: string, side: 'BUY' | 'SELL', timestamp: number }> = new Map(); // Track orders placed but not yet filled
  private lastTradeTimestamps: Map<string, { long: number; short: number }> = new Map(); // Track last trade per symbol/side
  private cleanupInterval: NodeJS.Timeout | null = null; // Periodic cleanup timer
  private syncInterval: NodeJS.Timeout | null = null; // Position mode sync timer
  private lastModeSync: number = Date.now(); // Track last mode sync time

  constructor(config: Config, isHedgeMode: boolean = false) {
    super();
    this.config = config;
    this.isHedgeMode = isHedgeMode;

    // Initialize threshold monitor with config
    thresholdMonitor.updateConfig(config);
  }

  // Set status broadcaster for order events
  public setStatusBroadcaster(broadcaster: any): void {
    this.statusBroadcaster = broadcaster;
  }

  // Set position tracker for position limit checks
  public setPositionTracker(tracker: PositionTracker): void {
    this.positionTracker = tracker;

    // Listen for order events from PositionManager
    if (tracker && 'on' in tracker) {
      (tracker as any).on('orderFilled', (data: any) => {
        this.removePendingOrder(data.orderId?.toString());
      });

      (tracker as any).on('orderCancelled', (data: any) => {
        this.removePendingOrder(data.orderId?.toString());
      });
    }
  }

  // Update configuration dynamically
  public updateConfig(newConfig: Config): void {
    const oldConfig = this.config;
    this.config = newConfig;

    // Update threshold monitor configuration
    thresholdMonitor.updateConfig(newConfig);

    // Log significant changes
    if (oldConfig.global.paperMode !== newConfig.global.paperMode) {
      console.log(`Hunter: Paper mode changed to ${newConfig.global.paperMode}`);

      // If switching from paper mode to live mode, restart WebSocket connection
      if (oldConfig.global.paperMode && !newConfig.global.paperMode && newConfig.api.apiKey) {
        console.log('Hunter: Switching from paper mode to live mode');
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        if (this.isRunning) {
          this.connectWebSocket();
        }
      }
      // If switching from live mode to paper mode without API keys
      else if (!oldConfig.global.paperMode && newConfig.global.paperMode && !newConfig.api.apiKey) {
        console.log('Hunter: Switching from live mode to paper mode');
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        if (this.isRunning) {
          this.simulateLiquidations();
        }
      }
    }

    // Log symbol changes
    const oldSymbols = Object.keys(oldConfig.symbols);
    const newSymbols = Object.keys(newConfig.symbols);
    const addedSymbols = newSymbols.filter(s => !oldSymbols.includes(s));
    const removedSymbols = oldSymbols.filter(s => !newSymbols.includes(s));

    if (addedSymbols.length > 0) {
      console.log(`Hunter: Added symbols: ${addedSymbols.join(', ')}`);
    }
    if (removedSymbols.length > 0) {
      console.log(`Hunter: Removed symbols: ${removedSymbols.join(', ')}`);
    }

    // Check for threshold changes
    for (const symbol of newSymbols) {
      if (oldConfig.symbols[symbol]) {
        const oldSym = oldConfig.symbols[symbol];
        const newSym = newConfig.symbols[symbol];

        if (oldSym.longVolumeThresholdUSDT !== newSym.longVolumeThresholdUSDT ||
            oldSym.shortVolumeThresholdUSDT !== newSym.shortVolumeThresholdUSDT) {
          console.log(`Hunter: ${symbol} volume thresholds updated`);
        }
      }
    }
  }

  // Helper methods for pending order management
  private addPendingOrder(orderId: string, symbol: string, side: 'BUY' | 'SELL'): void {
    this.pendingOrders.set(orderId, { symbol, side, timestamp: Date.now() });
    console.log(`Hunter: Added pending order ${orderId} for ${symbol} ${side}. Total pending: ${this.pendingOrders.size}`);
    this.debugPendingOrders();
  }

  private removePendingOrder(orderId: string): void {
    if (this.pendingOrders.delete(orderId)) {
      console.log(`Hunter: Removed pending order ${orderId}. Total pending: ${this.pendingOrders.size}`);
      this.debugPendingOrders();
    }
  }

  // Debug method to display current pending order state
  private debugPendingOrders(): void {
    if (this.pendingOrders.size === 0) {
      console.log('Hunter: [DEBUG] No pending orders');
    } else {
      const orderList = Array.from(this.pendingOrders.entries()).map(([id, info]) => {
        const age = Math.round((Date.now() - info.timestamp) / 1000);
        return `  - ${id.substring(0, 20)}... -> ${info.symbol} ${info.side} (${age}s old)`;
      });
      console.log(`Hunter: [DEBUG] Current pending orders (${this.pendingOrders.size}):\n${orderList.join('\n')}`);
    }
  }

  private getPendingOrderCount(): number {
    // In hedge mode, count unique symbols (long and short on same symbol = 1 position)
    if (this.isHedgeMode) {
      const uniqueSymbols = new Set([...this.pendingOrders.values()].map(o => o.symbol));
      return uniqueSymbols.size;
    }
    // In one-way mode, each order is a separate position
    return this.pendingOrders.size;
  }

  private hasPendingOrderForSymbol(symbol: string): boolean {
    for (const order of this.pendingOrders.values()) {
      if (order.symbol === symbol) {
        return true;
      }
    }
    return false;
  }

  // Clean up stale pending orders (older than 5 minutes)
  private cleanStalePendingOrders(): void {
    const staleTime = Date.now() - 5 * 60 * 1000; // 5 minutes
    let cleanedCount = 0;
    for (const [orderId, order] of this.pendingOrders.entries()) {
      if (order.timestamp < staleTime) {
        console.log(`Hunter: Cleaning stale pending order ${orderId} for ${order.symbol} (age: ${Math.round((Date.now() - order.timestamp) / 1000)}s)`);
        this.pendingOrders.delete(orderId);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`Hunter: Cleaned ${cleanedCount} stale pending orders. Remaining: ${this.pendingOrders.size}`);
    }
  }

  // Start periodic cleanup of stale orders
  private startPeriodicCleanup(): void {
    // Clear any existing interval
    this.stopPeriodicCleanup();

    // Run cleanup every 30 seconds
    this.cleanupInterval = setInterval(() => {
      if (this.pendingOrders.size > 0) {
        this.cleanStalePendingOrders();
      }
    }, 30000);

    console.log('Hunter: Started periodic cleanup of stale pending orders (every 30s)');
  }

  // Stop periodic cleanup
  private stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('Hunter: Stopped periodic cleanup of stale pending orders');
    }
  }

  // Synchronize position mode with the exchange
  public async syncPositionMode(): Promise<void> {
    if (!this.config.api.apiKey || !this.config.api.secretKey) {
      console.log('Hunter: Skipping position mode sync - no API keys configured');
      return;
    }

    try {
      const actualMode = await getPositionMode(this.config.api);
      if (actualMode !== this.isHedgeMode) {
        console.log(`Hunter: Position mode mismatch detected. Local: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, Exchange: ${actualMode ? 'HEDGE' : 'ONE-WAY'}`);
        this.isHedgeMode = actualMode;
        console.log(`Hunter: Position mode synchronized to: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'} mode`);
      }
      this.lastModeSync = Date.now(); // Update sync time
    } catch (error) {
      console.error('Hunter: Failed to sync position mode with exchange:', error);
      // Keep current mode on error
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Sync position mode on startup
    await this.syncPositionMode();

    // Start periodic cleanup of stale pending orders (every 30 seconds)
    this.startPeriodicCleanup();

    // Start periodic position mode sync (every 2 minutes instead of 5)
    this.syncInterval = setInterval(() => {
      this.syncPositionMode().catch(err =>
        console.error('Hunter: Failed to sync position mode during periodic check:', err)
      );
    }, 2 * 60 * 1000);

    // Initialize symbol precision manager with exchange info
    try {
      const exchangeInfo = await getExchangeInfo();
      symbolPrecision.parseExchangeInfo(exchangeInfo);
      console.log('Hunter: Symbol precision manager initialized');
    } catch (error) {
      console.error('Hunter: Failed to initialize symbol precision manager:', error);
      // Broadcast error to UI
      if (this.statusBroadcaster) {
        this.statusBroadcaster.broadcastConfigError(
          'Symbol Precision Error',
          'Failed to initialize symbol precision manager. Using default precision values.',
          {
            component: 'Hunter',
            rawError: error,
          }
        );
      }
      // Continue anyway, will use default precision values
    }

    // In paper mode with no API keys, simulate liquidation events
    if (this.config.global.paperMode && (!this.config.api.apiKey || !this.config.api.secretKey)) {
      console.log('Hunter: Running in paper mode without API keys - simulating liquidations');
      this.simulateLiquidations();
    } else {
      this.connectWebSocket();
    }
  }

  stop(): void {
    this.isRunning = false;

    // Stop periodic cleanup
    this.stopPeriodicCleanup();

    // Stop periodic sync
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('Hunter: Stopped periodic position mode sync');
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connectWebSocket(): void {
    this.ws = new WebSocket('wss://fstream.asterdex.com/ws/!forceOrder@arr');

    this.ws.on('open', () => {
      console.log('Hunter WS connected');
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString());
        this.handleLiquidationEvent(event);
      } catch (error) {
        console.error('Hunter: WS message parse error:', error);
        // Log to error database
        errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
          type: 'websocket',
          severity: 'low',
          context: {
            component: 'Hunter',
            userAction: 'Processing WebSocket message',
            metadata: { rawMessage: data.toString() }
          }
        });
        // Broadcast error to UI
        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastWebSocketError(
            'Message Parse Error',
            'Failed to parse liquidation stream message',
            {
              component: 'Hunter',
              rawError: error,
            }
          );
        }
      }
    });

    this.ws.on('error', (error) => {
      console.error('Hunter WS error:', error);
      // Log to error database
      errorLogger.logWebSocketError(
        'wss://fstream.asterdex.com/ws/!forceOrder@arr',
        error instanceof Error ? error : new Error(String(error)),
        1
      );
      // Broadcast error to UI
      if (this.statusBroadcaster) {
        this.statusBroadcaster.broadcastWebSocketError(
          'Hunter WebSocket Error',
          'Connection error with liquidation stream. Reconnecting in 5 seconds...',
          {
            component: 'Hunter',
            rawError: error,
          }
        );
      }
      // Reconnect after delay
      setTimeout(() => this.connectWebSocket(), 5000);
    });

    this.ws.on('close', () => {
      console.log('Hunter WS closed');
      if (this.isRunning) {
        // Broadcast reconnection attempt to UI
        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastWebSocketError(
            'Hunter WebSocket Closed',
            'Liquidation stream disconnected. Reconnecting in 5 seconds...',
            {
              component: 'Hunter',
            }
          );
        }
        setTimeout(() => this.connectWebSocket(), 5000);
      }
    });
  }

  private async handleLiquidationEvent(event: any): Promise<void> {
    if (event.e !== 'forceOrder') return; // Not a liquidation event

    const liquidation: LiquidationEvent = {
      symbol: event.o.s,
      side: event.o.S,
      orderType: event.o.o,
      quantity: parseFloat(event.o.q),
      price: parseFloat(event.o.p),
      averagePrice: parseFloat(event.o.ap),
      orderStatus: event.o.X,
      orderLastFilledQuantity: parseFloat(event.o.l),
      orderFilledAccumulatedQuantity: parseFloat(event.o.z),
      orderTradeTime: event.o.T,
      eventTime: event.E,
      qty: parseFloat(event.o.q), // Keep for backward compatibility
      time: event.E, // Keep for backward compatibility
    };

    // Check if threshold system is enabled globally and for this symbol
    const useThresholdSystem = this.config.global.useThresholdSystem === true &&
                              this.config.symbols[liquidation.symbol]?.useThreshold === true;

    // Process liquidation through threshold monitor only if enabled
    const thresholdStatus = useThresholdSystem ? thresholdMonitor.processLiquidation(liquidation) : null;

    // Emit liquidation event to WebSocket clients (all liquidations) with threshold info
    this.emit('liquidationDetected', {
      ...liquidation,
      thresholdStatus
    });

    const symbolConfig = this.config.symbols[liquidation.symbol];
    if (!symbolConfig) return; // Symbol not in config

    const volumeUSDT = liquidation.qty * liquidation.price;

    // Store liquidation in database (non-blocking)
    liquidationStorage.saveLiquidation(liquidation, volumeUSDT).catch(error => {
      console.error('Hunter: Failed to store liquidation:', error);
      // Log to error database
      errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
        type: 'general',
        severity: 'low',
        context: {
          component: 'Hunter',
          symbol: liquidation.symbol,
          userAction: 'Storing liquidation event',
          metadata: { volumeUSDT }
        }
      });
      // Non-critical error, don't broadcast to UI to avoid spam
    });

    // Check if we should use threshold system or instant trigger
    if (useThresholdSystem && thresholdStatus) {
      // * NEW THRESHOLD SYSTEM - Cumulative volume in 60-second window
      // * Determine opportunity direction based on trade_side parameter
      const tradeDirection = symbolConfig.trade_side || 'OPPOSITE';

      let isLongOpportunity: boolean;
      let isShortOpportunity: boolean;

      if (tradeDirection === 'OPPOSITE') {
        // * Contrarian: SELL liquidation → BUY opportunity, BUY liquidation → SELL opportunity
        isLongOpportunity = liquidation.side === 'SELL';
        isShortOpportunity = liquidation.side === 'BUY';
      } else {
        // * Momentum: SELL liquidation → SELL opportunity, BUY liquidation → BUY opportunity
        isLongOpportunity = liquidation.side === 'BUY';
        isShortOpportunity = liquidation.side === 'SELL';
      }

      let shouldTrade = false;
      let tradeSide: 'BUY' | 'SELL' | null = null;

      if (isLongOpportunity && thresholdStatus.longThreshold > 0) {
        // Check if cumulative SELL liquidations in 60s meet long threshold
        if (thresholdStatus.recentLongVolume >= thresholdStatus.longThreshold) {
          shouldTrade = true;
          tradeSide = 'BUY'; // Buy when longs are getting liquidated
          console.log(`Hunter: LONG threshold met - ${liquidation.symbol} cumulative SELL liquidations: ${thresholdStatus.recentLongVolume.toFixed(2)} USDT >= ${thresholdStatus.longThreshold} USDT (60s window)`);
        }
      } else if (isShortOpportunity && thresholdStatus.shortThreshold > 0) {
        // Check if cumulative BUY liquidations in 60s meet short threshold
        if (thresholdStatus.recentShortVolume >= thresholdStatus.shortThreshold) {
          shouldTrade = true;
          tradeSide = 'SELL'; // Sell when shorts are getting liquidated
          console.log(`Hunter: SHORT threshold met - ${liquidation.symbol} cumulative BUY liquidations: ${thresholdStatus.recentShortVolume.toFixed(2)} USDT >= ${thresholdStatus.shortThreshold} USDT (60s window)`);
        }
      }

      if (shouldTrade && tradeSide) {
        // Check cooldown to prevent multiple trades from same window
        const now = Date.now();
        const cooldownPeriod = symbolConfig.thresholdCooldown || 30000; // Use symbol-specific cooldown or default 30s
        const symbolTrades = this.lastTradeTimestamps.get(liquidation.symbol) || { long: 0, short: 0 };

        const lastTradeTime = tradeSide === 'BUY' ? symbolTrades.long : symbolTrades.short;
        const timeSinceLastTrade = now - lastTradeTime;

        if (timeSinceLastTrade < cooldownPeriod) {
          const remainingCooldown = Math.ceil((cooldownPeriod - timeSinceLastTrade) / 1000);
          console.log(`Hunter: ${tradeSide} trade cooldown active for ${liquidation.symbol} - ${remainingCooldown}s remaining`);
          return;
        }

        console.log(`Hunter: Triggering ${tradeSide} trade for ${liquidation.symbol} based on 60s cumulative volume`);

        // Update last trade timestamp
        if (tradeSide === 'BUY') {
          symbolTrades.long = now;
        } else {
          symbolTrades.short = now;
        }
        this.lastTradeTimestamps.set(liquidation.symbol, symbolTrades);

        // Analyze and trade with the cumulative trigger
        await this.analyzeAndTrade(liquidation, symbolConfig, tradeSide);
      }
    } else {
      // * ORIGINAL INSTANT TRIGGER SYSTEM - Check direction-specific volume thresholds
      // * Determine threshold based on trade_side parameter
      const tradeDirection = symbolConfig.trade_side || 'OPPOSITE';

      let thresholdToCheck: number;
      if (tradeDirection === 'OPPOSITE') {
        // * Contrarian: Use thresholds based on liquidation side
        thresholdToCheck = liquidation.side === 'SELL'
          ? (symbolConfig.longVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 0)
          : (symbolConfig.shortVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 0);
      } else {
        // * Momentum: Use thresholds based on opposite of liquidation side
        thresholdToCheck = liquidation.side === 'BUY'
          ? (symbolConfig.longVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 0)
          : (symbolConfig.shortVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 0);
      }

      if (volumeUSDT < thresholdToCheck) return; // Too small

      console.log(`Hunter: Liquidation detected - ${liquidation.symbol} ${liquidation.side} ${volumeUSDT.toFixed(2)} USDT`);

      // Analyze and trade with instant trigger
      await this.analyzeAndTrade(liquidation, symbolConfig);
    }
  }

  private async analyzeAndTrade(liquidation: LiquidationEvent, symbolConfig: SymbolConfig, _forcedSide?: 'BUY' | 'SELL'): Promise<void> {
    try {
      // Get mark price and recent 1m kline
      const [markPriceData] = Array.isArray(await getMarkPrice(liquidation.symbol)) ?
        await getMarkPrice(liquidation.symbol) as any[] :
        [await getMarkPrice(liquidation.symbol)];

      const markPrice = parseFloat(markPriceData.markPrice);

      // Determine trade direction based on trade_side parameter
      // * OPPOSITE (default): SELL liquidation → BUY, BUY liquidation → SELL (contrarian strategy)
      // * SAME: SELL liquidation → SELL, BUY liquidation → BUY (momentum strategy)
      const tradeSide = symbolConfig.trade_side || 'OPPOSITE';
      const priceRatio = liquidation.price / markPrice;

      let triggerBuy: boolean;
      let triggerSell: boolean;

      if (tradeSide === 'OPPOSITE') {
        // * Contrarian: Trade opposite to liquidation direction
        triggerBuy = liquidation.side === 'SELL' && priceRatio < 1.01; // SELL liquidation → BUY
        triggerSell = liquidation.side === 'BUY' && priceRatio > 0.99;  // BUY liquidation → SELL
      } else {
        // * Momentum: Trade in same direction as liquidation
        triggerBuy = liquidation.side === 'BUY' && priceRatio > 0.99;   // BUY liquidation → BUY
        triggerSell = liquidation.side === 'SELL' && priceRatio < 1.01; // SELL liquidation → SELL
      }

      // Check VWAP protection if enabled
      if (symbolConfig.vwapProtection) {
        const timeframe = symbolConfig.vwapTimeframe || '1m';
        const lookback = symbolConfig.vwapLookback || 100;

        if (triggerBuy) {
          // Try to use streamer data first (real-time)
          const streamedVWAP = vwapStreamer.getCurrentVWAP(liquidation.symbol);
          let vwapCheck;

          if (streamedVWAP && Date.now() - streamedVWAP.timestamp < 5000) {
            // Use streamed data if it's fresh (less than 5 seconds old)
            const allowed = liquidation.price < streamedVWAP.vwap;
            vwapCheck = {
              allowed,
              vwap: streamedVWAP.vwap,
              reason: allowed
                ? `Price is below VWAP - BUY entry allowed`
                : `Price ($${liquidation.price.toFixed(2)}) is above VWAP ($${streamedVWAP.vwap.toFixed(2)}) - blocking long entry`
            };
          } else {
            // Fallback to API fetch if no fresh streamer data
            vwapCheck = await vwapService.checkVWAPFilter(
              liquidation.symbol,
              'BUY',
              liquidation.price,
              timeframe,
              lookback
            );
          }

          if (!vwapCheck.allowed) {
            console.log(`Hunter: VWAP Protection - ${vwapCheck.reason}`);

            // Emit blocked trade opportunity for monitoring
            this.emit('tradeBlocked', {
              symbol: liquidation.symbol,
              side: 'BUY',
              reason: vwapCheck.reason,
              vwap: vwapCheck.vwap,
              currentPrice: liquidation.price,
              blockType: 'VWAP_FILTER'
            });

            return; // Block the trade
          } else {
            console.log(`Hunter: VWAP Check Passed - Price $${liquidation.price.toFixed(2)} below VWAP $${vwapCheck.vwap.toFixed(2)}`);
          }
        } else if (triggerSell) {
          // Try to use streamer data first (real-time)
          const streamedVWAP = vwapStreamer.getCurrentVWAP(liquidation.symbol);
          let vwapCheck;

          if (streamedVWAP && Date.now() - streamedVWAP.timestamp < 5000) {
            // Use streamed data if it's fresh (less than 5 seconds old)
            const allowed = liquidation.price > streamedVWAP.vwap;
            vwapCheck = {
              allowed,
              vwap: streamedVWAP.vwap,
              reason: allowed
                ? `Price is above VWAP - SELL entry allowed`
                : `Price ($${liquidation.price.toFixed(2)}) is below VWAP ($${streamedVWAP.vwap.toFixed(2)}) - blocking short entry`
            };
          } else {
            // Fallback to API fetch if no fresh streamer data
            vwapCheck = await vwapService.checkVWAPFilter(
              liquidation.symbol,
              'SELL',
              liquidation.price,
              timeframe,
              lookback
            );
          }

          if (!vwapCheck.allowed) {
            console.log(`Hunter: VWAP Protection - ${vwapCheck.reason}`);

            // Emit blocked trade opportunity for monitoring
            this.emit('tradeBlocked', {
              symbol: liquidation.symbol,
              side: 'SELL',
              reason: vwapCheck.reason,
              vwap: vwapCheck.vwap,
              currentPrice: liquidation.price,
              blockType: 'VWAP_FILTER'
            });

            return; // Block the trade
          } else {
            console.log(`Hunter: VWAP Check Passed - Price $${liquidation.price.toFixed(2)} above VWAP $${vwapCheck.vwap.toFixed(2)}`);
          }
        }
      }

      if (triggerBuy) {
        const volumeUSDT = liquidation.qty * liquidation.price;

         // * Generate reason based on trade side mode
        let reason: string;
        if (tradeSide === 'OPPOSITE') {
          reason = `SELL liquidation at ${((1 - priceRatio) * 100).toFixed(2)}% below mark price (contrarian)`;
        } else {
          reason = `BUY liquidation at ${((priceRatio - 1) * 100).toFixed(2)}% above mark price (momentum)`;
        }


        // Emit trade opportunity
        this.emit('tradeOpportunity', {
          symbol: liquidation.symbol,
          side: 'BUY',
          reason: reason,
          liquidationVolume: volumeUSDT,
          priceImpact: Math.abs((priceRatio - 1) * 100),
          confidence: Math.min(95, 50 + (volumeUSDT / 1000) * 10) // Higher confidence for larger volumes
        });

        console.log(`Hunter: [${tradeSide}] Triggering BUY for ${liquidation.symbol} at ${liquidation.price}`);
        await this.placeTrade(liquidation.symbol, 'BUY', symbolConfig, liquidation.price);
      } else if (triggerSell) {
        const volumeUSDT = liquidation.qty * liquidation.price;

        // * Generate reason based on trade side mode
        let reason: string;
        if (tradeSide === 'OPPOSITE') {
          reason = `BUY liquidation at ${((priceRatio - 1) * 100).toFixed(2)}% above mark price (contrarian)`;
        } else {
          reason = `SELL liquidation at ${((1 - priceRatio) * 100).toFixed(2)}% below mark price (momentum)`;
        }

        // Emit trade opportunity
        this.emit('tradeOpportunity', {
          symbol: liquidation.symbol,
          side: 'SELL',
          reason: reason,
          liquidationVolume: volumeUSDT,
          priceImpact: Math.abs((priceRatio - 1) * 100),
          confidence: Math.min(95, 50 + (volumeUSDT / 1000) * 10)
        });

        console.log(`Hunter: [${tradeSide}] Triggering SELL for ${liquidation.symbol} at ${liquidation.price}`);
        await this.placeTrade(liquidation.symbol, 'SELL', symbolConfig, liquidation.price);
      }
    } catch (error) {
      console.error('Hunter: Analysis error:', error);
    }
  }

  private async placeTrade(symbol: string, side: 'BUY' | 'SELL', symbolConfig: SymbolConfig, entryPrice: number): Promise<void> {
    // Track when this trade attempt started (for timestamp validation)
    const tradeStartTime = Date.now();

    // Declare variables that will be used in error handling
    // Initialize with meaningful defaults to avoid misleading error logs
    let currentPrice: number = entryPrice;
    let quantity: number | undefined;  // Don't initialize to 0 - use undefined
    let notionalUSDT: number | undefined;  // Don't initialize to 0 - use undefined
    let tradeSizeUSDT: number = symbolConfig.tradeSize; // Default to general tradeSize
    let order: any; // Declare order variable for error handling

    try {
      // Check position limits before placing trade
      if (this.positionTracker && !this.config.global.paperMode) {
        // Check if we already have a pending order for this symbol
        if (this.hasPendingOrderForSymbol(symbol)) {
          console.log(`Hunter: Skipping trade - already have pending order for ${symbol}`);
          return;
        }

        // Check global max positions limit (including pending orders)
        const maxPositions = this.config.global.maxOpenPositions || 10;
        const currentPositionCount = this.positionTracker.getUniquePositionCount(this.isHedgeMode);
        const pendingOrderCount = this.getPendingOrderCount();
        const totalPositions = currentPositionCount + pendingOrderCount;

        if (totalPositions >= maxPositions) {
          console.log(`Hunter: Skipping trade - max positions reached (current: ${currentPositionCount}, pending: ${pendingOrderCount}, max: ${maxPositions})`);
          return;
        }

        // Note: Periodic cleanup now happens automatically every 30 seconds

        // Check symbol-specific margin limit
        if (symbolConfig.maxPositionMarginUSDT) {
          const currentMargin = this.positionTracker.getMarginUsage(symbol);
          const newTradeMargin = symbolConfig.tradeSize;
          const totalMargin = currentMargin + newTradeMargin;

          // Enhanced logging to debug margin issues
          console.log(`Hunter: Margin check for ${symbol} - Current: ${currentMargin.toFixed(2)} USDT, New trade: ${newTradeMargin} USDT, Total: ${totalMargin.toFixed(2)} USDT, Max allowed: ${symbolConfig.maxPositionMarginUSDT} USDT`);

          if (totalMargin > symbolConfig.maxPositionMarginUSDT) {
            console.log(`Hunter: Skipping trade - would exceed max margin for ${symbol} (${totalMargin.toFixed(2)}/${symbolConfig.maxPositionMarginUSDT} USDT)`);
            return;
          }
        }
      }

      if (this.config.global.paperMode) {
        console.log(`Hunter: PAPER MODE - Would place ${side} order for ${symbol}, quantity: ${symbolConfig.tradeSize}, leverage: ${symbolConfig.leverage}`);
        this.emit('positionOpened', {
          symbol,
          side,
          quantity: symbolConfig.tradeSize,
          price: entryPrice,
          leverage: symbolConfig.leverage,
          paperMode: true
        });
        return;
      }

      // Determine order type from config (default to LIMIT for better fills)
      let orderType = symbolConfig.orderType || 'LIMIT';
      let orderPrice = entryPrice;

      if (orderType === 'LIMIT') {
        // Calculate optimal limit order price
        const priceOffsetBps = symbolConfig.priceOffsetBps || 1;
        const usePostOnly = symbolConfig.usePostOnly || false;

        const optimalPrice = await calculateOptimalPrice(symbol, side, priceOffsetBps, usePostOnly);
        if (optimalPrice) {
          orderPrice = optimalPrice;

          // Analyze liquidity at this price level
          const targetNotional = symbolConfig.tradeSize * orderPrice;
          const liquidityAnalysis = await analyzeOrderBookDepth(symbol, side, targetNotional);

          if (!liquidityAnalysis.liquidityOk) {
            console.log(`Hunter: Limited liquidity for ${symbol} ${side} - may use market order instead`);
          }

          // Check if optimal price is within acceptable slippage
          const maxSlippageBps = symbolConfig.maxSlippageBps || 50;
          const slippageBps = Math.abs((orderPrice - entryPrice) / entryPrice) * 10000;

          if (slippageBps > maxSlippageBps) {
            console.log(`Hunter: Slippage ${slippageBps.toFixed(1)}bp exceeds max ${maxSlippageBps}bp for ${symbol} - using market order`);
            orderPrice = entryPrice;
            orderType = 'MARKET';
          }
        } else {
          console.log(`Hunter: Could not calculate optimal price for ${symbol} - falling back to market order`);
          orderType = 'MARKET';
        }
      }

      // Fetch symbol info for precision and filters
      const symbolInfo = await getSymbolFilters(symbol);
      if (!symbolInfo) {
        console.error(`Hunter: Could not fetch symbol info for ${symbol}`);
        return;
      }

      // Extract minimum notional from filters
      const minNotionalFilter = symbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL');
      const minNotional = minNotionalFilter ? parseFloat(minNotionalFilter.notional || '5') : 5;

      // Fetch current price for quantity calculation first
      if (orderType === 'LIMIT' && orderPrice) {
        // For limit orders, use the order price for calculation
        currentPrice = orderPrice;
      } else {
        // For market orders, fetch the current mark price
        const markPriceData = await getMarkPrice(symbol);
        currentPrice = parseFloat(Array.isArray(markPriceData) ? markPriceData[0].markPrice : markPriceData.markPrice);
      }

      // Calculate proper quantity based on USDT margin value
      // Use direction-specific trade size if available, otherwise fall back to general tradeSize
      tradeSizeUSDT = side === 'BUY'
        ? (symbolConfig.longTradeSize ?? symbolConfig.tradeSize)
        : (symbolConfig.shortTradeSize ?? symbolConfig.tradeSize);

      notionalUSDT = tradeSizeUSDT * symbolConfig.leverage;

      // Ensure we meet minimum notional requirement
      if (notionalUSDT < minNotional) {
        console.log(`Hunter: Adjusting notional from ${notionalUSDT} to minimum ${minNotional} for ${symbol}`);
        notionalUSDT = minNotional * 1.01; // Add 1% buffer to ensure we're above minimum
      }

      const calculatedQuantity = notionalUSDT / currentPrice;

      // Always format quantity and price using symbolPrecision (which now has defaults)
      quantity = symbolPrecision.formatQuantity(symbol, calculatedQuantity);

      // Check if quantity rounds to zero or is below minimum
      const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
      const minQty = lotSizeFilter ? parseFloat(lotSizeFilter.minQty || '0.001') : 0.001;

      if (quantity === 0 || quantity < minQty) {
        // Calculate what the minimum trade size should be
        const minNotionalForMargin = minNotional / symbolConfig.leverage;
        const minQtyForMargin = (minQty * currentPrice) / symbolConfig.leverage;
        const recommendedTradeSize = Math.max(minNotionalForMargin, minQtyForMargin) * 1.3; // 30% buffer

        console.error(`Hunter: Trade size too small for ${symbol} - quantity rounds to zero or below minimum`);
        console.error(`  Current trade size: ${tradeSizeUSDT} USDT`);
        console.error(`  Calculated quantity: ${calculatedQuantity.toFixed(8)} -> ${quantity} (after formatting)`);
        console.error(`  Minimum quantity: ${minQty}`);
        console.error(`  Minimum notional: ${minNotional} USDT (${minNotionalForMargin.toFixed(2)} USDT at ${symbolConfig.leverage}x leverage)`);
        console.error(`  RECOMMENDED: Set trade size to at least ${recommendedTradeSize.toFixed(2)} USDT`);

        // Broadcast error to UI
        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastTradingError(
            `Trade Size Too Small - ${symbol}`,
            `Trade size ${tradeSizeUSDT.toFixed(2)} USDT is too small. Minimum recommended: ${recommendedTradeSize.toFixed(2)} USDT`,
            {
              component: 'Hunter',
              symbol,
              details: {
                currentTradeSize: tradeSizeUSDT,
                minimumRequired: recommendedTradeSize,
                calculatedQuantity: calculatedQuantity,
                formattedQuantity: quantity,
                minQuantity: minQty,
                currentPrice: currentPrice,
                leverage: symbolConfig.leverage
              }
            }
          );
        }

        // Don't attempt to place the trade
        return;
      }

      // Validate order parameters
      if (orderType === 'LIMIT') {
        // Always format price using symbolPrecision (which now has defaults)
        orderPrice = symbolPrecision.formatPrice(symbol, orderPrice);

        const validation = await validateOrderParams(symbol, side, orderPrice, quantity);
        if (!validation.valid) {
          console.error(`Hunter: Order validation failed for ${symbol}: ${validation.error}`);
          return;
        }

        // Use adjusted values if provided (these are already properly formatted)
        if (validation.adjustedPrice !== undefined) orderPrice = validation.adjustedPrice;
        if (validation.adjustedQuantity !== undefined) quantity = validation.adjustedQuantity;
      }

      // Set leverage if needed
      await setLeverage(symbol, symbolConfig.leverage, this.config.api);

      console.log(`Hunter: Calculated quantity for ${symbol}: margin=${tradeSizeUSDT} USDT (${side === 'BUY' ? 'long' : 'short'}), leverage=${symbolConfig.leverage}x, price=${currentPrice}, notional=${notionalUSDT} USDT, quantity=${quantity}`);

      // Quick sanity check - ensure our mode is still in sync (if last sync was over 1 minute ago)
      if (Date.now() - this.lastModeSync > 60000) {
        console.log('Hunter: Position mode sync check needed (over 1 minute since last sync)');
        await this.syncPositionMode();
      }

      // Prepare order parameters
      const positionSide = getPositionSide(this.isHedgeMode, side);
      console.log(`Hunter: Using position mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, side: ${side}, positionSide: ${positionSide}`);
      console.log(`Hunter: Order params - Symbol: ${symbol}, Side: ${side}, PositionSide: ${positionSide}, Mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}`);

      const orderParams: any = {
        symbol,
        side,
        type: orderType,
        quantity,
        positionSide,
      };

      // Add price for limit orders
      if (orderType === 'LIMIT') {
        orderParams.price = orderPrice;
        orderParams.timeInForce = symbolConfig.usePostOnly ? 'GTX' : 'GTC';
      }

      // Generate a temporary tracking ID before placing the order
      const tempTrackingId = `temp_${Date.now()}_${symbol}_${side}`;

      // Pre-track the order to prevent duplicate trades while order is being placed
      this.addPendingOrder(tempTrackingId, symbol, side);

      try {
        // Place the order
        order = await placeOrder(orderParams, this.config.api);

        const displayPrice = orderType === 'LIMIT' ? ` at ${orderPrice}` : '';
        console.log(`Hunter: Placed ${orderType} ${side} order for ${symbol}${displayPrice}, orderId: ${order.orderId}`);

        // Replace temp tracking with real order ID
        this.removePendingOrder(tempTrackingId);
        if (order.orderId) {
          this.addPendingOrder(order.orderId.toString(), symbol, side);
        }
      } catch (orderError: any) {
        // Check if this is a position mode error (-4061)
        if (orderError?.response?.data?.code === -4061) {
          console.log(`Hunter: Position mode error for ${symbol}. Checking exchange mode...`);

          // Remove temp tracking before retry
          this.removePendingOrder(tempTrackingId);

          try {
            // Query the actual position mode from exchange
            const actualMode = await getPositionMode(this.config.api);
            console.log(`Hunter: Exchange mode: ${actualMode ? 'HEDGE' : 'ONE-WAY'}, Local mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}`);

            // Only retry if modes actually differ
            if (actualMode !== this.isHedgeMode) {
              console.log(`Hunter: Mode mismatch detected! Updating local mode and retrying...`);

              // Update our mode to match exchange
              this.isHedgeMode = actualMode;

              // Recalculate position side with correct mode
              const retryPositionSide = getPositionSide(this.isHedgeMode, side);
              console.log(`Hunter: Retrying with corrected mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, positionSide: ${retryPositionSide}`);

              // Update order params
              orderParams.positionSide = retryPositionSide;

              // Create retry tracking
              const retryTrackingId = `retry_${Date.now()}_${symbol}_${side}`;
              this.addPendingOrder(retryTrackingId, symbol, side);

              try {
                // Retry the order
                order = await placeOrder(orderParams, this.config.api);

                const displayPrice = orderType === 'LIMIT' ? ` at ${orderPrice}` : '';
                console.log(`Hunter: ✅ Order placed after mode correction for ${symbol}${displayPrice}, orderId: ${order.orderId}`);

                // Replace tracking with real order ID
                this.removePendingOrder(retryTrackingId);
                if (order.orderId) {
                  this.addPendingOrder(order.orderId.toString(), symbol, side);
                }
              } catch (retryError) {
                console.error(`Hunter: Retry failed even with corrected mode. Error:`, retryError);
                this.removePendingOrder(retryTrackingId);
                throw retryError;
              }
            } else {
              // Modes match - this is likely a position conflict or limit issue in HEDGE mode
              console.warn(`Hunter: Position mode is correct (${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}), -4061 likely due to position limits or conflicts`);
              console.warn(`Hunter: Symbol: ${symbol}, Side: ${side}, PositionSide: ${positionSide}`);
              console.warn(`Hunter: This is often due to position limits, existing positions, or symbol-specific restrictions`);

              // Remove temp tracking since order won't be placed
              this.removePendingOrder(tempTrackingId);

              // Don't re-throw - just return to prevent error DB logging
              // This prevents the error from being logged to the error database
              return;
            }
          } catch (queryError) {
            console.error('Hunter: Failed to query position mode from exchange:', queryError);
            console.warn('Hunter: Cannot determine correct mode. Since we cannot verify, treating as non-critical.');

            // Remove temp tracking since order won't be placed
            this.removePendingOrder(tempTrackingId);

            // Return instead of throwing to prevent error DB logging
            // We can't determine the actual issue, so don't pollute error logs
            return;
          }
        } else {
          // Not a position mode error, just clean up and re-throw
          this.removePendingOrder(tempTrackingId);
          throw orderError; // Re-throw to be handled by outer catch
        }
      }

      // Only broadcast and emit if order was successfully placed
      if (order && order.orderId) {
        // Broadcast order placed event
        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastOrderPlaced({
            symbol,
            side,
            orderType,
            quantity,
            price: orderType === 'LIMIT' ? orderPrice : undefined,
            orderId: order.orderId?.toString(),
          });
        }

        this.emit('positionOpened', {
          symbol,
          side,
          quantity,
          price: orderType === 'LIMIT' ? orderPrice : entryPrice,
          orderId: order.orderId,
          leverage: symbolConfig.leverage,
          orderType,
          paperMode: false
        });
      }

    } catch (error: any) {
      // CRITICAL FIX: Remove pending order tracking when order placement fails
      // This prevents pending orders from accumulating forever
      // We need to check all possible ways an order ID might have been generated
      if (order && order.orderId) {
        this.removePendingOrder(order.orderId.toString());
        console.log(`Hunter: Removed pending order ${order.orderId} after placement failure`);
      } else {
        // If order wasn't created but we might have a pending entry for this symbol
        // Clean up any pending orders for this symbol that are older than 10 seconds
        // This is a safety net for edge cases where order ID wasn't available
        const now = Date.now();
        for (const [orderId, orderInfo] of this.pendingOrders.entries()) {
          if (orderInfo.symbol === symbol && orderInfo.side === side &&
              (now - orderInfo.timestamp) < 10000) { // Only recent orders
            this.removePendingOrder(orderId);
            console.log(`Hunter: Cleaned up recent pending order ${orderId} for ${symbol} after placement failure`);
            break; // Only remove the most recent matching order
          }
        }
      }

      // Parse the error with context (use actual values or defaults)
      const tradingError = parseExchangeError(error, {
        symbol,
        quantity: quantity || 0,  // Use actual quantity if calculated, otherwise 0
        price: currentPrice,
        leverage: symbolConfig.leverage,
        positionSide: getPositionSide(this.isHedgeMode, side)
      });

      // Log to error database
      await errorLogger.logTradingError(
        `placeTrade-${side}`,
        symbol,
        tradingError,
        {
          side,
          quantity: quantity || 0,  // Use actual quantity if calculated, otherwise 0
          price: currentPrice,
          leverage: symbolConfig.leverage,
          tradeSizeUSDT,
          notionalUSDT: notionalUSDT || 0,  // Use actual notional if calculated, otherwise 0
          errorCode: tradingError.code,
          errorType: tradingError.constructor.name
        }
      );

      // Special handling for specific error types
      if (tradingError instanceof NotionalError) {
        const errorMsg = `Required: ${tradingError.requiredNotional} USDT, Actual: ${tradingError.actualNotional.toFixed(2)} USDT`;
        console.error(`Hunter: NOTIONAL ERROR for ${symbol}:`);
        console.error(`  Required: ${tradingError.requiredNotional} USDT`);
        console.error(`  Actual: ${tradingError.actualNotional.toFixed(2)} USDT`);
        console.error(`  Price: ${tradingError.price}`);
        console.error(`  Quantity: ${tradingError.quantity}`);
        console.error(`  Leverage: ${tradingError.leverage}x`);
        console.error(`  Margin used: ${tradeSizeUSDT} USDT (${side === 'BUY' ? 'long' : 'short'})`);
        console.error(`  This indicates the symbol may have special requirements or price has moved significantly.`);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastTradingError(
            `Notional Error - ${symbol}`,
            errorMsg,
            {
              component: 'Hunter',
              symbol,
              errorCode: tradingError.code,
              details: tradingError.details,
            }
          );
        }
      } else if (tradingError instanceof RateLimitError) {
        console.error(`Hunter: RATE LIMIT ERROR - Too many requests, please slow down`);
        console.error(`  Consider reducing order frequency or implementing request throttling`);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastApiError(
            'Rate Limit Exceeded',
            'Too many requests. Please reduce order frequency.',
            {
              component: 'Hunter',
              errorCode: tradingError.code,
            }
          );
        }
      } else if (tradingError instanceof InsufficientBalanceError) {
        console.error(`Hunter: INSUFFICIENT BALANCE ERROR for ${symbol}`);
        console.error(`  Check account balance and margin requirements`);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastTradingError(
            `Insufficient Balance - ${symbol}`,
            'Check account balance and margin requirements',
            {
              component: 'Hunter',
              symbol,
              errorCode: tradingError.code,
            }
          );
        }
      } else if (tradingError instanceof ReduceOnlyError) {
        console.error(`Hunter: REDUCE ONLY ERROR for ${symbol}`);
        console.error(`  Cannot place reduce-only order when no position exists`);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastTradingError(
            `Reduce Only Error - ${symbol}`,
            'Cannot place reduce-only order without an open position',
            {
              component: 'Hunter',
              symbol,
              errorCode: tradingError.code,
            }
          );
        }
      } else if (tradingError instanceof PositionModeError) {
        // This should not happen as we handle it in the retry logic above
        // But just in case, log it clearly
        console.error(`Hunter: POSITION MODE ERROR for ${symbol}`);
        console.error(`  Position mode mismatch - attempted ${tradingError.attemptedMode}`);
        console.error(`  This error should have been handled by retry logic`);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastTradingError(
            `Position Mode Error - ${symbol}`,
            `Position mode mismatch - check exchange settings`,
            {
              component: 'Hunter',
              symbol,
              errorCode: tradingError.code,
              details: tradingError.details,
            }
          );
        }
      } else if (tradingError instanceof PricePrecisionError) {
        console.error(`Hunter: PRICE PRECISION ERROR for ${symbol}`);
        console.error(`  Price ${tradingError.price} doesn't meet tick size requirements`);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastTradingError(
            `Price Precision Error - ${symbol}`,
            `Price ${tradingError.price} doesn't meet tick size requirements`,
            {
              component: 'Hunter',
              symbol,
              errorCode: tradingError.code,
            }
          );
        }
      } else if (tradingError instanceof QuantityPrecisionError) {
        console.error(`Hunter: QUANTITY PRECISION ERROR for ${symbol}`);
        console.error(`  Quantity ${tradingError.quantity} doesn't meet step size requirements`);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastTradingError(
            `Quantity Precision Error - ${symbol}`,
            `Quantity ${tradingError.quantity} doesn't meet step size requirements`,
            {
              component: 'Hunter',
              symbol,
              errorCode: tradingError.code,
            }
          );
        }
      } else {
        console.error(`Hunter: Place trade error for ${symbol} (${tradingError.code}):`, tradingError.message);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastTradingError(
            `Trading Error - ${symbol}`,
            tradingError.message,
            {
              component: 'Hunter',
              symbol,
              errorCode: tradingError.code,
              details: tradingError.details,
            }
          );
        }
      }

      // Broadcast the order failed event (keep for backward compatibility)
      if (this.statusBroadcaster) {
        this.statusBroadcaster.broadcastOrderFailed({
          symbol,
          side,
          reason: tradingError.message,
          details: tradingError.details
        });
      }

      // If limit order fails, try fallback to market order
      if (symbolConfig.orderType !== 'MARKET') {
        // Check if too much time has passed since initial attempt (to avoid timestamp errors)
        const timeSinceStart = Date.now() - tradeStartTime;
        if (timeSinceStart > 15000) {
          console.warn(`Hunter: Skipping fallback order - ${timeSinceStart}ms elapsed, timestamp would be stale`);
          return;
        }

        console.log(`Hunter: Retrying with market order for ${symbol}`);

        // Declare fallback variables for error handling
        let fallbackQuantity: number = 0;
        let fallbackPrice: number = 0;
        let fallbackTempId: string = '';
        let fallbackPositionSide: 'BOTH' | 'LONG' | 'SHORT' = 'BOTH';

        try {
          await setLeverage(symbol, symbolConfig.leverage, this.config.api);

          // Fetch symbol info for precision and filters
          const fallbackSymbolInfo = await getSymbolFilters(symbol);
          if (!fallbackSymbolInfo) {
            console.error(`Hunter: Could not fetch symbol info for fallback order ${symbol}`);
            throw new Error('Symbol info unavailable');
          }

          // Extract minimum notional from filters
          const fallbackMinNotionalFilter = fallbackSymbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL');
          const fallbackMinNotional = fallbackMinNotionalFilter ? parseFloat(fallbackMinNotionalFilter.notional || '5') : 5;

          // Fetch current price for fallback market order
          const markPriceData = await getMarkPrice(symbol);
          const rawFallbackPrice = parseFloat(Array.isArray(markPriceData) ? markPriceData[0].markPrice : markPriceData.markPrice);

          // Always use symbolPrecision formatting (which now has defaults)
          fallbackPrice = symbolPrecision.formatPrice(symbol, rawFallbackPrice);

          // Calculate quantity for fallback order
          let fallbackNotionalUSDT = symbolConfig.tradeSize * symbolConfig.leverage;

          // Ensure we meet minimum notional requirement
          if (fallbackNotionalUSDT < fallbackMinNotional) {
            console.log(`Hunter: Adjusting fallback notional from ${fallbackNotionalUSDT} to minimum ${fallbackMinNotional} for ${symbol}`);
            fallbackNotionalUSDT = fallbackMinNotional * 1.01; // Add 1% buffer
          }

          // Calculate raw quantity
          const rawFallbackQuantity = fallbackNotionalUSDT / fallbackPrice;

          // Always use symbolPrecision formatting (which now has defaults)
          fallbackQuantity = symbolPrecision.formatQuantity(symbol, rawFallbackQuantity);

          console.log(`Hunter: Fallback calculation for ${symbol}: margin=${symbolConfig.tradeSize} USDT, leverage=${symbolConfig.leverage}x, price=${fallbackPrice}, notional=${fallbackNotionalUSDT} USDT, quantity=${fallbackQuantity}`);

          fallbackPositionSide = getPositionSide(this.isHedgeMode, side) as 'BOTH' | 'LONG' | 'SHORT';
          console.log(`Hunter: Using position mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, side: ${side}, positionSide: ${fallbackPositionSide}`);

          // Generate temp tracking for fallback order
          fallbackTempId = `fallback_${Date.now()}_${symbol}_${side}`;
          this.addPendingOrder(fallbackTempId, symbol, side);

          const fallbackOrder = await placeOrder({
            symbol,
            side,
            type: 'MARKET',
            quantity: fallbackQuantity,
            positionSide: fallbackPositionSide,
          }, this.config.api);

          console.log(`Hunter: Fallback market order placed for ${symbol}, orderId: ${fallbackOrder.orderId}`);

          // Replace temp tracking with real order ID
          this.removePendingOrder(fallbackTempId);
          if (fallbackOrder.orderId) {
            this.addPendingOrder(fallbackOrder.orderId.toString(), symbol, side);
          }

          // Broadcast fallback order placed event
          if (this.statusBroadcaster) {
            this.statusBroadcaster.broadcastOrderPlaced({
              symbol,
              side,
              orderType: 'MARKET',
              quantity: fallbackQuantity,
              orderId: fallbackOrder.orderId?.toString(),
            });
          }

          this.emit('positionOpened', {
            symbol,
            side,
            quantity: fallbackQuantity,
            price: entryPrice,
            orderId: fallbackOrder.orderId,
            leverage: symbolConfig.leverage,
            orderType: 'MARKET',
            paperMode: false
          });

        } catch (fallbackError: any) {
          // Remove temp tracking if fallback order also fails
          if (fallbackTempId) {
            this.removePendingOrder(fallbackTempId);
            console.log(`Hunter: Removed fallback temp pending order ${fallbackTempId} after placement failure`);
          }

          // Parse the fallback error with context
          const fallbackTradingError = parseExchangeError(fallbackError, {
            symbol,
            quantity: fallbackQuantity,
            price: fallbackPrice,
            leverage: symbolConfig.leverage,
            positionSide: fallbackPositionSide
          });

          // Log fallback error to database
          await errorLogger.logTradingError(
            `placeTrade-fallback-${side}`,
            symbol,
            fallbackTradingError,
            {
              side,
              quantity: fallbackQuantity,
              price: fallbackPrice,
              leverage: symbolConfig.leverage,
              tradeSizeUSDT,
              errorCode: fallbackTradingError.code,
              errorType: fallbackTradingError.constructor.name,
              isFallbackAttempt: true
            }
          );

          if (fallbackTradingError instanceof NotionalError) {
            const errorMsg = `Required: ${fallbackTradingError.requiredNotional} USDT, Actual: ${fallbackTradingError.actualNotional.toFixed(2)} USDT (fallback attempt)`;
            console.error(`Hunter: CRITICAL NOTIONAL ERROR in fallback for ${symbol}:`);
            console.error(`  Required: ${fallbackTradingError.requiredNotional} USDT`);
            console.error(`  Actual: ${fallbackTradingError.actualNotional.toFixed(2)} USDT`);
            console.error(`  Price: ${fallbackTradingError.price}`);
            console.error(`  Quantity: ${fallbackTradingError.quantity}`);
            console.error(`  Even with adjustments, notional requirement not met!`);
            console.error(`  Check if symbol has special requirements or if price data is stale.`);

              if (this.statusBroadcaster) {
                this.statusBroadcaster.broadcastTradingError(
                  `Critical Notional Error - ${symbol}`,
                  errorMsg,
                  {
                    component: 'Hunter',
                    symbol,
                    errorCode: fallbackTradingError.code,
                    details: { ...fallbackTradingError.details, isFallback: true },
                  }
                );
              }
            } else if (fallbackTradingError instanceof RateLimitError) {
              console.error(`Hunter: RATE LIMIT in fallback - backing off`);

              if (this.statusBroadcaster) {
                this.statusBroadcaster.broadcastApiError(
                  'Rate Limit (Fallback)',
                  'Rate limit hit during fallback order attempt',
                  {
                    component: 'Hunter',
                    symbol,
                    errorCode: fallbackTradingError.code,
                  }
                );
              }
            } else if (fallbackTradingError instanceof InsufficientBalanceError) {
              console.error(`Hunter: INSUFFICIENT BALANCE in fallback for ${symbol}`);

              if (this.statusBroadcaster) {
                this.statusBroadcaster.broadcastTradingError(
                  `Insufficient Balance (Fallback) - ${symbol}`,
                  'Insufficient balance for fallback market order',
                  {
                    component: 'Hunter',
                    symbol,
                    errorCode: fallbackTradingError.code,
                  }
                );
              }
            } else {
              console.error(`Hunter: Fallback order failed for ${symbol} (${fallbackTradingError.code}):`, fallbackTradingError.message);

              if (this.statusBroadcaster) {
                this.statusBroadcaster.broadcastTradingError(
                  `Fallback Order Failed - ${symbol}`,
                  fallbackTradingError.message,
                  {
                    component: 'Hunter',
                    symbol,
                    errorCode: fallbackTradingError.code,
                    details: fallbackTradingError.details,
                  }
                );
              }
            }

            // Broadcast fallback order failed event
            if (this.statusBroadcaster) {
              this.statusBroadcaster.broadcastOrderFailed({
                symbol,
                side,
                reason: fallbackTradingError.message,
                details: fallbackTradingError.details,
              });
            }
          }
        }
      }
    }

  private simulateLiquidations(): void {
    // Simulate liquidation events for paper mode testing
    const symbols = Object.keys(this.config.symbols);
    if (symbols.length === 0) {
      console.log('Hunter: No symbols configured for simulation');
      return;
    }

    // Generate random liquidation events every 5-10 seconds
    const generateEvent = () => {
      if (!this.isRunning) return;

      const symbol = symbols[Math.floor(Math.random() * symbols.length)];
      const side = Math.random() > 0.5 ? 'SELL' : 'BUY';
      const price = symbol === 'BTCUSDT' ? 40000 + Math.random() * 5000 : 2000 + Math.random() * 500;
      const qty = Math.random() * 10;

      const mockEvent = {
        o: {
          s: symbol,
          S: side,
          p: price.toString(),
          q: qty.toString(),
          T: Date.now()
        }
      };

      console.log(`Hunter: Simulated liquidation - ${symbol} ${side} ${qty.toFixed(4)} @ $${price.toFixed(2)}`);
      this.handleLiquidationEvent(mockEvent);

      // Schedule next event
      const delay = 5000 + Math.random() * 5000; // 5-10 seconds
      setTimeout(generateEvent, delay);
    };

    // Start generating events after 2 seconds
    setTimeout(generateEvent, 2000);
  }
}
