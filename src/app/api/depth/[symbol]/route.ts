import { NextRequest, NextResponse } from 'next/server';
import { getOrderBook, getBookTicker } from '@/lib/api/market';

interface DepthLevel {
  percentFromMid: number;
  bidLiquidity: number;  // USDT available on bid side within this %
  askLiquidity: number;  // USDT available on ask side within this %
  totalLiquidity: number;
}

interface DepthAnalysis {
  symbol: string;
  timestamp: number;
  midPrice: number;
  spread: number;
  spreadPercent: number;
  bestBid: number;
  bestAsk: number;
  bidAskImbalance: number;  // -1 to 1, negative = more asks, positive = more bids
  levels: DepthLevel[];
  totalBidLiquidity: number;
  totalAskLiquidity: number;
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

    // Fetch order book with maximum depth (1000 levels each side)
    // This gives better coverage for tight markets like BTC
    const [orderBook, bookTicker] = await Promise.all([
      getOrderBook(symbol.toUpperCase(), 1000),
      getBookTicker(symbol.toUpperCase())
    ]);

    if (!orderBook || !orderBook.bids || !orderBook.asks) {
      return NextResponse.json({ error: 'Failed to fetch order book' }, { status: 500 });
    }

    const bestBid = parseFloat(bookTicker.bidPrice);
    const bestAsk = parseFloat(bookTicker.askPrice);
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadPercent = (spread / midPrice) * 100;

    // Define % levels to analyze
    const percentLevels = [0.1, 0.25, 0.5, 1.0, 2.0, 5.0];
    
    // Calculate liquidity at each level
    const levels: DepthLevel[] = percentLevels.map(pct => {
      const bidThreshold = midPrice * (1 - pct / 100);
      const askThreshold = midPrice * (1 + pct / 100);
      
      let bidLiquidity = 0;
      let askLiquidity = 0;
      
      // Sum bid liquidity within range
      for (const [price, qty] of orderBook.bids) {
        const p = parseFloat(price);
        const q = parseFloat(qty);
        if (p >= bidThreshold) {
          bidLiquidity += p * q;
        }
      }
      
      // Sum ask liquidity within range
      for (const [price, qty] of orderBook.asks) {
        const p = parseFloat(price);
        const q = parseFloat(qty);
        if (p <= askThreshold) {
          askLiquidity += p * q;
        }
      }
      
      return {
        percentFromMid: pct,
        bidLiquidity,
        askLiquidity,
        totalLiquidity: bidLiquidity + askLiquidity
      };
    });

    // Calculate total liquidity (using largest % level)
    const totalBidLiquidity = levels[levels.length - 1]?.bidLiquidity || 0;
    const totalAskLiquidity = levels[levels.length - 1]?.askLiquidity || 0;
    
    // Bid/Ask imbalance at 1% level (-1 to 1)
    const level1pct = levels.find(l => l.percentFromMid === 1.0);
    let bidAskImbalance = 0;
    if (level1pct && (level1pct.bidLiquidity + level1pct.askLiquidity) > 0) {
      bidAskImbalance = (level1pct.bidLiquidity - level1pct.askLiquidity) / 
                        (level1pct.bidLiquidity + level1pct.askLiquidity);
    }

    const analysis: DepthAnalysis = {
      symbol: symbol.toUpperCase(),
      timestamp: Date.now(),
      midPrice,
      spread,
      spreadPercent,
      bestBid,
      bestAsk,
      bidAskImbalance,
      levels,
      totalBidLiquidity,
      totalAskLiquidity
    };

    return NextResponse.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Depth API error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze depth', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
