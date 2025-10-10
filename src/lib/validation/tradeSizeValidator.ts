import { Config } from '../types';
import { getExchangeInfo } from '../api/market';
import axios from 'axios';
import { normalizeLeverage } from '../utils/leverage';

export interface TradeSizeValidationResult {
  valid: boolean;
  warnings: TradeSizeWarning[];
}

export interface TradeSizeWarning {
  symbol: string;
  currentTradeSize?: number;
  currentLongSize?: number;
  currentShortSize?: number;
  minimumRequired: number;
  reason: string;
  leverage: number;
  currentPrice: number;
}

/**
 * Validates all configured trade sizes against exchange minimums
 */
export async function validateAllTradeSizes(config: Config): Promise<TradeSizeValidationResult> {
  const warnings: TradeSizeWarning[] = [];

  try {
    // Fetch exchange info and current prices for all symbols
    const [exchangeInfo, pricesResponse] = await Promise.all([
      getExchangeInfo(),
      axios.get('https://fapi.asterdex.com/fapi/v1/ticker/price')
    ]);

    const priceMap = new Map<string, number>();
    pricesResponse.data.forEach((item: any) => {
      priceMap.set(item.symbol, parseFloat(item.price));
    });

    // Check each configured symbol
    for (const [symbol, symbolConfig] of Object.entries(config.symbols)) {
      const symbolInfo = exchangeInfo.symbols.find((s: any) => s.symbol === symbol);
      if (!symbolInfo) continue;

      const currentPrice = priceMap.get(symbol);
      if (!currentPrice) continue;

      // Extract filters
      const minNotionalFilter = symbolInfo.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL');
      const lotSizeFilter = symbolInfo.filters?.find((f: any) => f.filterType === 'LOT_SIZE');

      const minNotional = minNotionalFilter?.notional ? parseFloat(minNotionalFilter.notional) : 10;
      const minQty = lotSizeFilter?.minQty ? parseFloat(lotSizeFilter.minQty) : 0.001;

      const leverage = normalizeLeverage(symbolConfig.leverage ?? 1);

      // Calculate minimum trade size required
      const minFromNotional = minNotional / leverage;
      const minFromQuantity = (minQty * currentPrice) / leverage;
      const minimumRequired = Math.max(minFromNotional, minFromQuantity) * 1.3; // 30% buffer

      // Check if using separate trade sizes
      const hasLongSize = symbolConfig.longTradeSize !== undefined;
      const hasShortSize = symbolConfig.shortTradeSize !== undefined;

      if (hasLongSize || hasShortSize) {
        // Check long trade size
        if (hasLongSize && symbolConfig.longTradeSize! < minimumRequired) {
          warnings.push({
            symbol,
            currentLongSize: symbolConfig.longTradeSize!,
            minimumRequired,
            reason: `Long trade size ${symbolConfig.longTradeSize!.toFixed(2)} USDT is below minimum ${minimumRequired.toFixed(2)} USDT`,
            leverage,
            currentPrice
          });
        }

        // Check short trade size
        if (hasShortSize && symbolConfig.shortTradeSize! < minimumRequired) {
          warnings.push({
            symbol,
            currentShortSize: symbolConfig.shortTradeSize!,
            minimumRequired,
            reason: `Short trade size ${symbolConfig.shortTradeSize!.toFixed(2)} USDT is below minimum ${minimumRequired.toFixed(2)} USDT`,
            leverage,
            currentPrice
          });
        }
      } else {
        // Check general trade size
        if (symbolConfig.tradeSize < minimumRequired) {
          warnings.push({
            symbol,
            currentTradeSize: symbolConfig.tradeSize,
            minimumRequired,
            reason: `Trade size ${symbolConfig.tradeSize.toFixed(2)} USDT is below minimum ${minimumRequired.toFixed(2)} USDT`,
            leverage,
            currentPrice
          });
        }
      }
    }
  } catch (error) {
    console.error('Failed to validate trade sizes:', error);
    // Return empty warnings if validation fails (don't block startup)
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}

/**
 * Calculate minimum trade size for a specific symbol
 */
export function calculateMinimumTradeSize(
  symbol: string,
  currentPrice: number,
  leverage: number,
  minNotional: number,
  minQty: number
): number {
  const normalizedLeverage = normalizeLeverage(leverage);
  const minFromNotional = minNotional / normalizedLeverage;
  const minFromQuantity = (minQty * currentPrice) / normalizedLeverage;
  return Math.max(minFromNotional, minFromQuantity) * 1.3; // 30% buffer
}