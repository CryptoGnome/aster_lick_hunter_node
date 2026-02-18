/**
 * Trade History Backfill Service
 * 
 * Imports historical trades and income from the exchange API into the local SQLite DB.
 * Can be run standalone (npx tsx scripts/backfill-trades.ts) or called on bot startup.
 * 
 * Uses sync_metadata to track progress and avoid re-fetching.
 * Handles pagination and rate limits.
 */

import { loadConfig } from '../src/lib/bot/config';
import { buildSignedQuery } from '../src/lib/api/auth';
import { tradeHistoryDb, TradeHistoryRecord } from '../src/lib/db/tradeHistoryDb';

const BASE_URL = 'https://fapi.asterdex.com';

// How far back to backfill if never run before (30 days)
const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
// Maximum time window per API request (7 days - Binance-style limit)
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Rate limit delay between API calls
const RATE_LIMIT_DELAY_MS = 200;

async function apiCall(endpoint: string, params: Record<string, string>, apiKey: string, secretKey: string): Promise<any> {
  const queryString = buildSignedQuery(params, { apiKey, secretKey });
  const url = `${BASE_URL}${endpoint}?${queryString}`;

  const res = await fetch(url, {
    headers: { 'X-MBX-APIKEY': apiKey }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Backfill trade history (allOrders endpoint)
 */
async function backfillOrders(apiKey: string, secretKey: string, symbols: string[]): Promise<number> {
  let totalImported = 0;

  // Determine start time from last backfill or default lookback
  const lastBackfill = tradeHistoryDb.getSyncMeta('last_order_backfill_time');
  const startTime = lastBackfill ? parseInt(lastBackfill) : Date.now() - DEFAULT_LOOKBACK_MS;
  const endTime = Date.now();

  console.log(`[Backfill] Orders: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);

  for (const symbol of symbols) {
    let windowStart = startTime;

    while (windowStart < endTime) {
      const windowEnd = Math.min(windowStart + MAX_WINDOW_MS, endTime);

      try {
        const orders = await apiCall('/fapi/v1/allOrders', {
          symbol,
          startTime: windowStart.toString(),
          endTime: windowEnd.toString(),
          limit: '1000',
        }, apiKey, secretKey);

        if (orders.length > 0) {
          const records: TradeHistoryRecord[] = orders.map((o: any) => ({
            symbol: o.symbol,
            orderId: o.orderId,
            clientOrderId: o.clientOrderId || o.origClientOrderId,
            side: o.side,
            positionSide: o.positionSide || 'BOTH',
            orderType: o.type || o.origType,
            origType: o.origType,
            status: o.status,
            price: o.price || '0',
            avgPrice: o.avgPrice || o.price || '0',
            origQty: o.origQty || '0',
            executedQty: o.executedQty || '0',
            lastFilledQty: null,
            lastFilledPrice: null,
            quoteQty: o.cumQuote || null,
            commission: null,
            commissionAsset: null,
            realizedPnl: '0', // allOrders doesn't include PnL
            reduceOnly: o.reduceOnly || false,
            closePosition: o.closePosition || false,
            isMaker: false,
            tradeId: null,
            orderTime: o.time,
            updateTime: o.updateTime,
            source: 'api_backfill' as const,
          }));

          tradeHistoryDb.batchUpsertTrades(records);
          totalImported += records.length;
          process.stdout.write(`  ${symbol}: ${records.length} orders (${new Date(windowStart).toLocaleDateString()})\n`);
        }
      } catch (err: any) {
        console.error(`  ${symbol} orders error at ${new Date(windowStart).toISOString()}: ${err.message}`);
      }

      windowStart = windowEnd;
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  return totalImported;
}

/**
 * Backfill user trades (for PnL and commission data)
 */
async function backfillUserTrades(apiKey: string, secretKey: string, symbols: string[]): Promise<number> {
  let totalImported = 0;

  const lastBackfill = tradeHistoryDb.getSyncMeta('last_trade_backfill_time');
  const startTime = lastBackfill ? parseInt(lastBackfill) : Date.now() - DEFAULT_LOOKBACK_MS;
  const endTime = Date.now();

  console.log(`[Backfill] UserTrades: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);

  for (const symbol of symbols) {
    let windowStart = startTime;

    while (windowStart < endTime) {
      const windowEnd = Math.min(windowStart + MAX_WINDOW_MS, endTime);

      try {
        const trades = await apiCall('/fapi/v1/userTrades', {
          symbol,
          startTime: windowStart.toString(),
          endTime: windowEnd.toString(),
          limit: '1000',
        }, apiKey, secretKey);

        if (trades.length > 0) {
          // UserTrades have richer data (PnL, commission, tradeId)
          // Update existing order records or create new ones
          const records: TradeHistoryRecord[] = trades.map((t: any) => ({
            symbol: t.symbol,
            orderId: t.orderId,
            clientOrderId: null,
            side: t.side,
            positionSide: t.positionSide || 'BOTH',
            orderType: 'MARKET', // userTrades don't include order type
            origType: null,
            status: 'FILLED',
            price: t.price || '0',
            avgPrice: t.price || '0',
            origQty: t.qty || '0',
            executedQty: t.qty || '0',
            lastFilledQty: t.qty,
            lastFilledPrice: t.price,
            quoteQty: t.quoteQty || null,
            commission: t.commission || '0',
            commissionAsset: t.commissionAsset || null,
            realizedPnl: t.realizedPnl || '0',
            reduceOnly: false,
            closePosition: false,
            isMaker: t.maker || false,
            tradeId: t.id,
            orderTime: t.time,
            updateTime: t.time,
            source: 'api_backfill' as const,
          }));

          tradeHistoryDb.batchUpsertTrades(records);
          totalImported += records.length;
          process.stdout.write(`  ${symbol}: ${records.length} trades (${new Date(windowStart).toLocaleDateString()})\n`);
        }
      } catch (err: any) {
        console.error(`  ${symbol} trades error at ${new Date(windowStart).toISOString()}: ${err.message}`);
      }

      windowStart = windowEnd;
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  return totalImported;
}

/**
 * Backfill income history (PnL, commissions, funding fees)
 */
async function backfillIncome(apiKey: string, secretKey: string): Promise<number> {
  let totalImported = 0;

  const lastBackfill = tradeHistoryDb.getSyncMeta('last_income_backfill_time');
  const startTime = lastBackfill ? parseInt(lastBackfill) : Date.now() - DEFAULT_LOOKBACK_MS;
  const endTime = Date.now();

  console.log(`[Backfill] Income: ${new Date(startTime).toISOString()} → ${new Date(endTime).toISOString()}`);

  let windowStart = startTime;

  while (windowStart < endTime) {
    const windowEnd = Math.min(windowStart + MAX_WINDOW_MS, endTime);

    try {
      const incomeRecords = await apiCall('/fapi/v1/income', {
        startTime: windowStart.toString(),
        endTime: windowEnd.toString(),
        limit: '1000',
      }, apiKey, secretKey);

      if (incomeRecords.length > 0) {
        const records = incomeRecords.map((r: any) => ({
          tranId: r.tranId,
          symbol: r.symbol || '',
          incomeType: r.incomeType,
          income: r.income,
          asset: r.asset || 'USDT',
          info: r.info || null,
          tradeId: r.tradeId || null,
          time: r.time,
        }));

        tradeHistoryDb.batchUpsertIncome(records);
        totalImported += records.length;
        process.stdout.write(`  ${incomeRecords.length} income records (${new Date(windowStart).toLocaleDateString()})\n`);
      }
    } catch (err: any) {
      console.error(`  Income error at ${new Date(windowStart).toISOString()}: ${err.message}`);
    }

    windowStart = windowEnd;
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  return totalImported;
}

/**
 * Run the full backfill process
 */
export async function runBackfill(): Promise<{
  orders: number;
  trades: number;
  income: number;
  durationMs: number;
}> {
  const startMs = Date.now();
  console.log('\n=== Trade History Backfill ===\n');

  const config = await loadConfig();
  const { apiKey, secretKey } = config.api;

  if (!apiKey || !secretKey) {
    console.error('No API keys configured. Skipping backfill.');
    return { orders: 0, trades: 0, income: 0, durationMs: 0 };
  }

  const symbols = Object.keys(config.symbols || {});
  if (symbols.length === 0) {
    console.error('No symbols configured. Skipping backfill.');
    return { orders: 0, trades: 0, income: 0, durationMs: 0 };
  }

  tradeHistoryDb.setSyncMeta('backfill_status', 'running');

  try {
    // 1. Backfill all orders (gets status, type, but no PnL)
    const orderCount = await backfillOrders(apiKey, secretKey, symbols);

    // 2. Backfill user trades (gets PnL, commission data)
    const tradeCount = await backfillUserTrades(apiKey, secretKey, symbols);

    // 3. Backfill income (PnL, commissions, funding fees - aggregated)
    const incomeCount = await backfillIncome(apiKey, secretKey);

    // Update sync metadata
    const now = Date.now();
    tradeHistoryDb.setSyncMeta('last_order_backfill_time', now.toString());
    tradeHistoryDb.setSyncMeta('last_trade_backfill_time', now.toString());
    tradeHistoryDb.setSyncMeta('last_income_backfill_time', now.toString());
    tradeHistoryDb.setSyncMeta('backfill_status', 'completed');

    const durationMs = Date.now() - startMs;

    console.log(`\n✅ Backfill complete in ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`   Orders: ${orderCount}`);
    console.log(`   Trades: ${tradeCount}`);
    console.log(`   Income: ${incomeCount}`);
    console.log(`   Total DB trades: ${tradeHistoryDb.getTradeCount()}\n`);

    return { orders: orderCount, trades: tradeCount, income: incomeCount, durationMs };
  } catch (err) {
    tradeHistoryDb.setSyncMeta('backfill_status', 'error');
    throw err;
  }
}

// Run standalone
if (require.main === module || process.argv[1]?.includes('backfill-trades')) {
  runBackfill()
    .then(result => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Backfill failed:', err);
      process.exit(1);
    });
}
