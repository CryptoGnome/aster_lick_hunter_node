import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { Config, LiquidationEvent, SymbolConfig } from '../types';
import { getMarkPrice, getExchangeInfo } from '../api/market';
import { placeOrder, setLeverage } from '../api/orders';
import { calculateOptimalPrice, validateOrderParams, analyzeOrderBookDepth, getSymbolFilters } from '../api/pricing';
import { getPositionSide } from '../api/positionMode';
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
  QuantityPrecisionError
} from '../errors/TradingErrors';
import { errorLogger } from '../services/errorLogger';

export class Hunter extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Config;
  private isRunning = false;
  private statusBroadcaster: any; // Will be injected
  private isHedgeMode: boolean;
  private positionTracker: PositionTracker | null = null;
  private lastTradeTimestamps: Map<string, { long: number; short: number }> = new Map(); // Track last trade per symbol/side

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

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

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

    // Process liquidation through threshold monitor
    const thresholdStatus = thresholdMonitor.processLiquidation(liquidation);

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

    // Check if cumulative liquidations in 60-second window meet threshold
    if (thresholdStatus) {
      // SELL liquidation means longs are getting liquidated, we might want to BUY
      // BUY liquidation means shorts are getting liquidated, we might want to SELL
      const isLongOpportunity = liquidation.side === 'SELL';
      const isShortOpportunity = liquidation.side === 'BUY';

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
        const cooldownPeriod = 120000; // 2 minutes cooldown
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
    }
  }

  private async analyzeAndTrade(liquidation: LiquidationEvent, symbolConfig: SymbolConfig, forcedSide?: 'BUY' | 'SELL'): Promise<void> {
    try {
      // Get mark price and recent 1m kline
      const [markPriceData] = Array.isArray(await getMarkPrice(liquidation.symbol)) ?
        await getMarkPrice(liquidation.symbol) as any[] :
        [await getMarkPrice(liquidation.symbol)];

      const markPrice = parseFloat(markPriceData.markPrice);

      // Determine trade direction based on forced side or original logic
      const priceRatio = liquidation.price / markPrice;
      let triggerBuy = false;
      let triggerSell = false;

      if (forcedSide) {
        // Use forced side from cumulative threshold logic
        triggerBuy = forcedSide === 'BUY';
        triggerSell = forcedSide === 'SELL';
        console.log(`Hunter: Using forced side ${forcedSide} from cumulative threshold trigger`);
      } else {
        // Fallback to original price-based logic (should rarely be used now)
        triggerBuy = liquidation.side === 'SELL' && priceRatio < 1.01; // 1% below
        triggerSell = liquidation.side === 'BUY' && priceRatio > 0.99;  // 1% above
        console.log(`Hunter: Using original price-based logic - triggerBuy: ${triggerBuy}, triggerSell: ${triggerSell}`);
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

        // Emit trade opportunity
        this.emit('tradeOpportunity', {
          symbol: liquidation.symbol,
          side: 'BUY',
          reason: `SELL liquidation at ${((1 - priceRatio) * 100).toFixed(2)}% below mark price`,
          liquidationVolume: volumeUSDT,
          priceImpact: (1 - priceRatio) * 100,
          confidence: Math.min(95, 50 + (volumeUSDT / 1000) * 10) // Higher confidence for larger volumes
        });

        console.log(`Hunter: Triggering BUY for ${liquidation.symbol} at ${liquidation.price}`);
        await this.placeTrade(liquidation.symbol, 'BUY', symbolConfig, liquidation.price);
      } else if (triggerSell) {
        const volumeUSDT = liquidation.qty * liquidation.price;

        // Emit trade opportunity
        this.emit('tradeOpportunity', {
          symbol: liquidation.symbol,
          side: 'SELL',
          reason: `BUY liquidation at ${((priceRatio - 1) * 100).toFixed(2)}% above mark price`,
          liquidationVolume: volumeUSDT,
          priceImpact: (priceRatio - 1) * 100,
          confidence: Math.min(95, 50 + (volumeUSDT / 1000) * 10)
        });

        console.log(`Hunter: Triggering SELL for ${liquidation.symbol} at ${liquidation.price}`);
        await this.placeTrade(liquidation.symbol, 'SELL', symbolConfig, liquidation.price);
      }
    } catch (error) {
      console.error('Hunter: Analysis error:', error);
    }
  }

  private async placeTrade(symbol: string, side: 'BUY' | 'SELL', symbolConfig: SymbolConfig, entryPrice: number): Promise<void> {
    // Declare variables that will be used in error handling
    let currentPrice: number = entryPrice;
    let quantity: number = 0;
    let notionalUSDT: number = 0;
    let tradeSizeUSDT: number = symbolConfig.tradeSize; // Default to general tradeSize

    try {
      // Check position limits before placing trade
      if (this.positionTracker && !this.config.global.paperMode) {
        // Check global max positions limit
        const maxPositions = this.config.global.maxOpenPositions || 10;
        const currentPositionCount = this.positionTracker.getUniquePositionCount(this.isHedgeMode);

        if (currentPositionCount >= maxPositions) {
          console.log(`Hunter: Skipping trade - max positions reached (${currentPositionCount}/${maxPositions})`);
          return;
        }

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

      // Format quantity according to symbol's step size
      quantity = symbolPrecision.hasSymbol(symbol)
        ? symbolPrecision.formatQuantity(symbol, calculatedQuantity)
        : parseFloat(calculatedQuantity.toFixed(symbolInfo.quantityPrecision || 8));

      // Validate order parameters
      if (orderType === 'LIMIT') {
        // Format price according to symbol's tick size before validation
        orderPrice = symbolPrecision.hasSymbol(symbol)
          ? symbolPrecision.formatPrice(symbol, orderPrice)
          : orderPrice;

        const validation = await validateOrderParams(symbol, side, orderPrice, quantity);
        if (!validation.valid) {
          console.error(`Hunter: Order validation failed for ${symbol}: ${validation.error}`);
          return;
        }

        // Use adjusted values if provided
        if (validation.adjustedPrice) orderPrice = validation.adjustedPrice;
        if (validation.adjustedQuantity) quantity = validation.adjustedQuantity;
      }

      // Set leverage if needed
      await setLeverage(symbol, symbolConfig.leverage, this.config.api);

      console.log(`Hunter: Calculated quantity for ${symbol}: margin=${tradeSizeUSDT} USDT (${side === 'BUY' ? 'long' : 'short'}), leverage=${symbolConfig.leverage}x, price=${currentPrice}, notional=${notionalUSDT} USDT, quantity=${quantity}`);

      // Prepare order parameters
      const positionSide = getPositionSide(this.isHedgeMode, side);
      console.log(`Hunter: Using position mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, side: ${side}, positionSide: ${positionSide}`);

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

      // Place the order
      const order = await placeOrder(orderParams, this.config.api);

      const displayPrice = orderType === 'LIMIT' ? ` at ${orderPrice}` : '';
      console.log(`Hunter: Placed ${orderType} ${side} order for ${symbol}${displayPrice}, orderId: ${order.orderId}`);

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

    } catch (error: any) {
      // Parse the error with context
      const tradingError = parseExchangeError(error, {
        symbol,
        quantity,
        price: currentPrice,
        leverage: symbolConfig.leverage
      });

      // Log to error database
      await errorLogger.logTradingError(
        `placeTrade-${side}`,
        symbol,
        tradingError,
        {
          side,
          quantity,
          price: currentPrice,
          leverage: symbolConfig.leverage,
          tradeSizeUSDT,
          notionalUSDT,
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
        console.log(`Hunter: Retrying with market order for ${symbol}`);

        // Declare fallback variables for error handling
        let fallbackQuantity: number = 0;
        let fallbackPrice: number = 0;

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

          // Format price according to symbol's tick size
          fallbackPrice = symbolPrecision.hasSymbol(symbol)
            ? symbolPrecision.formatPrice(symbol, rawFallbackPrice)
            : rawFallbackPrice;

          // Calculate quantity for fallback order
          let fallbackNotionalUSDT = symbolConfig.tradeSize * symbolConfig.leverage;

          // Ensure we meet minimum notional requirement
          if (fallbackNotionalUSDT < fallbackMinNotional) {
            console.log(`Hunter: Adjusting fallback notional from ${fallbackNotionalUSDT} to minimum ${fallbackMinNotional} for ${symbol}`);
            fallbackNotionalUSDT = fallbackMinNotional * 1.01; // Add 1% buffer
          }

          // Calculate raw quantity
          const rawFallbackQuantity = fallbackNotionalUSDT / fallbackPrice;

          // Format quantity according to symbol's step size
          fallbackQuantity = symbolPrecision.hasSymbol(symbol)
            ? symbolPrecision.formatQuantity(symbol, rawFallbackQuantity)
            : parseFloat(rawFallbackQuantity.toFixed(fallbackSymbolInfo.quantityPrecision || 8));

          console.log(`Hunter: Fallback calculation for ${symbol}: margin=${symbolConfig.tradeSize} USDT, leverage=${symbolConfig.leverage}x, price=${fallbackPrice}, notional=${fallbackNotionalUSDT} USDT, quantity=${fallbackQuantity}`);

          const fallbackPositionSide = getPositionSide(this.isHedgeMode, side) as 'BOTH' | 'LONG' | 'SHORT';
          console.log(`Hunter: Using position mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, side: ${side}, positionSide: ${fallbackPositionSide}`);

          const fallbackOrder = await placeOrder({
            symbol,
            side,
            type: 'MARKET',
            quantity: fallbackQuantity,
            positionSide: fallbackPositionSide,
          }, this.config.api);

          console.log(`Hunter: Fallback market order placed for ${symbol}, orderId: ${fallbackOrder.orderId}`);

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
          // Parse the fallback error with context
          const fallbackTradingError = parseExchangeError(fallbackError, {
            symbol,
            quantity: fallbackQuantity,
            price: fallbackPrice,
            leverage: symbolConfig.leverage
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
