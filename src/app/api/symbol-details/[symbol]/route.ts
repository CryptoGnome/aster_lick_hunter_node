import { NextResponse } from 'next/server';
import axios from 'axios';

const BASE_URL = 'https://fapi.asterdex.com';

interface SymbolDetails {
  symbol: string;
  currentPrice: number;
  minNotional: number;
  minQty: number;
  stepSize: number;
  tickSize: number;
  pricePrecision: number;
  quantityPrecision: number;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;

    // Fetch both exchange info and current price in parallel
    const [exchangeInfoResponse, priceResponse] = await Promise.all([
      axios.get(`${BASE_URL}/fapi/v1/exchangeInfo`),
      axios.get(`${BASE_URL}/fapi/v1/ticker/price?symbol=${symbol}`)
    ]);

    // Find the symbol info
    const symbolInfo = exchangeInfoResponse.data.symbols.find(
      (s: any) => s.symbol === symbol
    );

    if (!symbolInfo) {
      return NextResponse.json(
        { error: 'Symbol not found' },
        { status: 404 }
      );
    }

    // Extract filters
    const minNotionalFilter = symbolInfo.filters?.find(
      (f: any) => f.filterType === 'MIN_NOTIONAL'
    );
    const lotSizeFilter = symbolInfo.filters?.find(
      (f: any) => f.filterType === 'LOT_SIZE'
    );
    const priceFilter = symbolInfo.filters?.find(
      (f: any) => f.filterType === 'PRICE_FILTER'
    );

    // Parse values
    const minNotional = minNotionalFilter?.notional ?
      parseFloat(minNotionalFilter.notional) : 10;
    const minQty = lotSizeFilter?.minQty ?
      parseFloat(lotSizeFilter.minQty) : 0.001;
    const stepSize = lotSizeFilter?.stepSize ?
      parseFloat(lotSizeFilter.stepSize) : 0.001;
    const tickSize = priceFilter?.tickSize ?
      parseFloat(priceFilter.tickSize) : 0.01;
    const currentPrice = parseFloat(priceResponse.data.price);

    const details: SymbolDetails = {
      symbol,
      currentPrice,
      minNotional,
      minQty,
      stepSize,
      tickSize,
      pricePrecision: symbolInfo.pricePrecision || 2,
      quantityPrecision: symbolInfo.quantityPrecision || 3
    };

    return NextResponse.json(details);
  } catch (error: any) {
    console.error('Failed to fetch symbol details:', error?.message || error);
    
    // Check for specific error types
    if (error?.response?.status === 429) {
      return NextResponse.json(
        { error: 'Rate limited by exchange. Please try again in a moment.' },
        { status: 429 }
      );
    }
    
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') {
      return NextResponse.json(
        { error: 'Unable to connect to exchange API' },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch symbol details' },
      { status: 500 }
    );
  }
}