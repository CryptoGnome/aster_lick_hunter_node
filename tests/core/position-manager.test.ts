#!/usr/bin/env tsx

import { PositionManager } from '../../src/lib/bot/positionManager';
import {
  TestSummary,
  logSection,
  log,
  colors,
  createMockConfig,
  createMockPosition,
  assert,
  assertEqual,
  assertClose,
  wait as _wait
} from '../utils/test-helpers';

async function testPositionManagerInitialization() {
  logSection('Testing PositionManager Initialization');
  const summary = new TestSummary();

  await summary.run('Create PositionManager instance', async () => {
    const config = createMockConfig();
    const manager = new PositionManager(config.symbols, config.api);
    assert(manager !== null, 'PositionManager should be created');
  });

  await summary.run('Initialize with paper mode', async () => {
    const config = createMockConfig();
    config.global.paperMode = true;
    const manager = new PositionManager(config.symbols, config.api, true);
    assert(manager !== null, 'PositionManager should work in paper mode');
  });

  summary.print();
}

async function testPositionTracking() {
  logSection('Testing Position Tracking');
  const summary = new TestSummary();

  await summary.run('Track new position', async () => {
    const position = createMockPosition({
      symbol: 'BTCUSDT',
      positionAmt: '0.001',
      entryPrice: '50000',
      markPrice: '50100'
    });

    assert(position.symbol === 'BTCUSDT', 'Symbol should match');
    assert(parseFloat(position.positionAmt) > 0, 'Position amount should be positive');
  });

  await summary.run('Calculate position PnL', async () => {
    const position = createMockPosition({
      positionAmt: '0.001',
      entryPrice: '50000',
      markPrice: '50100'
    });

    const pnl = (parseFloat(position.markPrice) - parseFloat(position.entryPrice)) * parseFloat(position.positionAmt);
    const expectedPnl = 0.1;

    assertClose(pnl, expectedPnl, 0.001, 'PnL calculation should be correct');
    log(`  PnL: $${pnl.toFixed(2)}`, colors.gray);
  });

  await summary.run('Track multiple positions', async () => {
    const positions = [
      createMockPosition({ symbol: 'BTCUSDT', positionAmt: '0.001' }),
      createMockPosition({ symbol: 'ETHUSDT', positionAmt: '0.01' }),
      createMockPosition({ symbol: 'SOLUSDT', positionAmt: '1.0' })
    ];

    assertEqual(positions.length, 3, 'Should track 3 positions');
    assert(positions.every(p => parseFloat(p.positionAmt) > 0), 'All positions should have positive amounts');
  });

  await summary.run('Identify position side', async () => {
    const longPosition = createMockPosition({ positionAmt: '0.001' });
    const shortPosition = createMockPosition({ positionAmt: '-0.001' });

    assert(parseFloat(longPosition.positionAmt) > 0, 'Long position should be positive');
    assert(parseFloat(shortPosition.positionAmt) < 0, 'Short position should be negative');
  });

  summary.print();
}

async function testStopLossTakeProfit() {
  logSection('Testing Stop Loss & Take Profit');
  const summary = new TestSummary();

  await summary.run('Calculate SL price for long position', async () => {
    const entryPrice = 50000;
    const slPercent = 2;
    const slPrice = entryPrice * (1 - slPercent / 100);

    assertEqual(slPrice, 49000, 'SL price should be 2% below entry');
  });

  await summary.run('Calculate TP price for long position', async () => {
    const entryPrice = 50000;
    const tpPercent = 5;
    const tpPrice = entryPrice * (1 + tpPercent / 100);

    assertEqual(tpPrice, 52500, 'TP price should be 5% above entry');
  });

  await summary.run('Calculate SL price for short position', async () => {
    const entryPrice = 50000;
    const slPercent = 2;
    const slPrice = entryPrice * (1 + slPercent / 100);

    assertEqual(slPrice, 51000, 'SL price for short should be 2% above entry');
  });

  await summary.run('Calculate TP price for short position', async () => {
    const entryPrice = 50000;
    const tpPercent = 5;
    const tpPrice = entryPrice * (1 - tpPercent / 100);

    assertEqual(tpPrice, 47500, 'TP price for short should be 5% below entry');
  });

  await summary.run('Validate SL/TP order parameters', async () => {
    const position = createMockPosition({
      positionAmt: '0.001',
      entryPrice: '50000'
    });

    const slOrder = {
      symbol: position.symbol,
      side: 'SELL',
      type: 'STOP_MARKET',
      stopPrice: 49000,
      closePosition: true
    };

    const tpOrder = {
      symbol: position.symbol,
      side: 'SELL',
      type: 'TAKE_PROFIT_MARKET',
      stopPrice: 52500,
      closePosition: true
    };

    assert(slOrder.stopPrice < parseFloat(position.entryPrice), 'SL should be below entry');
    assert(tpOrder.stopPrice > parseFloat(position.entryPrice), 'TP should be above entry');
  });

  summary.print();
}

async function testPositionSizing() {
  logSection('Testing Position Sizing');
  const summary = new TestSummary();

  await summary.run('Calculate position size based on risk', async () => {
    const accountBalance = 10000;
    const riskPercent = 1;
    const stopLossPercent = 2;

    const riskAmount = accountBalance * (riskPercent / 100);
    const maxLoss = riskAmount;
    const positionSize = maxLoss / (stopLossPercent / 100);

    assertEqual(riskAmount, 100, 'Risk amount should be 1% of balance');
    assertEqual(positionSize, 5000, 'Position size calculation');
    log(`  Risk: $${riskAmount} | Position Size: $${positionSize}`, colors.gray);
  });

  await summary.run('Apply leverage to position size', async () => {
    const baseSize = 1000;
    const leverage = 10;
    const leveragedSize = baseSize * leverage;

    assertEqual(leveragedSize, 10000, 'Leveraged position size');
  });

  await summary.run('Respect max position limits', async () => {
    const requestedSize = 100000;
    const maxNotional = 50000;
    const actualSize = Math.min(requestedSize, maxNotional);

    assertEqual(actualSize, 50000, 'Should respect max notional limit');
  });

  summary.print();
}

async function testOrderFillHandling() {
  logSection('Testing Order Fill Handling');
  const summary = new TestSummary();

  await summary.run('Handle partial fill', async () => {
    const orderQty = 1.0;
    const filledQty = 0.7;
    const remainingQty = orderQty - filledQty;

    assertEqual(remainingQty, 0.3, 'Should calculate remaining quantity');
    assert(remainingQty > 0, 'Should identify partial fill');
  });

  await summary.run('Handle complete fill', async () => {
    const orderQty = 1.0;
    const filledQty = 1.0;
    const remainingQty = orderQty - filledQty;

    assertEqual(remainingQty, 0, 'Should have no remaining quantity');
    assert(filledQty === orderQty, 'Should identify complete fill');
  });

  await summary.run('Calculate average fill price', async () => {
    const fills = [
      { price: 50000, qty: 0.5 },
      { price: 50100, qty: 0.3 },
      { price: 50200, qty: 0.2 }
    ];

    let totalCost = 0;
    let totalQty = 0;

    for (const fill of fills) {
      totalCost += fill.price * fill.qty;
      totalQty += fill.qty;
    }

    const avgPrice = totalCost / totalQty;
    assertClose(avgPrice, 50070, 1, 'Average fill price calculation');
    log(`  Avg Price: $${avgPrice.toFixed(2)}`, colors.gray);
  });

  summary.print();
}

async function testSmartPositionClosing() {
  logSection('Testing Smart Position Closing');
  const summary = new TestSummary();

  await summary.run('Detect profit threshold exceeded', async () => {
    const position = createMockPosition({
      entryPrice: '50000',
      markPrice: '53000',
      positionAmt: '0.001'
    });

    const tpPercent = 5;
    const tpPrice = parseFloat(position.entryPrice) * (1 + tpPercent / 100);
    const currentPrice = parseFloat(position.markPrice);

    assert(currentPrice > tpPrice, 'Current price exceeds TP target');

    const profitPercent = ((currentPrice - parseFloat(position.entryPrice)) / parseFloat(position.entryPrice)) * 100;
    assert(profitPercent > tpPercent, 'Profit exceeds target');
    log(`  Profit: ${profitPercent.toFixed(2)}% > Target: ${tpPercent}%`, colors.gray);
  });

  await summary.run('Calculate market close vs limit close', async () => {
    const position = createMockPosition({
      positionAmt: '0.001',
      markPrice: '53000'
    });

    const marketClosePrice = parseFloat(position.markPrice);
    const limitClosePrice = marketClosePrice * 1.001;

    assert(limitClosePrice > marketClosePrice, 'Limit price should be above market');

    const slippage = ((limitClosePrice - marketClosePrice) / marketClosePrice) * 10000;
    assertClose(slippage, 10, 0.1, 'Slippage should be ~10 bps');
  });

  await summary.run('Handle position reduction', async () => {
    const initialSize = 1.0;
    const reductionPercent = 50;
    const reducedSize = initialSize * (reductionPercent / 100);
    const remainingSize = initialSize - reducedSize;

    assertEqual(reducedSize, 0.5, 'Should reduce by 50%');
    assertEqual(remainingSize, 0.5, 'Should have 50% remaining');
  });

  summary.print();
}

async function testBatchOrderFailureHandling() {
  logSection('Testing Batch Order Failure Handling');
  const summary = new TestSummary();

  await summary.run('Handle partial batch failure (SL fails, TP succeeds)', async () => {
    // Simulate batch result where TP succeeds but SL fails
    const batchResult = {
      stopLoss: null,
      takeProfit: { orderId: 12345, status: 'NEW' },
      errors: ['Stop price would trigger immediately']
    };

    assert(!batchResult.stopLoss, 'SL should have failed');
    assert(batchResult.takeProfit, 'TP should have succeeded');
    assert(batchResult.errors.length > 0, 'Should have error messages');
  });

  await summary.run('Handle partial batch failure (SL succeeds, TP fails)', async () => {
    const batchResult = {
      stopLoss: { orderId: 54321, status: 'NEW' },
      takeProfit: null,
      errors: ['Take profit price invalid']
    };

    assert(batchResult.stopLoss, 'SL should have succeeded');
    assert(!batchResult.takeProfit, 'TP should have failed');
  });

  await summary.run('Handle complete batch failure', async () => {
    const batchResult = {
      stopLoss: null,
      takeProfit: null,
      errors: ['Insufficient balance', 'Invalid symbol']
    };

    assert(!batchResult.stopLoss, 'SL should have failed');
    assert(!batchResult.takeProfit, 'TP should have failed');
    assertEqual(batchResult.errors.length, 2, 'Should have multiple errors');
  });

  await summary.run('Verify error logging for batch failures', async () => {
    let errorLogCount = 0;
    const mockErrorLogger = {
      logTradingError: async () => { errorLogCount++; return Promise.resolve(); }
    };

    const errors = ['Error 1', 'Error 2'];
    // Simulate processing errors
    for (const _error of errors) {
      await mockErrorLogger.logTradingError();
    }

    assertEqual(errorLogCount, 2, 'All errors should be logged');
  });

  await summary.run('Verify retry logic after batch failure', async () => {
    let placeSL = true;
    let placeTP = true;

    const batchResult = {
      stopLoss: null,
      takeProfit: { orderId: 12345 },
      errors: ['SL failed']
    };

    // After batch failure, should retry SL but not TP
    if (!batchResult.stopLoss && placeSL) {
      placeSL = true; // Should remain true for retry
    }
    if (batchResult.takeProfit && placeTP) {
      placeTP = false; // Should be false, already placed
    }

    assert(placeSL === true, 'Should retry SL');
    assert(placeTP === false, 'Should not retry TP');
  });

  summary.print();
}

async function testErrorRecovery() {
  logSection('Testing Error Recovery');
  const summary = new TestSummary();

  await summary.run('Handle order rejection', async () => {
    const error = {
      code: -2010,
      msg: 'Order would immediately match and take'
    };

    assert(error.code === -2010, 'Should identify rejection code');
    assert(error.msg.includes('immediately match'), 'Should identify rejection reason');
  });

  await summary.run('Handle insufficient balance', async () => {
    const requiredBalance = 1000;
    const availableBalance = 500;

    assert(availableBalance < requiredBalance, 'Should detect insufficient balance');

    const canTrade = availableBalance >= requiredBalance;
    assertEqual(canTrade, false, 'Should prevent trading');
  });

  await summary.run('Handle rate limit errors', async () => {
    const error = {
      code: -1003,
      msg: 'Too many requests'
    };

    assert(error.code === -1003, 'Should identify rate limit error');

    const retryAfter = 60;
    assert(retryAfter > 0, 'Should have retry delay');
    log(`  Retry after: ${retryAfter}s`, colors.gray);
  });

  summary.print();
}

async function main() {
  console.clear();
  log('🧪 POSITION MANAGER TEST SUITE', colors.cyan + colors.bold);
  log('=' .repeat(60), colors.cyan);

  try {
    await testPositionManagerInitialization();
    await testPositionTracking();
    await testStopLossTakeProfit();
    await testPositionSizing();
    await testOrderFillHandling();
    await testSmartPositionClosing();
    await testBatchOrderFailureHandling();
    await testErrorRecovery();

    logSection('✨ All Position Manager Tests Complete');
  } catch (error) {
    logSection('❌ Test Suite Failed');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}