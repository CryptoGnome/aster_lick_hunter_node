export interface SymbolConfig {
  // Volume thresholds
  volumeThresholdUSDT?: number;       // Legacy field for backward compatibility
  longVolumeThresholdUSDT?: number;   // Min liquidation volume to trigger long trades (buy on sell liquidations)
  shortVolumeThresholdUSDT?: number;  // Min liquidation volume to trigger short trades (sell on buy liquidations)

  // Position sizing
  tradeSize: number;                  // Base quantity for trades (adjusted by leverage)
  longTradeSize?: number;              // Optional: Specific margin in USDT for long positions
  shortTradeSize?: number;             // Optional: Specific margin in USDT for short positions
  maxPositionMarginUSDT?: number;     // Max margin exposure for this symbol (position size × leverage × price)

  // Risk parameters
  leverage: number;            // Leverage (1-125)
  tpPercent: number;           // Take profit as percentage (e.g., 5 for 5%)
  slPercent: number;           // Stop loss as percentage (e.g., 2 for 2%)

  // Limit order specific settings
  priceOffsetBps?: number;     // Price offset in basis points from best bid/ask (default: 1)
  usePostOnly?: boolean;       // Use post-only orders to guarantee maker fees (default: false)
  maxSlippageBps?: number;     // Maximum acceptable slippage in basis points (default: 50)
  orderType?: 'LIMIT' | 'MARKET'; // Order type preference (default: 'LIMIT')

  // VWAP protection settings
  vwapProtection?: boolean;    // Enable VWAP-based entry filtering (default: false)
  vwapTimeframe?: string;      // Timeframe for VWAP calculation: 1m, 5m, 15m, 30m, 1h (default: '1m')
  vwapLookback?: number;       // Number of candles to use for VWAP calculation (default: 100)
}

export interface ApiCredentials {
  apiKey: string;          // API Key from Aster Finance exchange
  secretKey: string;       // Secret Key from Aster Finance exchange
}

export interface ServerConfig {
  dashboardPassword?: string;  // Optional password to protect the dashboard
  dashboardPort?: number;       // Port for the web UI (default: 3000)
  websocketPort?: number;       // Port for the WebSocket server (default: 8080)
}

export interface GlobalConfig {
  riskPercent: number;     // Max risk per trade as % of account balance
  paperMode: boolean;      // If true, simulate trades without executing
  positionMode?: 'ONE_WAY' | 'HEDGE'; // Position mode preference (optional)
  maxOpenPositions?: number; // Max number of open positions (hedged pairs count as one)
  server?: ServerConfig;    // Optional server configuration
}

export interface Config {
  api: ApiCredentials;
  symbols: Record<string, SymbolConfig>; // key: symbol like "BTCUSDT"
  global: GlobalConfig;
  version?: string; // Optional version field for config schema versioning
}

// API response types
export interface LiquidationEvent {
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: string;
  quantity: number;
  price: number;
  averagePrice: number;
  orderStatus: string;
  orderLastFilledQuantity: number;
  orderFilledAccumulatedQuantity: number;
  orderTradeTime: number;
  eventTime: number;

  // Keep for backward compatibility
  qty: number;
  time: number;
}

export interface Order {
  symbol: string;
  orderId: string;
  clientOrderId?: string;
  side: 'BUY' | 'SELL';
  type: string;
  quantity: number;
  price: number;
  status: string;
  updateTime: number;
}

export interface Position {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unrealizedProfit: number;
  liquidationPrice?: number;
  leverage: number;
}

// Other types as needed
export interface Kline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface MarkPrice {
  symbol: string;
  markPrice: string;
  indexPrice: string;
};
