import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/btc-volume
 * Fetches BTC historical volume data from CoinGecko (aggregated across all exchanges)
 * This gives a broader market picture than single-exchange data
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const days = searchParams.get('days') || '30';

    // CoinGecko free API - no key needed
    // Returns: prices, market_caps, total_volumes as arrays of [timestamp, value]
    const url = `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      // Cache for 1 hour since this is daily data
      next: { revalidate: 3600 }
    });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();

    // Transform to our format
    // CoinGecko returns arrays of [timestamp, value]
    const volumeData = data.total_volumes?.map((item: [number, number]) => ({
      date: new Date(item[0]).toISOString().split('T')[0],
      timestamp: item[0],
      volume: item[1],
    })) || [];

    const priceData = data.prices?.map((item: [number, number]) => ({
      date: new Date(item[0]).toISOString().split('T')[0],
      timestamp: item[0],
      price: item[1],
    })) || [];

    // Merge price and volume by date
    const merged = volumeData.map((v: { date: string; timestamp: number; volume: number }) => {
      const price = priceData.find((p: { date: string }) => p.date === v.date);
      return {
        date: v.date,
        timestamp: v.timestamp,
        volume: v.volume,
        price: price?.price || 0,
        // Calculate daily price change percent
        priceChange: 0, // Will calculate below
      };
    });

    // Calculate price changes
    for (let i = 1; i < merged.length; i++) {
      const prevPrice = merged[i - 1].price;
      const currPrice = merged[i].price;
      if (prevPrice > 0) {
        merged[i].priceChange = ((currPrice - prevPrice) / prevPrice) * 100;
      }
    }

    // Calculate some stats
    const volumes = merged.map((d: { volume: number }) => d.volume);
    const avgVolume = volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length;
    const maxVolume = Math.max(...volumes);
    const minVolume = Math.min(...volumes);

    return NextResponse.json({
      success: true,
      data: {
        days: parseInt(days),
        source: 'coingecko',
        dailyData: merged,
        stats: {
          avgVolume,
          maxVolume,
          minVolume,
          currentVolume: volumes[volumes.length - 1] || 0,
        }
      }
    });
  } catch (error) {
    console.error('BTC volume API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch BTC volume data' },
      { status: 500 }
    );
  }
}
