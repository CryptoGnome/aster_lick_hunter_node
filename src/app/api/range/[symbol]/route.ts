import { NextRequest, NextResponse } from 'next/server';
import { getKlines } from '@/lib/api/market';

interface RangeAnalysis {
  symbol: string;
  timestamp: number;
  currentPrice: number;
  
  // ATR-style metrics (average of high-low range)
  atr1h: number;      // Average range over last 1 hour (using 5m candles)
  atr4h: number;      // Average range over last 4 hours
  atr24h: number;     // Average range over last 24 hours
  atr7d: number;      // Average range over last 7 days (using 1h candles)
  
  // As percentages of current price
  atrPercent1h: number;
  atrPercent4h: number;
  atrPercent24h: number;
  atrPercent7d: number;
  
  // High-low range over period (total movement, not average per candle)
  range24h: number;
  range24hPercent: number;
  range7d: number;
  range7dPercent: number;
  
  // Volatility comparison
  volatilityRank: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  
  // Suggested TP based on typical movement
  suggestedTpPercent: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    
    if (!symbol) {
      return NextResponse.json({ error: 'Symbol required' }, { status: 400 });
    }

    const upperSymbol = symbol.toUpperCase();
    const now = Date.now();

    // Fetch different timeframe klines in parallel
    const [klines5m, klines1h, klines1d] = await Promise.all([
      // Last 24 hours of 5m candles (288 candles)
      getKlines(upperSymbol, '5m', 288),
      // Last 7 days of 1h candles (168 candles)
      getKlines(upperSymbol, '1h', 168),
      // Last 30 days of 1d candles
      getKlines(upperSymbol, '1d', 30),
    ]);

    if (!klines5m?.length || !klines1h?.length) {
      return NextResponse.json({ error: 'Failed to fetch klines' }, { status: 500 });
    }

    // Current price from most recent candle
    const currentPrice = parseFloat(klines5m[klines5m.length - 1][4]); // Close price

    // Calculate ATR for different periods
    // ATR = Average of (High - Low) for each candle
    
    // 1h ATR: last 12 5m candles
    const atr1h = calculateATR(klines5m.slice(-12));
    
    // 4h ATR: last 48 5m candles
    const atr4h = calculateATR(klines5m.slice(-48));
    
    // 24h ATR: all 5m candles (288)
    const atr24h = calculateATR(klines5m);
    
    // 7d ATR: using 1h candles
    const atr7d = calculateATR(klines1h);

    // Calculate total range (highest high - lowest low over period)
    const range24h = calculateRange(klines5m);
    const range7d = calculateRange(klines1h);

    // Determine volatility rank based on 24h ATR %
    const atrPercent24h = (atr24h / currentPrice) * 100;
    let volatilityRank: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    if (atrPercent24h < 0.3) volatilityRank = 'LOW';
    else if (atrPercent24h < 0.6) volatilityRank = 'MEDIUM';
    else if (atrPercent24h < 1.0) volatilityRank = 'HIGH';
    else volatilityRank = 'VERY_HIGH';

    // Suggested TP: ~1.5x the average hourly range, capped at reasonable values
    // This gives a realistic target that the price typically reaches
    const avgHourlyRange = atr1h;
    const suggestedTpPercent = Math.min(
      Math.max((avgHourlyRange / currentPrice) * 100 * 1.5, 0.3), // Min 0.3%
      5.0 // Max 5%
    );

    const analysis: RangeAnalysis = {
      symbol: upperSymbol,
      timestamp: now,
      currentPrice,
      
      atr1h,
      atr4h,
      atr24h,
      atr7d,
      
      atrPercent1h: (atr1h / currentPrice) * 100,
      atrPercent4h: (atr4h / currentPrice) * 100,
      atrPercent24h,
      atrPercent7d: (atr7d / currentPrice) * 100,
      
      range24h,
      range24hPercent: (range24h / currentPrice) * 100,
      range7d,
      range7dPercent: (range7d / currentPrice) * 100,
      
      volatilityRank,
      suggestedTpPercent: Math.round(suggestedTpPercent * 100) / 100,
    };

    return NextResponse.json(analysis);
  } catch (error) {
    console.error('Range analysis error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze range' },
      { status: 500 }
    );
  }
}

// Calculate Average True Range from klines
// Kline format: [openTime, open, high, low, close, volume, closeTime, ...]
function calculateATR(klines: any[]): number {
  if (!klines?.length) return 0;
  
  let totalRange = 0;
  for (const kline of klines) {
    const high = parseFloat(kline[2]);
    const low = parseFloat(kline[3]);
    totalRange += (high - low);
  }
  
  return totalRange / klines.length;
}

// Calculate total range (highest high - lowest low)
function calculateRange(klines: any[]): number {
  if (!klines?.length) return 0;
  
  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  
  for (const kline of klines) {
    const high = parseFloat(kline[2]);
    const low = parseFloat(kline[3]);
    if (high > highestHigh) highestHigh = high;
    if (low < lowestLow) lowestLow = low;
  }
  
  return highestHigh - lowestLow;
}
