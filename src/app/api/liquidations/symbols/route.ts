import { NextResponse } from 'next/server';
import { liquidationStorage } from '@/lib/services/liquidationStorage';

export async function GET() {
  try {
    const symbols = await liquidationStorage.getUniqueSymbols();
    
    return NextResponse.json({
      success: true,
      symbols: symbols || []
    });
  } catch (error) {
    console.error('[API] Error fetching liquidation symbols:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch liquidation symbols',
        symbols: []
      },
      { status: 500 }
    );
  }
}
