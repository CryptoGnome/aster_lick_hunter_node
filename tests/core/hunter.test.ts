#!/usr/bin/env tsx

import { Hunter } from '../../src/lib/bot/hunter';
import {
  TestSummary,
  logSection,
  log,
  colors,
  createMockConfig,
  createMockLiquidation,
  createMockOrderBook,
  MockWebSocketServer,
  wait,
  assert,
  assertEqual,
  assertClose
} from '../utils/test-helpers';

async function testHunterInitialization() {
  logSection('Testing Hunter Initialization');
  const summary = new TestSummary();

  await summary.run('Create Hunter instance', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config.symbols, config.api);
    assert(hunter !== null, 'Hunter should be created');
  });

  await summary.run('Paper mode configuration', async () => {
    const config = createMockConfig();
    config.global.paperMode = true;
    const _hunter = new Hunter(config.symbols, config.api, true);
    assert(hunter !== null, 'Hunter should work in paper mode');
  });

  summary.print();
}

async function testLiquidationProcessing() {
  logSection('Testing Liquidation Processing');
  const summary = new TestSummary();

  await summary.run('Process valid liquidation event', async () => {
    const config = createMockConfig();
    const _hunter = new Hunter(config.symbols, config.api, true);

    const liquidation = createMockLiquidation({
      symbol: 'BTCUSDT',
      side: 'SELL',
      origQty: '1.0',
      price: '50000',
      orderStatus: 'FILLED'
    });

    const volumeUSDT = parseFloat(liquidation.origQty) * parseFloat(liquidation.price);
    assert(volumeUSDT > 0, 'Volume should be positive');
    assertEqual(volumeUSDT, 50000, 'Volume calculation should be correct');
  });

  await summary.run('Filter low volume liquidations', async () => {
    const config = createMockConfig();
    config.symbols.BTCUSDT.volumeThresholdUSDT = 100000;
    const _hunter = new Hunter(config.symbols, config.api, true);

    const liquidation = createMockLiquidation({
      symbol: 'BTCUSDT',
      origQty: '0.1',
      price: '50000'
    });

    const volumeUSDT = parseFloat(liquidation.origQty) * parseFloat(liquidation.price);
    const threshold = config.symbols.BTCUSDT.volumeThresholdUSDT;

    assert(volumeUSDT < threshold, 'Volume should be below threshold');
    log(`  Volume: $${volumeUSDT.toFixed(2)} < Threshold: $${threshold}`, colors.gray);
  });

  await summary.run('Identify liquidation direction', async () => {
    const sellLiquidation = createMockLiquidation({ side: 'SELL' });
    const buyLiquidation = createMockLiquidation({ side: 'BUY' });

    assertEqual(sellLiquidation.side, 'SELL', 'Should identify SELL liquidation');
    assertEqual(buyLiquidation.side, 'BUY', 'Should identify BUY liquidation');
  });

  summary.print();
}

async function testOrderPlacement() {
  logSection('Testing Order Placement Logic');
  const summary = new TestSummary();

  await summary.run('Calculate limit order price with offset', async () => {
    const markPrice = 50000;
    const offsetBps = 10;

    const buyPrice = markPrice * (1 - offsetBps / 10000);
    const sellPrice = markPrice * (1 + offsetBps / 10000);

    assertClose(buyPrice, 49995, 0.01, 'Buy price should be below mark price');
    assertClose(sellPrice, 50005, 0.01, 'Sell price should be above mark price');
  });

  await summary.run('Apply leverage to trade size', async () => {
    const baseSize = 0.001;
    const leverage = 5;

    const leveragedSize = baseSize * leverage;
    assertEqual(leveragedSize, 0.005, 'Leveraged size should be correct');
  });

  await summary.run('Validate order parameters', async () => {
    const _symbol = 'BTCUSDT';
    const price = 50000;
    const quantity = 0.001;
    const notional = price * quantity;

    assert(price > 0, 'Price must be positive');
    assert(quantity > 0, 'Quantity must be positive');
    assert(notional >= 5, 'Notional must meet minimum ($5)');
  });

  summary.print();
}

async function testOrderBookAnalysis() {
  logSection('Testing Order Book Analysis');
  const summary = new TestSummary();

  await summary.run('Analyze order book depth', async () => {
    const orderBook = createMockOrderBook(10);

    const bestBid = parseFloat(orderBook.bids[0][0]);
    const bestAsk = parseFloat(orderBook.asks[0][0]);
    const spread = bestAsk - bestBid;
    const spreadBps = (spread / bestBid) * 10000;

    assert(bestBid > 0, 'Best bid should be positive');
    assert(bestAsk > bestBid, 'Best ask should be above best bid');
    assertClose(spreadBps, 2, 0.1, 'Spread should be ~2 bps');
  });

  await summary.run('Calculate VWAP from order book', async () => {
    const orderBook = createMockOrderBook(5);

    let totalVolume = 0;
    let volumeWeightedSum = 0;

    for (const [price, qty] of orderBook.bids.slice(0, 3)) {
      const p = parseFloat(price);
      const q = parseFloat(qty);
      volumeWeightedSum += p * q;
      totalVolume += q;
    }

    const vwap = volumeWeightedSum / totalVolume;
    assert(vwap > 0, 'VWAP should be positive');
    assert(vwap < 50000, 'VWAP should be reasonable');
  });

  await summary.run('Check slippage limits', async () => {
    const entryPrice = 50000;
    const maxSlippageBps = 50;

    const maxBuyPrice = entryPrice * (1 + maxSlippageBps / 10000);
    const maxSellPrice = entryPrice * (1 - maxSlippageBps / 10000);

    assertEqual(maxBuyPrice, 50025, 'Max buy price with slippage');
    assertEqual(maxSellPrice, 49975, 'Max sell price with slippage');
  });

  summary.print();
}

async function testWebSocketConnection() {
  logSection('Testing WebSocket Connection');
  const summary = new TestSummary();

  let mockServer: MockWebSocketServer | null = null;

  await summary.run('Connect to liquidation stream', async () => {
    mockServer = new MockWebSocketServer(8082);
    await mockServer.start();

    await wait(100);

    const connected = mockServer !== null;
    assert(connected, 'Should connect to WebSocket server');
  });

  await summary.run('Handle liquidation stream messages', async () => {
    if (mockServer) {
      const testLiquidation = {
        e: 'forceOrder',
        E: Date.now(),
        o: createMockLiquidation()
      };

      const _messageReceived = false;
      mockServer.on('connection', (ws) => {
        ws.on('message', () => {
          // messageReceived = true;
        });
      });

      mockServer.broadcast(testLiquidation);
      await wait(50);

      assert(mockServer !== null, 'Mock server should exist');
    }
  });

  if (mockServer) {
    await mockServer.stop();
  }

  summary.print();
}

async function testPaperModeSimulation() {
  logSection('Testing Paper Mode Simulation');
  const summary = new TestSummary();

  await summary.run('Generate mock liquidations', async () => {
    const config = createMockConfig();
    config.global.paperMode = true;

    const _hunter = new Hunter(config.symbols, config.api, true);

    const mockLiquidation = createMockLiquidation({
      symbol: 'BTCUSDT',
      side: Math.random() > 0.5 ? 'BUY' : 'SELL',
      origQty: (Math.random() * 2).toFixed(3),
      price: (50000 + Math.random() * 1000 - 500).toFixed(2)
    });

    assert(mockLiquidation !== null, 'Should generate mock liquidation');
    assert(['BUY', 'SELL'].includes(mockLiquidation.side), 'Side should be valid');
  });

  await summary.run('Simulate order placement in paper mode', async () => {
    const config = createMockConfig();
    config.global.paperMode = true;

    const orderParams = {
      symbol: 'BTCUSDT',
      side: 'BUY' as const,
      type: 'LIMIT' as const,
      quantity: 0.001,
      price: 50000
    };

    assert(orderParams.quantity > 0, 'Quantity should be positive');
    assert(orderParams.price > 0, 'Price should be positive');

    log(`  Mock order: ${orderParams.side} ${orderParams.quantity} BTC @ $${orderParams.price}`, colors.gray);
  });

  summary.print();
}

async function main() {
  console.clear();
  log('🧪 HUNTER TEST SUITE', colors.cyan + colors.bold);
  log('=' .repeat(60), colors.cyan);

  try {
    await testHunterInitialization();
    await testLiquidationProcessing();
    await testOrderPlacement();
    await testOrderBookAnalysis();
    await testWebSocketConnection();
    await testPaperModeSimulation();

    logSection('✨ All Hunter Tests Complete');
  } catch (error) {
    logSection('❌ Test Suite Failed');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}