import WebSocket from 'ws';
import { EventEmitter } from 'events';
import axios, { AxiosResponse } from 'axios';
import { Config } from '../types';
import { buildSignedQuery } from '../api/auth';
import { getExchangeInfo, getMarkPrice } from '../api/market';
import { placeOrder, cancelOrder } from '../api/orders';
import { placeStopLossAndTakeProfit } from '../api/batchOrders';
import { symbolPrecision } from '../utils/symbolPrecision';
import { getBalanceService } from '../services/balanceService';
import { errorLogger } from '../services/errorLogger';
import { getPriceService } from '../services/priceService';
import { invalidateIncomeCache } from '../api/income';
import { logWithTimestamp, logErrorWithTimestamp, logWarnWithTimestamp } from '../utils/timestamp';

// Minimal local state - only track order IDs linked to positions
interface PositionOrders {
  slOrderId?: number;
  tpOrderId?: number;
}

// Exchange position from API
interface ExchangePosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;  // Note: This will be '0' from ACCOUNT_UPDATE, use PriceService for real mark prices
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  isolatedMargin: string;
  isAutoAddMargin: string;
  positionSide: string;
  updateTime: number;
}

// Exchange order from API
interface ExchangeOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  type: string;
  side: string;
  stopPrice: string;
  time: number;
  updateTime: number;
  workingType: string;
  origType: string;
  positionSide: string;
  reduceOnly: boolean;
}

const BASE_URL = 'https://fapi.asterdex.com';

// Position tracking interface for Hunter
export interface PositionTracker {
  getMarginUsage(symbol: string): number;
  getTotalPositionCount(): number;
  getUniquePositionCount(isHedgeMode: boolean): number;
  getPositionsMap(): Map<string, ExchangePosition>;
}

export class PositionManager extends EventEmitter implements PositionTracker {
  private ws: WebSocket | null = null;
  private listenKey: string | null = null;
  private config: Config;
  private positionOrders: Map<string, PositionOrders> = new Map(); // symbol_side -> order IDs
  private currentPositions: Map<string, ExchangePosition> = new Map(); // Live position data from WebSocket
  private previousPositionSizes: Map<string, number> = new Map(); // Track position size changes
  private keepaliveInterval?: NodeJS.Timeout;
  private riskCheckInterval?: NodeJS.Timeout;
  private orderCheckInterval?: NodeJS.Timeout;
  private isRunning = false;
  private statusBroadcaster: any; // Will be injected
  private isHedgeMode: boolean;
  private orderPlacementLocks: Set<string> = new Set(); // Prevent concurrent order placement for same position
  private orderCancellationLocks: Set<string> = new Set(); // Prevent concurrent order cancellation for same symbol
  private symbolLeverage: Map<string, number> = new Map(); // Track leverage per symbol from ACCOUNT_CONFIG_UPDATE

  constructor(config: Config, isHedgeMode: boolean = false) {
    super();
    this.config = config;
    this.isHedgeMode = isHedgeMode;
  }

  // Set status broadcaster for position updates
  public setStatusBroadcaster(broadcaster: any): void {
    this.statusBroadcaster = broadcaster;
  }

  // Update configuration dynamically
  public updateConfig(newConfig: Config): void {
    const oldConfig = this.config;
    this.config = newConfig;

    // Log significant changes
    if (oldConfig.global.riskPercent !== newConfig.global.riskPercent) {
logWithTimestamp(`PositionManager: Risk percent changed from ${oldConfig.global.riskPercent}% to ${newConfig.global.riskPercent}%`);
    }

    if (oldConfig.global.maxOpenPositions !== newConfig.global.maxOpenPositions) {
logWithTimestamp(`PositionManager: Max open positions changed from ${oldConfig.global.maxOpenPositions} to ${newConfig.global.maxOpenPositions}`);
    }

    // Check for symbol parameter changes that affect existing positions
    for (const [_posKey, position] of this.currentPositions) {
      const symbol = position.symbol;

      if (oldConfig.symbols[symbol] && newConfig.symbols[symbol]) {
        const oldSym = oldConfig.symbols[symbol];
        const newSym = newConfig.symbols[symbol];

        // Log changes that would affect new SL/TP orders
        if (oldSym.tpPercent !== newSym.tpPercent) {
logWithTimestamp(`PositionManager: ${symbol} TP percent changed from ${oldSym.tpPercent}% to ${newSym.tpPercent}%`);
        }
        if (oldSym.slPercent !== newSym.slPercent) {
logWithTimestamp(`PositionManager: ${symbol} SL percent changed from ${oldSym.slPercent}% to ${newSym.slPercent}%`);
        }

        // Note: We don't modify existing SL/TP orders - changes only apply to new positions
logWithTimestamp(`PositionManager: Note: Existing SL/TP orders for ${symbol} remain unchanged`);
      }
    }

    // If paper mode changed and we have an active websocket, we may need to restart
    if (oldConfig.global.paperMode !== newConfig.global.paperMode) {
logWithTimestamp(`PositionManager: Paper mode changed to ${newConfig.global.paperMode}`);

      // If switching modes with active connection, restart the connection
      if (this.isRunning && newConfig.api.apiKey && newConfig.api.secretKey) {
logWithTimestamp('PositionManager: Restarting connection due to mode change...');
        this.restartConnection();
      }
    }
  }

  private async restartConnection(): Promise<void> {
    // Close existing connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Clear intervals
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
    }
    if (this.riskCheckInterval) {
      clearInterval(this.riskCheckInterval);
    }
    if (this.orderCheckInterval) {
      clearInterval(this.orderCheckInterval);
    }

    // Wait a bit before reconnecting
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Reconnect
    try {
      await this.syncWithExchange();
      await this.startUserDataStream();
    } catch (error) {
logErrorWithTimestamp('PositionManager: Failed to restart connection:', error);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
logWithTimestamp('PositionManager: Starting...');

    // Fetch exchange info to get symbol precision
    try {
logWithTimestamp('PositionManager: Fetching exchange info for symbol precision...');
      const exchangeInfo = await getExchangeInfo();
      symbolPrecision.parseExchangeInfo(exchangeInfo);
    } catch (error: any) {
logErrorWithTimestamp('PositionManager: Failed to fetch exchange info:', error.message);
      // Continue anyway - will use raw values
    }

    // Skip user data stream in paper mode with no API keys
    if (this.config.global.paperMode && (!this.config.api.apiKey || !this.config.api.secretKey)) {
logWithTimestamp('PositionManager: Running in paper mode without API keys - simulating streams');
      return;
    }

    try {
      // First, sync with exchange to get current positions and orders
      await this.syncWithExchange();
      // Then start the user data stream for real-time updates
      await this.startUserDataStream();
    } catch (error) {
logErrorWithTimestamp('PositionManager: Failed to start:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
logWithTimestamp('PositionManager: Stopping...');

    if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
    if (this.riskCheckInterval) clearInterval(this.riskCheckInterval);
    if (this.orderCheckInterval) clearInterval(this.orderCheckInterval);
    if (this.ws) this.ws.close();
    if (this.listenKey) await this.closeUserDataStream();
  }

  private async startUserDataStream(): Promise<void> {
    // For listen key endpoint, typically only needs API key header, no signature
    const headers = {
      'X-MBX-APIKEY': this.config.api.apiKey  // Binance-style header
    };

    const response: AxiosResponse = await axios.post(`${BASE_URL}/fapi/v1/listenKey`, null, { headers });
    this.listenKey = response.data.listenKey;
logWithTimestamp('PositionManager: Got listenKey:', this.listenKey);

    // Start WS
    this.ws = new WebSocket(`wss://fstream.asterdex.com/ws/${this.listenKey}`);

    this.ws.on('open', () => {
logWithTimestamp('PositionManager WS connected');
      // Set keepalive every 30 min
      this.keepaliveInterval = setInterval(() => this.keepalive(), 30 * 60 * 1000);
      // Risk check every 5 min
      this.riskCheckInterval = setInterval(() => this.checkRisk(), 5 * 60 * 1000);
      // Order check every 30 seconds to ensure SL/TP quantities match positions
      this.orderCheckInterval = setInterval(() => this.checkAndAdjustOrders(), 30 * 1000);

      // Clean up orphaned orders immediately on startup, then every 30 seconds
      this.cleanupOrphanedOrders().catch(error => {
logErrorWithTimestamp('PositionManager: Initial cleanup failed:', error);
      });
      setInterval(() => this.cleanupOrphanedOrders(), 30 * 1000);
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString());
        this.handleEvent(event);
      } catch (error) {
logErrorWithTimestamp('PositionManager: WS message parse error:', error);
      }
    });

    this.ws.on('error', (error) => {
logErrorWithTimestamp('PositionManager WS error:', error);
      // Log to error database
      errorLogger.logWebSocketError(
        `wss://fstream.asterdex.com/ws/${this.listenKey}`,
        error instanceof Error ? error : new Error(String(error)),
        1
      );
      // Broadcast error to UI
      if (this.statusBroadcaster) {
        this.statusBroadcaster.broadcastWebSocketError(
          'Position Manager WebSocket Error',
          'User data stream connection error. Reconnecting...',
          {
            component: 'PositionManager',
            rawError: error,
          }
        );
      }
    });

    this.ws.on('close', () => {
logWithTimestamp('PositionManager WS closed - reconnecting...');
      // Broadcast reconnection attempt to UI
      if (this.statusBroadcaster) {
        this.statusBroadcaster.broadcastWebSocketError(
          'Position Manager Disconnected',
          'User data stream closed. Reconnecting in 5 seconds...',
          {
            component: 'PositionManager',
          }
        );
      }
      if (this.isRunning) {
        // Re-sync with exchange on reconnect
        setTimeout(async () => {
          await this.syncWithExchange();
          await this.startUserDataStream();
        }, 5000);
      }
    });
  }

  private async keepalive(): Promise<void> {
    if (!this.listenKey) return;
    try {
      const headers = {
        'X-MBX-APIKEY': this.config.api.apiKey
      };
      await axios.put(`${BASE_URL}/fapi/v1/listenKey`, null, { headers });
logWithTimestamp('PositionManager: Keepalive sent');
    } catch (error) {
logErrorWithTimestamp('PositionManager: Keepalive error:', error);
      // Log to error database
      errorLogger.logApiError(
        '/fapi/v1/listenKey',
        'PUT',
        error instanceof Error ? 0 : (error as any)?.response?.status || 0,
        error,
        { component: 'PositionManager', userAction: 'Keepalive' }
      );
    }
  }

  private async closeUserDataStream(): Promise<void> {
    if (!this.listenKey) return;
    try {
      const headers = {
        'X-MBX-APIKEY': this.config.api.apiKey
      };
      await axios.delete(`${BASE_URL}/fapi/v1/listenKey`, { headers });
logWithTimestamp('PositionManager: User data stream closed');
    } catch (error) {
logErrorWithTimestamp('PositionManager: Close stream error:', error);
    }
  }

  // Sync with exchange on startup or reconnection
  private async syncWithExchange(): Promise<void> {
logWithTimestamp('PositionManager: Syncing with exchange...');

    try {
      // Get all current positions from exchange
      const positions = await this.getPositionsFromExchange();

      // Get all open orders
      const openOrders = await this.getOpenOrdersFromExchange();
logWithTimestamp(`PositionManager: Found ${openOrders.length} open orders`);

      // Log order details for debugging
      openOrders.forEach(order => {
        if (order.reduceOnly) {
logWithTimestamp(`PositionManager: Open order - ${order.symbol} ${order.type} ${order.side}, reduceOnly: ${order.reduceOnly}, orderId: ${order.orderId}, qty: ${order.origQty}`);
        }
      });

      // Store previous tracking to preserve valid associations
      const _previousPositions = new Map(this.currentPositions);
      const previousOrders = new Map(this.positionOrders);

      // Clear current positions but preserve order tracking temporarily
      this.currentPositions.clear();

      // Track which orders have been assigned to positions
      const assignedOrderIds = new Set<number>();

      // Build a map of all reduce-only orders grouped by symbol for better matching
      const ordersBySymbol = new Map<string, ExchangeOrder[]>();
      for (const order of openOrders) {
        if (order.reduceOnly) {
          if (!ordersBySymbol.has(order.symbol)) {
            ordersBySymbol.set(order.symbol, []);
          }
          ordersBySymbol.get(order.symbol)!.push(order);
        }
      }

      // Process each position
      for (const position of positions) {
        const posAmt = parseFloat(position.positionAmt);
        if (Math.abs(posAmt) > 0) {
          const key = this.getPositionKey(position.symbol, position.positionSide, posAmt);
          this.currentPositions.set(key, position);

          // Only manage positions for symbols in our config
          const symbolConfig = this.config.symbols[position.symbol];
          if (!symbolConfig) {
logWithTimestamp(`PositionManager: Found position ${key}: ${posAmt} @ ${position.entryPrice} (not managed - symbol not in config)`);
            continue;
          }

logWithTimestamp(`PositionManager: Found position ${key}: ${posAmt} @ ${position.entryPrice}`);

          // First check if we had orders tracked for this position previously
          const previousTrackedOrders = previousOrders.get(key);
          let slOrder: ExchangeOrder | undefined;
          let tpOrder: ExchangeOrder | undefined;

          // Get orders for this symbol
          const symbolOrders = ordersBySymbol.get(position.symbol) || [];

          // If we had previously tracked orders, try to find them first
          if (previousTrackedOrders) {
            if (previousTrackedOrders.slOrderId && !assignedOrderIds.has(previousTrackedOrders.slOrderId)) {
              slOrder = symbolOrders.find(o =>
                o.orderId === previousTrackedOrders.slOrderId &&
                (o.type === 'STOP_MARKET' || o.type === 'STOP')
              );
              if (slOrder) {
logWithTimestamp(`PositionManager: Preserving tracked SL order ${slOrder.orderId} for ${key}`);
                assignedOrderIds.add(slOrder.orderId);
              }
            }
            if (previousTrackedOrders.tpOrderId && !assignedOrderIds.has(previousTrackedOrders.tpOrderId)) {
              tpOrder = symbolOrders.find(o =>
                o.orderId === previousTrackedOrders.tpOrderId &&
                (o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' || o.type === 'LIMIT')
              );
              if (tpOrder) {
logWithTimestamp(`PositionManager: Preserving tracked TP order ${tpOrder.orderId} for ${key}`);
                assignedOrderIds.add(tpOrder.orderId);
              }
            }
          }

          // Find SL/TP orders for this position based on quantity matching
          const positionQty = Math.abs(posAmt);
          const isLong = posAmt > 0;

          // If we didn't find previously tracked orders, look for matching orders by quantity
          if (!slOrder) {
            slOrder = symbolOrders.find(o =>
              !assignedOrderIds.has(o.orderId) &&
              (o.type === 'STOP_MARKET' || o.type === 'STOP') &&
              o.reduceOnly &&
              ((isLong && o.side === 'SELL') || (!isLong && o.side === 'BUY')) &&
              Math.abs(parseFloat(o.origQty) - positionQty) < 0.00000001  // Quantity matches
            );

            if (slOrder) {
              assignedOrderIds.add(slOrder.orderId);
logWithTimestamp(`PositionManager: Matched SL order ${slOrder.orderId} to position ${key} by quantity`);
            }
          }

          if (!tpOrder) {
            tpOrder = symbolOrders.find(o =>
              !assignedOrderIds.has(o.orderId) &&
              (o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' || (o.type === 'LIMIT' && o.reduceOnly)) &&
              o.reduceOnly &&
              ((isLong && o.side === 'SELL') || (!isLong && o.side === 'BUY')) &&
              Math.abs(parseFloat(o.origQty) - positionQty) < 0.00000001  // Quantity matches
            );

            if (tpOrder) {
              assignedOrderIds.add(tpOrder.orderId);
logWithTimestamp(`PositionManager: Matched TP order ${tpOrder.orderId} to position ${key} by quantity`);
            }
          }

          const orders: PositionOrders = {};
          let needsAdjustment = false;

          if (slOrder) {
            orders.slOrderId = slOrder.orderId;
            const slOrderQty = parseFloat(slOrder.origQty);

            // Check if SL order quantity matches position size (with small tolerance for rounding)
            if (Math.abs(slOrderQty - positionQty) > 0.00000001) {
logWithTimestamp(`PositionManager: SL order ${slOrder.orderId} quantity mismatch - Order: ${slOrderQty}, Position: ${positionQty}`);
              needsAdjustment = true;
            } else {
logWithTimestamp(`PositionManager: Found SL order ${slOrder.orderId} for ${key} (qty: ${slOrderQty})`);
            }
          }

          if (tpOrder) {
            orders.tpOrderId = tpOrder.orderId;
            const tpOrderQty = parseFloat(tpOrder.origQty);

            // Check if TP order quantity matches position size (with small tolerance for rounding)
            if (Math.abs(tpOrderQty - positionQty) > 0.00000001) {
logWithTimestamp(`PositionManager: TP order ${tpOrder.orderId} quantity mismatch - Order: ${tpOrderQty}, Position: ${positionQty}`);
              needsAdjustment = true;
            } else {
logWithTimestamp(`PositionManager: Found TP order ${tpOrder.orderId} for ${key} (qty: ${tpOrderQty})`);
            }
          }

          if (orders.slOrderId || orders.tpOrderId) {
            this.positionOrders.set(key, orders);
          }

          // Adjust orders if quantities don't match or place missing orders
          if (needsAdjustment) {
logWithTimestamp(`PositionManager: Adjusting protective orders for ${key} due to quantity mismatch`);
            await this.adjustProtectiveOrders(position, slOrder, tpOrder);
          } else if (!slOrder || !tpOrder) {
            // Critical protection check - log with appropriate severity
            if (!slOrder && !tpOrder) {
logWithTimestamp(`PositionManager: [CRITICAL SYNC] Position ${key} has NO protective orders at all!`);
logWithTimestamp(`PositionManager: This may indicate cancelled orders. Re-placing both SL and TP immediately`);
            } else {
logWithTimestamp(`PositionManager: Position ${key} missing protection (SL: ${!!slOrder}, TP: ${!!tpOrder})`);
            }

            // Ensure we have tracking for this position even if orders were cancelled
            if (!this.positionOrders.has(key)) {
logWithTimestamp(`PositionManager: Re-establishing order tracking for position ${key}`);
              this.positionOrders.set(key, {});
            }

            await this.placeProtectiveOrdersWithLock(key, position, !slOrder, !tpOrder);
          }
        }
      }

      // Clean up order tracking for positions that no longer exist
      for (const [key, _orders] of previousOrders.entries()) {
        if (!this.currentPositions.has(key)) {
logWithTimestamp(`PositionManager: Removing order tracking for closed position ${key}`);
          this.positionOrders.delete(key);
        }
      }

      // Log any unassigned reduce-only orders as potential orphans
      for (const order of openOrders) {
        if (order.reduceOnly && !assignedOrderIds.has(order.orderId)) {
logWarnWithTimestamp(`PositionManager: Unassigned reduce-only order - ${order.symbol} ${order.type} ${order.side}, orderId: ${order.orderId}, qty: ${order.origQty}`);
        }
      }

logWithTimestamp(`PositionManager: Sync complete - ${this.currentPositions.size} positions, ${this.positionOrders.size} with orders`);
    } catch (error) {
logErrorWithTimestamp('PositionManager: Failed to sync with exchange:', error);
      throw error;
    }
  }

  // Get all positions from exchange
  private async getPositionsFromExchange(): Promise<ExchangePosition[]> {
    const params = {};
    const queryString = buildSignedQuery(params, this.config.api);

    const response = await axios.get(`${BASE_URL}/fapi/v2/positionRisk?${queryString}`, {
      headers: { 'X-MBX-APIKEY': this.config.api.apiKey }
    });

    return response.data;
  }

  // Get all open orders from exchange
  private async getOpenOrdersFromExchange(): Promise<ExchangeOrder[]> {
    const params = {};
    const queryString = buildSignedQuery(params, this.config.api);

    const response = await axios.get(`${BASE_URL}/fapi/v1/openOrders?${queryString}`, {
      headers: { 'X-MBX-APIKEY': this.config.api.apiKey }
    });

    return response.data;
  }

  // Helper to create consistent position keys
  private getPositionKey(symbol: string, positionSide: string, positionAmt: number): string {
    // For one-way mode (BOTH), include direction in key
    if (positionSide === 'BOTH') {
      const direction = positionAmt > 0 ? 'LONG' : 'SHORT';
      // Add a unique identifier to prevent any potential collisions
      return `${symbol}_${direction}_${positionSide}`;
    }
    // For hedge mode, use position side with additional identifier
    return `${symbol}_${positionSide}_HEDGE`;
  }

  // Ensure position has SL/TP orders
  private async ensurePositionProtected(symbol: string, positionSide: string, positionAmt: number): Promise<void> {
    const key = this.getPositionKey(symbol, positionSide, positionAmt);

    // Check if order placement is already in progress for this position
    if (this.orderPlacementLocks.has(key)) {
logWithTimestamp(`PositionManager: Order placement already in progress for ${key}, skipping`);
      return;
    }

    // Check if we already have orders tracked
    const existingOrders = this.positionOrders.get(key);
    if (existingOrders?.slOrderId && existingOrders?.tpOrderId) {
      return; // Already protected
    }

    // Get the position data
    const position = this.currentPositions.get(key);
    if (!position) {
logWarnWithTimestamp(`PositionManager: Position ${key} not found in map`);
      return;
    }

    // Place missing orders
    const needSL = !existingOrders?.slOrderId;
    const needTP = !existingOrders?.tpOrderId;

    if (needSL || needTP) {
      await this.placeProtectiveOrdersWithLock(key, position, needSL, needTP);
    }
  }

  // Cancel protective orders for a position with retry logic
  private async cancelProtectiveOrders(positionKey: string, orders: PositionOrders): Promise<void> {
    const [symbol] = positionKey.split('_');

    // Add lock to prevent concurrent cancellations for the same symbol
    const lockKey = `cancel_${symbol}`;
    if (this.orderCancellationLocks.has(lockKey)) {
logWithTimestamp(`PositionManager: Order cancellation already in progress for ${symbol}, skipping`);
      return;
    }

    this.orderCancellationLocks.add(lockKey);

    try {
      // Validate that orders belong to the correct symbol before cancellation
logWithTimestamp(`PositionManager: Cancelling protective orders for position ${positionKey} - SL: ${orders.slOrderId || 'none'}, TP: ${orders.tpOrderId || 'none'}`);

      if (orders.slOrderId) {
logWithTimestamp(`PositionManager: Cancelling SL order ${orders.slOrderId} for symbol ${symbol}`);
        await this.cancelOrderWithRetry(symbol, orders.slOrderId, 'SL');
      }

      if (orders.tpOrderId) {
logWithTimestamp(`PositionManager: Cancelling TP order ${orders.tpOrderId} for symbol ${symbol}`);
        await this.cancelOrderWithRetry(symbol, orders.tpOrderId, 'TP');
      }
    } finally {
      // Always release the lock
      this.orderCancellationLocks.delete(lockKey);
    }
  }

  // Cancel order with retry and backoff
  private async cancelOrderWithRetry(symbol: string, orderId: number, orderType: string): Promise<void> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    // Validate symbol matches what we expect
logWithTimestamp(`PositionManager: Attempting to cancel ${orderType} order ${orderId} for symbol ${symbol}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Extra validation: query the order first to ensure it belongs to the correct symbol
        // This is a safety check to prevent cross-symbol cancellation
        await this.cancelOrderById(symbol, orderId);
logWithTimestamp(`PositionManager: Successfully cancelled ${orderType} order ${orderId} for ${symbol} (attempt ${attempt})`);
        return; // Success, exit retry loop
      } catch (error: any) {
        // Error -2011 means order doesn't exist (already filled or cancelled)
        if (error?.response?.data?.code === -2011) {
logWithTimestamp(`PositionManager: ${orderType} order ${orderId} already filled or cancelled`);
          return; // Not an error to retry
        }

logErrorWithTimestamp(`PositionManager: Failed to cancel ${orderType} order ${orderId} (attempt ${attempt}/${maxRetries}):`, error?.response?.data?.message || error?.message);

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = baseDelay * Math.pow(2, attempt - 1);
logWithTimestamp(`PositionManager: Retrying ${orderType} order cancellation in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
logErrorWithTimestamp(`PositionManager: Max retries reached for cancelling ${orderType} order ${orderId}`);
        }
      }
    }
  }

  // Cancel order by ID
  private async cancelOrderById(symbol: string, orderId: number): Promise<void> {
    await cancelOrder({ symbol, orderId }, this.config.api);
  }

  private handleEvent(event: any): void {
    if (event.e === 'ACCOUNT_UPDATE') {
      this.handleAccountUpdate(event);
    } else if (event.e === 'ORDER_TRADE_UPDATE') {
      this.handleOrderUpdate(event);
    } else if (event.e === 'ACCOUNT_CONFIG_UPDATE') {
      this.handleAccountConfigUpdate(event);
    }
  }

  private handleAccountConfigUpdate(event: any): void {
    // Handle ACCOUNT_CONFIG_UPDATE events which contain leverage information
    if (event.ac) {
      const { s: symbol, l: leverage } = event.ac;
      if (symbol && leverage !== undefined) {
logWithTimestamp(`PositionManager: Leverage update for ${symbol}: ${leverage}x`);
        this.symbolLeverage.set(symbol, leverage);

        // Update leverage for any existing positions of this symbol
        for (const [_key, position] of this.currentPositions.entries()) {
          if (position.symbol === symbol) {
            position.leverage = leverage.toString();
          }
        }
      }
    }
  }

  private handleAccountUpdate(event: any): void {
logWithTimestamp('PositionManager: Account update received');

    // Forward to PnL service for tracking
    const pnlService = require('../services/pnlService').default;
    pnlService.updateFromAccountEvent(event);

    // Broadcast PnL update if we have a broadcaster
    if (this.statusBroadcaster && this.statusBroadcaster.broadcastPnLUpdate) {
      const session = pnlService.getSessionPnL();
      const snapshot = pnlService.getLatestSnapshot();
      this.statusBroadcaster.broadcastPnLUpdate({
        session,
        snapshot,
        reason: event.a?.m,
      });
    }

    // Update our position map from the authoritative source (exchange)
    if (event.a && event.a.P) {
      const positions = event.a.P;

      // Track previous positions to detect closures
      const previousPositions = new Map(this.currentPositions);
      const previousOrders = new Map(this.positionOrders);

      // Clear position map but preserve order tracking
      this.currentPositions.clear();

      positions.forEach(async (pos: any) => {
        const positionAmt = parseFloat(pos.pa);
        const symbol = pos.s;
        const positionSide = pos.ps || 'BOTH';

        // Check if position is closed (positionAmt = 0)
        if (Math.abs(positionAmt) === 0) {
          // Find the previous position key for this symbol/side
          let previousKey: string | undefined;
          let previousPosition: ExchangePosition | undefined;

          for (const [key, prevPos] of previousPositions.entries()) {
            if (prevPos.symbol === symbol && prevPos.positionSide === positionSide) {
              previousKey = key;
              previousPosition = prevPos;
              break;
            }
          }

          if (previousKey && previousPosition) {
            const previousAmt = parseFloat(previousPosition.positionAmt);
logWithTimestamp(`PositionManager: Position ${previousKey} fully closed`);

            // Don't broadcast position_closed here - it will be broadcast with actual PnL in ORDER_TRADE_UPDATE
            // Only broadcast position_update for UI state updates
            if (this.statusBroadcaster) {
              // Broadcast position_update with type closed for compatibility
              this.statusBroadcaster.broadcastPositionUpdate({
                symbol: symbol,
                side: previousAmt > 0 ? 'LONG' : 'SHORT',
                quantity: 0,
                price: 0,
                type: 'closed',
                pnl: 0,
              });
            }

            // Clean up tracking
            this.positionOrders.delete(previousKey);
            this.previousPositionSizes.delete(previousKey);

            // Trigger immediate balance refresh
            this.refreshBalance();
          }
          return; // Skip adding closed positions to map
        }

        // Store the full position data from exchange (only for open positions)
        if (Math.abs(positionAmt) > 0) {
          const key = this.getPositionKey(symbol, positionSide, positionAmt);

          // Check if position size has changed
          const previousSize = this.previousPositionSizes.get(key);
          const currentSize = Math.abs(positionAmt);
          const sizeChanged = previousSize !== undefined && Math.abs(previousSize - currentSize) > 0.00000001;

          if (sizeChanged) {
logWithTimestamp(`PositionManager: Position size changed for ${key} from ${previousSize} to ${currentSize}`);
          }

          // Preserve order tracking if position hasn't changed significantly
          if (!sizeChanged && previousOrders.has(key)) {
            const existingOrders = previousOrders.get(key);
            if (existingOrders) {
              this.positionOrders.set(key, existingOrders);
logWithTimestamp(`PositionManager: Preserved order tracking for ${key} (SL: ${existingOrders.slOrderId || 'none'}, TP: ${existingOrders.tpOrderId || 'none'})`);
            }
          }

          // Update tracking
          this.previousPositionSizes.set(key, currentSize);

          // Get leverage from our tracking or use '0' as placeholder
          const trackedLeverage = this.symbolLeverage.get(pos.s);
          const leverage = trackedLeverage ? trackedLeverage.toString() : '0';

          this.currentPositions.set(key, {
            symbol: pos.s,
            positionAmt: pos.pa,
            entryPrice: pos.ep,
            markPrice: pos.mp || '0',  // Note: This is often '0' from WebSocket, use PriceService for real prices
            unRealizedProfit: pos.up,
            liquidationPrice: pos.lp || '0',
            leverage: leverage, // Use tracked leverage or '0' if not yet received
            marginType: pos.mt,
            isolatedMargin: pos.iw || '0',
            isAutoAddMargin: pos.iam || 'false',
            positionSide: positionSide,
            updateTime: event.E
          });

          // Subscribe to mark price updates for this symbol
          const priceService = getPriceService();
          if (priceService && !this.previousPositionSizes.has(key)) {
            priceService.subscribeToSymbols([pos.s]);
logWithTimestamp(`📊 Added price streaming for new position: ${pos.s}`);
          }

          // Check if this position has SL/TP orders and if they need adjustment
          if (sizeChanged) {
            // Position size changed, need to check and adjust orders (async, don't await to avoid blocking)
            // Add symbol-specific lock to prevent interference
            const adjustLockKey = `adjust_${symbol}`;
            if (!this.orderPlacementLocks.has(adjustLockKey)) {
              this.checkAndAdjustOrdersForPosition(key).catch(error => {
logErrorWithTimestamp(`PositionManager: Failed to adjust orders for ${key}:`, error?.response?.data || error?.message);
              });
            } else {
logWithTimestamp(`PositionManager: Order adjustment already in progress for ${symbol}, will retry on next check`);
            }
          } else {
            // Just ensure position is protected (async, don't await to avoid blocking)
            // Add small delay to reduce race conditions with other protection logic
            setTimeout(() => {
              this.ensurePositionProtected(symbol, positionSide, positionAmt).catch(error => {
logErrorWithTimestamp(`PositionManager: Failed to ensure protection for ${symbol}:`, error?.response?.data || error?.message);
              });
            }, 100);
          }

          // Broadcast to UI
          if (this.statusBroadcaster) {
            this.statusBroadcaster.broadcastPositionUpdate({
              symbol: pos.s,
              side: positionAmt > 0 ? 'LONG' : 'SHORT',
              quantity: Math.abs(positionAmt),
              price: parseFloat(pos.ep),
              type: 'updated',
              pnl: parseFloat(pos.up)
            });
          }

          // Trigger balance refresh if position size changed
          if (sizeChanged) {
            this.refreshBalance();
          }
        }
      });

      // Trigger PnL checks for all active positions after processing update
      for (const [key, position] of this.currentPositions.entries()) {
        const activeAmt = parseFloat(position.positionAmt);
        if (Math.abs(activeAmt) > 0.001) {
          logWithTimestamp(`PositionManager: Triggering PnL check for ${position.symbol} (${position.positionSide})`);
          this.checkAndAdjustOrdersForPosition(key).catch(error => {
            logErrorWithTimestamp(`PositionManager: Failed PnL check for ${position.symbol}:`, error?.response?.data || error?.message || error);
          });
        }
      }

      // Check for closed positions (positions that were in our map but aren't in the update)
      // IMPORTANT: ACCOUNT_UPDATE may contain partial updates (only changed positions)
      // We should only consider a position closed if its symbol was included in the update with 0 amount
      const symbolsInUpdate = new Set<string>();
      positions.forEach((pos: any) => {
        symbolsInUpdate.add(pos.s);
      });

      for (const [key, orders] of this.positionOrders.entries()) {
        if (!this.currentPositions.has(key)) {
          // Extract symbol from key
          const [symbol] = key.split('_');

          // Only consider it closed if this symbol was actually in the update
          // If the symbol wasn't in the update, it means the position still exists but wasn't changed
          if (!symbolsInUpdate.has(symbol)) {
            // Symbol not in update - position likely still exists, preserve tracking
logWithTimestamp(`PositionManager: Position ${key} not in update, preserving order tracking (partial update)`);

            // Try to restore the position from previous state if available
            const previousPosition = previousPositions.get(key);
            if (previousPosition) {
              this.currentPositions.set(key, previousPosition);
logWithTimestamp(`PositionManager: Restored position ${key} from previous state`);
            }
            continue;
          }

          // Position was actually closed (symbol was in update with 0 amount)
logWithTimestamp(`PositionManager: Position ${key} was closed`);

          // Invalidate income cache when position closes (generates realized PnL, commission)
          invalidateIncomeCache();
logWithTimestamp(`PositionManager: Invalidated income cache after position ${key} closed`);

          const cancelLockKey = `cancel_${symbol}`;

          // Only cancel if not already in progress
          if (!this.orderCancellationLocks.has(cancelLockKey)) {
logWithTimestamp(`PositionManager: Cancelling protective orders for closed position ${key}`);
            // Cancel any remaining SL/TP orders if they exist (async, don't await to avoid blocking)
            this.cancelProtectiveOrders(key, orders).catch(error => {
logErrorWithTimestamp(`PositionManager: Failed to cancel protective orders for ${key}:`, error?.response?.data || error?.message);
            });
          } else {
logWithTimestamp(`PositionManager: Order cancellation already in progress for ${symbol}, skipping`);
          }

          // Clean up tracking maps
          this.positionOrders.delete(key);
          this.previousPositionSizes.delete(key);

          // Trigger balance refresh after position closure
          this.refreshBalance();
        }
      }
    }
  }

  private handleOrderUpdate(event: any): void {
    // Forward to PnL service for commission tracking
    const pnlService = require('../services/pnlService').default;
    pnlService.updateFromOrderEvent(event);

    // Forward the ORDER_TRADE_UPDATE event to the web UI
    if (this.statusBroadcaster) {
      this.statusBroadcaster.broadcastOrderUpdate(event);
    }

    const order = event.o;
    const symbol = order.s;
    const orderType = order.o;
    const orderStatus = order.X;
    const _positionSide = order.ps || 'BOTH';
    const side = order.S;
    const orderId = order.i;

    // Enhanced logging for order lifecycle tracking
logWithTimestamp(`PositionManager: ORDER_TRADE_UPDATE - Symbol: ${symbol}, OrderId: ${orderId}, Type: ${orderType}, Status: ${orderStatus}, Side: ${side}`);

    // Check if this is a filled order that affects positions (SL/TP fills)
    if (orderStatus === 'FILLED' && order.rp) { // rp = realized profit (from exchange API)
      logWithTimestamp(`PositionManager: Reduce-only order filled for ${symbol}`);
      // Trigger balance refresh after SL/TP execution
      this.refreshBalance();
    }

    // Track our SL/TP order IDs when they're placed
    if (orderStatus === 'NEW' && (orderType === 'STOP_MARKET' || orderType === 'TAKE_PROFIT_MARKET')) {
      const _executedQty = parseFloat(order.z || '0');
      const origQty = parseFloat(order.q);

      // Find the matching position by both symbol and quantity
      let bestMatch: { key: string; position: ExchangePosition; quantityDiff: number } | null = null;

      for (const [key, position] of this.currentPositions.entries()) {
        if (position.symbol === symbol) {
          const posAmt = parseFloat(position.positionAmt);
          const positionQty = Math.abs(posAmt);

          // Check if this order is for this position (same symbol and opposite side)
          if ((posAmt > 0 && side === 'SELL') || (posAmt < 0 && side === 'BUY')) {
            // Calculate the difference in quantity
            const quantityDiff = Math.abs(origQty - positionQty);

            // Check if this position already has the order type we're trying to assign
            const existingOrders = this.positionOrders.get(key);
            const alreadyHasThisOrderType =
              (orderType === 'STOP_MARKET' && existingOrders?.slOrderId) ||
              (orderType === 'TAKE_PROFIT_MARKET' && existingOrders?.tpOrderId);

            // Prefer positions without this order type, or find the best quantity match
            if (!bestMatch ||
                (!alreadyHasThisOrderType && quantityDiff < bestMatch.quantityDiff) ||
                (alreadyHasThisOrderType && bestMatch.quantityDiff > 0.00000001 && quantityDiff < 0.00000001)) {
              bestMatch = { key, position, quantityDiff };
            }
          }
        }
      }

      // Assign the order to the best matching position
      if (bestMatch) {
        const { key, position, quantityDiff } = bestMatch;

        if (!this.positionOrders.has(key)) {
          this.positionOrders.set(key, {});
        }
        const orders = this.positionOrders.get(key)!;

        if (quantityDiff > 0.00000001) {
logWarnWithTimestamp(`PositionManager: WARNING - Order quantity mismatch for ${key}. Order: ${origQty}, Position: ${Math.abs(parseFloat(position.positionAmt))}`);
        }

        if (orderType === 'STOP_MARKET') {
          // Check if we already have a different SL order tracked
          if (orders.slOrderId && orders.slOrderId !== orderId) {
logWarnWithTimestamp(`PositionManager: WARNING - Position ${key} already has SL order ${orders.slOrderId}, replacing with ${orderId}`);
          }
          orders.slOrderId = orderId;
logWithTimestamp(`PositionManager: Tracked NEW SL order ${orderId} for position ${key} (${symbol}) - qty match: ${quantityDiff < 0.00000001 ? 'exact' : 'approximate'}`);
        } else if (orderType === 'TAKE_PROFIT_MARKET') {
          // Check if we already have a different TP order tracked
          if (orders.tpOrderId && orders.tpOrderId !== orderId) {
logWarnWithTimestamp(`PositionManager: WARNING - Position ${key} already has TP order ${orders.tpOrderId}, replacing with ${orderId}`);
          }
          orders.tpOrderId = orderId;
logWithTimestamp(`PositionManager: Tracked NEW TP order ${orderId} for position ${key} (${symbol}) - qty match: ${quantityDiff < 0.00000001 ? 'exact' : 'approximate'}`);
        }
      } else {
logWarnWithTimestamp(`PositionManager: WARNING - Could not find matching position for ${orderType} order ${orderId} (${symbol}, qty: ${origQty})`);
      }
    }

    // Handle filled orders
    if (orderStatus === 'FILLED') {
      const executedQty = parseFloat(order.z || '0');
      const avgPrice = parseFloat(order.ap || order.p || '0');

      if (!order.cp && !order.R) { // Not close-all and not reduce-only - this is an entry
logWithTimestamp(`PositionManager: Entry order filled for ${symbol}`);

        // Broadcast order filled event
        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastOrderFilled({
            symbol,
            side,
            orderType,
            executedQty,
            price: avgPrice,
            orderId: orderId?.toString(),
          });
        }

        // Emit event for Hunter to track
        this.emit('orderFilled', {
          symbol,
          side,
          orderType,
          orderId: orderId?.toString(),
        });

        // Position will be updated via ACCOUNT_UPDATE event
        // Just wait for it and then place SL/TP
      } else if (orderType === 'STOP_MARKET' || orderType === 'STOP' ||
                 orderType === 'TAKE_PROFIT_MARKET' || orderType === 'TAKE_PROFIT' ||
                 (orderType === 'LIMIT' && order.R)) { // Any reduce-only order
        // SL/TP filled, position closed
logWithTimestamp(`PositionManager: ${orderType} (reduce-only) filled for ${symbol}`);

        // Clean up our tracking
        for (const [key, orders] of this.positionOrders.entries()) {
          if (orders.slOrderId === orderId || orders.tpOrderId === orderId) {
            const [posSymbol] = key.split('_');

            // Validate that the filled order is for the correct symbol
            if (posSymbol !== symbol) {
logErrorWithTimestamp(`PositionManager: CRITICAL - Order ${orderId} filled for ${symbol} but tracked under position ${key} (${posSymbol})`);
              continue; // Don't process mismatched orders
            }

logWithTimestamp(`PositionManager: ${orderType} order ${orderId} filled for position ${key}, cancelling opposite order`);

            // Cancel the other order if it exists (async, don't await to avoid blocking)
            if (orders.slOrderId === orderId && orders.tpOrderId) {
logWithTimestamp(`PositionManager: Cancelling opposite TP order ${orders.tpOrderId} for ${symbol}`);
              this.cancelOrderById(symbol, orders.tpOrderId).catch(error => {
logErrorWithTimestamp(`PositionManager: Failed to cancel TP order ${orders.tpOrderId}:`, error?.response?.data || error?.message);
              });
            } else if (orders.tpOrderId === orderId && orders.slOrderId) {
logWithTimestamp(`PositionManager: Cancelling opposite SL order ${orders.slOrderId} for ${symbol}`);
              this.cancelOrderById(symbol, orders.slOrderId).catch(error => {
logErrorWithTimestamp(`PositionManager: Failed to cancel SL order ${orders.slOrderId}:`, error?.response?.data || error?.message);
              });
            }
            this.positionOrders.delete(key);
            break;
          }
        }

        let realizedPnl = parseFloat(order.rp || '0');

        // If exchange didn't provide PnL (returns 0), calculate it ourselves
        if (realizedPnl === 0 && (orderType === 'TAKE_PROFIT' || orderType === 'TAKE_PROFIT_MARKET' || orderType === 'STOP_MARKET' || orderType === 'STOP')) {
logWithTimestamp(`PositionManager: Exchange returned PnL=0 for ${orderType}, attempting to calculate from position data`);

          // Find the position key that matches this order
          let positionKey: string | undefined;
          for (const [key, orders] of this.positionOrders.entries()) {
            if (orders.slOrderId === orderId || orders.tpOrderId === orderId) {
              positionKey = key;
              break;
            }
          }

          if (positionKey) {
            const position = this.currentPositions.get(positionKey);
            if (position && position.entryPrice) {
              const entryPrice = parseFloat(position.entryPrice);
              const exitPrice = avgPrice;
              const quantity = executedQty;

              // Calculate PnL based on position direction
              // If closing with SELL order = was LONG position
              // If closing with BUY order = was SHORT position
              if (side === 'SELL') {
                // Closing LONG: profit = (exit - entry) * quantity
                realizedPnl = (exitPrice - entryPrice) * quantity;
              } else {
                // Closing SHORT: profit = (entry - exit) * quantity
                realizedPnl = (entryPrice - exitPrice) * quantity;
              }

logWithTimestamp(`PositionManager: Calculated PnL for ${symbol} ${orderType}: Entry=${entryPrice.toFixed(2)}, Exit=${exitPrice.toFixed(2)}, Qty=${quantity}, PnL=$${realizedPnl.toFixed(2)}`);
            } else {
logWarnWithTimestamp(`PositionManager: Could not find position entry price for ${positionKey} to calculate PnL`);
            }
          } else {
logWarnWithTimestamp(`PositionManager: Could not find position key for order ${orderId} to calculate PnL`);
          }
        } else if (realizedPnl !== 0) {
logWithTimestamp(`PositionManager: Using exchange-provided PnL for ${symbol} ${orderType}: $${realizedPnl.toFixed(2)}`);
        }

        // Broadcast order filled event (SL/TP)
        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastOrderFilled({
            symbol,
            side,
            orderType,
            executedQty,
            price: avgPrice,
            orderId: orderId?.toString(),
            pnl: realizedPnl,
          });

          // Also broadcast position closed event
          this.statusBroadcaster.broadcastPositionClosed({
            symbol,
            side: side === 'BUY' ? 'SHORT' : 'LONG', // Opposite of closing order
            quantity: executedQty,
            pnl: realizedPnl,
            reason: orderType.includes('STOP') ? 'Stop Loss' : 'Take Profit',
          });

          // Keep the existing position update for backward compatibility
          this.statusBroadcaster.broadcastPositionUpdate({
            symbol: symbol,
            side: side === 'BUY' ? 'SHORT' : 'LONG',
            quantity: parseFloat(order.q),
            price: parseFloat(order.ap || '0'),
            type: 'closed',
            pnl: realizedPnl,
          });
        }
      }
    }

    // Handle cancelled or expired orders
    if (orderStatus === 'CANCELED' || orderStatus === 'EXPIRED') {
logWithTimestamp(`PositionManager: Order ${orderId} ${orderStatus} for ${symbol}`);

      // Emit event for Hunter to clean up pending tracking
      this.emit('orderCancelled', {
        symbol,
        side,
        orderType,
        orderId: orderId?.toString(),
        status: orderStatus,
      });

      // Clean up any SL/TP tracking if this was a protective order
      for (const [key, orders] of this.positionOrders.entries()) {
        if (orders.slOrderId === orderId || orders.tpOrderId === orderId) {
          if (orders.slOrderId === orderId) {
            delete orders.slOrderId;
logWithTimestamp(`PositionManager: Removed cancelled SL order ${orderId} from tracking for ${key}`);
logWithTimestamp(`PositionManager: WARNING - Position ${key} now missing SL protection, will attempt to re-place`);
          } else if (orders.tpOrderId === orderId) {
            delete orders.tpOrderId;
logWithTimestamp(`PositionManager: Removed cancelled TP order ${orderId} from tracking for ${key}`);
logWithTimestamp(`PositionManager: WARNING - Position ${key} now missing TP protection, will attempt to re-place`);
          }

          // CRITICAL FIX: Do NOT delete position tracking when orders are cancelled
          // The position still exists and needs protection!
          // Only delete tracking when the position itself is confirmed closed
          if (!orders.slOrderId && !orders.tpOrderId) {
            // Check if position still exists before removing tracking
            if (this.currentPositions.has(key)) {
logWithTimestamp(`PositionManager: CRITICAL - Position ${key} lost all protective orders but position is still open!`);
logWithTimestamp(`PositionManager: Will attempt to re-place protective orders on next sync cycle`);
              // Keep the tracking entry so we know this position needs protection
              // The periodic sync will detect missing orders and re-place them
            } else {
              // Position is actually closed, safe to remove tracking
logWithTimestamp(`PositionManager: Position ${key} is closed, removing order tracking`);
              this.positionOrders.delete(key);
            }
          }
          break;
        }
      }
    }
  }

  // Listen for new positions from Hunter
  public onNewPosition(data: { symbol: string; side: string; quantity: number; orderId?: number }): void {
    // In the new architecture, we wait for ACCOUNT_UPDATE to confirm the position
    // The WebSocket will tell us when the position is actually open
logWithTimestamp(`PositionManager: Notified of potential new position: ${data.symbol} ${data.side}`);

    // For paper mode, simulate the position
    if (this.config.global.paperMode) {
      // Use the proper position side based on hedge mode
      const positionSide = this.isHedgeMode ?
        (data.side === 'BUY' ? 'LONG' : 'SHORT') : 'BOTH';
      const key = `${data.symbol}_${positionSide}`;

      // Simulate the position in our map
      this.currentPositions.set(key, {
        symbol: data.symbol,
        positionAmt: data.side === 'BUY' ? data.quantity.toString() : (-data.quantity).toString(),
        entryPrice: '0', // Will be updated by market price
        markPrice: '0',
        unRealizedProfit: '0',
        liquidationPrice: '0',
        leverage: this.config.symbols[data.symbol]?.leverage?.toString() || '10',
        marginType: 'isolated',
        isolatedMargin: '0',
        isAutoAddMargin: 'false',
        positionSide: positionSide,
        updateTime: Date.now()
      });

      // Place SL/TP for paper mode
      this.ensurePositionProtected(data.symbol, positionSide, data.side === 'BUY' ? data.quantity : -data.quantity);
    }
  }

  // Adjust protective orders when quantities don't match position size
  private async adjustProtectiveOrders(position: ExchangePosition, currentSlOrder?: ExchangeOrder, currentTpOrder?: ExchangeOrder): Promise<void> {
    const symbol = position.symbol;
    const posAmt = parseFloat(position.positionAmt);
    const key = this.getPositionKey(symbol, position.positionSide, posAmt);

    // Check if adjustment is already in progress for this position
    if (this.orderPlacementLocks.has(key)) {
logWithTimestamp(`PositionManager: Order adjustment already in progress for ${key}, skipping`);
      return;
    }

    // Set lock to prevent concurrent adjustments
    this.orderPlacementLocks.add(key);

    try {
logWithTimestamp(`PositionManager: Adjusting protective orders for ${symbol} - Position size: ${Math.abs(posAmt)}`);

      // Cancel existing orders with wrong quantities using retry logic
      const orders = this.positionOrders.get(key) || {};
      const cancelPromises: Promise<void>[] = [];

      let needNewSL = false;
      let needNewTP = false;

      // Check and cancel SL if quantity doesn't match
      if (currentSlOrder) {
        const slOrderQty = parseFloat(currentSlOrder.origQty);
        if (Math.abs(slOrderQty - Math.abs(posAmt)) > 0.00000001) {
logWithTimestamp(`PositionManager: Cancelling SL order ${currentSlOrder.orderId} (qty: ${slOrderQty}) to replace with correct size`);
          cancelPromises.push(this.cancelOrderWithRetry(symbol, currentSlOrder.orderId, 'SL'));
          needNewSL = true;
          delete orders.slOrderId;
        }
      } else {
        needNewSL = true;
      }

      // Check and cancel TP if quantity doesn't match
      if (currentTpOrder) {
        const tpOrderQty = parseFloat(currentTpOrder.origQty);
        if (Math.abs(tpOrderQty - Math.abs(posAmt)) > 0.00000001) {
logWithTimestamp(`PositionManager: Cancelling TP order ${currentTpOrder.orderId} (qty: ${tpOrderQty}) to replace with correct size`);
          cancelPromises.push(this.cancelOrderWithRetry(symbol, currentTpOrder.orderId, 'TP'));
          needNewTP = true;
          delete orders.tpOrderId;
        }
      } else {
        needNewTP = true;
      }

      // Wait for cancellations to complete
      if (cancelPromises.length > 0) {
        try {
          await Promise.all(cancelPromises);
logWithTimestamp(`PositionManager: Cancelled ${cancelPromises.length} order(s) for adjustment`);
        } catch (error: any) {
logErrorWithTimestamp('PositionManager: Error cancelling orders for adjustment:', error?.response?.data || error?.message);
          // Continue to try placing new orders even if cancellation failed
        }
      }

      // Update our tracking
      this.positionOrders.set(key, orders);

      // Place new orders with correct quantities
      if (needNewSL || needNewTP) {
        await this.placeProtectiveOrders(position, needNewSL, needNewTP);
      }
    } finally {
      // Always release the lock
      this.orderPlacementLocks.delete(key);
    }
  }

  // Place protective orders with lock to prevent duplicates
  private async placeProtectiveOrdersWithLock(key: string, position: ExchangePosition, placeSL: boolean, placeTP: boolean): Promise<void> {
    // Set lock to prevent concurrent order placement
    this.orderPlacementLocks.add(key);

    try {
      await this.placeProtectiveOrders(position, placeSL, placeTP);
    } finally {
      // Always release the lock
      this.orderPlacementLocks.delete(key);
    }
  }

  // Place protective orders (SL/TP) for a position
  private async placeProtectiveOrders(position: ExchangePosition, placeSL: boolean, placeTP: boolean): Promise<void> {
    const symbol = position.symbol;
    const symbolConfig = this.config.symbols[symbol];
    if (!symbolConfig) {
logWarnWithTimestamp(`PositionManager: No config for symbol ${symbol}`);
      return;
    }

    const posAmt = parseFloat(position.positionAmt);
    // Add this check right after parsing posAmt
    if (Math.abs(posAmt) < 0.001) {  // Using a small epsilon to account for floating point
      logWithTimestamp(`PositionManager: Position ${symbol} is closed or has zero quantity, skipping TP/SL placement`);
      return;
    }
    const entryPrice = parseFloat(position.entryPrice);
    const quantity = Math.abs(posAmt);
    const isLong = posAmt > 0;
    let leverage = parseFloat(position.leverage);
    if (!leverage || leverage <= 0 || Number.isNaN(leverage)) {
      const trackedLeverage = this.symbolLeverage.get(symbol);
      if (trackedLeverage && trackedLeverage > 0) {
        leverage = trackedLeverage;
      } else if (symbolConfig.leverage && symbolConfig.leverage > 0) {
        leverage = symbolConfig.leverage;
        logWithTimestamp(`PositionManager: Using configured leverage ${leverage}x for ${symbol} (position leverage unavailable)`);
      } else {
        leverage = 1;
        logWithTimestamp(`PositionManager: Defaulting leverage to 1x for ${symbol} (no leverage data available)`);
      }
    }
    const key = this.getPositionKey(symbol, position.positionSide, posAmt);

    // Get or create order tracking
    if (!this.positionOrders.has(key)) {
      this.positionOrders.set(key, {});
    }
    const orders = this.positionOrders.get(key)!;

    // Double-check existing orders before placing new ones
    try {
      const openOrders = await this.getOpenOrdersFromExchange();

      // Find ALL existing SL orders for this position
      const existingSlOrders = openOrders.filter(o =>
        o.symbol === symbol &&
        (o.type === 'STOP_MARKET' || o.type === 'STOP') &&
        o.reduceOnly &&
        ((posAmt > 0 && o.side === 'SELL') || (posAmt < 0 && o.side === 'BUY'))
      );

      // Find ALL existing TP orders for this position
      const existingTpOrders = openOrders.filter(o =>
        o.symbol === symbol &&
        (o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' || o.type === 'LIMIT') &&
        o.reduceOnly &&
        ((posAmt > 0 && o.side === 'SELL') || (posAmt < 0 && o.side === 'BUY'))
      );

      // Handle multiple SL orders - keep the first one, cancel the rest
      if (existingSlOrders.length > 1) {
logWithTimestamp(`PositionManager: Found ${existingSlOrders.length} SL orders for ${key}, cancelling duplicates`);
        for (let i = 1; i < existingSlOrders.length; i++) {
          try {
            await this.cancelOrderById(symbol, existingSlOrders[i].orderId);
logWithTimestamp(`PositionManager: Cancelled duplicate SL order ${existingSlOrders[i].orderId}`);
          } catch (error: any) {
logErrorWithTimestamp(`PositionManager: Failed to cancel duplicate SL order ${existingSlOrders[i].orderId}:`, error?.response?.data || error?.message);
            // Non-critical error - duplicate cancellation failure
          }
        }
      }

      // Handle multiple TP orders - keep the first one, cancel the rest
      if (existingTpOrders.length > 1) {
logWithTimestamp(`PositionManager: Found ${existingTpOrders.length} TP orders for ${key}, cancelling duplicates`);
        for (let i = 1; i < existingTpOrders.length; i++) {
          try {
            await this.cancelOrderById(symbol, existingTpOrders[i].orderId);
logWithTimestamp(`PositionManager: Cancelled duplicate TP order ${existingTpOrders[i].orderId}`);
          } catch (error: any) {
logErrorWithTimestamp(`PositionManager: Failed to cancel duplicate TP order ${existingTpOrders[i].orderId}:`, error?.response?.data || error?.message);
            // Non-critical error - duplicate cancellation failure
          }
        }
      }

      // Update our tracking with the remaining orders
      const existingSlOrder = existingSlOrders.length > 0 ? existingSlOrders[0] : undefined;
      const existingTpOrder = existingTpOrders.length > 0 ? existingTpOrders[0] : undefined;

      if (existingSlOrder) {
        orders.slOrderId = existingSlOrder.orderId;
        placeSL = false; // Don't place if one already exists
logWithTimestamp(`PositionManager: Found existing SL order ${existingSlOrder.orderId} for ${key}, skipping placement`);
      }

      if (existingTpOrder) {
        orders.tpOrderId = existingTpOrder.orderId;
        placeTP = false; // Don't place if one already exists
logWithTimestamp(`PositionManager: Found existing TP order ${existingTpOrder.orderId} for ${key}, skipping placement`);
      }

      // Note: we no longer return early here; even if protective orders exist we still
      // perform TP/SL evaluation below to trigger market closes when targets are hit.
    } catch (error: any) {
logErrorWithTimestamp('PositionManager: Failed to check existing orders, proceeding with placement:', error?.response?.data || error?.message);
      // Log to error database
      errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
        type: 'api',
        severity: 'low',
        context: {
          component: 'PositionManager',
          symbol: position.symbol,
          userAction: 'Checking existing orders',
          metadata: error?.response?.data
        }
      });
    }

    const noOrdersNeeded = !placeSL && !placeTP;

    let currentPrice: number;
    try {
      const ticker = await axios.get(`https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${symbol}`);
      currentPrice = parseFloat(ticker.data.price);
      if (!Number.isFinite(currentPrice)) {
logWarnWithTimestamp(`PositionManager: Invalid current price for ${symbol} (${ticker.data.price}), skipping protection update`);
        return;
      }
    } catch (priceError: any) {
logErrorWithTimestamp(`PositionManager: Failed to fetch current price for ${symbol}:`, priceError?.response?.data || priceError?.message);
      return;
    }

    const rawSlPrice = isLong
      ? entryPrice * (1 - symbolConfig.slPercent / 100)
      : entryPrice * (1 + symbolConfig.slPercent / 100);
    const rawTpPrice = isLong
      ? entryPrice * (1 + symbolConfig.tpPercent / 100)
      : entryPrice * (1 - symbolConfig.tpPercent / 100);

    const margin = (quantity * entryPrice) / leverage;
    const pnl = isLong
      ? (currentPrice - entryPrice) * quantity
      : (entryPrice - currentPrice) * quantity;
    const pnlPercent = margin > 0 ? (pnl / Math.abs(margin)) * 100 : 0;

    logWithTimestamp(`PositionManager: [TP Check] ${symbol} | Side: ${isLong ? 'LONG' : 'SHORT'}`);
    logWithTimestamp(`  Entry: ${entryPrice} | Current: ${currentPrice} | TP%: ${symbolConfig.tpPercent}%`);
    logWithTimestamp(`  Position: ${quantity} ${symbol.replace('USDT', '')} | Leverage: ${leverage}x | Margin: $${margin.toFixed(2)}`);
    logWithTimestamp(`  PnL: $${pnl.toFixed(2)} (${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}% ROE) | TP Target: ${symbolConfig.tpPercent}%`);
    logWithTimestamp(`PositionManager: [PnL Debug] ${symbol} | ` +
      `Entry: ${entryPrice} | Current: ${currentPrice} | ` +
      `Qty: ${quantity} | Leverage: ${leverage}x\n` +
      `  PnL Calc: ${isLong ? `(${currentPrice} - ${entryPrice}) * ${quantity}` : `(${entryPrice} - ${currentPrice}) * ${quantity}`} = $${pnl.toFixed(2)}\n` +
      `  Margin: (${quantity} * ${entryPrice}) / ${leverage} = $${margin.toFixed(2)}\n` +
      `  PnL%: (${pnl} / ${Math.abs(margin)}) * 100 = ${pnlPercent.toFixed(2)}%`);

    const pastTP = Math.abs(pnlPercent) >= symbolConfig.tpPercent;
    logWithTimestamp(`PositionManager: [TP Check] ${symbol} | ` +
      `Current PnL%: ${Math.abs(pnlPercent).toFixed(2)}% | ` +
      `TP Target: ${symbolConfig.tpPercent}% | ` +
      `TP ${pastTP ? 'REACHED' : 'NOT REACHED'}`);

    if (pastTP) {
      logWithTimestamp(`PositionManager: TP TRIGGERED! ${symbol} at ${pnlPercent.toFixed(2)}% ROE (target: ${symbolConfig.tpPercent}%)`);
      logWithTimestamp(`  Position details: ${quantity} ${symbol.replace('USDT', '')} @ ${entryPrice} | Current: ${currentPrice}`);

      if (!entryPrice || entryPrice <= 0) {
        logWithTimestamp(`PositionManager: WARNING - Invalid entry price (${entryPrice}) for ${symbol}`);
        logWithTimestamp(`PositionManager: Skipping auto-close due to data issue`);
        return;
      }

      logWithTimestamp(`PositionManager: Position ${symbol} has exceeded TP target (${pnlPercent.toFixed(2)}% > ${symbolConfig.tpPercent}%)`);
      logWithTimestamp(`  Entry: ${entryPrice} | Current: ${currentPrice} | Side: ${isLong ? 'LONG' : 'SHORT'}`);
      logWithTimestamp(`  Position size: ${quantity} ${symbol.replace('USDT', '')} | Leverage: ${leverage}x | Margin: $${margin.toFixed(2)}`);
      logWithTimestamp(`PositionManager: Closing position at market (ROE-based TP hit)`);

      try {
        const formattedQuantity = symbolPrecision.formatQuantity(symbol, quantity);
        const orderPositionSide = position.positionSide || 'BOTH';
        const side = isLong ? 'SELL' : 'BUY';

        const marketParams: any = {
          symbol,
          side: side as 'BUY' | 'SELL',
          type: 'MARKET',
          quantity: formattedQuantity,
          positionSide: orderPositionSide as 'BOTH' | 'LONG' | 'SHORT',
          newClientOrderId: `al_btc_${symbol}_${Date.now() % 10000000000}`,
        };

        if (orderPositionSide === 'BOTH') {
          marketParams.reduceOnly = true;
        }

        const marketOrder = await placeOrder(marketParams, this.config.api);
        logWithTimestamp(`PositionManager: Position closed at market! Order ID: ${marketOrder.orderId}, PnL: ~${pnlPercent.toFixed(2)}%`);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastPositionClosed({
            symbol,
            side: isLong ? 'LONG' : 'SHORT',
            quantity,
            pnl: pnlPercent * quantity * currentPrice / 100,
            reason: 'Auto-closed at market (exceeded TP target)',
          });
        }

        if (placeSL) {
logWithTimestamp(`PositionManager: Position closed, skipping SL placement`);
        }
        return;
      } catch (marketError: any) {
logErrorWithTimestamp(`PositionManager: Failed to close at market: ${marketError.response?.data?.msg || marketError.message}`);
        logWithTimestamp(`PositionManager: Skipping TP placement since position is past target`);
        placeTP = false;
      }
    }

    let adjustedSlPrice = rawSlPrice;
    if (placeSL) {
      if ((isLong && rawSlPrice >= currentPrice) || (!isLong && rawSlPrice <= currentPrice)) {
        const bufferPercent = 0.1;
        adjustedSlPrice = isLong
          ? currentPrice * (1 - bufferPercent / 100)
          : currentPrice * (1 + bufferPercent / 100);

logWithTimestamp(`PositionManager: Position ${symbol} is underwater. Adjusting SL from ${rawSlPrice.toFixed(4)} to ${adjustedSlPrice.toFixed(4)} (current: ${currentPrice.toFixed(4)})`);
      }
    }

    try {
      if (noOrdersNeeded) {
logWithTimestamp(`PositionManager: All protective orders already exist for ${key}`);
        return;
      }

      if (placeSL && placeTP) {
        const slPrice = symbolPrecision.formatPrice(symbol, adjustedSlPrice);
        const tpPrice = symbolPrecision.formatPrice(symbol, rawTpPrice);
        const formattedQuantity = symbolPrecision.formatQuantity(symbol, quantity);

        const orderPositionSide = position.positionSide || 'BOTH';
        const side = isLong ? 'SELL' : 'BUY';

logWithTimestamp(`PositionManager: Placing SL/TP batch for ${symbol}:`);
logWithTimestamp(`  Quantity: ${formattedQuantity}`);
logWithTimestamp(`  SL price: ${slPrice.toFixed(4)}`);
logWithTimestamp(`  TP price: ${tpPrice.toFixed(4)}`);
logWithTimestamp(`  Side: ${side}`);
logWithTimestamp(`  Position Mode: ${this.isHedgeMode ? 'HEDGE' : 'ONE-WAY'}`);
logWithTimestamp(`  Position Side: ${orderPositionSide}`);

        const batchResult = await placeStopLossAndTakeProfit({
          symbol,
          side: side as 'BUY' | 'SELL',
          quantity: formattedQuantity,
          stopLossPrice: slPrice,
          takeProfitPrice: tpPrice,
          positionSide: orderPositionSide as 'BOTH' | 'LONG' | 'SHORT',
          reduceOnly: orderPositionSide === 'BOTH',
        }, this.config.api);

        if (batchResult.stopLoss) {
          orders.slOrderId = typeof batchResult.stopLoss.orderId === 'string' ?
            parseInt(batchResult.stopLoss.orderId) : batchResult.stopLoss.orderId;
logWithTimestamp(`PositionManager: Placed SL for ${symbol} at ${slPrice.toFixed(4)}, orderId: ${batchResult.stopLoss.orderId}`);

          if (this.statusBroadcaster) {
            this.statusBroadcaster.broadcastStopLossPlaced({
              symbol,
              price: slPrice,
              quantity,
              orderId: batchResult.stopLoss.orderId?.toString(),
            });
          }
        }

        if (batchResult.takeProfit) {
          orders.tpOrderId = typeof batchResult.takeProfit.orderId === 'string' ?
            parseInt(batchResult.takeProfit.orderId) : batchResult.takeProfit.orderId;
logWithTimestamp(`PositionManager: Placed TP for ${symbol} at ${tpPrice.toFixed(4)}, orderId: ${batchResult.takeProfit.orderId}`);

          if (this.statusBroadcaster) {
            this.statusBroadcaster.broadcastTakeProfitPlaced({
              symbol,
              price: tpPrice,
              quantity,
              orderId: batchResult.takeProfit.orderId?.toString(),
            });
          }
        }

        const actualErrors = batchResult.errors.filter(
          errorMsg => !errorMsg.includes('Order would immediately trigger')
        );

        if (actualErrors.length > 0) {
logErrorWithTimestamp(`PositionManager: Batch order errors for ${symbol}:`, actualErrors);

          for (const errorMsg of actualErrors) {
            await errorLogger.logTradingError(
              'batchOrderPlacement',
              symbol,
              new Error(errorMsg),
              {
                type: 'trading',
                severity: 'high',
                context: {
                  component: 'PositionManager',
                  userAction: 'placeProtectionOrders',
                  metadata: {
                    slAttempted: placeSL,
                    tpAttempted: placeTP,
                    slSucceeded: !!batchResult.stopLoss,
                    tpSucceeded: !!batchResult.takeProfit,
                    entryPrice,
                    currentQuantity: quantity
                  }
                }
              }
            );
          }
        }

        if (batchResult.errors.length > 0) {
          const slFailed = placeSL && !batchResult.stopLoss;
          const tpFailed = placeTP && !batchResult.takeProfit;

          if (slFailed || tpFailed) {
logWithTimestamp(`PositionManager: Batch partially failed. Retrying failed orders individually...`);

            if (slFailed) {
              orders.slOrderId = undefined;
logWithTimestamp(`PositionManager: Will retry SL order for ${symbol}`);
            }
            if (tpFailed) {
              orders.tpOrderId = undefined;
logWithTimestamp(`PositionManager: Will retry TP order for ${symbol}`);
            }

            placeSL = slFailed;
            placeTP = tpFailed;
          } else {
logWithTimestamp(`PositionManager: Batch completed with non-critical errors`);
            this.positionOrders.set(key, orders);
            return;
          }
        } else {
logWithTimestamp(`PositionManager: Batch order placement successful and saved 1 API call!`);
          this.positionOrders.set(key, orders);
          return;
        }
      }

      if (placeSL || placeTP) {
logWithTimestamp(`PositionManager: Placing protection orders individually for ${symbol} (SL: ${placeSL}, TP: ${placeTP})`);
      }

      if (placeSL) {
        const slPrice = symbolPrecision.formatPrice(symbol, adjustedSlPrice);
        const formattedQuantity = symbolPrecision.formatQuantity(symbol, quantity);

logWithTimestamp(`PositionManager: SL order preparation for ${symbol}:`);
logWithTimestamp(`  Raw quantity: ${quantity}`);
logWithTimestamp(`  Formatted quantity: ${formattedQuantity}`);
logWithTimestamp(`  Raw SL price: ${rawSlPrice}`);
logWithTimestamp(`  Adjusted SL price: ${adjustedSlPrice}`);
logWithTimestamp(`  Formatted SL price: ${slPrice}`);

        const orderPositionSide = position.positionSide || 'BOTH';

        const orderParams: any = {
          symbol,
          side: isLong ? 'SELL' : 'BUY',
          type: 'STOP_MARKET',
          quantity: formattedQuantity,
          stopPrice: slPrice,
          positionSide: orderPositionSide as 'BOTH' | 'LONG' | 'SHORT',
          newClientOrderId: `al_sl_${symbol}_${Date.now() % 10000000000}`,
        };

        if (orderPositionSide === 'BOTH') {
          orderParams.reduceOnly = true;
        }

        const slOrder = await placeOrder(orderParams, this.config.api);

        orders.slOrderId = typeof slOrder.orderId === 'string' ? parseInt(slOrder.orderId) : slOrder.orderId;
logWithTimestamp(`PositionManager: Placed SL (STOP_MARKET) for ${symbol} at ${slPrice.toFixed(4)}, orderId: ${slOrder.orderId}`);

        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastStopLossPlaced({
            symbol,
            price: slPrice,
            quantity,
            orderId: slOrder.orderId?.toString(),
          });
        }
      }

      if (placeTP) {
        const pastImmediateTP = isLong
          ? currentPrice >= rawTpPrice
          : currentPrice <= rawTpPrice;

        if (pastImmediateTP) {
          if (!entryPrice || entryPrice <= 0) {
logWithTimestamp(`PositionManager: WARNING - Invalid entry price (${entryPrice}) for ${symbol}, cannot calculate PnL accurately`);
logWithTimestamp(`PositionManager: Skipping auto-close due to data issue`);
            return;
          }

          logWithTimestamp(`PositionManager: Position ${symbol} has exceeded TP target!`);
          logWithTimestamp(`  Entry: ${entryPrice}, Current: ${currentPrice}`);
          logWithTimestamp(`  PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}% ROE), TP target: ${symbolConfig.tpPercent}%`);
          logWithTimestamp(`  Position size: ${quantity}, Margin: $${margin.toFixed(2)}`);
          logWithTimestamp(`PositionManager: Closing position at market - ROE exceeded TP target`);

          try {
            const formattedQuantity = symbolPrecision.formatQuantity(symbol, quantity);
            const orderPositionSide = position.positionSide || 'BOTH';

            const marketParams: any = {
              symbol,
              side: isLong ? 'SELL' : 'BUY',
              type: 'MARKET',
              quantity: formattedQuantity,
              positionSide: orderPositionSide as 'BOTH' | 'LONG' | 'SHORT',
              newClientOrderId: `al_mtp_${symbol}_${Date.now() % 10000000000}`,
            };

            if (orderPositionSide === 'BOTH') {
              marketParams.reduceOnly = true;
            }

            const marketOrder = await placeOrder(marketParams, this.config.api);
            logWithTimestamp(`PositionManager: Position closed at market! Order ID: ${marketOrder.orderId}, PnL: ~${pnlPercent.toFixed(2)}%`);

            if (this.statusBroadcaster) {
              this.statusBroadcaster.broadcastPositionClosed({
                symbol,
                side: isLong ? 'LONG' : 'SHORT',
                quantity,
                pnl: pnlPercent * quantity * currentPrice / 100,
                reason: 'Auto-closed at market (exceeded TP target)',
              });
            }
            return;
          } catch (marketError: any) {
logErrorWithTimestamp(`PositionManager: Failed to close at market: ${marketError.response?.data?.msg || marketError.message}`);
            logWithTimestamp(`PositionManager: Not placing TP order since position is past target and market close failed`);
            return;
          }

        } else {
          const tpPrice = symbolPrecision.formatPrice(symbol, rawTpPrice);
          const formattedQuantity = symbolPrecision.formatQuantity(symbol, quantity);

logWithTimestamp(`PositionManager: TP order preparation for ${symbol}:`);
logWithTimestamp(`  Raw quantity: ${quantity}`);
logWithTimestamp(`  Formatted quantity: ${formattedQuantity}`);
logWithTimestamp(`  Raw TP price: ${rawTpPrice}`);
logWithTimestamp(`  Formatted TP price: ${tpPrice}`);

          const orderPositionSide = position.positionSide || 'BOTH';
          const tpParams: any = {
            symbol,
            side: isLong ? 'SELL' : 'BUY',
            type: 'TAKE_PROFIT_MARKET',
            quantity: formattedQuantity,
            stopPrice: tpPrice,
            positionSide: orderPositionSide as 'BOTH' | 'LONG' | 'SHORT',
            newClientOrderId: `al_tp_${symbol}_${Date.now() % 10000000000}`,
          };

          if (orderPositionSide === 'BOTH') {
            tpParams.reduceOnly = true;
          }

          const tpOrder = await placeOrder(tpParams, this.config.api);
          orders.tpOrderId = typeof tpOrder.orderId === 'string' ? parseInt(tpOrder.orderId) : tpOrder.orderId;
logWithTimestamp(`PositionManager: Placed TP for ${symbol} at ${tpPrice}, orderId: ${tpOrder.orderId}`);

          if (this.statusBroadcaster) {
            this.statusBroadcaster.broadcastTakeProfitPlaced({
              symbol,
              price: tpPrice,
              quantity,
              orderId: tpOrder.orderId?.toString(),
            });
          }
        }
      }

      if (orders.slOrderId || orders.tpOrderId) {
        this.positionOrders.set(key, orders);
logWithTimestamp(`PositionManager: Protection orders tracked for ${key} - SL: ${orders.slOrderId || 'none'}, TP: ${orders.tpOrderId || 'none'}`);

        // Warn if position is partially protected
        if (!orders.slOrderId && symbolConfig.slPercent > 0) {
logWarnWithTimestamp(`PositionManager: ⚠️ Position ${key} has NO STOP LOSS protection!`);
          await errorLogger.logTradingError(
            'missingStopLoss',
            symbol,
            new Error('Failed to place stop loss order'),
            {
              type: 'trading',
              severity: 'critical',
              context: {
                component: 'PositionManager',
                metadata: {
                  positionKey: key,
                  entryPrice,
                  quantity
                }
              }
            }
          );
        }

        if (!orders.tpOrderId && symbolConfig.tpPercent > 0) {
logWarnWithTimestamp(`PositionManager: ⚠️ Position ${key} has NO TAKE PROFIT order!`);
        }
      } else {
logErrorWithTimestamp(`PositionManager: ❌ No protection orders placed for ${key} - position is UNPROTECTED!`);
        // Don't save empty orders - this ensures periodic check will retry
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.msg || error.message || 'Unknown error';
logErrorWithTimestamp(`PositionManager: Failed to place protective orders for ${symbol}:`, error.response?.data || error.message);

      // Log to error database
      await errorLogger.logTradingError(
        'placeProtectiveOrders',
        symbol,
        error instanceof Error ? error : new Error(errorMsg),
        {
          entryPrice,
          quantity,
          isLong,
          slPercent: symbolConfig.slPercent,
          tpPercent: symbolConfig.tpPercent,
          errorCode: error.response?.data?.code,
          errorDetails: error.response?.data
        }
      );

      // Broadcast error to UI
      if (this.statusBroadcaster) {
        this.statusBroadcaster.broadcastTradingError(
          `Failed to Place Protective Orders - ${symbol}`,
          errorMsg,
          {
            component: 'PositionManager',
            symbol,
            errorCode: error.response?.data?.code,
            rawError: error.response?.data || error,
          }
        );
      }
    }
  }

  private async checkRisk(): Promise<void> {
    // Check total PnL
    const _riskPercent = this.config.global.riskPercent / 100;
    // Simplified: assume some PnL calculation
    // If unrealized PnL < -risk * balance, close all positions
    // Implementation depends on balance query

logWithTimestamp(`PositionManager: Risk check complete`);
  }

  // Clean up orphaned orders (orders for symbols without active positions) and duplicates
  private async cleanupOrphanedOrders(): Promise<void> {
    try {
logWithTimestamp('PositionManager: Checking for orphaned and duplicate orders...');

      const openOrders = await this.getOpenOrdersFromExchange();
      const positions = await this.getPositionsFromExchange();

      // Create map of active positions with their position details
      const activePositions = new Map<string, { symbol: string; positionAmt: number; positionSide: string }>();

      // Create a more detailed position tracking structure
      const symbolPositionDetails = new Map<string, { long: boolean; short: boolean; amounts: number[] }>();

      for (const position of positions) {
        const posAmt = parseFloat(position.positionAmt);
        if (Math.abs(posAmt) > 0) {
          const key = this.getPositionKey(position.symbol, position.positionSide, posAmt);
          activePositions.set(key, {
            symbol: position.symbol,
            positionAmt: posAmt,
            positionSide: position.positionSide
          });

          // Track position details per symbol
          if (!symbolPositionDetails.has(position.symbol)) {
            symbolPositionDetails.set(position.symbol, { long: false, short: false, amounts: [] });
          }
          const details = symbolPositionDetails.get(position.symbol)!;
          details.amounts.push(posAmt);
          if (posAmt > 0) details.long = true;
          if (posAmt < 0) details.short = true;
        }
      }

      const _activeSymbols = new Set(Array.from(activePositions.values()).map(p => p.symbol));

      // Find orphaned orders (reduce-only orders without matching positions)
      // Enhanced check considers order quantity matching
      const orphanedOrders = openOrders.filter(order => {
        if (!order.reduceOnly) return false;

        const symbolDetails = symbolPositionDetails.get(order.symbol);

        // If symbol has no positions at all, it's orphaned
        if (!symbolDetails) {
          const isBotOrder = order.clientOrderId &&
            (order.clientOrderId.startsWith('al_sl_') || order.clientOrderId.startsWith('al_tp_'));
logWithTimestamp(`PositionManager: Found orphaned ${order.type} order for ${order.symbol} (no position) - OrderId: ${order.orderId}, ClientOrderId: ${order.clientOrderId || 'none'}, Bot order: ${isBotOrder ? 'yes' : 'no'}`);
          return true;
        }

        // Check if order matches any position direction
        // SELL reduce-only orders close LONG positions
        // BUY reduce-only orders close SHORT positions
        const orderMatchesPosition =
          (order.side === 'SELL' && symbolDetails.long) ||
          (order.side === 'BUY' && symbolDetails.short);

        if (!orderMatchesPosition) {
logWithTimestamp(`PositionManager: Found orphaned ${order.type} order for ${order.symbol} (direction mismatch) - OrderId: ${order.orderId}, Side: ${order.side}, Has Long: ${symbolDetails.long}, Has Short: ${symbolDetails.short}`);
          return true;
        }

        // Check if this order is tracked by any position
        const orderQty = parseFloat(order.origQty);
        let isTracked = false;

        for (const [key, trackedOrders] of this.positionOrders.entries()) {
          if (trackedOrders.slOrderId === order.orderId || trackedOrders.tpOrderId === order.orderId) {
            isTracked = true;

            // Verify the position still exists
            const position = this.currentPositions.get(key);
            if (!position) {
logWithTimestamp(`PositionManager: Order ${order.orderId} tracked for non-existent position ${key} - marking as orphaned`);
              return true;
            }

            // Verify quantity still matches
            const posQty = Math.abs(parseFloat(position.positionAmt));
            if (Math.abs(orderQty - posQty) > 0.00000001) {
logWithTimestamp(`PositionManager: Order ${order.orderId} quantity mismatch - Order: ${orderQty}, Position: ${posQty}`);
              // Don't mark as orphaned here, it will be handled by adjustment logic
            }
            break;
          }
        }

        // If not tracked and there are multiple positions, check if it's an orphan
        if (!isTracked && symbolDetails.amounts.length > 1) {
          // Check if any position matches this order's quantity
          const matchingPosition = symbolDetails.amounts.find(amt =>
            Math.abs(parseFloat(order.origQty) - amt) < 0.00000001
          );

          if (!matchingPosition) {
logWithTimestamp(`PositionManager: Untracked reduce-only order ${order.orderId} with no matching position quantity - OrderQty: ${order.origQty}, Positions: ${symbolDetails.amounts.join(', ')}`);
            return true;
          }
        }

        return false;
      });

      // Find stuck entry orders (non reduce-only orders that have been open for too long without creating positions)
      // These are LIMIT orders that haven't filled and don't have corresponding positions
      const stuckEntryOrders = openOrders.filter(order => {
        // Only check non reduce-only LIMIT orders
        if (order.reduceOnly || order.type !== 'LIMIT') {
          return false;
        }

        // Check if this symbol has an active position
        const hasPosition = Array.from(activePositions.values()).some(p => p.symbol === order.symbol);

        // Calculate order age
        const orderAge = Date.now() - order.time;

        // For non reduce-only LIMIT orders, ensure they're at least 30 seconds old
        // This prevents cancelling orders that were just placed
        if (orderAge < 30 * 1000) { // 30 seconds
          return false;
        }

        // If no position exists and order is older than 5 minutes, consider it stuck
        const isStuck = !hasPosition && orderAge > 5 * 60 * 1000; // 5 minutes

        if (isStuck) {
logWithTimestamp(`PositionManager: Found stuck entry order for ${order.symbol} - OrderId: ${order.orderId}, Type: ${order.type}, Age: ${Math.round(orderAge / 1000)}s`);
        }

        return isStuck;
      });

      // Find duplicate orders for each active position
      const duplicateOrders: ExchangeOrder[] = [];

      // Group orders by symbol and type for better duplicate detection
      const ordersBySymbolAndType = new Map<string, { sl: ExchangeOrder[]; tp: ExchangeOrder[] }>();

      for (const [key, positionData] of activePositions) {
        const { symbol, positionAmt } = positionData;

        // Initialize order tracking for this symbol if needed
        if (!ordersBySymbolAndType.has(symbol)) {
          ordersBySymbolAndType.set(symbol, { sl: [], tp: [] });
        }

        // Find all SL orders for this specific position
        const slOrders = openOrders.filter(o => {
          // Must match symbol
          if (o.symbol !== symbol) return false;
          // Must be a stop order type
          if (!(o.type === 'STOP_MARKET' || o.type === 'STOP')) return false;
          // Must be reduce-only
          if (!o.reduceOnly) return false;
          // Must match position direction (SELL for LONG, BUY for SHORT)
          const directionMatches = (positionAmt > 0 && o.side === 'SELL') || (positionAmt < 0 && o.side === 'BUY');
          if (!directionMatches) return false;

          // Additional validation: log what we're considering
logWithTimestamp(`PositionManager: Evaluating SL order ${o.orderId} for position ${key} - Symbol: ${o.symbol}, Side: ${o.side}, Type: ${o.type}`);
          return true;
        });

        // Find all TP orders for this specific position
        const tpOrders = openOrders.filter(o => {
          // Must match symbol
          if (o.symbol !== symbol) return false;
          // Must be a take profit or limit order type
          if (!(o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' || o.type === 'LIMIT')) return false;
          // Must be reduce-only
          if (!o.reduceOnly) return false;
          // Must match position direction (SELL for LONG, BUY for SHORT)
          const directionMatches = (positionAmt > 0 && o.side === 'SELL') || (positionAmt < 0 && o.side === 'BUY');
          if (!directionMatches) return false;

          // Additional validation: log what we're considering
logWithTimestamp(`PositionManager: Evaluating TP order ${o.orderId} for position ${key} - Symbol: ${o.symbol}, Side: ${o.side}, Type: ${o.type}`);
          return true;
        });

        // Track orders for this symbol
        const symbolOrders = ordersBySymbolAndType.get(symbol)!;
        symbolOrders.sl.push(...slOrders);
        symbolOrders.tp.push(...tpOrders);

        // Mark duplicates for cancellation (keep first, cancel rest)
        if (slOrders.length > 1) {
logWithTimestamp(`PositionManager: Found ${slOrders.length} SL orders for position ${key} (${symbol}), marking ${slOrders.length - 1} for cancellation`);
          // Sort by order ID to ensure consistent behavior
          slOrders.sort((a, b) => a.orderId - b.orderId);
          duplicateOrders.push(...slOrders.slice(1));
        }

        if (tpOrders.length > 1) {
logWithTimestamp(`PositionManager: Found ${tpOrders.length} TP orders for position ${key} (${symbol}), marking ${tpOrders.length - 1} for cancellation`);
          // Sort by order ID to ensure consistent behavior
          tpOrders.sort((a, b) => a.orderId - b.orderId);
          duplicateOrders.push(...tpOrders.slice(1));
        }
      }

      // Cancel orphaned orders
      if (orphanedOrders.length > 0) {
logWithTimestamp(`PositionManager: Found ${orphanedOrders.length} orphaned orders to cleanup`);

        // Group by symbol for logging
        const orphanedBySymbol = new Map<string, ExchangeOrder[]>();
        for (const order of orphanedOrders) {
          if (!orphanedBySymbol.has(order.symbol)) {
            orphanedBySymbol.set(order.symbol, []);
          }
          orphanedBySymbol.get(order.symbol)!.push(order);
        }

        // Log summary
        for (const [symbol, orders] of orphanedBySymbol) {
logWithTimestamp(`PositionManager: Cancelling ${orders.length} orphaned orders for ${symbol}`);
        }

        for (const order of orphanedOrders) {
          try {
            // Double-check that this order is really for the correct symbol
            if (order.symbol && order.orderId) {
logWithTimestamp(`PositionManager: Cancelling orphaned order - Symbol: ${order.symbol}, OrderId: ${order.orderId}, Type: ${order.type}, Side: ${order.side}`);
              await this.cancelOrderById(order.symbol, order.orderId);
logWithTimestamp(`PositionManager: Successfully cancelled orphaned order ${order.symbol} #${order.orderId} (${order.type})`);
            } else {
logWarnWithTimestamp(`PositionManager: Skipping invalid orphaned order - missing symbol or orderId`);
            }
          } catch (error: any) {
            // Ignore "order not found" errors (already filled/cancelled)
            if (error?.response?.data?.code === -2011) {
logWithTimestamp(`PositionManager: Orphaned order ${order.symbol} #${order.orderId} already filled/cancelled`);
            } else {
logErrorWithTimestamp(`PositionManager: Failed to cancel orphaned order ${order.symbol} #${order.orderId}:`, error?.response?.data || error?.message);
              // Log non-critical cancellation errors
              errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
                type: 'api',
                severity: 'low',
                context: {
                  component: 'PositionManager',
                  symbol: order.symbol,
                  userAction: 'Cancelling orphaned order',
                  metadata: { orderId: order.orderId, orderType: order.type }
                }
              });
            }
          }
        }
      }

      // Cancel duplicate orders
      if (duplicateOrders.length > 0) {
logWithTimestamp(`PositionManager: Found ${duplicateOrders.length} duplicate orders to cleanup`);

        // Remove any duplicates from the duplicate list itself
        const uniqueDuplicates = Array.from(new Map(duplicateOrders.map(o => [`${o.symbol}_${o.orderId}`, o])).values());

        if (uniqueDuplicates.length !== duplicateOrders.length) {
logWithTimestamp(`PositionManager: Deduplicated ${duplicateOrders.length} to ${uniqueDuplicates.length} unique duplicate orders`);
        }

        for (const order of uniqueDuplicates) {
          try {
            // Validate before cancellation
            if (order.symbol && order.orderId) {
logWithTimestamp(`PositionManager: Cancelling duplicate order - Symbol: ${order.symbol}, OrderId: ${order.orderId}, Type: ${order.type}, Side: ${order.side}`);
              await this.cancelOrderById(order.symbol, order.orderId);
logWithTimestamp(`PositionManager: Successfully cancelled duplicate order ${order.symbol} #${order.orderId} (${order.type})`);
            }
          } catch (error: any) {
            // Ignore "order not found" errors (already filled/cancelled)
            if (error?.response?.data?.code === -2011) {
logWithTimestamp(`PositionManager: Duplicate order ${order.symbol} #${order.orderId} already filled/cancelled`);
            } else {
logErrorWithTimestamp(`PositionManager: Failed to cancel duplicate order ${order.symbol} #${order.orderId}:`, error?.response?.data || error?.message);
            }
          }
        }
      }

      // Cancel stuck entry orders
      if (stuckEntryOrders.length > 0) {
logWithTimestamp(`PositionManager: Found ${stuckEntryOrders.length} stuck entry orders to cleanup`);

        for (const order of stuckEntryOrders) {
          try {
            await this.cancelOrderById(order.symbol, order.orderId);
logWithTimestamp(`PositionManager: Cancelled stuck entry order ${order.symbol} #${order.orderId} (${order.type})`);
          } catch (error: any) {
            // Ignore "order not found" errors (already filled/cancelled)
            if (error?.response?.data?.code === -2011) {
logWithTimestamp(`PositionManager: Stuck entry order ${order.symbol} #${order.orderId} already filled/cancelled`);
            } else {
logErrorWithTimestamp(`PositionManager: Failed to cancel stuck entry order ${order.symbol} #${order.orderId}:`, error?.response?.data || error?.message);
            }
          }
        }
      }

      if (orphanedOrders.length === 0 && duplicateOrders.length === 0 && stuckEntryOrders.length === 0) {
logWithTimestamp('PositionManager: No orphaned, duplicate, or stuck orders found');
      }
    } catch (error: any) {
logErrorWithTimestamp('PositionManager: Error during orphaned order cleanup:', error?.response?.data || error?.message);
      // Log to error database
      errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
        type: 'general',
        severity: 'medium',
        context: {
          component: 'PositionManager',
          userAction: 'Cleaning up orphaned orders',
          metadata: error?.response?.data
        }
      });
    }
  }

  // Check and adjust all orders periodically
  private async checkAndAdjustOrders(): Promise<void> {
    if (this.currentPositions.size === 0) {
      return; // No positions to check
    }

logWithTimestamp(`PositionManager: Checking ${this.currentPositions.size} position(s) for order adjustments`);

    try {
      // Get all open orders from exchange
      const openOrders = await this.getOpenOrdersFromExchange();

      // Get price service instance
      const priceService = getPriceService();

      // Check each position
      for (const [key, position] of this.currentPositions.entries()) {
        const symbol = position.symbol;
        const posAmt = parseFloat(position.positionAmt);
        const positionQty = Math.abs(posAmt);
        const entryPrice = parseFloat(position.entryPrice);

        // Get real-time mark price from PriceService
        let markPrice: number = 0;
        const priceData = priceService?.getMarkPrice(symbol);

        if (priceData && priceData.markPrice) {
          // Check if price data is fresh (within 10 seconds)
          const priceAge = Date.now() - priceData.timestamp;
          if (priceAge <= 10000) {
            markPrice = parseFloat(priceData.markPrice);
          } else {
logWithTimestamp(`PositionManager: WebSocket mark price stale for ${symbol} (${priceAge}ms old), fetching from API`);
          }
        }

        // Fallback to API if WebSocket price is not available or stale
        if (markPrice <= 0) {
          try {
            const apiPriceData = await getMarkPrice(symbol) as any;
            if (apiPriceData && apiPriceData.markPrice) {
              markPrice = parseFloat(apiPriceData.markPrice);
logWithTimestamp(`PositionManager: Fetched mark price from API for ${symbol}: ${markPrice}`);
            }
          } catch (error) {
logErrorWithTimestamp(`PositionManager: Failed to fetch mark price from API for ${symbol}:`, error);
          }
        }

        // Final validation
        if (markPrice <= 0) {
logWithTimestamp(`PositionManager: WARNING - No valid mark price available for ${symbol}, skipping TP check`);
          continue;
        }

        const isLong = posAmt > 0;

        // Only manage positions for symbols in our config
        const symbolConfig = this.config.symbols[symbol];
        if (!symbolConfig) {
          continue;
        }

        // Check if position has exceeded TP target
        const tpPercent = symbolConfig.tpPercent || 0.5;
        const targetTP = isLong
          ? entryPrice * (1 + tpPercent / 100)
          : entryPrice * (1 - tpPercent / 100);

        const pastTP = isLong
          ? markPrice >= targetTP
          : markPrice <= targetTP;

        if (pastTP) {
          // Validate entry price before calculating PnL
          if (!entryPrice || entryPrice <= 0) {
            logWithTimestamp(`PositionManager: WARNING - Invalid entry price (${entryPrice}) for ${symbol}, skipping auto-close`);
          }
          
          // Calculate PNL based on margin (ROE)
          const margin = (positionQty * entryPrice) / leverage;
          const pnl = isLong 
            ? (markPrice - entryPrice) * positionQty
            : (entryPrice - markPrice) * positionQty;
          const pnlPercent = margin > 0 ? (pnl / Math.abs(margin)) * 100 : 0;

          logWithTimestamp(`PositionManager: [Periodic Check] Position ${symbol} exceeded TP target!`);
          logWithTimestamp(`  Entry: ${entryPrice}, Mark: ${markPrice}`);
          logWithTimestamp(`  PnL: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}% ROE), TP target: ${tpPercent}%`);
          logWithTimestamp(`  Position size: ${positionQty}, Margin: $${margin.toFixed(2)}`);
          logWithTrace(`PositionManager: Auto-closing ${symbol} at market - ROE exceeded TP target`);

          try {
            const formattedQty = symbolPrecision.formatQuantity(symbol, positionQty);
            const orderPositionSide = position.positionSide || 'BOTH';

            const marketParams: any = {
              symbol,
              side: isLong ? 'SELL' : 'BUY',
              type: 'MARKET',
              quantity: formattedQty,
              positionSide: orderPositionSide as 'BOTH' | 'LONG' | 'SHORT',
              newClientOrderId: `al_pc_${symbol}_${Date.now() % 10000000000}`,
            };

            if (orderPositionSide === 'BOTH') {
              marketParams.reduceOnly = true;
            }

            const marketOrder = await placeOrder(marketParams, this.config.api);
            logWithTimestamp(`PositionManager: Position ${symbol} closed at market! Order ID: ${marketOrder.orderId}`);

              if (this.statusBroadcaster) {
                this.statusBroadcaster.broadcastPositionClosed({
                  symbol,
                  side: isLong ? 'LONG' : 'SHORT',
                  quantity: positionQty,
                  pnl: pnlPercent * positionQty * markPrice / 100,
                  reason: 'Periodic auto-close (exceeded TP target)',
                });
              }

              // Remove from tracking
              this.currentPositions.delete(key);
              this.positionOrders.delete(key);
              continue; // Skip to next position
          } catch (error: any) {
logErrorWithTimestamp(`PositionManager: Failed to auto-close ${symbol}: ${error?.response?.data?.msg || error?.message}`);
          }
        }

        // Verify tracked orders actually exist on exchange
        const trackedOrders = this.positionOrders.get(key);
        if (trackedOrders) {
          let needsUpdate = false;

          // Get orders for this symbol
          const symbolOrders = openOrders.filter(o => o.symbol === symbol);

          // Verify SL order exists
          if (trackedOrders.slOrderId) {
            const slExists = symbolOrders.some(o => o.orderId === trackedOrders.slOrderId);
            if (!slExists) {
logWarnWithTimestamp(`PositionManager: Tracked SL order ${trackedOrders.slOrderId} not found on exchange for ${key}`);
              trackedOrders.slOrderId = undefined;
              needsUpdate = true;
            }
          }

          // Verify TP order exists
          if (trackedOrders.tpOrderId) {
            const tpExists = symbolOrders.some(o => o.orderId === trackedOrders.tpOrderId);
            if (!tpExists) {
logWarnWithTimestamp(`PositionManager: Tracked TP order ${trackedOrders.tpOrderId} not found on exchange for ${key}`);
              trackedOrders.tpOrderId = undefined;
              needsUpdate = true;
            }
          }

          if (needsUpdate) {
            this.positionOrders.set(key, trackedOrders);
          }
        }

        // Find SL/TP orders for this position
        const slOrder = openOrders.find(o =>
          o.symbol === symbol &&
          (o.type === 'STOP_MARKET' || o.type === 'STOP') &&
          o.reduceOnly &&
          ((posAmt > 0 && o.side === 'SELL') || (posAmt < 0 && o.side === 'BUY'))
        );

        const tpOrder = openOrders.find(o =>
          o.symbol === symbol &&
          (o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' || o.type === 'LIMIT') &&
          o.reduceOnly &&
          ((posAmt > 0 && o.side === 'SELL') || (posAmt < 0 && o.side === 'BUY'))
        );

        let needsAdjustment = false;

        // Check if SL order quantity matches
        if (slOrder) {
          const slOrderQty = parseFloat(slOrder.origQty);
          if (Math.abs(slOrderQty - positionQty) > 0.00000001) {
logWithTimestamp(`PositionManager: [Periodic Check] SL order ${slOrder.orderId} quantity mismatch - Order: ${slOrderQty}, Position: ${positionQty}`);
            needsAdjustment = true;
          }
        }

        // Check if TP order quantity matches
        if (tpOrder) {
          const tpOrderQty = parseFloat(tpOrder.origQty);
          if (Math.abs(tpOrderQty - positionQty) > 0.00000001) {
logWithTimestamp(`PositionManager: [Periodic Check] TP order ${tpOrder.orderId} quantity mismatch - Order: ${tpOrderQty}, Position: ${positionQty}`);
            needsAdjustment = true;
          }
        }

        // Adjust if needed
        if (needsAdjustment) {
          await this.adjustProtectiveOrders(position, slOrder, tpOrder);
        } else if (!slOrder || !tpOrder) {
          // Enhanced logging for missing protection
          if (!slOrder && !tpOrder) {
logWithTimestamp(`PositionManager: [CRITICAL] Position ${key} has NO protective orders! Re-placing both SL and TP immediately`);
          } else {
logWithTimestamp(`PositionManager: [Periodic Check] Position ${key} missing protection (SL: ${!!slOrder}, TP: ${!!tpOrder})`);
          }

          // Check if we have tracking for this position
          const existingTracking = this.positionOrders.get(key);
          if (!existingTracking) {
logWithTimestamp(`PositionManager: Creating new order tracking for position ${key}`);
            this.positionOrders.set(key, {});
          }

          await this.placeProtectiveOrdersWithLock(key, position, !slOrder, !tpOrder);
        }
      }
    } catch (error: any) {
logErrorWithTimestamp('PositionManager: Error during periodic order check:', error?.response?.data || error?.message);
      await errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
        type: 'general',
        severity: 'medium',
        context: {
          component: 'PositionManager',
          userAction: 'checkAndAdjustOrders'
        }
      });
    }
  }

  // Check and adjust orders for a specific position
  private async checkAndAdjustOrdersForPosition(positionKey: string): Promise<void> {
    const position = this.currentPositions.get(positionKey);
    if (!position) {
      return;
    }

    const symbol = position.symbol;
    const posAmt = parseFloat(position.positionAmt);
    const positionQty = Math.abs(posAmt);

    // Only manage positions for symbols in our config
    const symbolConfig = this.config.symbols[symbol];
    if (!symbolConfig) {
      return;
    }

    // Add lock to prevent concurrent adjustments
    const adjustLockKey = `adjust_${symbol}`;
    if (this.orderPlacementLocks.has(adjustLockKey)) {
logWithTimestamp(`PositionManager: Order adjustment already in progress for ${symbol}, skipping`);
      return;
    }

    this.orderPlacementLocks.add(adjustLockKey);

logWithTimestamp(`PositionManager: Checking orders for position ${positionKey} (size: ${positionQty})`);

    try {
      // Get all open orders from exchange
      const openOrders = await this.getOpenOrdersFromExchange();

      // Find SL/TP orders for this position
      const slOrder = openOrders.find(o =>
        o.symbol === symbol &&
        (o.type === 'STOP_MARKET' || o.type === 'STOP') &&
        o.reduceOnly &&
        ((posAmt > 0 && o.side === 'SELL') || (posAmt < 0 && o.side === 'BUY'))
      );

      const tpOrder = openOrders.find(o =>
        o.symbol === symbol &&
        (o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' || o.type === 'LIMIT') &&
        o.reduceOnly &&
        ((posAmt > 0 && o.side === 'SELL') || (posAmt < 0 && o.side === 'BUY'))
      );

      // Always adjust orders when position size changes
      await this.adjustProtectiveOrders(position, slOrder, tpOrder);
    } catch (error: any) {
logErrorWithTimestamp('PositionManager: Error checking orders for position %s:', positionKey, error?.response?.data || error?.message);
      // Log to error database
      errorLogger.logError(error instanceof Error ? error : new Error(String(error)), {
        type: 'general',
        severity: 'medium',
        context: {
          component: 'PositionManager',
          symbol,
          userAction: 'Checking and adjusting orders',
          metadata: { positionKey, positionQty, error: error?.response?.data }
        }
      });
    } finally {
      // Always release the lock
      this.orderPlacementLocks.delete(adjustLockKey);
    }
  }

  // Manual cleanup method to immediately clean up orphaned/duplicate orders
  public async manualCleanup(): Promise<void> {
logWithTimestamp('PositionManager: Manual cleanup triggered');
    await this.cleanupOrphanedOrders();
  }

  // Manual methods
  public async closePosition(symbol: string, side: string): Promise<void> {
    // Find the position in our current positions map
    let targetPosition: ExchangePosition | undefined;
    let targetKey: string | undefined;

    for (const [key, position] of this.currentPositions.entries()) {
      if (position.symbol === symbol) {
        const posAmt = parseFloat(position.positionAmt);
        if ((side === 'LONG' && posAmt > 0) || (side === 'SHORT' && posAmt < 0)) {
          targetPosition = position;
          targetKey = key;
          break;
        }
      }
    }

    if (!targetPosition || !targetKey) {
logWarnWithTimestamp(`PositionManager: Position ${symbol} ${side} not found`);
      return;
    }

    // Cancel SL/TP if they exist
    const orders = this.positionOrders.get(targetKey);
    if (orders) {
      await this.cancelProtectiveOrders(targetKey, orders);
    }

    // Place market close order
    const posAmt = parseFloat(targetPosition.positionAmt);
    const quantity = Math.abs(posAmt);
    const closeSide = posAmt > 0 ? 'SELL' : 'BUY';

    await placeOrder({
      symbol,
      side: closeSide,
      type: 'MARKET',
      quantity: quantity,
      positionSide: (targetPosition.positionSide || 'BOTH') as 'BOTH' | 'LONG' | 'SHORT',
      // Only use reduceOnly in One-way mode
      ...(targetPosition.positionSide === 'BOTH' ? { reduceOnly: true } : {}),
    }, this.config.api);

    // Remove from our maps (will be confirmed by ACCOUNT_UPDATE)
    this.currentPositions.delete(targetKey);
    this.positionOrders.delete(targetKey);

logWithTimestamp(`PositionManager: Closed position ${symbol} ${side}`);

    // Broadcast position closure
    if (this.statusBroadcaster) {
      this.statusBroadcaster.broadcastPositionUpdate({
        symbol,
        side,
        quantity: quantity,
        price: 0, // Market close
        type: 'closed',
        pnl: 0 // Will be updated by account stream
      });
    }

    // Trigger balance refresh after position close
    this.refreshBalance();
  }

  // Get current positions for API/UI
  public getPositions(): ExchangePosition[] {
    return Array.from(this.currentPositions.values());
  }

  // Check if position exists
  public hasPosition(symbol: string): boolean {
    for (const position of this.currentPositions.values()) {
      if (position.symbol === symbol && Math.abs(parseFloat(position.positionAmt)) > 0) {
        return true;
      }
    }
    return false;
  }

  // ===== Position Tracking Methods for Hunter =====

  // Calculate total margin usage for a symbol (position size × leverage × entry price)
  public getMarginUsage(symbol: string): number {
    let totalMargin = 0;

    for (const position of this.currentPositions.values()) {
      if (position.symbol === symbol) {
        const positionAmt = Math.abs(parseFloat(position.positionAmt));
        if (positionAmt > 0) {
          const entryPrice = parseFloat(position.entryPrice);
          let leverage = parseFloat(position.leverage);

          // Handle invalid leverage (0, NaN, or undefined)
          if (!leverage || leverage === 0 || isNaN(leverage)) {
            // First try to use tracked leverage from ACCOUNT_CONFIG_UPDATE
            const trackedLeverage = this.symbolLeverage.get(symbol);
            if (trackedLeverage) {
logWithTimestamp(`PositionManager: Using tracked leverage for ${symbol}: ${trackedLeverage}x`);
              leverage = trackedLeverage;
            } else {
              // Then try to use configured leverage as fallback
              const symbolConfig = this.config.symbols[symbol];
              if (symbolConfig && symbolConfig.leverage) {
logWithTimestamp(`PositionManager: Warning - No tracked leverage for ${symbol}, using configured leverage: ${symbolConfig.leverage}`);
                leverage = symbolConfig.leverage;
              } else {
                // Last resort: assume leverage of 1 (no leverage)
logWithTimestamp(`PositionManager: Warning - No tracked leverage for ${symbol} and no config found, defaulting to 1x`);
                leverage = 1;
              }
            }
          }

          // Margin = (Position Size × Entry Price) / Leverage
          const margin = (positionAmt * entryPrice) / leverage;
          totalMargin += margin;
        }
      }
    }

    return totalMargin;
  }

  // Get total count of all open positions
  public getTotalPositionCount(): number {
    let count = 0;
    for (const position of this.currentPositions.values()) {
      if (Math.abs(parseFloat(position.positionAmt)) > 0) {
        count++;
      }
    }
    return count;
  }

  // Refresh balance from the exchange
  private async refreshBalance(): Promise<void> {
    try {
      const balanceService = getBalanceService();
      if (balanceService && balanceService.isInitialized()) {
        // The balance service will automatically update via its WebSocket stream
        // We just need to trigger a manual fetch to ensure consistency
        await (balanceService as any).fetchInitialBalance();
logWithTimestamp('PositionManager: Triggered balance refresh after position change');
      }
    } catch (error) {
logErrorWithTimestamp('PositionManager: Failed to refresh balance:', error);
    }
  }

  // Get unique position count (hedge mode: long+short on same symbol = 1 position)
  public getUniquePositionCount(isHedgeMode: boolean): number {
    if (!isHedgeMode) {
      // In one-way mode, just count positions with non-zero amount
      return this.getTotalPositionCount();
    }

    // In hedge mode, count unique symbols
    const uniqueSymbols = new Set<string>();
    for (const position of this.currentPositions.values()) {
      if (Math.abs(parseFloat(position.positionAmt)) > 0) {
        uniqueSymbols.add(position.symbol);
      }
    }
    return uniqueSymbols.size;
  }

  // Get Map of positions for direct access
  public getPositionsMap(): Map<string, ExchangePosition> {
    return this.currentPositions;
  }
}
