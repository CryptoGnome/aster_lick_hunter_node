'use client';

import { EventEmitter } from 'events';

export interface AccountInfo {
  totalBalance: number;
  availableBalance: number;
  totalPositionValue: number;
  totalPnL: number;
}

export interface BalanceStatus {
  source?: string;
  timestamp?: number;
  error?: string;
}

export interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  pnl: number;
  pnlPercent: number;
  margin: number;
  stopLoss?: number;
  takeProfit?: number;
  leverage: number;
  hasStopLoss?: boolean;
  hasTakeProfit?: boolean;
  liquidationPrice?: number;
}

interface CachedData<T> {
  data: T;
  timestamp: number;
  loading: boolean;
  error?: string;
}

interface DataStoreState {
  balance: CachedData<AccountInfo>;
  positions: CachedData<Position[]>;
  markPrices: Record<string, number>;
}

class DataStore extends EventEmitter {
  private state: DataStoreState;
  private fetchPromises: Map<string, Promise<any>>;
  private readonly CACHE_TTL = 5000; // 5 seconds cache

  constructor() {
    super();
    this.state = {
      balance: {
        data: {
          totalBalance: 0,
          availableBalance: 0,
          totalPositionValue: 0,
          totalPnL: 0,
        },
        timestamp: 0,
        loading: false,
      },
      positions: {
        data: [],
        timestamp: 0,
        loading: false,
      },
      markPrices: {},
    };
    this.fetchPromises = new Map();
  }

  // Get current balance data
  getBalance(): CachedData<AccountInfo> {
    return { ...this.state.balance };
  }

  // Get current positions data
  getPositions(): CachedData<Position[]> {
    return { ...this.state.positions };
  }

  // Get mark prices
  getMarkPrices(): Record<string, number> {
    return { ...this.state.markPrices };
  }

  // Update balance from WebSocket or API
  updateBalance(data: AccountInfo, source: string = 'api') {
    this.state.balance = {
      data,
      timestamp: Date.now(),
      loading: false,
      error: undefined,
    };
    this.emit('balance:update', { ...data, source });
  }

  // Update positions from WebSocket or API
  updatePositions(data: Position[]) {
    this.state.positions = {
      data,
      timestamp: Date.now(),
      loading: false,
      error: undefined,
    };
    this.emit('positions:update', data);
  }

  // Update mark prices from WebSocket
  updateMarkPrices(prices: Record<string, number>) {
    this.state.markPrices = { ...this.state.markPrices, ...prices };
    this.emit('markPrices:update', this.state.markPrices);
  }

  // Fetch balance with deduplication and caching
  async fetchBalance(force: boolean = false): Promise<AccountInfo> {
    const cached = this.state.balance;

    // Return cached data if still valid
    if (!force && cached.timestamp && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Check if there's already a fetch in progress
    const existingPromise = this.fetchPromises.get('balance');
    if (existingPromise) {
      return existingPromise;
    }

    // Start new fetch
    const fetchPromise = this._fetchBalance(force);
    this.fetchPromises.set('balance', fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.fetchPromises.delete('balance');
    }
  }

  // Fetch positions with deduplication and caching
  async fetchPositions(force: boolean = false): Promise<Position[]> {
    const cached = this.state.positions;

    // Return cached data if still valid
    if (!force && cached.timestamp && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Check if there's already a fetch in progress
    const existingPromise = this.fetchPromises.get('positions');
    if (existingPromise) {
      return existingPromise;
    }

    // Start new fetch
    const fetchPromise = this._fetchPositions(force);
    this.fetchPromises.set('positions', fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.fetchPromises.delete('positions');
    }
  }

  // Internal fetch methods
  private async _fetchBalance(force: boolean = false): Promise<AccountInfo> {
    this.state.balance.loading = true;
    this.emit('balance:loading');

    try {
      const url = force ? '/api/balance?force=true' : '/api/balance';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Balance API failed: ${response.status}`);
      }

      const data = await response.json();
      const accountInfo: AccountInfo = {
        totalBalance: data.totalBalance || 0,
        availableBalance: data.availableBalance || 0,
        totalPositionValue: data.totalPositionValue || 0,
        totalPnL: data.totalPnL || 0,
      };

      this.updateBalance(accountInfo, data.source || 'api');
      return accountInfo;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.state.balance = {
        ...this.state.balance,
        loading: false,
        error: errorMessage,
      };
      this.emit('balance:error', errorMessage);
      throw error;
    }
  }

  private async _fetchPositions(force: boolean = false): Promise<Position[]> {
    this.state.positions.loading = true;
    this.emit('positions:loading');

    try {
      const url = force ? '/api/positions?force=true' : '/api/positions';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Positions API failed: ${response.status}`);
      }

      const data = await response.json();
      this.updatePositions(data);
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.state.positions = {
        ...this.state.positions,
        loading: false,
        error: errorMessage,
      };
      this.emit('positions:error', errorMessage);
      throw error;
    }
  }

  // Clear all cached data
  clearCache() {
    this.state.balance.timestamp = 0;
    this.state.positions.timestamp = 0;
    this.fetchPromises.clear();
  }

  // Handle WebSocket message
  handleWebSocketMessage(message: any) {
    if (message.type === 'balance_update') {
      console.log('[DataStore] Received balance update from WebSocket:', message.data);
      this.updateBalance(message.data, 'websocket');
    } else if (message.type === 'position_update') {
      console.log('[DataStore] Position update received:', message.data?.type);
      // Clear positions cache immediately to prevent serving stale data
      this.state.positions.timestamp = 0;

      // Check if this is a position closure
      if (message.data?.type === 'closed') {
        console.log('[DataStore] Position closed, fetching positions immediately');
        // Fetch immediately for position closures
        this.fetchPositions(true).catch(error => {
          console.error('[DataStore] Failed to fetch positions after closure:', error);
        });
      } else {
        // Add a 1 second delay to allow protective orders to be placed
        // This ensures SL/TP badges appear correctly in the dashboard
        setTimeout(() => {
          // Force fetch to get latest positions with protective orders
          this.fetchPositions(true).catch(error => {
            console.error('[DataStore] Failed to fetch positions after update:', error);
          });
        }, 1000);
      }
    } else if (message.type === 'position_closed') {
      console.log('[DataStore] Position closed event received, fetching positions immediately');
      // Clear positions cache and fetch immediately
      this.state.positions.timestamp = 0;
      this.fetchPositions(true).catch(error => {
        console.error('[DataStore] Failed to fetch positions after closure:', error);
      });
    } else if (message.type === 'sl_placed' || message.type === 'tp_placed') {
      // When SL/TP orders are placed, refresh positions to update protection badges
      console.log(`[DataStore] ${message.type === 'sl_placed' ? 'Stop Loss' : 'Take Profit'} placed, refreshing positions`);
      // Small delay to ensure order is registered on exchange
      setTimeout(() => {
        this.fetchPositions(true).catch(error => {
          console.error('[DataStore] Failed to fetch positions after SL/TP placement:', error);
        });
      }, 500);
    } else if (message.type === 'mark_price_update') {
      if (Array.isArray(message.data)) {
        const priceUpdates: Record<string, number> = {};
        message.data.forEach((price: any) => {
          priceUpdates[price.symbol] = parseFloat(price.markPrice);
        });
        this.updateMarkPrices(priceUpdates);
      }
    } else if (message.type === 'order_update' || message.type === 'ORDER_TRADE_UPDATE') {
      // Forward order updates to orderStore
      console.log('[DataStore] Forwarding order update to orderStore');
      // Import orderStore dynamically to avoid circular dependencies
      import('./orderStore').then(module => {
        module.default.handleWebSocketMessage(message);
      }).catch(error => {
        console.error('[DataStore] Failed to forward order update:', error);
      });
    }
  }
}

// Global singleton instance
const dataStore = new DataStore();

// Export singleton instance
export default dataStore;