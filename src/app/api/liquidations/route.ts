import { NextRequest, NextResponse } from 'next/server';
import { liquidationStorage } from '@/lib/services/liquidationStorage';
import { ensureDbInitialized } from '@/lib/db/initDb';

export async function GET(request: NextRequest) {
  try {
    // Ensure database is initialized
    await ensureDbInitialized();

    const searchParams = request.nextUrl.searchParams;

    const params = {
      symbol: searchParams.get('symbol') || undefined,
      from: searchParams.get('from') ? parseInt(searchParams.get('from')!) : undefined,
      to: searchParams.get('to') ? parseInt(searchParams.get('to')!) : undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
    };

    const result = await liquidationStorage.getLiquidations(params);

    return NextResponse.json({
      success: true,
      data: result.liquidations,
      pagination: {
        total: result.total,
        limit: params.limit,
        offset: params.offset,
        hasMore: params.offset! + params.limit! < result.total,
      },
    });
  } catch (error) {
    console.error('API error - get liquidations:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch liquidations',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}