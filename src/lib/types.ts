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
  
  // Dynamic position sizing
  positionSizingMode?: 'FIXED' | 'PERCENTAGE'; // Position sizing mode (default: FIXED)
  percentageOfBalance?: number;        // Percentage of balance to use for position sizing (0.1-100%)
  minPositionSize?: number;            // Minimum position size in USDT (safety floor)
  maxPositionSize?: number;            // Maximum position size in USDT (safety ceiling)

  // Risk parameters
  leverage: number;            // Leverage (1-125)
  tpPercent: number;           // Take profit as percentage (e.g., 5 for 5%)
  slPercent: number;           // Stop loss as percentage (e.g., 2 for 2%)

  // Limit order specific settings
  priceOffsetBps?: number;     // Price offset in basis points from best bid/ask (default: 1)
  usePostOnly?: boolean;       // Use post-only orders to guarantee maker fees (default: false)
  maxSlippageBps?: number;     // Maximum acceptable slippage in basis points (default: 50)
  orderType?: 'LIMIT' | 'MARKET'; // Order type preference (default: 'LIMIT')
  forceMarketEntry?: boolean;  // Force market orders for opening positions (default: false)

  // VWAP protection settings
  vwapProtection?: boolean;    // Enable VWAP-based entry filtering (default: false)
  vwapTimeframe?: string;      // Timeframe for VWAP calculation: 1m, 5m, 15m, 30m, 1h (default: '1m')
  vwapLookback?: number;       // Number of candles to use for VWAP calculation (default: 100)

  // Threshold system settings (60-second rolling window)
  useThreshold?: boolean;       // Enable threshold-based triggering for this symbol (default: false)
  thresholdTimeWindow?: number; // Time window in ms for volume accumulation (default: 60000)
  thresholdCooldown?: number;   // Cooldown period in ms between triggers (default: 30000)

  // Multi-Tranche Position Management
  enableTrancheManagement?: boolean;     // Enable tracking of multiple independent position entries
  trancheIsolationThreshold?: number;    // P&L % threshold to isolate underwater tranches (e.g., 5 for -5%)
  maxTranches?: number;                  // Maximum number of active tranches per symbol/side (e.g., 10)
  maxIsolatedTranches?: number;          // Maximum number of isolated tranches allowed before blocking new trades
  allowTrancheWhileIsolated?: boolean;   // Allow opening new tranches while some are isolated
  trancheAutoCloseIsolated?: boolean;    // Automatically close isolated tranches when they recover
  trancheRecoveryThreshold?: number;     // P&L % threshold to auto-close recovered tranches (e.g., 0.5 for +0.5%)
  maxPositionLossUSDT?: number;          // Position-level max loss in USDT — close worst tranches when total unrealized exceeds this (e.g., 3)
  maxTrancheAgeMinutes?: number;         // Time-based exit: close underwater tranches older than this (e.g., 240 for 4 hours)
}

export interface ApiCredentials {
  apiKey: string;          // API Key from Aster Finance exchange
  secretKey: string;       // Secret Key from Aster Finance exchange
}

export interface ServerConfig {
  dashboardPassword?: string;  // Optional password to protect the dashboard
  dashboardPort?: number;       // Port for the web UI (default: 3000)
  websocketPort?: number;       // Port for the WebSocket server (default: 8080)
  useRemoteWebSocket?: boolean; // Enable remote WebSocket access (default: false)
  websocketHost?: string | null; // Optional WebSocket host override (null for auto-detect)
  setupComplete?: boolean;      // Track if initial setup/onboarding has been completed (server-side state)
}

export interface RateLimitConfig {
  maxRequestWeight?: number;  // Max request weight per minute (default: 2400)
  maxOrderCount?: number;      // Max orders per minute (default: 1200)
  reservePercent?: number;     // Percentage to reserve for critical operations (default: 30)
  enableBatching?: boolean;    // Enable order batching (default: true)
  queueTimeout?: number;       // Timeout for queued requests in ms (default: 30000)
  enableDeduplication?: boolean; // Enable request deduplication (default: true)
  deduplicationWindowMs?: number; // Time window for request deduplication in ms (default: 1000)
  parallelProcessing?: boolean; // Enable parallel processing of requests (default: false)
  maxConcurrentRequests?: number; // Maximum number of concurrent requests (default: 3)
}

export interface PaperTradingConfig {
  startingBalance?: number;     // Initial virtual balance in USDT (default: 1000)
  slippageBps?: number;         // Simulated slippage in basis points (default: 0)
  partialFillPercent?: number;  // Chance of partial fills 0-100 (default: 0)
  latencyMs?: number;           // Simulated network latency in ms (default: 0)
  rejectionRate?: number;       // Chance of order rejection 0-100 (default: 0)
  enableRealisticFills?: boolean; // Simulate more realistic order fills (default: false)
}

export interface LiquidationDatabaseConfig {
  retentionDays?: number;       // Number of days to retain liquidation data (default: 90)
  cleanupIntervalHours?: number; // How often to run cleanup in hours (default: 24)
}

export interface CascadeProtectionConfig {
  enabled?: boolean;                  // Enable cascade detection (default: true)
  mode?: 'BLOCK' | 'LOG_ONLY' | 'REDUCE'; // BLOCK=hard stop, LOG_ONLY=log but allow trades, REDUCE=trade at reduced size (default: LOG_ONLY)
  reducedPositionMultiplier?: number; // Position size multiplier during cascade when mode=REDUCE (default: 0.5)
  rollingWindowMinutes?: number;      // Window for detecting abnormal activity (default: 5)
  baselineWindowMinutes?: number;     // Window for calculating normal volume baseline (default: 30)
  volumeMultiplierThreshold?: number; // Volume spike multiplier to trigger detection (default: 3.0)
  minSymbolsForCascade?: number;      // Minimum symbols liquidating simultaneously (default: 3)
  directionalSkewThreshold?: number;  // Directional skew threshold 0-1 (default: 0.8)
  cooldownMinutes?: number;           // Minutes to pause after cascade detected (default: 10)
  minVolumeForDetection?: number;     // Minimum volume in window before detection (default: 50000)
}

export interface AccountHealthConfig {
  enabled?: boolean;                     // Enable account health monitoring (default: true)
  maxDrawdownPercent?: number;           // Pause new trades if account drops X% from session peak balance (default: 25)
  maxUnrealizedLossPercent?: number;     // Pause new trades if total unrealized loss exceeds X% of balance (default: 20)
  resumeAtDrawdownPercent?: number;      // Resume trading when drawdown recovers to X% (default: 15) — must be < maxDrawdownPercent
  checkIntervalSeconds?: number;         // How often to check account health (default: 60)
  closeAllAtDrawdownPercent?: number;    // Emergency: close ALL positions if drawdown exceeds X% (default: 0 = disabled)
  maxPositionNotional?: number;          // Max notional value (qty × price) a single position can grow to via DCA (default: 0 = unlimited)
  maxDCAEntries?: number;                // Max number of DCA entries per position direction (default: 0 = unlimited)
}

export interface GlobalConfig {
  riskPercent: number;     // Max risk per trade as % of account balance
  paperMode: boolean;      // If true, simulate trades without executing
  positionMode?: 'ONE_WAY' | 'HEDGE'; // Position mode preference (optional)
  maxOpenPositions?: number; // Max number of open positions (hedged pairs count as one)
  maxLongPositions?: number; // Max number of LONG positions allowed simultaneously (default: unlimited)
  maxShortPositions?: number; // Max number of SHORT positions allowed simultaneously (default: unlimited)
  useThresholdSystem?: boolean; // Enable 60-second rolling volume threshold system (default: false)
  useTradeQualityScoring?: boolean; // Enable trade quality scoring - VWAP regime, spike analysis (default: true)
  useFTAExitAnalysis?: boolean; // Enable FTA early exit analysis - logs signals for long-running/losing trades (default: false)
  enableTrailingTP?: boolean;   // Enable trailing take profit globally (default: false)
  trailingTPActivation?: number; // Profit % at which trailing TP activates (default: 0.5)
  trailingTPCallback?: number;  // Callback % from peak profit to trigger close (default: 0.3)
  minEntrySpacingPercent?: number; // Minimum price spacing % between entries on same symbol/direction for DCA safety (default: 0.5)
  tradeSizeMultiplier?: number;     // Global trade size multiplier (0.1-5.0, default: 1.0). Applies to ALL symbols. Use for risk-on/risk-off scaling.
  debugMode?: boolean;      // Enable verbose console logging for debugging (default: false)
  server?: ServerConfig;    // Optional server configuration
  rateLimit?: RateLimitConfig; // Rate limit configuration
  liquidationDatabase?: LiquidationDatabaseConfig; // Liquidation data retention settings
  cascadeProtection?: CascadeProtectionConfig; // Cascade detection & circuit breaker settings
  accountHealth?: AccountHealthConfig; // Account drawdown & health monitoring settings
  paperTrading?: PaperTradingConfig; // Paper trading configuration
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

// Multi-Tranche Position Management types

export interface Tranche {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  entryPrice: number;
  quantity: number;
  marginUsed: number;
  leverage: number;
  entryTime: number;
  entryOrderId?: string;
  exitPrice?: number;
  exitTime?: number;
  exitOrderId?: string;
  unrealizedPnl: number;
  realizedPnl: number;
  tpPercent: number;
  slPercent: number;
  tpPrice: number;
  slPrice: number;
  status: 'active' | 'closed' | 'liquidated';
  isolated: boolean;
  isolationTime?: number;
  isolationPrice?: number;
  notes?: string;
}

export interface TrancheGroup {
  symbol: string;
  side: 'LONG' | 'SHORT';
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  tranches: Tranche[];
  activeTranches: Tranche[];
  isolatedTranches: Tranche[];
  totalQuantity: number;
  totalMarginUsed: number;
  weightedAvgEntry: number;
  totalUnrealizedPnl: number;
  lastExchangeQuantity: number;
  lastExchangeSync: number;
  syncStatus: 'synced' | 'drift';
}

export interface TrancheEvent {
  id: number;
  trancheId: string;
  eventType: string;
  eventTime: number;
  price?: number;
  quantity?: number;
  pnl?: number;
  trigger?: string;
  metadata?: string;
}
