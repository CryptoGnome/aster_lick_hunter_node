import { NextResponse } from 'next/server';
import { loadConfig } from '@/lib/bot/config';
import { validateAllTradeSizes } from '@/lib/validation/tradeSizeValidator';

export async function GET() {
  try {
    const config = await loadConfig();
    const validationResult = await validateAllTradeSizes(config);

    return NextResponse.json({
      valid: validationResult.valid,
      warnings: validationResult.warnings
    });
  } catch (error) {
    console.error('Failed to validate trade sizes:', error);
    return NextResponse.json(
      { error: 'Failed to validate trade sizes' },
      { status: 500 }
    );
  }
}