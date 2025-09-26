import WebSocket from 'ws';
import { EventEmitter } from 'events';
import axios, { AxiosResponse } from 'axios';
import { Config } from '../types';
import { getSignedParams, paramsToQuery } from '../api/auth';
import { getExchangeInfo } from '../api/market';
import { placeOrder, cancelOrder } from '../api/orders';
import { symbolPrecision } from '../utils/symbolPrecision';
import { getBalanceService } from '../services/balanceService';

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
      console.log(`PositionManager: Risk percent changed from ${oldConfig.global.riskPercent}% to ${newConfig.global.riskPercent}%`);
    }

    if (oldConfig.global.maxOpenPositions !== newConfig.global.maxOpenPositions) {
      console.log(`PositionManager: Max open positions changed from ${oldConfig.global.maxOpenPositions} to ${newConfig.global.maxOpenPositions}`);
    }

    // Check for symbol parameter changes that affect existing positions
    for (const [posKey, position] of this.currentPositions) {
      const symbol = position.symbol;

      if (oldConfig.symbols[symbol] && newConfig.symbols[symbol]) {
        const oldSym = oldConfig.symbols[symbol];
        const newSym = newConfig.symbols[symbol];

        // Log changes that would affect new SL/TP orders
        if (oldSym.tpPercent !== newSym.tpPercent) {
          console.log(`PositionManager: ${symbol} TP percent changed from ${oldSym.tpPercent}% to ${newSym.tpPercent}%`);
        }
        if (oldSym.slPercent !== newSym.slPercent) {
          console.log(`PositionManager: ${symbol} SL percent changed from ${oldSym.slPercent}% to ${newSym.slPercent}%`);
        }

        // Note: We don't modify existing SL/TP orders - changes only apply to new positions
        console.log(`PositionManager: Note: Existing SL/TP orders for ${symbol} remain unchanged`);
      }
    }

    // If paper mode changed and we have an active websocket, we may need to restart
    if (oldConfig.global.paperMode !== newConfig.global.paperMode) {
      console.log(`PositionManager: Paper mode changed to ${newConfig.global.paperMode}`);

      // If switching modes with active connection, restart the connection
      if (this.isRunning && newConfig.api.apiKey && newConfig.api.secretKey) {
        console.log('PositionManager: Restarting connection due to mode change...');
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
      console.error('PositionManager: Failed to restart connection:', error);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('PositionManager: Starting...');

    // Fetch exchange info to get symbol precision
    try {
      console.log('PositionManager: Fetching exchange info for symbol precision...');
      const exchangeInfo = await getExchangeInfo();
      symbolPrecision.parseExchangeInfo(exchangeInfo);
    } catch (error: any) {
      console.error('PositionManager: Failed to fetch exchange info:', error.message);
      // Continue anyway - will use raw values
    }

    // Skip user data stream in paper mode with no API keys
    if (this.config.global.paperMode && (!this.config.api.apiKey || !this.config.api.secretKey)) {
      console.log('PositionManager: Running in paper mode without API keys - simulating streams');
      return;
    }

    try {
      // First, sync with exchange to get current positions and orders
      await this.syncWithExchange();
      // Then start the user data stream for real-time updates
      await this.startUserDataStream();
    } catch (error) {
      console.error('PositionManager: Failed to start:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    console.log('PositionManager: Stopping...');

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
    console.log('PositionManager: Got listenKey:', this.listenKey);

    // Start WS
    this.ws = new WebSocket(`wss://fstream.asterdex.com/ws/${this.listenKey}`);

    this.ws.on('open', () => {
      console.log('PositionManager WS connected');
      // Set keepalive every 30 min
      this.keepaliveInterval = setInterval(() => this.keepalive(), 30 * 60 * 1000);
      // Risk check every 5 min
      this.riskCheckInterval = setInterval(() => this.checkRisk(), 5 * 60 * 1000);
      // Order check every 30 seconds to ensure SL/TP quantities match positions
      this.orderCheckInterval = setInterval(() => this.checkAndAdjustOrders(), 30 * 1000);

      // Clean up orphaned orders immediately on startup, then every 30 seconds
      this.cleanupOrphanedOrders().catch(error => {
        console.error('PositionManager: Initial cleanup failed:', error);
      });
      setInterval(() => this.cleanupOrphanedOrders(), 30 * 1000);
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString());
        this.handleEvent(event);
      } catch (error) {
        console.error('PositionManager: WS message parse error:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('PositionManager WS error:', error);
    });

    this.ws.on('close', () => {
      console.log('PositionManager WS closed - reconnecting...');
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
      console.log('PositionManager: Keepalive sent');
    } catch (error) {
      console.error('PositionManager: Keepalive error:', error);
    }
  }

  private async closeUserDataStream(): Promise<void> {
    if (!this.listenKey) return;
    try {
      const headers = {
        'X-MBX-APIKEY': this.config.api.apiKey
      };
      await axios.delete(`${BASE_URL}/fapi/v1/listenKey`, { headers });
      console.log('PositionManager: User data stream closed');
    } catch (error) {
      console.error('PositionManager: Close stream error:', error);
    }
  }

  // Sync with exchange on startup or reconnection
  private async syncWithExchange(): Promise<void> {
    console.log('PositionManager: Syncing with exchange...');

    try {
      // Get all current positions from exchange
      const positions = await this.getPositionsFromExchange();

      // Get all open orders
      const openOrders = await this.getOpenOrdersFromExchange();
      console.log(`PositionManager: Found ${openOrders.length} open orders`);

      // Log order details for debugging
      openOrders.forEach(order => {
        if (order.reduceOnly) {
          console.log(`PositionManager: Open order - ${order.symbol} ${order.type} ${order.side}, reduceOnly: ${order.reduceOnly}, orderId: ${order.orderId}`);
        }
      });

      // Clear and rebuild our position map
      this.currentPositions.clear();
      this.positionOrders.clear();

      // Process each position
      for (const position of positions) {
        const posAmt = parseFloat(position.positionAmt);
        if (Math.abs(posAmt) > 0) {
          const key = this.getPositionKey(position.symbol, position.positionSide, posAmt);
          this.currentPositions.set(key, position);

          // Only manage positions for symbols in our config
          const symbolConfig = this.config.symbols[position.symbol];
          if (!symbolConfig) {
            console.log(`PositionManager: Found position ${key}: ${posAmt} @ ${position.entryPrice} (not managed - symbol not in config)`);
            continue;
          }

          console.log(`PositionManager: Found position ${key}: ${posAmt} @ ${position.entryPrice}`);

          // Find SL/TP orders for this position
          // Check for stop loss orders (STOP_MARKET or STOP)
          const slOrder = openOrders.find(o =>
            o.symbol === position.symbol &&
            (o.type === 'STOP_MARKET' || o.type === 'STOP') &&
            o.reduceOnly &&
            ((posAmt > 0 && o.side === 'SELL') || (posAmt < 0 && o.side === 'BUY'))
          );

          // Check for take profit orders (TAKE_PROFIT_MARKET, TAKE_PROFIT, or LIMIT with reduceOnly)
          const tpOrder = openOrders.find(o =>
            o.symbol === position.symbol &&
            (o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' || o.type === 'LIMIT') &&
            o.reduceOnly &&
            ((posAmt > 0 && o.side === 'SELL') || (posAmt < 0 && o.side === 'BUY'))
          );

          const orders: PositionOrders = {};
          let needsAdjustment = false;

          if (slOrder) {
            orders.slOrderId = slOrder.orderId;
            const slOrderQty = parseFloat(slOrder.origQty);
            const positionQty = Math.abs(posAmt);

            // Check if SL order quantity matches position size (with small tolerance for rounding)
            if (Math.abs(slOrderQty - positionQty) > 0.00000001) {
              console.log(`PositionManager: SL order ${slOrder.orderId} quantity mismatch - Order: ${slOrderQty}, Position: ${positionQty}`);
              needsAdjustment = true;
            } else {
              console.log(`PositionManager: Found SL order ${slOrder.orderId} for ${key} (qty: ${slOrderQty})`);
            }
          }

          if (tpOrder) {
            orders.tpOrderId = tpOrder.orderId;
            const tpOrderQty = parseFloat(tpOrder.origQty);
            const positionQty = Math.abs(posAmt);

            // Check if TP order quantity matches position size (with small tolerance for rounding)
            if (Math.abs(tpOrderQty - positionQty) > 0.00000001) {
              console.log(`PositionManager: TP order ${tpOrder.orderId} quantity mismatch - Order: ${tpOrderQty}, Position: ${positionQty}`);
              needsAdjustment = true;
            } else {
              console.log(`PositionManager: Found TP order ${tpOrder.orderId} for ${key} (qty: ${tpOrderQty})`);
            }
          }

          if (orders.slOrderId || orders.tpOrderId) {
            this.positionOrders.set(key, orders);
          }

          // Adjust orders if quantities don't match or place missing orders
          if (needsAdjustment) {
            console.log(`PositionManager: Adjusting protective orders for ${key} due to quantity mismatch`);
            await this.adjustProtectiveOrders(position, slOrder, tpOrder);
          } else if (!slOrder || !tpOrder) {
            console.log(`PositionManager: Position ${key} missing protection (SL: ${!!slOrder}, TP: ${!!tpOrder})`);
            await this.placeProtectiveOrdersWithLock(key, position, !slOrder, !tpOrder);
          }
        }
      }

      console.log(`PositionManager: Sync complete - ${this.currentPositions.size} positions, ${this.positionOrders.size} with orders`);
    } catch (error) {
      console.error('PositionManager: Failed to sync with exchange:', error);
      throw error;
    }
  }

  // Get all positions from exchange
  private async getPositionsFromExchange(): Promise<ExchangePosition[]> {
    const params = {
      timestamp: Date.now(),
      recvWindow: 5000
    };

    const signedParams = getSignedParams(params, this.config.api);
    const queryString = paramsToQuery(signedParams);

    const response = await axios.get(`${BASE_URL}/fapi/v2/positionRisk?${queryString}`, {
      headers: { 'X-MBX-APIKEY': this.config.api.apiKey }
    });

    return response.data;
  }

  // Get all open orders from exchange
  private async getOpenOrdersFromExchange(): Promise<ExchangeOrder[]> {
    const params = {
      timestamp: Date.now(),
      recvWindow: 5000
    };

    const signedParams = getSignedParams(params, this.config.api);
    const queryString = paramsToQuery(signedParams);

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
      return `${symbol}_${direction}`;
    }
    // For hedge mode, use position side
    return `${symbol}_${positionSide}`;
  }

  // Ensure position has SL/TP orders
  private async ensurePositionProtected(symbol: string, positionSide: string, positionAmt: number): Promise<void> {
    const key = this.getPositionKey(symbol, positionSide, positionAmt);

    // Check if order placement is already in progress for this position
    if (this.orderPlacementLocks.has(key)) {
      console.log(`PositionManager: Order placement already in progress for ${key}, skipping`);
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
      console.warn(`PositionManager: Position ${key} not found in map`);
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

    if (orders.slOrderId) {
      await this.cancelOrderWithRetry(symbol, orders.slOrderId, 'SL');
    }

    if (orders.tpOrderId) {
      await this.cancelOrderWithRetry(symbol, orders.tpOrderId, 'TP');
    }
  }

  // Cancel order with retry and backoff
  private async cancelOrderWithRetry(symbol: string, orderId: number, orderType: string): Promise<void> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.cancelOrderById(symbol, orderId);
        console.log(`PositionManager: Cancelled ${orderType} order ${orderId} (attempt ${attempt})`);
        return; // Success, exit retry loop
      } catch (error: any) {
        // Error -2011 means order doesn't exist (already filled or cancelled)
        if (error?.response?.data?.code === -2011) {
          console.log(`PositionManager: ${orderType} order ${orderId} already filled or cancelled`);
          return; // Not an error to retry
        }

        console.error(`PositionManager: Failed to cancel ${orderType} order ${orderId} (attempt ${attempt}/${maxRetries}):`, error?.response?.data?.message || error?.message);

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`PositionManager: Retrying ${orderType} order cancellation in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`PositionManager: Max retries reached for cancelling ${orderType} order ${orderId}`);
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
    }
  }

  private handleAccountUpdate(event: any): void {
    console.log('PositionManager: Account update received');

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

      // Clear and rebuild position map - exchange data is the truth
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
            console.log(`PositionManager: Position ${previousKey} fully closed`);

            // Broadcast position closed event
            if (this.statusBroadcaster) {
              this.statusBroadcaster.broadcastPositionClosed({
                symbol: symbol,
                side: previousAmt > 0 ? 'LONG' : 'SHORT',
                quantity: Math.abs(previousAmt),
                pnl: 0, // Will be updated by ORDER_TRADE_UPDATE
                reason: 'Position Closed',
              });

              // Also broadcast position_update with type closed for compatibility
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
            console.log(`PositionManager: Position size changed for ${key} from ${previousSize} to ${currentSize}`);
          }

          // Update tracking
          this.previousPositionSizes.set(key, currentSize);

          this.currentPositions.set(key, {
            symbol: pos.s,
            positionAmt: pos.pa,
            entryPrice: pos.ep,
            markPrice: pos.mp || '0',
            unRealizedProfit: pos.up,
            liquidationPrice: pos.lp || '0',
            leverage: pos.l || '0',
            marginType: pos.mt,
            isolatedMargin: pos.iw || '0',
            isAutoAddMargin: pos.iam || 'false',
            positionSide: positionSide,
            updateTime: event.E
          });

          // Check if this position has SL/TP orders and if they need adjustment
          if (sizeChanged) {
            // Position size changed, need to check and adjust orders (async, don't await to avoid blocking)
            this.checkAndAdjustOrdersForPosition(key).catch(error => {
              console.error(`PositionManager: Failed to adjust orders for ${key}:`, error?.response?.data || error?.message);
            });
          } else {
            // Just ensure position is protected (async, don't await to avoid blocking)
            // Add small delay to reduce race conditions with other protection logic
            setTimeout(() => {
              this.ensurePositionProtected(symbol, positionSide, positionAmt).catch(error => {
                console.error(`PositionManager: Failed to ensure protection for ${symbol}:`, error?.response?.data || error?.message);
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

      // Check for closed positions (positions that were in our map but aren't in the update)
      for (const [key, orders] of this.positionOrders.entries()) {
        if (!this.currentPositions.has(key)) {
          // Position was closed, clean up
          console.log(`PositionManager: Position ${key} was closed`);
          this.positionOrders.delete(key);
          this.previousPositionSizes.delete(key);
          // Cancel any remaining SL/TP orders if they exist (async, don't await to avoid blocking)
          this.cancelProtectiveOrders(key, orders).catch(error => {
            console.error(`PositionManager: Failed to cancel protective orders for ${key}:`, error?.response?.data || error?.message);
          });

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

    // Check if this is a filled order that affects positions (SL/TP fills)
    if (orderStatus === 'FILLED' && order.rp) { // rp = reduce only
      console.log(`PositionManager: Reduce-only order filled for ${symbol}`);
      // Trigger balance refresh after SL/TP execution
      this.refreshBalance();
    }

    // Track our SL/TP order IDs when they're placed
    if (orderStatus === 'NEW' && (orderType === 'STOP_MARKET' || orderType === 'TAKE_PROFIT_MARKET')) {
      const _executedQty = parseFloat(order.z || '0');
      const _origQty = parseFloat(order.q);

      // Find the matching position
      for (const [key, position] of this.currentPositions.entries()) {
        if (position.symbol === symbol) {
          const posAmt = parseFloat(position.positionAmt);
          // Check if this order is for this position (same symbol and opposite side)
          if ((posAmt > 0 && side === 'SELL') || (posAmt < 0 && side === 'BUY')) {
            if (!this.positionOrders.has(key)) {
              this.positionOrders.set(key, {});
            }
            const orders = this.positionOrders.get(key)!;

            if (orderType === 'STOP_MARKET') {
              orders.slOrderId = orderId;
              console.log(`PositionManager: Tracked SL order ${orderId} for position ${key}`);
            } else if (orderType === 'TAKE_PROFIT_MARKET') {
              orders.tpOrderId = orderId;
              console.log(`PositionManager: Tracked TP order ${orderId} for position ${key}`);
            }
          }
        }
      }
    }

    // Handle filled orders
    if (orderStatus === 'FILLED') {
      const executedQty = parseFloat(order.z || '0');
      const avgPrice = parseFloat(order.ap || order.p || '0');

      if (!order.cp && !order.R) { // Not close-all and not reduce-only - this is an entry
        console.log(`PositionManager: Entry order filled for ${symbol}`);

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

        // Position will be updated via ACCOUNT_UPDATE event
        // Just wait for it and then place SL/TP
      } else if (orderType === 'STOP_MARKET' || orderType === 'STOP' ||
                 orderType === 'TAKE_PROFIT_MARKET' || orderType === 'TAKE_PROFIT' ||
                 (orderType === 'LIMIT' && order.R)) { // Any reduce-only order
        // SL/TP filled, position closed
        console.log(`PositionManager: ${orderType} (reduce-only) filled for ${symbol}`);

        // Clean up our tracking
        for (const [key, orders] of this.positionOrders.entries()) {
          if (orders.slOrderId === orderId || orders.tpOrderId === orderId) {
            // Cancel the other order if it exists (async, don't await to avoid blocking)
            if (orders.slOrderId === orderId && orders.tpOrderId) {
              this.cancelOrderById(symbol, orders.tpOrderId).catch(error => {
                console.error(`PositionManager: Failed to cancel TP order ${orders.tpOrderId}:`, error?.response?.data || error?.message);
              });
            } else if (orders.tpOrderId === orderId && orders.slOrderId) {
              this.cancelOrderById(symbol, orders.slOrderId).catch(error => {
                console.error(`PositionManager: Failed to cancel SL order ${orders.slOrderId}:`, error?.response?.data || error?.message);
              });
            }
            this.positionOrders.delete(key);
            break;
          }
        }

        const realizedPnl = parseFloat(order.rp || '0');

        // Broadcast order filled event (SL/TP)
        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastOrderFilled({
            symbol,
            side,
            orderType,
            executedQty,
            price: avgPrice,
            orderId: orderId?.toString(),
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
  }

  // Listen for new positions from Hunter
  public onNewPosition(data: { symbol: string; side: string; quantity: number; orderId?: number }): void {
    // In the new architecture, we wait for ACCOUNT_UPDATE to confirm the position
    // The WebSocket will tell us when the position is actually open
    console.log(`PositionManager: Notified of potential new position: ${data.symbol} ${data.side}`);

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
      console.log(`PositionManager: Order adjustment already in progress for ${key}, skipping`);
      return;
    }

    // Set lock to prevent concurrent adjustments
    this.orderPlacementLocks.add(key);

    try {
      console.log(`PositionManager: Adjusting protective orders for ${symbol} - Position size: ${Math.abs(posAmt)}`);

      // Cancel existing orders with wrong quantities using retry logic
      const orders = this.positionOrders.get(key) || {};
      const cancelPromises: Promise<void>[] = [];

      let needNewSL = false;
      let needNewTP = false;

      // Check and cancel SL if quantity doesn't match
      if (currentSlOrder) {
        const slOrderQty = parseFloat(currentSlOrder.origQty);
        if (Math.abs(slOrderQty - Math.abs(posAmt)) > 0.00000001) {
          console.log(`PositionManager: Cancelling SL order ${currentSlOrder.orderId} (qty: ${slOrderQty}) to replace with correct size`);
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
          console.log(`PositionManager: Cancelling TP order ${currentTpOrder.orderId} (qty: ${tpOrderQty}) to replace with correct size`);
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
          console.log(`PositionManager: Cancelled ${cancelPromises.length} order(s) for adjustment`);
        } catch (error: any) {
          console.error('PositionManager: Error cancelling orders for adjustment:', error?.response?.data || error?.message);
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
      console.warn(`PositionManager: No config for symbol ${symbol}`);
      return;
    }

    const posAmt = parseFloat(position.positionAmt);
    const entryPrice = parseFloat(position.entryPrice);
    const quantity = Math.abs(posAmt);
    const isLong = posAmt > 0;
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
        console.log(`PositionManager: Found ${existingSlOrders.length} SL orders for ${key}, cancelling duplicates`);
        for (let i = 1; i < existingSlOrders.length; i++) {
          try {
            await this.cancelOrderById(symbol, existingSlOrders[i].orderId);
            console.log(`PositionManager: Cancelled duplicate SL order ${existingSlOrders[i].orderId}`);
          } catch (error: any) {
            console.error(`PositionManager: Failed to cancel duplicate SL order ${existingSlOrders[i].orderId}:`, error?.response?.data || error?.message);
          }
        }
      }

      // Handle multiple TP orders - keep the first one, cancel the rest
      if (existingTpOrders.length > 1) {
        console.log(`PositionManager: Found ${existingTpOrders.length} TP orders for ${key}, cancelling duplicates`);
        for (let i = 1; i < existingTpOrders.length; i++) {
          try {
            await this.cancelOrderById(symbol, existingTpOrders[i].orderId);
            console.log(`PositionManager: Cancelled duplicate TP order ${existingTpOrders[i].orderId}`);
          } catch (error: any) {
            console.error(`PositionManager: Failed to cancel duplicate TP order ${existingTpOrders[i].orderId}:`, error?.response?.data || error?.message);
          }
        }
      }

      // Update our tracking with the remaining orders
      const existingSlOrder = existingSlOrders.length > 0 ? existingSlOrders[0] : undefined;
      const existingTpOrder = existingTpOrders.length > 0 ? existingTpOrders[0] : undefined;

      if (existingSlOrder) {
        orders.slOrderId = existingSlOrder.orderId;
        placeSL = false; // Don't place if one already exists
        console.log(`PositionManager: Found existing SL order ${existingSlOrder.orderId} for ${key}, skipping placement`);
      }

      if (existingTpOrder) {
        orders.tpOrderId = existingTpOrder.orderId;
        placeTP = false; // Don't place if one already exists
        console.log(`PositionManager: Found existing TP order ${existingTpOrder.orderId} for ${key}, skipping placement`);
      }

      // Exit early if no orders need to be placed
      if (!placeSL && !placeTP) {
        console.log(`PositionManager: All protective orders already exist for ${key}`);
        return;
      }
    } catch (error: any) {
      console.error('PositionManager: Failed to check existing orders, proceeding with placement:', error?.response?.data || error?.message);
    }

    try {
      // Place Stop Loss
      if (placeSL) {
        // Get current market price to avoid "Order would immediately trigger" error
        const ticker = await axios.get(`https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${symbol}`);
        const currentPrice = parseFloat(ticker.data.price);

        const rawSlPrice = isLong
          ? entryPrice * (1 - symbolConfig.slPercent / 100)
          : entryPrice * (1 + symbolConfig.slPercent / 100);

        // Check if the position is already beyond the stop level
        let adjustedSlPrice = rawSlPrice;
        if ((isLong && rawSlPrice >= currentPrice) || (!isLong && rawSlPrice <= currentPrice)) {
          // Position is already at a loss beyond the intended stop
          // Place stop slightly beyond current price to avoid immediate trigger
          const bufferPercent = 0.1; // 0.1% buffer
          adjustedSlPrice = isLong
            ? currentPrice * (1 - bufferPercent / 100)
            : currentPrice * (1 + bufferPercent / 100);

          console.log(`PositionManager: Position ${symbol} is underwater. Adjusting SL from ${rawSlPrice.toFixed(4)} to ${adjustedSlPrice.toFixed(4)} (current: ${currentPrice.toFixed(4)})`);
        }

        // Format price and quantity according to symbol precision
        const slPrice = symbolPrecision.formatPrice(symbol, adjustedSlPrice);
        const formattedQuantity = symbolPrecision.formatQuantity(symbol, quantity);

        console.log(`PositionManager: SL order preparation for ${symbol}:`);
        console.log(`  Raw quantity: ${quantity}`);
        console.log(`  Formatted quantity: ${formattedQuantity}`);
        console.log(`  Raw SL price: ${rawSlPrice}`);
        console.log(`  Adjusted SL price: ${adjustedSlPrice}`);
        console.log(`  Formatted SL price: ${slPrice}`);

        // Determine position side for the SL order
        const orderPositionSide = position.positionSide || 'BOTH';

        const orderParams: any = {
          symbol,
          side: isLong ? 'SELL' : 'BUY', // Opposite side to close
          type: 'STOP_MARKET',
          quantity: formattedQuantity,
          stopPrice: slPrice,
          positionSide: orderPositionSide as 'BOTH' | 'LONG' | 'SHORT',
          newClientOrderId: `al_sl_${symbol}_${Date.now()}`,
        };

        // Only add reduceOnly in One-way mode (positionSide == BOTH)
        // In Hedge Mode, the opposite positionSide naturally closes the position
        if (orderPositionSide === 'BOTH') {
          orderParams.reduceOnly = true;
        }

        const slOrder = await placeOrder(orderParams, this.config.api);

        orders.slOrderId = typeof slOrder.orderId === 'string' ? parseInt(slOrder.orderId) : slOrder.orderId;
        console.log(`PositionManager: Placed SL (STOP_MARKET) for ${symbol} at ${slPrice.toFixed(4)}, orderId: ${slOrder.orderId}`);

        // Broadcast SL placed event
        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastStopLossPlaced({
            symbol,
            price: slPrice,
            quantity,
            orderId: slOrder.orderId?.toString(),
          });
        }
      }

      // Place Take Profit
      if (placeTP) {
        const rawTpPrice = isLong
          ? entryPrice * (1 + symbolConfig.tpPercent / 100)
          : entryPrice * (1 - symbolConfig.tpPercent / 100);

        // Format price and quantity according to symbol precision
        const tpPrice = symbolPrecision.formatPrice(symbol, rawTpPrice);
        const formattedQuantity = symbolPrecision.formatQuantity(symbol, quantity);

        console.log(`PositionManager: TP order preparation for ${symbol}:`);
        console.log(`  Raw quantity: ${quantity}`);
        console.log(`  Formatted quantity: ${formattedQuantity}`);
        console.log(`  Raw TP price: ${rawTpPrice}`);
        console.log(`  Formatted TP price: ${tpPrice}`);

        // Use TAKE_PROFIT_MARKET order for consistency with exchange
        // Determine position side for the TP order
        const orderPositionSide = position.positionSide || 'BOTH';

        const tpParams: any = {
          symbol,
          side: isLong ? 'SELL' : 'BUY',
          type: 'TAKE_PROFIT_MARKET',
          quantity: formattedQuantity,
          stopPrice: tpPrice, // Use stopPrice for TAKE_PROFIT_MARKET
          positionSide: orderPositionSide as 'BOTH' | 'LONG' | 'SHORT',
          newClientOrderId: `al_tp_${symbol}_${Date.now()}`,
        };

        // Only add reduceOnly in One-way mode (positionSide == BOTH)
        // In Hedge Mode, the opposite positionSide naturally closes the position
        if (orderPositionSide === 'BOTH') {
          tpParams.reduceOnly = true;
        }

        const tpOrder = await placeOrder(tpParams, this.config.api);

        orders.tpOrderId = typeof tpOrder.orderId === 'string' ? parseInt(tpOrder.orderId) : tpOrder.orderId;
        console.log(`PositionManager: Placed TP (LIMIT) for ${symbol} at ${tpPrice.toFixed(4)}, orderId: ${tpOrder.orderId}`);

        // Broadcast TP placed event
        if (this.statusBroadcaster) {
          this.statusBroadcaster.broadcastTakeProfitPlaced({
            symbol,
            price: tpPrice,
            quantity,
            orderId: tpOrder.orderId?.toString(),
          });
        }
      }

      this.positionOrders.set(key, orders);
    } catch (error: any) {
      console.error(`PositionManager: Failed to place protective orders for ${symbol}:`, error.response?.data || error.message);
    }
  }

  private async checkRisk(): Promise<void> {
    // Check total PnL
    const _riskPercent = this.config.global.riskPercent / 100;
    // Simplified: assume some PnL calculation
    // If unrealized PnL < -risk * balance, close all positions
    // Implementation depends on balance query

    console.log(`PositionManager: Risk check complete`);
  }

  // Clean up orphaned orders (orders for symbols without active positions) and duplicates
  private async cleanupOrphanedOrders(): Promise<void> {
    try {
      console.log('PositionManager: Checking for orphaned and duplicate orders...');

      const openOrders = await this.getOpenOrdersFromExchange();
      const positions = await this.getPositionsFromExchange();

      // Create map of active positions with their position details
      const activePositions = new Map<string, { symbol: string; positionAmt: number; positionSide: string }>();

      for (const position of positions) {
        const posAmt = parseFloat(position.positionAmt);
        if (Math.abs(posAmt) > 0) {
          const key = this.getPositionKey(position.symbol, position.positionSide, posAmt);
          activePositions.set(key, {
            symbol: position.symbol,
            positionAmt: posAmt,
            positionSide: position.positionSide
          });
        }
      }

      const activeSymbols = new Set(Array.from(activePositions.values()).map(p => p.symbol));

      // Find orphaned orders (reduce-only orders for symbols without positions)
      // This includes bot-created orders since they're also orphaned if no position exists
      const orphanedOrders = openOrders.filter(order => {
        const isOrphaned = order.reduceOnly && !activeSymbols.has(order.symbol);

        // Log evaluation for debugging
        if (order.reduceOnly) {
          const isBotOrder = order.clientOrderId &&
            (order.clientOrderId.startsWith('al_sl_') || order.clientOrderId.startsWith('al_tp_'));

          if (isOrphaned) {
            console.log(`PositionManager: Found orphaned ${order.type} order for ${order.symbol} - OrderId: ${order.orderId}, ClientOrderId: ${order.clientOrderId || 'none'}, Bot order: ${isBotOrder ? 'yes' : 'no'}`);
          }
        }

        return isOrphaned;
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
          console.log(`PositionManager: Found stuck entry order for ${order.symbol} - OrderId: ${order.orderId}, Type: ${order.type}, Age: ${Math.round(orderAge / 1000)}s`);
        }

        return isStuck;
      });

      // Find duplicate orders for each active position
      const duplicateOrders: ExchangeOrder[] = [];

      for (const [key, positionData] of activePositions) {
        const { symbol, positionAmt } = positionData;

        // Find all SL orders for this position
        const slOrders = openOrders.filter(o =>
          o.symbol === symbol &&
          (o.type === 'STOP_MARKET' || o.type === 'STOP') &&
          o.reduceOnly &&
          ((positionAmt > 0 && o.side === 'SELL') || (positionAmt < 0 && o.side === 'BUY'))
        );

        // Find all TP orders for this position
        const tpOrders = openOrders.filter(o =>
          o.symbol === symbol &&
          (o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT' || o.type === 'LIMIT') &&
          o.reduceOnly &&
          ((positionAmt > 0 && o.side === 'SELL') || (positionAmt < 0 && o.side === 'BUY'))
        );

        // Mark duplicates for cancellation (keep first, cancel rest)
        if (slOrders.length > 1) {
          console.log(`PositionManager: Found ${slOrders.length} SL orders for ${key}, marking ${slOrders.length - 1} for cancellation`);
          duplicateOrders.push(...slOrders.slice(1));
        }

        if (tpOrders.length > 1) {
          console.log(`PositionManager: Found ${tpOrders.length} TP orders for ${key}, marking ${tpOrders.length - 1} for cancellation`);
          duplicateOrders.push(...tpOrders.slice(1));
        }
      }

      // Cancel orphaned orders
      if (orphanedOrders.length > 0) {
        console.log(`PositionManager: Found ${orphanedOrders.length} orphaned orders to cleanup`);

        for (const order of orphanedOrders) {
          try {
            await this.cancelOrderById(order.symbol, order.orderId);
            console.log(`PositionManager: Cancelled orphaned order ${order.symbol} #${order.orderId} (${order.type})`);
          } catch (error: any) {
            // Ignore "order not found" errors (already filled/cancelled)
            if (error?.response?.data?.code === -2011) {
              console.log(`PositionManager: Orphaned order ${order.symbol} #${order.orderId} already filled/cancelled`);
            } else {
              console.error(`PositionManager: Failed to cancel orphaned order ${order.symbol} #${order.orderId}:`, error?.response?.data || error?.message);
            }
          }
        }
      }

      // Cancel duplicate orders
      if (duplicateOrders.length > 0) {
        console.log(`PositionManager: Found ${duplicateOrders.length} duplicate orders to cleanup`);

        for (const order of duplicateOrders) {
          try {
            await this.cancelOrderById(order.symbol, order.orderId);
            console.log(`PositionManager: Cancelled duplicate order ${order.symbol} #${order.orderId} (${order.type})`);
          } catch (error: any) {
            // Ignore "order not found" errors (already filled/cancelled)
            if (error?.response?.data?.code === -2011) {
              console.log(`PositionManager: Duplicate order ${order.symbol} #${order.orderId} already filled/cancelled`);
            } else {
              console.error(`PositionManager: Failed to cancel duplicate order ${order.symbol} #${order.orderId}:`, error?.response?.data || error?.message);
            }
          }
        }
      }

      // Cancel stuck entry orders
      if (stuckEntryOrders.length > 0) {
        console.log(`PositionManager: Found ${stuckEntryOrders.length} stuck entry orders to cleanup`);

        for (const order of stuckEntryOrders) {
          try {
            await this.cancelOrderById(order.symbol, order.orderId);
            console.log(`PositionManager: Cancelled stuck entry order ${order.symbol} #${order.orderId} (${order.type})`);
          } catch (error: any) {
            // Ignore "order not found" errors (already filled/cancelled)
            if (error?.response?.data?.code === -2011) {
              console.log(`PositionManager: Stuck entry order ${order.symbol} #${order.orderId} already filled/cancelled`);
            } else {
              console.error(`PositionManager: Failed to cancel stuck entry order ${order.symbol} #${order.orderId}:`, error?.response?.data || error?.message);
            }
          }
        }
      }

      if (orphanedOrders.length === 0 && duplicateOrders.length === 0 && stuckEntryOrders.length === 0) {
        console.log('PositionManager: No orphaned, duplicate, or stuck orders found');
      }
    } catch (error: any) {
      console.error('PositionManager: Error during orphaned order cleanup:', error?.response?.data || error?.message);
    }
  }

  // Check and adjust all orders periodically
  private async checkAndAdjustOrders(): Promise<void> {
    if (this.currentPositions.size === 0) {
      return; // No positions to check
    }

    console.log(`PositionManager: Checking ${this.currentPositions.size} position(s) for order adjustments`);

    try {
      // Get all open orders from exchange
      const openOrders = await this.getOpenOrdersFromExchange();

      // Check each position
      for (const [key, position] of this.currentPositions.entries()) {
        const symbol = position.symbol;
        const posAmt = parseFloat(position.positionAmt);
        const positionQty = Math.abs(posAmt);

        // Only manage positions for symbols in our config
        const symbolConfig = this.config.symbols[symbol];
        if (!symbolConfig) {
          continue;
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
            console.log(`PositionManager: [Periodic Check] SL order ${slOrder.orderId} quantity mismatch - Order: ${slOrderQty}, Position: ${positionQty}`);
            needsAdjustment = true;
          }
        }

        // Check if TP order quantity matches
        if (tpOrder) {
          const tpOrderQty = parseFloat(tpOrder.origQty);
          if (Math.abs(tpOrderQty - positionQty) > 0.00000001) {
            console.log(`PositionManager: [Periodic Check] TP order ${tpOrder.orderId} quantity mismatch - Order: ${tpOrderQty}, Position: ${positionQty}`);
            needsAdjustment = true;
          }
        }

        // Adjust if needed
        if (needsAdjustment) {
          await this.adjustProtectiveOrders(position, slOrder, tpOrder);
        } else if (!slOrder || !tpOrder) {
          console.log(`PositionManager: [Periodic Check] Position ${key} missing protection (SL: ${!!slOrder}, TP: ${!!tpOrder})`);
          await this.placeProtectiveOrdersWithLock(key, position, !slOrder, !tpOrder);
        }
      }
    } catch (error: any) {
      console.error('PositionManager: Error during periodic order check:', error?.response?.data || error?.message);
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

    console.log(`PositionManager: Checking orders for position ${positionKey} (size: ${positionQty})`);

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
      console.error(`PositionManager: Error checking orders for position ${positionKey}:`, error?.response?.data || error?.message);
    }
  }

  // Manual cleanup method to immediately clean up orphaned/duplicate orders
  public async manualCleanup(): Promise<void> {
    console.log('PositionManager: Manual cleanup triggered');
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
      console.warn(`PositionManager: Position ${symbol} ${side} not found`);
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

    console.log(`PositionManager: Closed position ${symbol} ${side}`);

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
            // Try to use configured leverage as fallback
            const symbolConfig = this.config.symbols[symbol];
            if (symbolConfig && symbolConfig.leverage) {
              console.log(`PositionManager: Warning - Invalid leverage (${position.leverage}) for ${symbol} position, using configured leverage: ${symbolConfig.leverage}`);
              leverage = symbolConfig.leverage;
            } else {
              // Last resort: assume leverage of 1 (no leverage)
              console.log(`PositionManager: Warning - Invalid leverage (${position.leverage}) for ${symbol} position and no config found, defaulting to 1x`);
              leverage = 1;
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
        console.log('PositionManager: Triggered balance refresh after position change');
      }
    } catch (error) {
      console.error('PositionManager: Failed to refresh balance:', error);
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
