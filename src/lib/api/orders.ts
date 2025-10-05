import { AxiosResponse } from 'axios';
import { ApiCredentials, Order } from '../types';
import { buildSignedForm, buildSignedQuery } from './auth';
import { getRateLimitedAxios } from './requestInterceptor';
import { symbolPrecision } from '../utils/symbolPrecision';
import { getMarkPrice } from './market';

const BASE_URL = 'https://fapi.asterdex.com';

// Place a new order (POST)
export async function placeOrder(params: {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  positionSide?: 'BOTH' | 'LONG' | 'SHORT';
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'GTX';
}, credentials: ApiCredentials): Promise<Order> {
  // Validate quantity before proceeding
  let validatedQuantity = params.quantity;
  let priceForValidation = params.price || 0;
  
  try {
    // For market orders or when price is not provided, get the current mark price for validation
    if (params.type === 'MARKET' || !params.price) {
      try {
        const markPriceData = await getMarkPrice(params.symbol);
        if (Array.isArray(markPriceData)) {
          // Find the symbol in the array of mark prices
          const symbolData = markPriceData.find(item => item.symbol === params.symbol);
          if (symbolData && symbolData.markPrice) {
            priceForValidation = parseFloat(symbolData.markPrice);
          }
        } else if (markPriceData && markPriceData.markPrice) {
          // Handle single symbol response
          priceForValidation = parseFloat(markPriceData.markPrice);
        }
      } catch (error) {
        console.warn(`Failed to get mark price for ${params.symbol}:`, error);
        // Fall back to the provided price or 0 if not available
        priceForValidation = params.price || 0;
      }
    }
    
    // Validate and adjust quantity
    const { quantity: adjustedQty, adjusted } = symbolPrecision.validateAndAdjustQuantity(
      params.symbol,
      params.quantity,
      priceForValidation
    );
    
    if (adjusted) {
      console.warn(`Order quantity adjusted from ${params.quantity} to ${adjustedQty} for ${params.symbol} to comply with exchange limits`);
      validatedQuantity = adjustedQty;
    }
  } catch (error: any) {
    console.error(`Failed to validate order quantity for ${params.symbol}:`, error.message);
    throw new Error(`Order validation failed: ${error.message}`);
  }

  const orderParams = {
    ...params,
    quantity: validatedQuantity, // Use the validated quantity
  };

  // Add timeInForce for limit orders if not specified
  if (params.type === 'LIMIT' && !params.timeInForce) {
    orderParams.timeInForce = 'GTC';
  }

  // Build signed form data - this ensures we sign the exact payload we'll send
  const formData = buildSignedForm(orderParams, credentials);

  // Debug: log what we're actually sending
  console.log('[ORDER DEBUG] Form data being sent:', formData.toString());

  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.post(`${BASE_URL}/fapi/v1/order`, formData, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-MBX-APIKEY': credentials.apiKey
    },
  });

  return response.data;
}

// Define order params type
type OrderParams = {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  quantity: number;
  price?: number;
  stopPrice?: number;
  reduceOnly?: boolean;
  positionSide?: 'BOTH' | 'LONG' | 'SHORT';
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'GTX';
};

// Place multiple orders (batch)
export async function placeBatchOrders(orders: Array<Omit<OrderParams, 'positionSide' | 'reduceOnly' | 'stopPrice'>>, credentials: ApiCredentials): Promise<any> {
  // For simplicity, loop and place individually for now
  const results = [];
  for (const order of orders) {
    try {
      const result = await placeOrder(order, credentials);
      results.push(result);
    } catch (error: any) {
      results.push({ error: error.response?.data || error.message });
    }
  }
  return results;
}

// Cancel an order
export async function cancelOrder(params: {
  symbol: string;
  orderId?: number;
  origClientOrderId?: string;
}, credentials: ApiCredentials): Promise<any> {
  const cancelParams = {
    ...params,
  };
  const query = buildSignedQuery(cancelParams, credentials);

  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.delete(`${BASE_URL}/fapi/v1/order?${query}`, {
    headers: {
      'X-MBX-APIKEY': credentials.apiKey
    }
  });
  return response.data;
}

// Cancel all open orders for a symbol
export async function cancelAllOrders(symbol: string, credentials: ApiCredentials): Promise<any> {
  const params = {
    symbol,
  };
  const query = buildSignedQuery(params, credentials);

  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.delete(`${BASE_URL}/fapi/v1/allOpenOrders?${query}`, {
    headers: {
      'X-MBX-APIKEY': credentials.apiKey
    }
  });
  return response.data;
}

// Query a specific order
export async function queryOrder(params: {
  symbol: string;
  orderId?: number;
  origClientOrderId?: string;
}, credentials: ApiCredentials): Promise<Order> {
  const queryParams = {
    ...params,
  };
  const query = buildSignedQuery(queryParams, credentials);

  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v1/order?${query}`, {
    headers: {
      'X-MBX-APIKEY': credentials.apiKey
    }
  });
  return response.data;
}

// Get all orders
export async function getAllOrders(symbol: string, credentials: ApiCredentials, startTime?: number, endTime?: number, limit: number = 500): Promise<Order[]> {
  const params: Record<string, any> = {
    symbol,
    limit,
  };
  if (startTime) params.startTime = startTime;
  if (endTime) params.endTime = endTime;

  const query = buildSignedQuery(params, credentials);

  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v1/allOrders?${query}`, {
    headers: {
      'X-MBX-APIKEY': credentials.apiKey
    }
  });
  return response.data;
}

// Change leverage
export async function setLeverage(symbol: string, leverage: number, credentials: ApiCredentials): Promise<any> {
  const params = {
    symbol,
    leverage,
  };
  const formData = buildSignedForm(params, credentials);

  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.post(`${BASE_URL}/fapi/v1/leverage`, formData, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-MBX-APIKEY': credentials.apiKey
    },
  });

  return response.data;
}

// Get all positions
export async function getPositions(credentials: ApiCredentials): Promise<any[]> {
  const params = {}; // Empty params for positions endpoint
  const query = buildSignedQuery(params, credentials);

  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v2/positionRisk?${query}`, {
    headers: {
      'X-MBX-APIKEY': credentials.apiKey
    }
  });
  return response.data;
}

// Note: Endpoints may differ for Aster - adjust based on docs