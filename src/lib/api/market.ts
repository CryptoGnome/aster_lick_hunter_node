import { AxiosResponse } from 'axios';
import { ApiCredentials, MarkPrice, Kline } from '../types';
import { buildSignedQuery, paramsToQuery } from './auth';
import { getRateLimitedAxios } from './requestInterceptor';

const BASE_URL = 'https://fapi.asterdex.com';

// Public endpoints (no authentication)
export async function getExchangeInfo(): Promise<any> {
  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v1/exchangeInfo`);
  return response.data;
}

export async function getMarkPrice(symbol?: string): Promise<MarkPrice | MarkPrice[]> {
  const params: Record<string, any> = {};
  if (symbol) params.symbol = symbol;
  const query = paramsToQuery(params);
  const url = query ? `${BASE_URL}/fapi/v1/premiumIndex?${query}` : `${BASE_URL}/fapi/v1/premiumIndex`;
  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(url);
  return response.data;
}

export async function getKlines(symbol: string, interval: string = '1m', limit: number = 500): Promise<Kline[]> {
  const params = { symbol, interval, limit };
  const query = paramsToQuery(params);
  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v1/klines?${query}`);
  // Klines come as [[openTime, open, high, low, close, volume], ...]
  // Convert to Kline array
  const klines = response.data.map((k: any[]) => ({
    openTime: k[0],
    open: k[1],
    high: k[2],
    low: k[3],
    close: k[4],
    volume: k[5],
  }));
  return klines as Kline[];
}

export async function getRecentTrades(symbol: string, limit: number = 500): Promise<any[]> {
  const params = { symbol, limit };
  const query = paramsToQuery(params);
  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v1/trades?${query}`);
  return response.data;
}

// Signed endpoints (require authentication)
export async function getBalance(credentials: ApiCredentials): Promise<any> {
  const params = {}; // Empty params for balance endpoint
  const query = buildSignedQuery(params, credentials);

  try {
    const axios = getRateLimitedAxios();
    const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v2/balance?${query}`, {
      headers: {
        'X-MBX-APIKEY': credentials.apiKey
      }
    });
    return response.data;
  } catch (error: any) {
    console.log('Balance API Error Details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: `${BASE_URL}/fapi/v2/balance?${query}`,
      headers: { 'X-MBX-APIKEY': credentials.apiKey }
    });
    throw error;
  }
}

export async function getAccountInfo(credentials: ApiCredentials): Promise<any> {
  const params = {}; // Empty params for account endpoint
  const query = buildSignedQuery(params, credentials);

  try {
    const axios = getRateLimitedAxios();
    const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v4/account?${query}`, {
      headers: {
        'X-MBX-APIKEY': credentials.apiKey
      }
    });
    return response.data;
  } catch (error: any) {
    console.log('Account API Error Details:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: `${BASE_URL}/fapi/v4/account?${query}`,
      headers: { 'X-MBX-APIKEY': credentials.apiKey }
    });
    throw error;
  }
}

export async function getPositionRisk(symbol?: string, credentials?: ApiCredentials): Promise<any> {
  // If no credentials provided, this is likely being called incorrectly
  if (!credentials) {
    throw new Error('Credentials required for getPositionRisk');
  }

  const params: Record<string, any> = {};
  if (symbol) {
    params.symbol = symbol;
  }
  const query = buildSignedQuery(params, credentials);
  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v2/positionRisk?${query}`, {
    headers: {
      'X-MBX-APIKEY': credentials.apiKey
    }
  });
  return response.data;
}

export async function getOpenOrders(symbol?: string, credentials?: ApiCredentials): Promise<any[]> {
  // If no credentials provided, this is likely being called incorrectly
  if (!credentials) {
    throw new Error('Credentials required for getOpenOrders');
  }

  const params: Record<string, any> = {};
  if (symbol) {
    params.symbol = symbol;
  }
  const query = buildSignedQuery(params, credentials);
  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v1/openOrders?${query}`, {
    headers: {
      'X-MBX-APIKEY': credentials.apiKey
    }
  });
  return response.data;
}

// Get order book depth for optimal pricing
export async function getOrderBook(symbol: string, limit: number = 5): Promise<any> {
  const params = { symbol, limit };
  const query = paramsToQuery(params);
  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v1/depth?${query}`);
  return response.data;
}

// Get symbol price ticker for current price
export async function getSymbolPrice(symbol: string): Promise<any> {
  const params = { symbol };
  const query = paramsToQuery(params);
  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v1/ticker/price?${query}`);
  return response.data;
}

// Get best bid/ask prices from book ticker
export async function getBookTicker(symbol: string): Promise<any> {
  const params = { symbol };
  const query = paramsToQuery(params);
  const axios = getRateLimitedAxios();
  const response: AxiosResponse = await axios.get(`${BASE_URL}/fapi/v1/ticker/bookTicker?${query}`);
  return response.data;
}
