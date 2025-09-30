import { z } from 'zod';

export const symbolConfigSchema = z.object({
  // Volume thresholds
  volumeThresholdUSDT: z.number().min(0).optional(),
  longVolumeThresholdUSDT: z.number().min(0).optional(),
  shortVolumeThresholdUSDT: z.number().min(0).optional(),

  // Position sizing
  tradeSize: z.number().min(0.00001),
  longTradeSize: z.number().min(0.00001).optional(),
  shortTradeSize: z.number().min(0.00001).optional(),
  maxPositionMarginUSDT: z.number().min(0).optional(),

  // Risk parameters
  leverage: z.number().min(1).max(125),
  tpPercent: z.number().min(0.1),
  slPercent: z.number().min(0.1),

  // Limit order settings (optional)
  priceOffsetBps: z.number().optional(),
  usePostOnly: z.boolean().optional(),
  maxSlippageBps: z.number().optional(),
  orderType: z.enum(['LIMIT', 'MARKET']).optional(),

  // VWAP protection settings (optional)
  vwapProtection: z.boolean().optional(),
  vwapTimeframe: z.string().optional(),
  vwapLookback: z.number().min(10).max(500).optional(),

  // Threshold system settings
  useThreshold: z.boolean().optional(),
}).refine(data => {
  // Ensure we have either legacy or new volume thresholds
  return data.volumeThresholdUSDT !== undefined ||
         (data.longVolumeThresholdUSDT !== undefined && data.shortVolumeThresholdUSDT !== undefined);
}, {
  message: "Either volumeThresholdUSDT or both longVolumeThresholdUSDT and shortVolumeThresholdUSDT must be provided"
});

export const apiCredentialsSchema = z.object({
  apiKey: z.string(),
  secretKey: z.string(),
});

export const serverConfigSchema = z.object({
  dashboardPassword: z.string().optional(),
  dashboardPort: z.number().optional(),
  websocketPort: z.number().optional(),
  useRemoteWebSocket: z.boolean().optional(),
  websocketHost: z.string().nullable().optional(),
  envWebSocketHost: z.string().optional(), // For environment variable override
}).optional();

export const rateLimitConfigSchema = z.object({
  maxRequestWeight: z.number().optional(),
  maxOrderCount: z.number().optional(),
  reservePercent: z.number().optional(),
  enableBatching: z.boolean().optional(),
  queueTimeout: z.number().optional(),
  enableDeduplication: z.boolean().optional(),
  deduplicationWindowMs: z.number().optional(),
  parallelProcessing: z.boolean().optional(),
  maxConcurrentRequests: z.number().min(1).max(10).optional(),
}).optional();

export const globalConfigSchema = z.object({
  riskPercent: z.number().min(0).max(100),
  paperMode: z.boolean(),
  positionMode: z.enum(['ONE_WAY', 'HEDGE']).optional(),
  maxOpenPositions: z.number().min(1).optional(),
  useThresholdSystem: z.boolean().optional(),
  server: serverConfigSchema,
  rateLimit: rateLimitConfigSchema,
});

export const configSchema = z.object({
  api: apiCredentialsSchema,
  symbols: z.record(symbolConfigSchema),
  global: globalConfigSchema,
  version: z.string().optional(),
});

export type SymbolConfig = z.infer<typeof symbolConfigSchema>;
export type ApiCredentials = z.infer<typeof apiCredentialsSchema>;
export type GlobalConfig = z.infer<typeof globalConfigSchema>;
export type Config = z.infer<typeof configSchema>;

export interface ConfigMigration {
  fromVersion: string;
  toVersion: string;
  migrate: (config: any) => any;
}