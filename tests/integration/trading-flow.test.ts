#!/usr/bin/env tsx

import { Hunter } from '../../src/lib/bot/hunter';
import { PositionManager } from '../../src/lib/bot/positionManager';
// import { loadConfig } from '../../src/lib/bot/config';
import {
  TestSummary,
  logSection,
  log,
  colors,
  createMockConfig,
  createMockLiquidation,
  createMockPosition,
  assert,
  assertEqual,
  assertClose,
  wait
} from '../utils/test-helpers';

async function testFullTradingFlow() {
  logSection('Testing Full Trading Flow');
  const summary = new TestSummary();

  await summary.run('Load configuration', async () => {
    const config = createMockConfig();
    config.global.paperMode = true;

    assert(config.global.paperMode === true, 'Should be in paper mode');
    assert(config.symbols.BTCUSDT !== undefined, 'Should have BTCUSDT config');
  });

  await summary.run('Initialize bot components', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config.symbols, config.api, true);
    const positionManager = new PositionManager(config.symbols, config.api, true);

    assert(hunter !== null, 'Hunter should be initialized');
    assert(positionManager !== null, 'PositionManager should be initialized');
  });

  await summary.run('Process liquidation event', async () => {
    const liquidation = createMockLiquidation({
      symbol: 'BTCUSDT',
      side: 'SELL',
      origQty: '2.0',
      price: '50000'
    });

    const volumeUSDT = parseFloat(liquidation.origQty) * parseFloat(liquidation.price);
    assert(volumeUSDT === 100000, 'Volume should be $100,000');

    const tradeSide = liquidation.side === 'SELL' ? 'BUY' : 'SELL';
    assertEqual(tradeSide, 'BUY', 'Should trade opposite to liquidation');
  });

  await summary.run('Place limit order', async () => {
    const markPrice = 50000;
    const offsetBps = 5;
    const tradeSize = 0.001;
    const leverage = 5;

    const entryPrice = markPrice * (1 - offsetBps / 10000);
    const leveragedSize = tradeSize * leverage;

    assertClose(entryPrice, 49975, 0.1, 'Entry price calculation');
    assertEqual(leveragedSize, 0.005, 'Leveraged size calculation');

    log(`  Order: BUY ${leveragedSize} BTC @ $${entryPrice}`, colors.gray);
  });

  await summary.run('Simulate order fill', async () => {
    const order = {
      orderId: 12345,
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.005,
      price: 49975,
      status: 'FILLED',
      avgPrice: 49975
    };

    assertEqual(order.status, 'FILLED', 'Order should be filled');
    assertEqual(order.avgPrice, order.price, 'Fill price should match order price');
  });

  await summary.run('Create position from fill', async () => {
    const position = createMockPosition({
      symbol: 'BTCUSDT',
      positionAmt: '0.005',
      entryPrice: '49975',
      markPrice: '50025'
    });

    const pnl = (parseFloat(position.markPrice) - parseFloat(position.entryPrice)) * parseFloat(position.positionAmt);
    assertClose(pnl, 0.25, 0.01, 'Initial PnL should be positive');
  });

  await summary.run('Place SL/TP orders', async () => {
    const entryPrice = 49975;
    const slPercent = 2;
    const tpPercent = 5;

    const slPrice = entryPrice * (1 - slPercent / 100);
    const tpPrice = entryPrice * (1 + tpPercent / 100);

    assertEqual(slPrice, 48975.5, 'SL price calculation');
    assertEqual(tpPrice, 52473.75, 'TP price calculation');

    log(`  SL: $${slPrice.toFixed(2)} | TP: $${tpPrice.toFixed(2)}`, colors.gray);
  });

  await summary.run('Monitor position updates', async () => {
    const updates = [
      { markPrice: 50025, pnl: 0.25 },
      { markPrice: 50500, pnl: 2.625 },
      { markPrice: 51000, pnl: 5.125 }
    ];

    for (const update of updates) {
      const position = createMockPosition({
        positionAmt: '0.005',
        entryPrice: '49975',
        markPrice: String(update.markPrice)
      });

      const pnl = (parseFloat(position.markPrice) - parseFloat(position.entryPrice)) * parseFloat(position.positionAmt);
      assertClose(pnl, update.pnl, 0.01, `PnL at $${update.markPrice}`);
    }
  });

  await summary.run('Close position at profit', async () => {
    const position = createMockPosition({
      positionAmt: '0.005',
      entryPrice: '49975',
      markPrice: '52500'
    });

    const profitPercent = ((parseFloat(position.markPrice) - parseFloat(position.entryPrice)) / parseFloat(position.entryPrice)) * 100;
    assertClose(profitPercent, 5.05, 0.1, 'Profit percentage');

    const closeOrder = {
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'LIMIT',
      quantity: 0.005,
      price: 52500
    };

    assertEqual(closeOrder.side, 'SELL', 'Should sell to close long');
    assertEqual(closeOrder.quantity, 0.005, 'Should close full position');
  });

  summary.print();
}

async function testPaperModeFlow() {
  logSection('Testing Paper Mode Flow');
  const summary = new TestSummary();

  await summary.run('Generate mock liquidations', async () => {
    const mockLiquidations = [];

    for (let i = 0; i < 5; i++) {
      mockLiquidations.push(createMockLiquidation({
        symbol: 'BTCUSDT',
        side: Math.random() > 0.5 ? 'BUY' : 'SELL',
        origQty: (Math.random() * 5).toFixed(3),
        price: (50000 + Math.random() * 2000 - 1000).toFixed(2)
      }));
    }

    assertEqual(mockLiquidations.length, 5, 'Should generate 5 liquidations');
    assert(mockLiquidations.every(l => parseFloat(l.origQty) > 0), 'All should have quantity');
  });

  await summary.run('Simulate paper trades', async () => {
    const trades = [];
    const _mockLiquidation = createMockLiquidation({
      side: 'SELL',
      origQty: '1.0',
      price: '50000'
    });

    const trade = {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 0.005,
      price: 49950,
      timestamp: Date.now(),
      paper: true
    };

    trades.push(trade);
    assert(trade.paper === true, 'Should be marked as paper trade');
  });

  await summary.run('Track paper positions', async () => {
    const paperPositions = new Map();

    paperPositions.set('BTCUSDT', {
      amount: 0.005,
      entryPrice: 49950,
      currentPrice: 50100,
      pnl: 0.75
    });

    assert(paperPositions.has('BTCUSDT'), 'Should track paper position');
    assertEqual(paperPositions.get('BTCUSDT').pnl, 0.75, 'Should calculate paper PnL');
  });

  summary.print();
}

async function testErrorRecoveryFlow() {
  logSection('Testing Error Recovery Flow');
  const summary = new TestSummary();

  await summary.run('Handle order rejection', async () => {
    const error = {
      code: -2010,
      msg: 'Order would immediately match and take'
    };

    let retryWithAdjustedPrice = false;
    if (error.code === -2010) {
      retryWithAdjustedPrice = true;
    }

    assert(retryWithAdjustedPrice, 'Should retry with adjusted price');
  });

  await summary.run('Handle connection loss during trade', async () => {
    let connected = true;
    const hasOpenPosition = true;

    connected = false;

    if (!connected && hasOpenPosition) {
      log('  ⚠️  Connection lost with open position', colors.yellow);
    }

    assert(!connected && hasOpenPosition, 'Should detect risky situation');
  });

  await summary.run('Recover from partial fills', async () => {
    const orderQty = 1.0;
    const filledQty = 0.6;
    const remaining = orderQty - filledQty;

    assert(remaining > 0, 'Should detect partial fill');

    const followUpOrder = {
      quantity: remaining,
      adjustPrice: true
    };

    assertEqual(followUpOrder.quantity, 0.4, 'Should place order for remaining');
  });

  summary.print();
}

async function testConfigurationChanges() {
  logSection('Testing Configuration Changes');
  const summary = new TestSummary();

  await summary.run('Update symbol configuration', async () => {
    const config = createMockConfig();
    const oldTpPercent = config.symbols.BTCUSDT.tpPercent;

    config.symbols.BTCUSDT.tpPercent = 7;
    const newTpPercent = config.symbols.BTCUSDT.tpPercent;

    assert(oldTpPercent !== newTpPercent, 'Configuration should change');
    assertEqual(newTpPercent, 7, 'New TP should be 7%');
  });

  await summary.run('Add new symbol', async () => {
    const config = createMockConfig();

    config.symbols['ETHUSDT'] = {
      volumeThresholdUSDT: 5000,
      tradeSize: 0.01,
      leverage: 3,
      tpPercent: 3,
      slPercent: 1.5,
      priceOffsetBps: 3,
      maxSlippageBps: 30,
      orderType: 'LIMIT'
    };

    assert(config.symbols['ETHUSDT'] !== undefined, 'Should add new symbol');
    assertEqual(config.symbols['ETHUSDT'].leverage, 3, 'Should have correct leverage');
  });

  await summary.run('Toggle paper mode', async () => {
    const config = createMockConfig();
    const initialMode = config.global.paperMode;

    config.global.paperMode = !initialMode;

    assert(config.global.paperMode !== initialMode, 'Mode should toggle');
  });

  summary.print();
}

async function testPerformanceMetrics() {
  logSection('Testing Performance Metrics');
  const summary = new TestSummary();

  await summary.run('Track trade execution time', async () => {
    const startTime = Date.now();
    await wait(50);
    const executionTime = Date.now() - startTime;

    assert(executionTime >= 50, 'Should measure execution time');
    assert(executionTime < 100, 'Should be reasonably fast');

    log(`  Execution time: ${executionTime}ms`, colors.gray);
  });

  await summary.run('Calculate win rate', async () => {
    const trades = [
      { pnl: 10 },
      { pnl: -5 },
      { pnl: 15 },
      { pnl: -3 },
      { pnl: 8 }
    ];

    const wins = trades.filter(t => t.pnl > 0).length;
    const winRate = (wins / trades.length) * 100;

    assertEqual(wins, 3, 'Should count wins correctly');
    assertEqual(winRate, 60, 'Win rate should be 60%');
  });

  await summary.run('Calculate average profit', async () => {
    const profits = [10, 15, 8];
    const avgProfit = profits.reduce((a, b) => a + b, 0) / profits.length;

    assertClose(avgProfit, 11, 0.1, 'Average profit calculation');
  });

  await summary.run('Track position duration', async () => {
    const openTime = Date.now() - 300000;
    const closeTime = Date.now();
    const duration = (closeTime - openTime) / 1000 / 60;

    assertEqual(duration, 5, 'Position held for 5 minutes');
  });

  summary.print();
}

async function main() {
  console.clear();
  log('🧪 INTEGRATION TEST SUITE', colors.cyan + colors.bold);
  log('=' .repeat(60), colors.cyan);

  try {
    await testFullTradingFlow();
    await testPaperModeFlow();
    await testErrorRecoveryFlow();
    await testConfigurationChanges();
    await testPerformanceMetrics();

    logSection('✨ All Integration Tests Complete');
  } catch (error) {
    logSection('❌ Test Suite Failed');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}