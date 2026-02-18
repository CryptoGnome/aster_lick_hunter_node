import { getOrderBook, getBookTicker, getExchangeInfo } from './market';

interface OrderBookEntry {
  price: string;
  quantity: string;
}

interface OrderBookData {
  lastUpdateId: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

interface SymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  notional?: string;
}

interface SymbolInfo {
  symbol: string;
  filters: SymbolFilter[];
  pricePrecision: number;
  quantityPrecision: number;
}

// Cache for exchange info to avoid repeated API calls
let exchangeInfoCache: any = null;
let exchangeInfoCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Default filter values for unknown symbols
const DEFAULT_FILTERS = {
  PRICE_FILTER: {
    minPrice: '0.00001',
    maxPrice: '1000000',
    tickSize: '0.0001'
  },
  LOT_SIZE: {
    minQty: '0.001',
    maxQty: '10000000',
    stepSize: '0.001'
  },
  MIN_NOTIONAL: {
    notional: '10'
  }
};

// Get symbol filters from exchange info
export async function getSymbolFilters(symbol: string): Promise<SymbolInfo | null> {
  const now = Date.now();

  // Use cache if available and not expired
  if (exchangeInfoCache && (now - exchangeInfoCacheTime) < CACHE_DURATION) {
    const symbolInfo = exchangeInfoCache.symbols.find((s: any) => s.symbol === symbol);
    if (!symbolInfo) {
      console.warn(`getSymbolFilters: Symbol ${symbol} not found in exchange info`);
    }
    return symbolInfo || null;
  }

  try {
    exchangeInfoCache = await getExchangeInfo();
    exchangeInfoCacheTime = now;

    const symbolInfo = exchangeInfoCache.symbols.find((s: any) => s.symbol === symbol);
    if (!symbolInfo) {
      console.warn(`getSymbolFilters: Symbol ${symbol} not found in exchange info`);
    }
    return symbolInfo || null;
  } catch (error) {
    console.error('Error fetching exchange info:', error);
    return null;
  }
}

// Round price to valid tick size
export function roundToTickSize(price: number, tickSize: string): number {
  const tick = parseFloat(tickSize);
  if (tick === 0) return price;

  const rounded = Math.round(price / tick) * tick;
  // Parse to fixed decimal places to avoid floating point precision issues
  const decimals = tickSize.includes('.') ? tickSize.split('.')[1].replace(/0+$/, '').length : 0;
  return parseFloat(rounded.toFixed(decimals));
}

// Round quantity to valid step size
export function roundToStepSize(quantity: number, stepSize: string): number {
  const step = parseFloat(stepSize);
  if (step === 0) return quantity;

  const rounded = Math.round(quantity / step) * step;
  // Parse to fixed decimal places to avoid floating point precision issues
  const decimals = stepSize.includes('.') ? stepSize.split('.')[1].replace(/0+$/, '').length : 0;
  return parseFloat(rounded.toFixed(decimals));
}

// Calculate optimal limit order price based on order book
export async function calculateOptimalPrice(
  symbol: string,
  side: 'BUY' | 'SELL',
  priceOffsetBps: number = 1, // 1 basis point default offset
  usePostOnly: boolean = false
): Promise<number | null> {
  try {
    // Get current best bid/ask
    const bookTicker = await getBookTicker(symbol);
    const bestBid = parseFloat(bookTicker.bidPrice);
    const bestAsk = parseFloat(bookTicker.askPrice);

    // Validate we got valid prices from the exchange
    if (!isFinite(bestBid) || !isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) {
      console.error(`calculateOptimalPrice: Invalid bid/ask from exchange for ${symbol} - bid: ${bookTicker.bidPrice}, ask: ${bookTicker.askPrice}`);
      return null;
    }

    // Get symbol filters for price precision
    const symbolInfo = await getSymbolFilters(symbol);
    const tickSize = symbolInfo?.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize || '0.01';

    let targetPrice: number;

    if (side === 'BUY') {
      if (usePostOnly) {
        // For post-only, stay below best ask to avoid crossing
        targetPrice = bestBid + parseFloat(tickSize);
      } else {
        // Aggressive but still maker: place just above best bid
        const offset = bestBid * (priceOffsetBps / 10000);
        targetPrice = bestBid + Math.max(offset, parseFloat(tickSize));
      }
    } else { // SELL
      if (usePostOnly) {
        // For post-only, stay above best bid to avoid crossing
        targetPrice = bestAsk - parseFloat(tickSize);
      } else {
        // Aggressive but still maker: place just below best ask
        const offset = bestAsk * (priceOffsetBps / 10000);
        targetPrice = bestAsk - Math.max(offset, parseFloat(tickSize));
      }
    }

    // Round to valid tick size
    targetPrice = roundToTickSize(targetPrice, tickSize);

    // Validate price is within symbol limits
    const priceFilter = symbolInfo?.filters.find(f => f.filterType === 'PRICE_FILTER');
    if (priceFilter) {
      const minPrice = parseFloat(priceFilter.minPrice || '0');
      const maxPrice = parseFloat(priceFilter.maxPrice || '999999999');

      if (targetPrice < minPrice) targetPrice = minPrice;
      if (targetPrice > maxPrice) targetPrice = maxPrice;
    }

    return targetPrice;

  } catch (error) {
    console.error('Error calculating optimal price:', error);
    return null;
  }
}

// Validate order parameters against symbol filters
export async function validateOrderParams(
  symbol: string,
  side: 'BUY' | 'SELL',
  price: number,
  quantity: number
): Promise<{ valid: boolean; adjustedPrice?: number; adjustedQuantity?: number; error?: string }> {
  try {
    const symbolInfo = await getSymbolFilters(symbol);
    if (!symbolInfo) {
      console.warn(`validateOrderParams: Symbol info not found for ${symbol}, using defaults`);
      // Use default filters and still validate/format
    }

    let adjustedPrice = price;
    let adjustedQuantity = quantity;

    // Validate and adjust price (use defaults if symbolInfo is missing)
    const priceFilter = symbolInfo?.filters?.find(f => f.filterType === 'PRICE_FILTER') || DEFAULT_FILTERS.PRICE_FILTER;
    if (priceFilter) {
      const minPrice = parseFloat(priceFilter.minPrice || DEFAULT_FILTERS.PRICE_FILTER.minPrice);
      const maxPrice = parseFloat(priceFilter.maxPrice || DEFAULT_FILTERS.PRICE_FILTER.maxPrice);
      const tickSize = priceFilter.tickSize || DEFAULT_FILTERS.PRICE_FILTER.tickSize;

      adjustedPrice = roundToTickSize(adjustedPrice, tickSize);

      if (adjustedPrice < minPrice) {
        return { valid: false, error: `Price ${adjustedPrice} below minimum ${minPrice}` };
      }
      if (adjustedPrice > maxPrice) {
        return { valid: false, error: `Price ${adjustedPrice} above maximum ${maxPrice}` };
      }
    }

    // Validate and adjust quantity (use defaults if symbolInfo is missing)
    const lotSizeFilter = symbolInfo?.filters?.find(f => f.filterType === 'LOT_SIZE') || DEFAULT_FILTERS.LOT_SIZE;
    if (lotSizeFilter) {
      const minQty = parseFloat(lotSizeFilter.minQty || DEFAULT_FILTERS.LOT_SIZE.minQty);
      const maxQty = parseFloat(lotSizeFilter.maxQty || DEFAULT_FILTERS.LOT_SIZE.maxQty);
      const stepSize = lotSizeFilter.stepSize || DEFAULT_FILTERS.LOT_SIZE.stepSize;

      adjustedQuantity = roundToStepSize(adjustedQuantity, stepSize);

      if (adjustedQuantity < minQty) {
        return { valid: false, error: `Quantity ${adjustedQuantity} below minimum ${minQty}` };
      }
      if (adjustedQuantity > maxQty) {
        return { valid: false, error: `Quantity ${adjustedQuantity} above maximum ${maxQty}` };
      }
    }

    // Validate notional value (use defaults if symbolInfo is missing)
    const minNotionalFilter = symbolInfo?.filters?.find(f => f.filterType === 'MIN_NOTIONAL') || DEFAULT_FILTERS.MIN_NOTIONAL;
    if (minNotionalFilter) {
      const minNotional = parseFloat(minNotionalFilter.notional || DEFAULT_FILTERS.MIN_NOTIONAL.notional);
      const notionalValue = adjustedPrice * adjustedQuantity;

      if (notionalValue < minNotional) {
        return {
          valid: false,
          error: `Notional value ${notionalValue} below minimum ${minNotional}`
        };
      }
    }

    return {
      valid: true,
      adjustedPrice,
      adjustedQuantity
    };

  } catch (error) {
    console.error('Error validating order params:', error);
    return { valid: false, error: 'Validation error: ' + (error as Error).message };
  }
}

// Get order book depth analysis for better entry timing
export async function analyzeOrderBookDepth(
  symbol: string,
  side: 'BUY' | 'SELL',
  targetNotional: number = 10000 // Target order size in USDT
): Promise<{
  avgPrice: number;
  priceImpact: number;
  liquidityOk: boolean;
}> {
  try {
    const orderBook: OrderBookData = await getOrderBook(symbol, 20); // Get deeper book
    const orders = side === 'BUY' ? orderBook.asks : orderBook.bids;

    let cumulativeNotional = 0;
    let weightedPriceSum = 0;
    let totalQuantity = 0;

    const firstPrice = parseFloat(orders[0]?.price || '0');

    for (const order of orders) {
      const price = parseFloat(order.price);
      const quantity = parseFloat(order.quantity);
      const notional = price * quantity;

      if (cumulativeNotional + notional >= targetNotional) {
        // Partial fill of this level
        const remainingNotional = targetNotional - cumulativeNotional;
        const remainingQuantity = remainingNotional / price;

        weightedPriceSum += price * remainingQuantity;
        totalQuantity += remainingQuantity;
        break;
      }

      weightedPriceSum += price * quantity;
      totalQuantity += quantity;
      cumulativeNotional += notional;
    }

    const avgPrice = totalQuantity > 0 ? weightedPriceSum / totalQuantity : firstPrice;
    const priceImpact = Math.abs((avgPrice - firstPrice) / firstPrice) * 100;
    const liquidityOk = cumulativeNotional >= targetNotional * 0.8; // At least 80% can be filled

    return {
      avgPrice,
      priceImpact,
      liquidityOk
    };

  } catch (error) {
    console.error('Error analyzing order book depth:', error);
    return {
      avgPrice: 0,
      priceImpact: 100,
      liquidityOk: false
    };
  }
}