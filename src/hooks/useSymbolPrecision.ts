import { useState, useEffect, useCallback } from 'react';

interface SymbolPrecisionInfo {
  symbol: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: string;
  stepSize: string;
}

export function useSymbolPrecision() {
  const [symbolInfo, setSymbolInfo] = useState<Record<string, SymbolPrecisionInfo>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSymbolInfo();
  }, []);

  const loadSymbolInfo = async () => {
    try {
      const response = await fetch('/api/symbol-info');
      if (response.ok) {
        const data = await response.json();
        setSymbolInfo(data);
      }
    } catch (error) {
      console.error('Failed to load symbol info:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatPrice = useCallback((symbol: string, price: number | string): string => {
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    
    if (isNaN(numPrice)) {
      return '0.00';
    }
    
    const info = symbolInfo[symbol];
    if (!info) {
      // Fallback formatting based on price magnitude
      if (numPrice < 0.01) return numPrice.toFixed(6);
      if (numPrice < 1) return numPrice.toFixed(4);
      if (numPrice < 100) return numPrice.toFixed(3);
      if (numPrice < 10000) return numPrice.toFixed(2);
      return numPrice.toFixed(0);
    }

    return numPrice.toFixed(info.pricePrecision);
  }, [symbolInfo]);

  const formatQuantity = useCallback((symbol: string, quantity: number | string): string => {
    const numQuantity = typeof quantity === 'string' ? parseFloat(quantity) : quantity;
    
    if (isNaN(numQuantity)) {
      return '0.00';
    }
    
    const info = symbolInfo[symbol];
    if (!info) {
      // Fallback formatting
      if (numQuantity < 1) return numQuantity.toFixed(6);
      if (numQuantity < 100) return numQuantity.toFixed(4);
      return numQuantity.toFixed(2);
    }

    return numQuantity.toFixed(info.quantityPrecision);
  }, [symbolInfo]);

  const formatPriceWithCommas = useCallback((symbol: string, price: number | string): string => {
    const formatted = formatPrice(symbol, price);

    // Add commas for thousands
    const parts = formatted.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return parts.join('.');
  }, [formatPrice]);

  return {
    symbolInfo,
    isLoading,
    formatPrice,
    formatQuantity,
    formatPriceWithCommas,
    reload: loadSymbolInfo,
  };
}