import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { Config, LiquidationEvent, SymbolConfig } from '../types';
import { getMarkPrice, getExchangeInfo, getAccountInfo } from '../api/market';
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
import { logWithTimestamp, logErrorWithTimestamp, logWarnWithTimestamp } from '../utils/timestamp';

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
  private wsKeepAliveInterval: NodeJS.Timeout | null = null; // WebSocket keepalive ping timer
  private wsInactivityTimeout: NodeJS.Timeout | null = null; // WebSocket inactivity detector
  private lastLiquidationTime: number = Date.now(); // Track last liquidation received
  private statusLogInterval: NodeJS.Timeout | null = null; // Periodic status logging
  private shouldReconnect: boolean = true; // Flag to control automatic reconnection
  private reconnectTimeout: NodeJS.Timeout | null = null; // Track scheduled reconnection

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
logWithTimestamp(`Hunter: Paper mode changed to ${newConfig.global.paperMode}`);

      // If switching from paper mode to live mode, restart WebSocket connection
      if (oldConfig.global.paperMode && !newConfig.global.paperMode && newConfig.api.apiKey) {
logWithTimestamp('Hunter: Switching from paper mode to live mode');
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        if (this.isRunning) {
          this.connectWebSocket();
        }
      }
      // If switching from live mode to paper mode, keep WebSocket connection
      // Paper mode uses real liquidations, only simulates order execution
      else if (!oldConfig.global.paperMode && newConfig.global.paperMode) {
logWithTimestamp('Hunter: Switching to paper mode - continuing to monitor real liquidations');
        // Keep WebSocket connected to receive real liquidation data
      }
    }

    // Log symbol changes
    const oldSymbols = Object.keys(oldConfig.symbols);
    const newSymbols = Object.keys(newConfig.symbols);
    const addedSymbols = newSymbols.filter(s => !oldSymbols.includes(s));
    const removedSymbols = oldSymbols.filter(s => !newSymbols.includes(s));

    if (addedSymbols.length > 0) {
logWithTimestamp(`Hunter: Added symbols: ${addedSymbols.join(', ')}`);
    }
    if (removedSymbols.length > 0) {
logWithTimestamp(`Hunter: Removed symbols: ${removedSymbols.join(', ')}`);
    }

    // Check for threshold changes
    for (const symbol of newSymbols) {
      if (oldConfig.symbols[symbol]) {
        const oldSym = oldConfig.symbols[symbol];
        const newSym = newConfig.symbols[symbol];

        if (oldSym.longVolumeThresholdUSDT !== newSym.longVolumeThresholdUSDT ||
            oldSym.shortVolumeThresholdUSDT !== newSym.shortVolumeThresholdUSDT) {
logWithTimestamp(`Hunter: ${symbol} volume thresholds updated`);
        }

        // Log threshold system configuration changes
        if (oldSym.useThreshold !== newSym.useThreshold) {
logWithTimestamp(`Hunter: ${symbol} threshold system ${newSym.useThreshold ? 'ENABLED' : 'DISABLED'}`);
        }

        if (oldSym.thresholdCooldown !== newSym.thresholdCooldown) {
          const oldCooldownSec = (oldSym.thresholdCooldown || 30000) / 1000;
          const newCooldownSec = (newSym.thresholdCooldown || 30000) / 1000;
logWithTimestamp(`Hunter: ${symbol} threshold cooldown updated: ${oldCooldownSec}s → ${newCooldownSec}s`);
        }

        if (oldSym.thresholdTimeWindow !== newSym.thresholdTimeWindow) {
          const oldWindowSec = (oldSym.thresholdTimeWindow || 60000) / 1000;
          const newWindowSec = (newSym.thresholdTimeWindow || 60000) / 1000;
logWithTimestamp(`Hunter: ${symbol} threshold time window updated: ${oldWindowSec}s → ${newWindowSec}s`);
        }
      }
    }
  }

  // Helper methods for pending order management
  private addPendingOrder(orderId: string, symbol: string, side: 'BUY' | 'SELL'): void {
    this.pendingOrders.set(orderId, { symbol, side, timestamp: Date.now() });
logWithTimestamp(`Hunter: Added pending order ${orderId} for ${symbol} ${side}. Total pending: ${this.pendingOrders.size}`);
    this.debugPendingOrders();
  }

  private removePendingOrder(orderId: string): void {
    if (this.pendingOrders.delete(orderId)) {
logWithTimestamp(`Hunter: Removed pending order ${orderId}. Total pending: ${this.pendingOrders.size}`);
      this.debugPendingOrders();
    }
  }

  // Debug method to display current pending order state
  private debugPendingOrders(): void {
    if (this.pendingOrders.size === 0) {
logWithTimestamp('Hunter: [DEBUG] No pending orders');
    } else {
      const orderList = Array.from(this.pendingOrders.entries()).map(([id, info]) => {
        const age = Math.round((Date.now() - info.timestamp) / 1000);
        return `  - ${id.substring(0, 20)}... -> ${info.symbol} ${info.side} (${age}s old)`;
      });
logWithTimestamp(`Hunter: [DEBUG] Current pending orders (${this.pendingOrders.size}):\n${orderList.join('\n')}`);
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
logWithTimestamp(`Hunter: Cleaning stale pending order ${orderId} for ${order.symbol} (age: ${Math.round((Date.now() - order.timestamp) / 1000)}s)`);
        this.pendingOrders.delete(orderId);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
logWithTimestamp(`Hunter: Cleaned ${cleanedCount} stale pending orders. Remaining: ${this.pendingOrders.size}`);
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

logWithTimestamp('Hunter: Started periodic cleanup of stale pending orders (every 30s)');
  }

  // Stop periodic cleanup
  private stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
logWithTimestamp('Hunter: Stopped periodic cleanup of stale pending orders');
    }
  }

  // Synchronize position mode with the exchange
  public async syncPositionMode(): Promise<void> {
    if (!this.config.api.apiKey || !this.config.api.secretKey) {
logWithTimestamp('Hunter: Skipping position mode sync - no API keys configured');
      return;
    }

    try {
      const actualMode = await getPositionMode(this.config.api);
      if (actualMode !== this.isHedgeMode) {
logWithTimestamp(`Hunter: Position mode mismatch detected. Local: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, Exchange: ${actualMode ? 'HEDGE' : 'ONE-WAY'}`);
        this.isHedgeMode = actualMode;
logWithTimestamp(`Hunter: Position mode synchronized to: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'} mode`);
      }
      this.lastModeSync = Date.now(); // Update sync time
    } catch (error) {
logErrorWithTimestamp('Hunter: Failed to sync position mode with exchange:', error);
      // Keep current mode on error
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Log threshold system configuration on startup
    if (this.config.global.useThresholdSystem) {
logWithTimestamp('Hunter: Global threshold system ENABLED');
      Object.entries(this.config.symbols).forEach(([symbol, config]) => {
        if (config.useThreshold) {
          const cooldownSec = (config.thresholdCooldown || 30000) / 1000;
          const windowSec = (config.thresholdTimeWindow || 60000) / 1000;
logWithTimestamp(`Hunter: ${symbol} - Threshold system active (cooldown: ${cooldownSec}s, window: ${windowSec}s)`);
        }
      });
    } else {
logWithTimestamp('Hunter: Global threshold system DISABLED - using instant triggers');
    }

    // Sync position mode on startup
    await this.syncPositionMode();

    // Start periodic cleanup of stale pending orders (every 30 seconds)
    this.startPeriodicCleanup();

    // Start periodic position mode sync (every 2 minutes instead of 5)
    this.syncInterval = setInterval(() => {
      this.syncPositionMode().catch(err =>
logErrorWithTimestamp('Hunter: Failed to sync position mode during periodic check:', err)
      );
    }, 2 * 60 * 1000);

    // Initialize symbol precision manager with exchange info
    try {
      const exchangeInfo = await getExchangeInfo();
      symbolPrecision.parseExchangeInfo(exchangeInfo);
logWithTimestamp('Hunter: Symbol precision manager initialized');
    } catch (error) {
logErrorWithTimestamp('Hunter: Failed to initialize symbol precision manager:', error);
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

    // Always connect to real liquidation WebSocket feed
    // Paper mode only affects order execution, not the liquidation data source
    this.connectWebSocket();
  }

  stop(): void {
    this.isRunning = false;
    this.shouldReconnect = false; // Disable auto-reconnect on shutdown

    // Cancel any scheduled reconnections
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Stop periodic cleanup
    this.stopPeriodicCleanup();

    // Stop periodic sync
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logWithTimestamp('Hunter: Stopped periodic position mode sync');
    }

    // Clean up WebSocket keepalive and inactivity timers
    this.cleanupWebSocketTimers();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Remove all event listeners to prevent memory leaks and duplicate event handlers
    this.removeAllListeners();
  }

  private connectWebSocket(): void {
    // Cancel any pending reconnection attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Clean up any existing keepalive/inactivity timers
    if (this.wsKeepAliveInterval) {
      clearInterval(this.wsKeepAliveInterval);
      this.wsKeepAliveInterval = null;
    }
    if (this.wsInactivityTimeout) {
      clearTimeout(this.wsInactivityTimeout);
      this.wsInactivityTimeout = null;
    }
    if (this.statusLogInterval) {
      clearInterval(this.statusLogInterval);
      this.statusLogInterval = null;
    }

    // CRITICAL: Close and remove all listeners from old WebSocket before creating new one
    // This prevents duplicate event handlers from accumulating
    if (this.ws) {
      try {
        // Temporarily disable auto-reconnect to prevent close event from triggering reconnection
        const wasAutoReconnectEnabled = this.shouldReconnect;
        this.shouldReconnect = false;
        
        this.ws.removeAllListeners();
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
        
        // Restore auto-reconnect flag
        this.shouldReconnect = wasAutoReconnectEnabled;
      } catch (error) {
        logErrorWithTimestamp('Hunter: Error closing old WebSocket:', error);
      }
      this.ws = null;
    }

    this.ws = new WebSocket('wss://fstream.asterdex.com/ws/!forceOrder@arr');

    this.ws.on('open', () => {
      logWithTimestamp('Hunter WS connected');
      this.lastLiquidationTime = Date.now();
      
      // Start ping/pong keepalive - send ping every 30 seconds
      this.wsKeepAliveInterval = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 30000);
      
      // Start inactivity monitor - reconnect if no liquidations for 5 minutes
      this.startInactivityMonitor();
      
      // Start periodic status logging - every 2 minutes
      this.statusLogInterval = setInterval(() => {
        const timeSinceLastLiq = Date.now() - this.lastLiquidationTime;
        const minutesInactive = Math.floor(timeSinceLastLiq / 60000);
        const secondsInactive = Math.floor((timeSinceLastLiq % 60000) / 1000);
        
        if (minutesInactive >= 1) {
          logWithTimestamp(`📊 Hunter: Monitoring | Last liquidation: ${minutesInactive}m ${secondsInactive}s ago`);
        } else {
          logWithTimestamp(`📊 Hunter: Monitoring | Last liquidation: ${secondsInactive}s ago`);
        }
      }, 120000); // Every 2 minutes
    });

    this.ws.on('ping', () => {
      // Server sent ping, respond with pong (ws library handles this automatically)
    });

    this.ws.on('pong', () => {
      // Received pong response from server - connection is alive
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString());
        
        // Update last liquidation time for any valid message
        this.lastLiquidationTime = Date.now();
        this.startInactivityMonitor(); // Reset inactivity timer
        
        this.handleLiquidationEvent(event);
      } catch (error) {
        logErrorWithTimestamp('Hunter: WS message parse error:', error);
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
      logErrorWithTimestamp('Hunter WS error:', error);
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
      // Clean up timers before reconnecting
      this.cleanupWebSocketTimers();
      // Reconnect after delay (only if auto-reconnect is enabled)
      if (this.shouldReconnect && this.isRunning) {
        this.reconnectTimeout = setTimeout(() => this.connectWebSocket(), 5000);
      }
    });

    this.ws.on('close', () => {
      logWithTimestamp('Hunter WS closed');
      // Clean up timers
      this.cleanupWebSocketTimers();
      
      // Only reconnect if auto-reconnect is enabled and bot is running
      // This prevents reconnection loops during manual disconnects
      if (this.shouldReconnect && this.isRunning) {
        this.reconnectTimeout = setTimeout(() => this.connectWebSocket(), 5000);
      }
    });
  }

  private startInactivityMonitor(): void {
    // Clear any existing inactivity timeout
    if (this.wsInactivityTimeout) {
      clearTimeout(this.wsInactivityTimeout);
    }
    
    // Set up new inactivity timeout - 5 minutes without liquidations
    this.wsInactivityTimeout = setTimeout(() => {
      const timeSinceLastLiq = Date.now() - this.lastLiquidationTime;
      const minutesInactive = Math.floor(timeSinceLastLiq / 60000);
      
      logWarnWithTimestamp(`⚠️ Hunter: No liquidations for ${minutesInactive} minutes. Reconnecting stream...`);
      
      // Force reconnection (this is intentional, so we allow it)
      if (this.ws) {
        // Temporarily disable auto-reconnect to prevent close handler from double-reconnecting
        this.shouldReconnect = false;
        this.ws.close();
        this.ws = null;
        this.shouldReconnect = true;
      }
      this.connectWebSocket();
    }, 5 * 60 * 1000); // 5 minutes
  }

  private cleanupWebSocketTimers(): void {
    if (this.wsKeepAliveInterval) {
      clearInterval(this.wsKeepAliveInterval);
      this.wsKeepAliveInterval = null;
    }
    if (this.wsInactivityTimeout) {
      clearTimeout(this.wsInactivityTimeout);
      this.wsInactivityTimeout = null;
    }
    if (this.statusLogInterval) {
      clearInterval(this.statusLogInterval);
      this.statusLogInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private async handleLiquidationEvent(event: any): Promise<void> {
    if (event.e !== 'forceOrder') return; // Not a liquidation event
    
    console.log(`[Hunter] handleLiquidationEvent START: ${event.o.s} @ ${Date.now()}`);

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

    // Log liquidation received with basic info
    const volumeUSDT = liquidation.qty * liquidation.price;
    logWithTimestamp(`💥 Liquidation: ${liquidation.symbol} ${liquidation.side} ${liquidation.qty.toFixed(4)} @ $${liquidation.price.toLocaleString()} ($${volumeUSDT.toFixed(2)})`);

    // Check if threshold system is enabled globally and for this symbol
    const useThresholdSystem = this.config.global.useThresholdSystem === true &&
                              this.config.symbols[liquidation.symbol]?.useThreshold === true;

    // Process liquidation through threshold monitor only if enabled
    const thresholdStatus = useThresholdSystem ? thresholdMonitor.processLiquidation(liquidation) : null;

    // Emit liquidation event to WebSocket clients (all liquidations) with threshold info
    console.log(`[Hunter] About to emit liquidationDetected for ${liquidation.symbol}`);
    this.emit('liquidationDetected', {
      ...liquidation,
      thresholdStatus
    });
    console.log(`[Hunter] Finished emitting liquidationDetected for ${liquidation.symbol}`);

    const symbolConfig = this.config.symbols[liquidation.symbol];
    if (!symbolConfig) return; // Symbol not in config

    // Store liquidation in database (non-blocking)
    liquidationStorage.saveLiquidation(liquidation, volumeUSDT).catch(error => {
logErrorWithTimestamp('Hunter: Failed to store liquidation:', error);
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
      // NEW THRESHOLD SYSTEM - Cumulative volume in 60-second window
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
          logWithTimestamp(`Hunter: LONG threshold met - ${liquidation.symbol} cumulative SELL liquidations: ${thresholdStatus.recentLongVolume.toFixed(2)} USDT >= ${thresholdStatus.longThreshold} USDT (60s window)`);
        }
      } else if (isShortOpportunity && thresholdStatus.shortThreshold > 0) {
        // Check if cumulative BUY liquidations in 60s meet short threshold
        if (thresholdStatus.recentShortVolume >= thresholdStatus.shortThreshold) {
          shouldTrade = true;
          tradeSide = 'SELL'; // Sell when shorts are getting liquidated
          logWithTimestamp(`Hunter: SHORT threshold met - ${liquidation.symbol} cumulative BUY liquidations: ${thresholdStatus.recentShortVolume.toFixed(2)} USDT >= ${thresholdStatus.shortThreshold} USDT (60s window)`);
        }
      }

      if (shouldTrade && tradeSide) {
        // Check cooldown to prevent multiple trades from same window
        const now = Date.now();
        const cooldownPeriod = symbolConfig.thresholdCooldown || 30000; // Use symbol-specific cooldown or default 30s
        const symbolTrades = this.lastTradeTimestamps.get(liquidation.symbol) || { long: 0, short: 0 };

        const lastTradeTime = tradeSide === 'BUY' ? symbolTrades.long : symbolTrades.short;
        const timeSinceLastTrade = now - lastTradeTime;

        // Enhanced logging for cooldown configuration
logWithTimestamp(`Hunter: Cooldown check for ${liquidation.symbol} ${tradeSide} - configured: ${cooldownPeriod}ms (${(cooldownPeriod / 1000).toFixed(0)}s), time since last trade: ${(timeSinceLastTrade / 1000).toFixed(1)}s`);

        if (timeSinceLastTrade < cooldownPeriod) {
          const remainingCooldown = Math.ceil((cooldownPeriod - timeSinceLastTrade) / 1000);
logWithTimestamp(`Hunter: ${tradeSide} trade cooldown active for ${liquidation.symbol} - ${remainingCooldown}s remaining (cooldown period: ${(cooldownPeriod / 1000).toFixed(0)}s)`);
          return;
        }

logWithTimestamp(`Hunter: ✓ Cooldown passed - Triggering ${tradeSide} trade for ${liquidation.symbol} based on 60s cumulative volume (cooldown: ${(cooldownPeriod / 1000).toFixed(0)}s)`);

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
      // ORIGINAL INSTANT TRIGGER SYSTEM
      // Check direction-specific volume thresholds
      // SELL liquidation means longs are getting liquidated, we might want to BUY
      // BUY liquidation means shorts are getting liquidated, we might want to SELL
      const thresholdToCheck = liquidation.side === 'SELL'
        ? (symbolConfig.longVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 0)
        : (symbolConfig.shortVolumeThresholdUSDT ?? symbolConfig.volumeThresholdUSDT ?? 0);

      if (volumeUSDT < thresholdToCheck) return; // Too small

      logWithTimestamp(`Hunter: Liquidation detected - ${liquidation.symbol} ${liquidation.side} ${volumeUSDT.toFixed(2)} USDT`);

      // Check cooldown for instant trigger system (apply same cooldown logic as threshold system)
      const tradeSide = liquidation.side === 'SELL' ? 'BUY' : 'SELL';
      const now = Date.now();
      const cooldownPeriod = symbolConfig.thresholdCooldown || 30000; // Use same cooldown setting
      const symbolTrades = this.lastTradeTimestamps.get(liquidation.symbol) || { long: 0, short: 0 };

      const lastTradeTime = tradeSide === 'BUY' ? symbolTrades.long : symbolTrades.short;
      const timeSinceLastTrade = now - lastTradeTime;

      // Enhanced logging for cooldown configuration
logWithTimestamp(`Hunter: Cooldown check for ${liquidation.symbol} ${tradeSide} (instant trigger) - configured: ${cooldownPeriod}ms (${(cooldownPeriod / 1000).toFixed(0)}s), time since last trade: ${(timeSinceLastTrade / 1000).toFixed(1)}s`);

      if (timeSinceLastTrade < cooldownPeriod) {
        const remainingCooldown = Math.ceil((cooldownPeriod - timeSinceLastTrade) / 1000);
logWithTimestamp(`Hunter: ${tradeSide} trade cooldown active for ${liquidation.symbol} - ${remainingCooldown}s remaining (cooldown period: ${(cooldownPeriod / 1000).toFixed(0)}s)`);
        return;
      }

logWithTimestamp(`Hunter: ✓ Cooldown passed - Triggering ${tradeSide} trade for ${liquidation.symbol} (instant trigger, cooldown: ${(cooldownPeriod / 1000).toFixed(0)}s)`);

      // Update last trade timestamp
      if (tradeSide === 'BUY') {
        symbolTrades.long = now;
      } else {
        symbolTrades.short = now;
      }
      this.lastTradeTimestamps.set(liquidation.symbol, symbolTrades);

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

      // Simple analysis: If SELL liquidation and price is > 0.99 * mark, buy
      // If BUY liquidation, sell
      const priceRatio = liquidation.price / markPrice;
      const triggerBuy = liquidation.side === 'SELL' && priceRatio < 1.01; // 1% below
      const triggerSell = liquidation.side === 'BUY' && priceRatio > 0.99;  // 1% above

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
logWithTimestamp(`Hunter: VWAP Protection - ${vwapCheck.reason}`);

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
logWithTimestamp(`Hunter: VWAP Check Passed - Price $${liquidation.price.toFixed(2)} below VWAP $${vwapCheck.vwap.toFixed(2)}`);
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
logWithTimestamp(`Hunter: VWAP Protection - ${vwapCheck.reason}`);

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
logWithTimestamp(`Hunter: VWAP Check Passed - Price $${liquidation.price.toFixed(2)} above VWAP $${vwapCheck.vwap.toFixed(2)}`);
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

        logWithTimestamp(`Hunter: Triggering BUY for ${liquidation.symbol} at ${liquidation.price}`);
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

        logWithTimestamp(`Hunter: Triggering SELL for ${liquidation.symbol} at ${liquidation.price}`);
        await this.placeTrade(liquidation.symbol, 'SELL', symbolConfig, liquidation.price);
      }
    } catch (error) {
logErrorWithTimestamp('Hunter: Analysis error:', error);
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
logWithTimestamp(`Hunter: Skipping trade - already have pending order for ${symbol}`);
          return;
        }

        // Check global max positions limit (including pending orders)
        const maxPositions = this.config.global.maxOpenPositions || 10;
        const currentPositionCount = this.positionTracker.getUniquePositionCount(this.isHedgeMode);
        const pendingOrderCount = this.getPendingOrderCount();
        const totalPositions = currentPositionCount + pendingOrderCount;

        if (totalPositions >= maxPositions) {
logWithTimestamp(`Hunter: Skipping trade - max positions reached (current: ${currentPositionCount}, pending: ${pendingOrderCount}, max: ${maxPositions})`);
          return;
        }

        // Note: Periodic cleanup now happens automatically every 30 seconds

        // Check symbol-specific margin limit
        if (symbolConfig.maxPositionMarginUSDT) {
          const currentMargin = this.positionTracker.getMarginUsage(symbol);
          const newTradeMargin = symbolConfig.tradeSize;
          const totalMargin = currentMargin + newTradeMargin;

          // Enhanced logging to debug margin issues
logWithTimestamp(`Hunter: Margin check for ${symbol} - Current: ${currentMargin.toFixed(2)} USDT, New trade: ${newTradeMargin} USDT, Total: ${totalMargin.toFixed(2)} USDT, Max allowed: ${symbolConfig.maxPositionMarginUSDT} USDT`);

          if (totalMargin > symbolConfig.maxPositionMarginUSDT) {
logWithTimestamp(`Hunter: Skipping trade - would exceed max margin for ${symbol} (${totalMargin.toFixed(2)}/${symbolConfig.maxPositionMarginUSDT} USDT)`);
            return;
          }
        }

        // Check available margin from exchange to prevent insufficient balance errors
        try {
          const accountInfo = await getAccountInfo(this.config.api);
          const totalBalance = parseFloat(accountInfo.totalWalletBalance || '0');
          const availableBalance = parseFloat(accountInfo.availableBalance || '0');
          const usedMargin = totalBalance - availableBalance;

          // Use direction-specific trade size if available
          const requiredMargin = side === 'BUY'
            ? (symbolConfig.longTradeSize ?? symbolConfig.tradeSize)
            : (symbolConfig.shortTradeSize ?? symbolConfig.tradeSize);

logWithTimestamp(`Hunter: Available margin check for ${symbol}`);
logWithTimestamp(`  Total balance: ${totalBalance.toFixed(2)} USDT`);
logWithTimestamp(`  Used margin: ${usedMargin.toFixed(2)} USDT`);
logWithTimestamp(`  Available: ${availableBalance.toFixed(2)} USDT`);
logWithTimestamp(`  Required for this trade: ${requiredMargin.toFixed(2)} USDT`);

          if (availableBalance < requiredMargin) {
            const deficit = requiredMargin - availableBalance;
logWarnWithTimestamp(`Hunter: INSUFFICIENT AVAILABLE MARGIN for ${symbol}`);
logWarnWithTimestamp(`  Available: ${availableBalance.toFixed(2)} USDT`);
logWarnWithTimestamp(`  Required: ${requiredMargin.toFixed(2)} USDT`);
logWarnWithTimestamp(`  Deficit: ${deficit.toFixed(2)} USDT`);
logWarnWithTimestamp(`  Reason: ${usedMargin.toFixed(2)} USDT is locked in ${currentPositionCount} existing positions`);

            // Broadcast detailed error to UI
            if (this.statusBroadcaster) {
              this.statusBroadcaster.broadcastTradingError(
                `Insufficient Available Margin - ${symbol}`,
                `Cannot open new position: ${availableBalance.toFixed(2)} USDT available, ${requiredMargin.toFixed(2)} USDT required`,
                {
                  component: 'Hunter',
                  symbol,
                  details: {
                    totalBalance: totalBalance.toFixed(2),
                    usedMargin: usedMargin.toFixed(2),
                    availableBalance: availableBalance.toFixed(2),
                    requiredMargin: requiredMargin.toFixed(2),
                    deficit: deficit.toFixed(2),
                    currentPositions: currentPositionCount,
                    suggestion: usedMargin > 0
                      ? `${usedMargin.toFixed(2)} USDT is locked in ${currentPositionCount} open positions. Wait for positions to close or reduce trade sizes.`
                      : 'Add more funds to your account or reduce trade sizes.'
                  }
                }
              );
            }

            return; // Block the trade
          }

logWithTimestamp(`Hunter: ✓ Available margin check passed - ${availableBalance.toFixed(2)} USDT available, ${requiredMargin.toFixed(2)} USDT required`);
        } catch (marginCheckError) {
logWarnWithTimestamp(`Hunter: Failed to check available margin for ${symbol}:`, marginCheckError);
logWarnWithTimestamp(`Hunter: Proceeding with trade anyway - exchange will reject if insufficient balance`);
          // Don't block the trade on margin check failure - let the exchange handle it
        }
      }

      if (this.config.global.paperMode) {
logWithTimestamp(`Hunter: PAPER MODE - Placing ${side} order for ${symbol}, quantity: ${symbolConfig.tradeSize}, leverage: ${symbolConfig.leverage}`);
        
        // Actually place the paper trade through the order API
        // This will route to the paper trading system
        try {
          const { placeOrder } = await import('../api/orders');
          await placeOrder({
            symbol,
            side,
            type: 'MARKET', // Use market order for paper trading
            quantity: symbolConfig.tradeSize,
            positionSide: this.config.global.positionMode === 'HEDGE' ? (side === 'BUY' ? 'LONG' : 'SHORT') : 'BOTH',
          }, this.config.api);
          
logWithTimestamp(`📄 Paper Trading: Order placed for ${symbol} ${side}`);
        } catch (error) {
logErrorWithTimestamp(`📄 Paper Trading: Failed to place order:`, error);
        }
        
        return;
      }

      // Determine order type from config
      // If forceMarketEntry is true, always use MARKET orders for opening positions
      let orderType = symbolConfig.forceMarketEntry ? 'MARKET' : (symbolConfig.orderType || 'LIMIT');
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
logWithTimestamp(`Hunter: Limited liquidity for ${symbol} ${side} - may use market order instead`);
          }

          // Check if optimal price is within acceptable slippage
          const maxSlippageBps = symbolConfig.maxSlippageBps || 50;
          const slippageBps = Math.abs((orderPrice - entryPrice) / entryPrice) * 10000;

          if (slippageBps > maxSlippageBps) {
logWithTimestamp(`Hunter: Slippage ${slippageBps.toFixed(1)}bp exceeds max ${maxSlippageBps}bp for ${symbol} - using market order`);
            orderPrice = entryPrice;
            orderType = 'MARKET';
          }
        } else {
logWithTimestamp(`Hunter: Could not calculate optimal price for ${symbol} - falling back to market order`);
          orderType = 'MARKET';
        }
      }

      // Fetch symbol info for precision and filters
      const symbolInfo = await getSymbolFilters(symbol);
      if (!symbolInfo) {
logErrorWithTimestamp(`Hunter: Could not fetch symbol info for ${symbol}`);
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
logWithTimestamp(`Hunter: Adjusting notional from ${notionalUSDT} to minimum ${minNotional} for ${symbol}`);
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

logErrorWithTimestamp(`Hunter: Trade size too small for ${symbol} - quantity rounds to zero or below minimum`);
logErrorWithTimestamp(`  Current trade size: ${tradeSizeUSDT} USDT`);
logErrorWithTimestamp(`  Calculated quantity: ${calculatedQuantity.toFixed(8)} -> ${quantity} (after formatting)`);
logErrorWithTimestamp(`  Minimum quantity: ${minQty}`);
logErrorWithTimestamp(`  Minimum notional: ${minNotional} USDT (${minNotionalForMargin.toFixed(2)} USDT at ${symbolConfig.leverage}x leverage)`);
logErrorWithTimestamp(`  RECOMMENDED: Set trade size to at least ${recommendedTradeSize.toFixed(2)} USDT`);

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
logErrorWithTimestamp(`Hunter: Order validation failed for ${symbol}: ${validation.error}`);
          return;
        }

        // Use adjusted values if provided (these are already properly formatted)
        if (validation.adjustedPrice !== undefined) orderPrice = validation.adjustedPrice;
        if (validation.adjustedQuantity !== undefined) quantity = validation.adjustedQuantity;
      }

      // Set leverage if needed
      await setLeverage(symbol, symbolConfig.leverage, this.config.api);

logWithTimestamp(`Hunter: Calculated quantity for ${symbol}: margin=${tradeSizeUSDT} USDT (${side === 'BUY' ? 'long' : 'short'}), leverage=${symbolConfig.leverage}x, price=${currentPrice}, notional=${notionalUSDT} USDT, quantity=${quantity}`);

      // Quick sanity check - ensure our mode is still in sync (if last sync was over 1 minute ago)
      if (Date.now() - this.lastModeSync > 60000) {
logWithTimestamp('Hunter: Position mode sync check needed (over 1 minute since last sync)');
        await this.syncPositionMode();
      }

      // Prepare order parameters
      const positionSide = getPositionSide(this.isHedgeMode, side);
logWithTimestamp(`Hunter: Using position mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, side: ${side}, positionSide: ${positionSide}`);
logWithTimestamp(`Hunter: Order params - Symbol: ${symbol}, Side: ${side}, PositionSide: ${positionSide}, Mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}`);

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
        logWithTimestamp(`Hunter: Placed ${orderType} ${side} order for ${symbol}${displayPrice}, orderId: ${order.orderId}`);

        // Replace temp tracking with real order ID
        this.removePendingOrder(tempTrackingId);
        if (order.orderId) {
          this.addPendingOrder(order.orderId.toString(), symbol, side);
        }
      } catch (orderError: any) {
        // Check if this is a position mode error (-4061)
        if (orderError?.response?.data?.code === -4061) {
logWithTimestamp(`Hunter: Position mode error for ${symbol}. Checking exchange mode...`);

          // Remove temp tracking before retry
          this.removePendingOrder(tempTrackingId);

          try {
            // Query the actual position mode from exchange
            const actualMode = await getPositionMode(this.config.api);
logWithTimestamp(`Hunter: Exchange mode: ${actualMode ? 'HEDGE' : 'ONE-WAY'}, Local mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}`);

            // Only retry if modes actually differ
            if (actualMode !== this.isHedgeMode) {
logWithTimestamp(`Hunter: Mode mismatch detected! Updating local mode and retrying...`);

              // Update our mode to match exchange
              this.isHedgeMode = actualMode;

              // Recalculate position side with correct mode
              const retryPositionSide = getPositionSide(this.isHedgeMode, side);
logWithTimestamp(`Hunter: Retrying with corrected mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, positionSide: ${retryPositionSide}`);

              // Update order params
              orderParams.positionSide = retryPositionSide;

              // Create retry tracking
              const retryTrackingId = `retry_${Date.now()}_${symbol}_${side}`;
              this.addPendingOrder(retryTrackingId, symbol, side);

              try {
                // Retry the order
                order = await placeOrder(orderParams, this.config.api);

                const displayPrice = orderType === 'LIMIT' ? ` at ${orderPrice}` : '';
logWithTimestamp(`Hunter: ✅ Order placed after mode correction for ${symbol}${displayPrice}, orderId: ${order.orderId}`);

                // Replace tracking with real order ID
                this.removePendingOrder(retryTrackingId);
                if (order.orderId) {
                  this.addPendingOrder(order.orderId.toString(), symbol, side);
                }
              } catch (retryError) {
logErrorWithTimestamp(`Hunter: Retry failed even with corrected mode. Error:`, retryError);
                this.removePendingOrder(retryTrackingId);
                throw retryError;
              }
            } else {
              // Modes match - this is likely a position conflict or limit issue in HEDGE mode
logWarnWithTimestamp(`Hunter: Position mode is correct (${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}), -4061 likely due to position limits or conflicts`);
logWarnWithTimestamp(`Hunter: Symbol: ${symbol}, Side: ${side}, PositionSide: ${positionSide}`);
logWarnWithTimestamp(`Hunter: This is often due to position limits, existing positions, or symbol-specific restrictions`);

              // Remove temp tracking since order won't be placed
              this.removePendingOrder(tempTrackingId);

              // Don't re-throw - just return to prevent error DB logging
              // This prevents the error from being logged to the error database
              return;
            }
          } catch (queryError) {
logErrorWithTimestamp('Hunter: Failed to query position mode from exchange:', queryError);
logWarnWithTimestamp('Hunter: Cannot determine correct mode. Since we cannot verify, treating as non-critical.');

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
        // Create tranche if tranche management is enabled
        if (symbolConfig.enableTrancheManagement) {
          try {
            const { getTrancheManager } = await import('../services/trancheManager');
            const trancheManager = getTrancheManager();
            const _trancheSide = side === 'BUY' ? 'LONG' : 'SHORT';

            const tranche = await trancheManager.createTranche({
              symbol,
              side,
              positionSide: getPositionSide(this.isHedgeMode, side) as any,
              entryPrice: orderType === 'LIMIT' ? orderPrice : entryPrice,
              quantity: quantity!,
              marginUsed: tradeSizeUSDT,
              leverage: symbolConfig.leverage,
              orderId: order.orderId.toString(),
            });

            logWithTimestamp(`Hunter: Created tranche ${tranche.id.substring(0, 8)} for ${symbol} ${side}`);
          } catch (trancheError) {
            logErrorWithTimestamp('Hunter: Failed to create tranche:', trancheError);
            // Don't fail the trade, just log the error
          }
        }

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
logWithTimestamp(`Hunter: Removed pending order ${order.orderId} after placement failure`);
      } else {
        // If order wasn't created but we might have a pending entry for this symbol
        // Clean up any pending orders for this symbol that are older than 10 seconds
        // This is a safety net for edge cases where order ID wasn't available
        const now = Date.now();
        for (const [orderId, orderInfo] of this.pendingOrders.entries()) {
          if (orderInfo.symbol === symbol && orderInfo.side === side &&
              (now - orderInfo.timestamp) < 10000) { // Only recent orders
            this.removePendingOrder(orderId);
logWithTimestamp(`Hunter: Cleaned up recent pending order ${orderId} for ${symbol} after placement failure`);
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
logErrorWithTimestamp(`Hunter: NOTIONAL ERROR for ${symbol}:`);
logErrorWithTimestamp(`  Required: ${tradingError.requiredNotional} USDT`);
logErrorWithTimestamp(`  Actual: ${tradingError.actualNotional.toFixed(2)} USDT`);
logErrorWithTimestamp(`  Price: ${tradingError.price}`);
logErrorWithTimestamp(`  Quantity: ${tradingError.quantity}`);
logErrorWithTimestamp(`  Leverage: ${tradingError.leverage}x`);
logErrorWithTimestamp(`  Margin used: ${tradeSizeUSDT} USDT (${side === 'BUY' ? 'long' : 'short'})`);
logErrorWithTimestamp(`  This indicates the symbol may have special requirements or price has moved significantly.`);

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
logErrorWithTimestamp(`Hunter: RATE LIMIT ERROR - Too many requests, please slow down`);
logErrorWithTimestamp(`  Consider reducing order frequency or implementing request throttling`);

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
logErrorWithTimestamp(`Hunter: INSUFFICIENT BALANCE ERROR for ${symbol}`);
logErrorWithTimestamp(`  Check account balance and margin requirements`);

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
logErrorWithTimestamp(`Hunter: REDUCE ONLY ERROR for ${symbol}`);
logErrorWithTimestamp(`  Cannot place reduce-only order when no position exists`);

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
logErrorWithTimestamp(`Hunter: POSITION MODE ERROR for ${symbol}`);
logErrorWithTimestamp(`  Position mode mismatch - attempted ${tradingError.attemptedMode}`);
logErrorWithTimestamp(`  This error should have been handled by retry logic`);

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
logErrorWithTimestamp(`Hunter: PRICE PRECISION ERROR for ${symbol}`);
logErrorWithTimestamp(`  Price ${tradingError.price} doesn't meet tick size requirements`);

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
logErrorWithTimestamp(`Hunter: QUANTITY PRECISION ERROR for ${symbol}`);
logErrorWithTimestamp(`  Quantity ${tradingError.quantity} doesn't meet step size requirements`);

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
logErrorWithTimestamp(`Hunter: Place trade error for ${symbol} (${tradingError.code}):`, tradingError.message);

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
logWarnWithTimestamp(`Hunter: Skipping fallback order - ${timeSinceStart}ms elapsed, timestamp would be stale`);
          return;
        }

logWithTimestamp(`Hunter: Retrying with market order for ${symbol}`);

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
logErrorWithTimestamp(`Hunter: Could not fetch symbol info for fallback order ${symbol}`);
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
logWithTimestamp(`Hunter: Adjusting fallback notional from ${fallbackNotionalUSDT} to minimum ${fallbackMinNotional} for ${symbol}`);
            fallbackNotionalUSDT = fallbackMinNotional * 1.01; // Add 1% buffer
          }

          // Calculate raw quantity
          const rawFallbackQuantity = fallbackNotionalUSDT / fallbackPrice;

          // Always use symbolPrecision formatting (which now has defaults)
          fallbackQuantity = symbolPrecision.formatQuantity(symbol, rawFallbackQuantity);

logWithTimestamp(`Hunter: Fallback calculation for ${symbol}: margin=${symbolConfig.tradeSize} USDT, leverage=${symbolConfig.leverage}x, price=${fallbackPrice}, notional=${fallbackNotionalUSDT} USDT, quantity=${fallbackQuantity}`);

          fallbackPositionSide = getPositionSide(this.isHedgeMode, side) as 'BOTH' | 'LONG' | 'SHORT';
logWithTimestamp(`Hunter: Using position mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}, side: ${side}, positionSide: ${fallbackPositionSide}`);

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

logWithTimestamp(`Hunter: Fallback market order placed for ${symbol}, orderId: ${fallbackOrder.orderId}`);

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
logWithTimestamp(`Hunter: Removed fallback temp pending order ${fallbackTempId} after placement failure`);
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
logErrorWithTimestamp(`Hunter: CRITICAL NOTIONAL ERROR in fallback for ${symbol}:`);
logErrorWithTimestamp(`  Required: ${fallbackTradingError.requiredNotional} USDT`);
logErrorWithTimestamp(`  Actual: ${fallbackTradingError.actualNotional.toFixed(2)} USDT`);
logErrorWithTimestamp(`  Price: ${fallbackTradingError.price}`);
logErrorWithTimestamp(`  Quantity: ${fallbackTradingError.quantity}`);
logErrorWithTimestamp(`  Even with adjustments, notional requirement not met!`);
logErrorWithTimestamp(`  Check if symbol has special requirements or if price data is stale.`);

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
logErrorWithTimestamp(`Hunter: RATE LIMIT in fallback - backing off`);

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
logErrorWithTimestamp(`Hunter: INSUFFICIENT BALANCE in fallback for ${symbol}`);

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
logErrorWithTimestamp(`Hunter: Fallback order failed for ${symbol} (${fallbackTradingError.code}):`, fallbackTradingError.message);

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
}
