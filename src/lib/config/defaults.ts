import { Config } from './types';

export const DEFAULT_CONFIG_VERSION = '1.1.0';

export const DEFAULT_CONFIG: Config = {
  api: {
    apiKey: '',
    secretKey: '',
  },
  symbols: {
    // Empty by default - users add symbols during setup
  },
  global: {
    riskPercent: 5,
    paperMode: false,
    positionMode: 'HEDGE',
    maxOpenPositions: 10,
    useTradeQualityScoring: false, // Disabled by default - users can enable once familiar
    useFTAExitAnalysis: false, // Disabled by default - logs signals for long-running trades
    server: {
      dashboardPassword: '',
      dashboardPort: 3000,
      websocketPort: 8080,
      useRemoteWebSocket: false,
      websocketHost: null,
    },
  },
  version: DEFAULT_CONFIG_VERSION,
};

// Default symbol config - tradeSize in USDT (margin amount)
export const DEFAULT_SYMBOL_CONFIG = {
  longVolumeThresholdUSDT: 5000,
  shortVolumeThresholdUSDT: 5000,
  tradeSize: 5, // $5 USDT margin - safe minimum for most symbols at 10x leverage
  maxPositionMarginUSDT: 1000,
  leverage: 5,
  tpPercent: 3,
  slPercent: 1.5,
  priceOffsetBps: 5,
  maxSlippageBps: 50,
  orderType: 'LIMIT' as const,
  vwapProtection: true,
  vwapTimeframe: '1m',
  vwapLookback: 200,
};