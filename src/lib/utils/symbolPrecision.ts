// Symbol precision utilities for formatting prices and quantities according to exchange rules

export interface SymbolFilter {
  symbol: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: string;
  stepSize: string;
  maxQuantity?: number;
  minNotional?: number;
  minQuantity?: number;
}

export class SymbolPrecisionManager {
  private symbolFilters: Map<string, SymbolFilter> = new Map();

  // Default precision values for unknown symbols
  private readonly DEFAULT_PRICE_PRECISION = 4;
  private readonly DEFAULT_QUANTITY_PRECISION = 3;
  private readonly DEFAULT_TICK_SIZE = '0.0001';
  private readonly DEFAULT_STEP_SIZE = '0.001';

  // Parse exchange info and store symbol filters
  public parseExchangeInfo(exchangeInfo: any): void {
    if (!exchangeInfo.symbols) return;

    for (const symbolInfo of exchangeInfo.symbols) {
      const symbol = symbolInfo.symbol;

      // Find PRICE_FILTER, LOT_SIZE, and MIN_NOTIONAL filters
      const priceFilter = symbolInfo.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
      const lotSizeFilter = symbolInfo.filters?.find((f: any) => f.filterType === 'LOT_SIZE');
      const minNotionalFilter = symbolInfo.filters?.find((f: any) => f.filterType === 'MIN_NOTIONAL');

      if (priceFilter && lotSizeFilter) {
        // Calculate precision from tick size and step size
        const pricePrecision = this.getPrecisionFromString(priceFilter.tickSize);
        const quantityPrecision = this.getPrecisionFromString(lotSizeFilter.stepSize);
        
        // Parse quantity limits
        const maxQuantity = lotSizeFilter.maxQty ? parseFloat(lotSizeFilter.maxQty) : undefined;
        const minQuantity = lotSizeFilter.minQty ? parseFloat(lotSizeFilter.minQty) : undefined;
        const minNotional = minNotionalFilter?.minNotional ? parseFloat(minNotionalFilter.minNotional) : undefined;

        this.symbolFilters.set(symbol, {
          symbol,
          pricePrecision,
          quantityPrecision,
          tickSize: priceFilter.tickSize,
          stepSize: lotSizeFilter.stepSize,
          maxQuantity,
          minQuantity,
          minNotional
        });
        
        // Log the limits for debugging
        console.log(`Symbol ${symbol} limits - MaxQty: ${maxQuantity || 'none'}, MinQty: ${minQuantity || 'none'}, MinNotional: ${minNotional || 'none'}`);
      } else {
        console.warn(`SymbolPrecisionManager: Missing filters for ${symbol}, using defaults`);
      }
    }

    console.log(`SymbolPrecisionManager: Loaded precision for ${this.symbolFilters.size} symbols`);
  }

  // Get decimal places from a string like "0.00100000"
  private getPrecisionFromString(value: string): number {
    if (!value || value === '0') return 0;

    const decimal = value.indexOf('.');
    if (decimal === -1) return 0;

    // Find the position of the last non-zero digit
    let precision = 0;
    for (let i = value.length - 1; i > decimal; i--) {
      if (value[i] !== '0') {
        precision = i - decimal;
        break;
      }
    }

    // If all decimals are zero, count until first 1
    if (precision === 0 && decimal !== -1) {
      for (let i = decimal + 1; i < value.length; i++) {
        if (value[i] !== '0') {
          precision = i - decimal;
          break;
        }
      }
    }

    return precision;
  }

  // Format price according to symbol's tick size
  public formatPrice(symbol: string, price: number): number {
    const filter = this.symbolFilters.get(symbol);
    if (!filter) {
      console.warn(`SymbolPrecisionManager: No precision info for ${symbol}, using default precision`);
      // Use default precision values
      const multiplier = Math.pow(10, this.DEFAULT_PRICE_PRECISION);
      const rounded = Math.round(price * multiplier) / multiplier;
      const tickSize = parseFloat(this.DEFAULT_TICK_SIZE);
      const aligned = Math.round(rounded / tickSize) * tickSize;
      return parseFloat(aligned.toFixed(this.DEFAULT_PRICE_PRECISION));
    }

    // Round to the correct precision
    const multiplier = Math.pow(10, filter.pricePrecision);
    const rounded = Math.round(price * multiplier) / multiplier;

    // Ensure it's aligned with tick size
    const tickSize = parseFloat(filter.tickSize);
    if (tickSize > 0) {
      const aligned = Math.round(rounded / tickSize) * tickSize;
      // Parse and return to avoid floating point precision issues
      return parseFloat(aligned.toFixed(filter.pricePrecision));
    }

    // Parse and return to avoid floating point precision issues
    return parseFloat(rounded.toFixed(filter.pricePrecision));
  }

  // Format quantity according to symbol's step size
  public formatQuantity(symbol: string, quantity: number): number {
    const filter = this.symbolFilters.get(symbol);
    if (!filter) {
      console.warn(`SymbolPrecisionManager: No precision info for ${symbol}, using default precision`);
      // Use default precision values
      const multiplier = Math.pow(10, this.DEFAULT_QUANTITY_PRECISION);
      const rounded = Math.round(quantity * multiplier) / multiplier;
      const stepSize = parseFloat(this.DEFAULT_STEP_SIZE);
      const aligned = Math.round(rounded / stepSize) * stepSize;
      return parseFloat(aligned.toFixed(this.DEFAULT_QUANTITY_PRECISION));
    }

    // Round to the correct precision
    const multiplier = Math.pow(10, filter.quantityPrecision);
    const rounded = Math.round(quantity * multiplier) / multiplier;

    // Ensure it's aligned with step size
    const stepSize = parseFloat(filter.stepSize);
    if (stepSize > 0) {
      const aligned = Math.round(rounded / stepSize) * stepSize;
      // Parse and return to avoid floating point precision issues
      return parseFloat(aligned.toFixed(filter.quantityPrecision));
    }

    // Parse and return to avoid floating point precision issues
    return parseFloat(rounded.toFixed(filter.quantityPrecision));
  }

  // Get symbol filter
  public getSymbolFilter(symbol: string): SymbolFilter | undefined {
    return this.symbolFilters.get(symbol);
  }

  // Check if we have precision info for a symbol
  public hasSymbol(symbol: string): boolean {
    return this.symbolFilters.has(symbol);
  }

  // Get default filter for unknown symbols
  public getDefaultFilter(symbol: string): SymbolFilter {
    return {
      symbol,
      pricePrecision: this.DEFAULT_PRICE_PRECISION,
      quantityPrecision: this.DEFAULT_QUANTITY_PRECISION,
      tickSize: this.DEFAULT_TICK_SIZE,
      stepSize: this.DEFAULT_STEP_SIZE,
    };
  }

  /**
   * Validates and adjusts the quantity to comply with exchange limits
   * @param symbol The trading pair symbol (e.g., 'BTCUSDT')
   * @param quantity The desired quantity to validate
   * @param price The current price (required for notional validation)
   * @returns Object containing the adjusted quantity and a boolean indicating if adjustment was needed
   */
  public validateAndAdjustQuantity(symbol: string, quantity: number, price: number): { quantity: number; adjusted: boolean } {
    if (quantity <= 0) {
      throw new Error(`Invalid quantity: ${quantity}. Quantity must be positive.`);
    }

    const filter = this.symbolFilters.get(symbol) || this.getDefaultFilter(symbol);
    let adjusted = false;
    let adjustedQty = this.formatQuantity(symbol, quantity);
    
    // Check minimum quantity
    if (filter.minQuantity && adjustedQty < filter.minQuantity) {
      adjustedQty = filter.minQuantity;
      adjusted = true;
      console.warn(`SymbolPrecisionManager: Quantity ${quantity} is below minimum for ${symbol}, adjusted to ${adjustedQty}`);
    }
    
    // Check maximum quantity
    if (filter.maxQuantity && adjustedQty > filter.maxQuantity) {
      adjustedQty = filter.maxQuantity;
      adjusted = true;
      console.warn(`SymbolPrecisionManager: Quantity ${quantity} exceeds maximum for ${symbol}, adjusted to ${adjustedQty}`);
    }
    
    // Check minimum notional (price * quantity)
    if (price > 0 && filter.minNotional) {
      const notional = price * adjustedQty;
      if (notional < filter.minNotional) {
        // Calculate minimum quantity to meet notional requirement
        const minQtyToMeetNotional = Math.ceil((filter.minNotional / price) * Math.pow(10, filter.quantityPrecision)) / 
                                    Math.pow(10, filter.quantityPrecision);
        
        // If even the minimum quantity is too small, we can't proceed
        if (minQtyToMeetNotional > (filter.maxQuantity || Infinity)) {
          throw new Error(`Cannot meet minimum notional requirement for ${symbol} with current price ${price}. ` +
                         `Required min quantity: ${minQtyToMeetNotional}, max allowed: ${filter.maxQuantity}`);
        }
        
        adjustedQty = minQtyToMeetNotional;
        adjusted = true;
        console.warn(`SymbolPrecisionManager: Notional too low for ${symbol}, adjusted quantity to ${adjustedQty} to meet minimum notional`);
      }
    }
    
    // Final format to ensure proper precision
    adjustedQty = this.formatQuantity(symbol, adjustedQty);
    
    return {
      quantity: adjustedQty,
      adjusted
    };
  }
}

// Singleton instance
export const symbolPrecision = new SymbolPrecisionManager();