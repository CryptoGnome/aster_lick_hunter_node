import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { LiquidationEvent } from '../lib/types';
import { errorLogger } from '../lib/services/errorLogger';
import { discordService } from '../lib/services/discordService';

export interface BotStatus {
  isRunning: boolean;
  paperMode: boolean;
  uptime: number;
  startTime: Date | null;
  lastActivity: Date | null;
  symbols: string[];
  positionsOpen: number;
  totalPnL: number;
  errors: string[];
}

export class StatusBroadcaster extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private status: BotStatus = {
    isRunning: false,
    paperMode: true,
    uptime: 0,
    startTime: null,
    lastActivity: null,
    symbols: [],
    positionsOpen: 0,
    totalPnL: 0,
    errors: [],
  };
  private uptimeInterval: NodeJS.Timeout | null = null;

  constructor(private port: number = 8080) {
    super();
  }

  // Initialize Discord service with config
  initializeDiscord(config: any): void {
    discordService.initialize(config?.global?.discord);
  }

  async start(): Promise<void> {
    try {
      this.wss = new WebSocketServer({ port: this.port });

      this.wss.on('connection', (ws: WebSocket) => {
        console.log('📱 Web UI connected to bot');
        this.clients.add(ws);

        // Send initial status
        ws.send(JSON.stringify({
          type: 'status',
          data: this.status,
        }));

        // Handle incoming messages from web UI
        ws.on('message', async (data: Buffer) => {
          try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
              case 'reload_config':
                console.log('📝 Config reload requested from web UI');
                this.broadcast('config_reloading', { timestamp: new Date() });

                // Trigger config reload through configManager
                const { configManager } = await import('../lib/services/configManager');
                try {
                  const newConfig = await configManager.reloadConfig();
                  this.broadcast('config_reload_success', {
                    timestamp: new Date(),
                    config: newConfig,
                  });
                  console.log('✅ Config reloaded via WebSocket command');
                } catch (error: any) {
                  this.broadcast('config_reload_error', {
                    timestamp: new Date(),
                    error: error.message,
                  });
                  console.error('❌ Config reload failed:', error);
                }
                break;

              case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                break;

              default:
                // Only log truly unknown message types
                if (!['pong'].includes(message.type)) {
                  console.log('Unknown message type:', message.type);
                }
            }
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        });

        ws.on('close', () => {
          console.log('📱 Web UI disconnected');
          this.clients.delete(ws);
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          this.clients.delete(ws);
        });

        // Handle ping/pong for keep-alive
        ws.on('ping', () => ws.pong());
      });

      // Update uptime every second
      this.uptimeInterval = setInterval(() => {
        if (this.status.isRunning && this.status.startTime) {
          this.status.uptime = Date.now() - this.status.startTime.getTime();
          this._broadcast('status', this.status);
        }
      }, 1000);

      console.log(`📡 WebSocket server running on port ${this.port}`);
    } catch (error) {
      console.error('Failed to start WebSocket server:', error);
    }
  }

  stop(): void {
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
    }

    this.clients.forEach(client => {
      client.close();
    });

    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  updateStatus(updates: Partial<BotStatus>): void {
    this.status = { ...this.status, ...updates };
    this._broadcast('status', this.status);
  }

  setRunning(isRunning: boolean): void {
    this.status.isRunning = isRunning;
    if (isRunning) {
      this.status.startTime = new Date();
      this.status.uptime = 0;
    } else {
      this.status.startTime = null;
      this.status.uptime = 0;
    }
    this._broadcast('status', this.status);
  }

  addError(error: string): void {
    this.status.errors.push(error);
    // Keep only last 10 errors
    if (this.status.errors.length > 10) {
      this.status.errors.shift();
    }
    this._broadcast('status', this.status);
  }

  clearErrors(): void {
    this.status.errors = [];
    this._broadcast('status', this.status);
  }

  // Public broadcast method for external use
  public broadcast(type: string, data: any): void {
    this._broadcast(type, data);
  }

  private _broadcast(type: string, data: any): void {
    const message = JSON.stringify({ type, data });

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  logActivity(activity: string): void {
    this.status.lastActivity = new Date();
    this._broadcast('activity', {
      message: activity,
      timestamp: this.status.lastActivity,
    });
  }

  // Broadcast liquidation events to connected clients
  broadcastLiquidation(liquidationEvent: LiquidationEvent): void {
    this._broadcast('liquidation', {
      symbol: liquidationEvent.symbol,
      side: liquidationEvent.side,
      orderType: liquidationEvent.orderType,
      quantity: liquidationEvent.quantity,
      price: liquidationEvent.price,
      averagePrice: liquidationEvent.averagePrice,
      orderStatus: liquidationEvent.orderStatus,
      orderLastFilledQuantity: liquidationEvent.orderLastFilledQuantity,
      orderFilledAccumulatedQuantity: liquidationEvent.orderFilledAccumulatedQuantity,
      orderTradeTime: liquidationEvent.orderTradeTime,
      eventTime: liquidationEvent.eventTime,
      timestamp: new Date(),
      // Include threshold status for real-time UI updates
      thresholdStatus: (liquidationEvent as any).thresholdStatus,
    });
  }

  // Broadcast threshold updates to connected clients
  broadcastThresholdUpdate(thresholdUpdate: any): void {
    this._broadcast('threshold_update', {
      ...thresholdUpdate,
      timestamp: new Date(),
    });
  }

  // Broadcast trade opportunities detected by the hunter
  broadcastTradeOpportunity(data: {
    symbol: string;
    side: string;
    reason: string;
    liquidationVolume: number;
    priceImpact: number;
    confidence: number;
  }): void {
    this._broadcast('trade_opportunity', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast when a trade is blocked (e.g., by VWAP protection)
  broadcastTradeBlocked(data: {
    symbol: string;
    side: string;
    reason: string;
    vwap?: number;
    currentPrice?: number;
    blockType?: string;
  }): void {
    this._broadcast('trade_blocked', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast when a position is actually opened
  broadcastPositionUpdate(data: {
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    type: 'opened' | 'closed' | 'updated';
    pnl?: number;
  }): void {
    this._broadcast('position_update', {
      ...data,
      timestamp: new Date(),
    });

    // Send Discord notification for position events
    if (data.type === 'opened') {
      discordService.notifyPositionOpened({
        symbol: data.symbol,
        side: data.side as 'LONG' | 'SHORT',
        quantity: data.quantity,
        price: data.price,
      }).catch(error => {
        console.error('Failed to send Discord notification for position opened:', error);
      });
    }
  }

  // Broadcast balance updates to web UI
  broadcastBalance(data: {
    totalBalance: number;
    availableBalance: number;
    totalPositionValue: number;
    totalPnL: number;
  }): void {
    this._broadcast('balance_update', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast PnL updates to web UI
  broadcastPnLUpdate(data: {
    session: any;
    snapshot: any;
    reason?: string;
  }): void {
    this._broadcast('pnl_update', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast when an order is placed
  broadcastOrderPlaced(data: {
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: string;
    quantity: number;
    price?: number;
    orderId?: string;
  }): void {
    this._broadcast('order_placed', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast when an order is filled
  broadcastOrderFilled(data: {
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: string;
    executedQty: number;
    price: number;
    orderId?: string;
    pnl?: number;
  }): void {
    this._broadcast('order_filled', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast when a stop loss is placed
  broadcastStopLossPlaced(data: {
    symbol: string;
    price: number;
    quantity: number;
    orderId?: string;
  }): void {
    this._broadcast('sl_placed', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast when a take profit is placed
  broadcastTakeProfitPlaced(data: {
    symbol: string;
    price: number;
    quantity: number;
    orderId?: string;
  }): void {
    this._broadcast('tp_placed', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast when a position is closed
  broadcastPositionClosed(data: {
    symbol: string;
    side: string;
    quantity: number;
    pnl?: number;
    reason?: string;
  }): void {
    this._broadcast('position_closed', {
      ...data,
      timestamp: new Date(),
    });

    // Send Discord notification for position closed
    discordService.notifyPositionClosed({
      symbol: data.symbol,
      side: data.side as 'LONG' | 'SHORT',
      quantity: data.quantity,
      price: 0, // Price not available in this context
      pnl: data.pnl,
      reason: data.reason,
    }).catch(error => {
      console.error('Failed to send Discord notification for position closed:', error);
    });
  }

  // Broadcast when an order is cancelled
  broadcastOrderCancelled(data: {
    symbol: string;
    side: string;
    orderType: string;
    reason?: string;
  }): void {
    this._broadcast('order_cancelled', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast when an order fails
  broadcastOrderFailed(data: {
    symbol: string;
    side: string;
    reason?: string;
  }): void {
    this._broadcast('order_failed', {
      ...data,
      timestamp: new Date(),
    });
  }

  // Broadcast ORDER_TRADE_UPDATE events from user data stream
  broadcastOrderUpdate(orderEvent: any): void {
    // Forward the raw ORDER_TRADE_UPDATE event to web UI
    this._broadcast('order_update', orderEvent);
  }

  // Broadcast error events to web UI for toast notifications
  broadcastError(type: 'websocket' | 'api' | 'trading' | 'config' | 'general', data: {
    title: string;
    message: string;
    details?: {
      errorCode?: string;
      component?: string;
      symbol?: string;
      timestamp?: string;
      stackTrace?: string;
      rawError?: any;
    };
  }): void {
    // Log to persistent error database
    const error = new Error(`${data.title}: ${data.message}`);
    if (data.details?.stackTrace) {
      error.stack = data.details.stackTrace;
    }

    errorLogger.logError(error, {
      type,
      severity: type === 'config' || type === 'api' ? 'high' : 'medium',
      code: data.details?.errorCode,
      context: {
        component: data.details?.component,
        symbol: data.details?.symbol,
        metadata: data.details?.rawError
      }
    });

    // Also log to console for server-side debugging
    console.error(`[${type.toUpperCase()} ERROR] ${data.title}: ${data.message}`);
    if (data.details) {
      console.error('Details:', data.details);
    }

    // Broadcast to web UI
    this._broadcast(`${type}_error`, {
      title: data.title,
      message: data.message,
      details: {
        ...data.details,
        timestamp: data.details?.timestamp || new Date().toISOString(),
        sessionId: errorLogger.getSessionId(),
      },
    });

    // Also add to status errors for backward compatibility
    if (type === 'config' || type === 'api') {
      this.addError(`${data.title}: ${data.message}`);
    }
  }

  // Convenience methods for specific error types
  broadcastWebSocketError(title: string, message: string, details?: any): void {
    this.broadcastError('websocket', {
      title,
      message,
      details,
    });
  }

  broadcastApiError(title: string, message: string, details?: any): void {
    this.broadcastError('api', {
      title,
      message,
      details,
    });
  }

  broadcastTradingError(title: string, message: string, details?: any): void {
    this.broadcastError('trading', {
      title,
      message,
      details,
    });
  }

  broadcastConfigError(title: string, message: string, details?: any): void {
    this.broadcastError('config', {
      title,
      message,
      details,
    });
  }

  // Broadcast session info for error tracking
  broadcastSessionInfo(): void {
    this._broadcast('session_info', {
      sessionId: errorLogger.getSessionId(),
      systemInfo: errorLogger.getSystemInfo(),
      timestamp: new Date(),
    });
  }
}