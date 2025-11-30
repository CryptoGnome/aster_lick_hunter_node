import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '@/lib/bot/config';
import { withAuth } from '@/lib/auth/with-auth';

export const POST = withAuth(async (request: NextRequest, _user) => {
  try {
    const config = await loadConfig();
    
    if (!config.global.paperMode) {
      return NextResponse.json(
        { error: 'Paper mode is not enabled' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { newBalance } = body;

    // Validate new balance
    if (newBalance && (typeof newBalance !== 'number' || newBalance < 100)) {
      return NextResponse.json(
        { error: 'Invalid balance. Must be a number >= 100' },
        { status: 400 }
      );
    }

    const { PaperTradingDatabase } = await import('@/lib/db/paperTradingDb');
    const db = PaperTradingDatabase.getInstance();

    // Clear all positions and orders
    await db.run('DELETE FROM positions');
    await db.run('DELETE FROM orders');

    // Reset balance
    const startingBalance = newBalance || config.global.paperTrading?.startingBalance || 1000;
    await db.run(`
      INSERT OR REPLACE INTO balance (
        id, total_balance, available_balance, used_margin, unrealized_pnl,
        session_starting_balance, session_pnl, session_pnl_percent,
        session_trades, session_wins, session_losses, updated_at
      ) VALUES (1, ?, ?, 0, 0, ?, 0, 0, 0, 0, 0, strftime('%s', 'now'))
    `, [startingBalance, startingBalance, startingBalance]);

    console.log(`[Paper Trading Reset] Reset to ${startingBalance} USDT`);

    return NextResponse.json({
      success: true,
      balance: startingBalance,
      message: `Paper trading reset to ${startingBalance} USDT`
    });
  } catch (error: any) {
    console.error('[Paper Trading Reset] Error:', error);
    return NextResponse.json(
      { error: 'Failed to reset paper trading', details: error.message },
      { status: 500 }
    );
  }
});
