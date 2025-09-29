#!/usr/bin/env tsx

import { Hunter } from '../../src/lib/bot/hunter';
// import { PositionManager } from '../../src/lib/bot/positionManager';
import { EventEmitter } from 'events';
import {
  TestSummary,
  logSection,
  log,
  colors,
  createMockConfig,
  createMockLiquidation as _createMockLiquidation,
  assert,
  assertEqual,
  wait
} from '../utils/test-helpers';

// Mock PositionTracker for testing
class MockPositionTracker extends EventEmitter {
  private positions = new Map<string, any>();

  getUniquePositionCount(_isHedgeMode: boolean): number {
    return this.positions.size;
  }

  getMarginUsage(_symbol: string): number {
    return 0;
  }

  simulateOrderFilled(orderId: string, symbol: string) {
    this.emit('orderFilled', { orderId, symbol });
  }

  simulateOrderCancelled(orderId: string, symbol: string) {
    this.emit('orderCancelled', { orderId, symbol });
  }
}

async function testPendingOrderManagement() {
  logSection('Testing Pending Order Management');
  const summary = new TestSummary();

  await summary.run('Initialize Hunter with position tracker', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config, false);
    const tracker = new MockPositionTracker();

    hunter.setPositionTracker(tracker as any);
    assert(hunter !== null, 'Hunter should be initialized');
  });

  await summary.run('Check pending orders are tracked', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config, false);

    // Access private methods via any casting for testing
    const hunterAny = hunter as any;

    // Initially should have no pending orders
    assertEqual(hunterAny.getPendingOrderCount(), 0, 'Should start with no pending orders');

    // Add a pending order
    hunterAny.addPendingOrder('order123', 'BTCUSDT', 'BUY');
    assertEqual(hunterAny.getPendingOrderCount(), 1, 'Should have 1 pending order');

    // Check if symbol has pending order
    assert(hunterAny.hasPendingOrderForSymbol('BTCUSDT'), 'Should detect pending order for BTCUSDT');
    assert(!hunterAny.hasPendingOrderForSymbol('ETHUSDT'), 'Should not detect pending order for ETHUSDT');
  });

  await summary.run('Pending orders cleared on fill event', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config, false);
    const tracker = new MockPositionTracker();

    hunter.setPositionTracker(tracker as any);
    const hunterAny = hunter as any;

    // Add pending order
    hunterAny.addPendingOrder('order456', 'BTCUSDT', 'BUY');
    assertEqual(hunterAny.getPendingOrderCount(), 1, 'Should have pending order');

    // Simulate order filled event
    tracker.simulateOrderFilled('order456', 'BTCUSDT');
    await wait(10);

    assertEqual(hunterAny.getPendingOrderCount(), 0, 'Pending order should be cleared after fill');
    assert(!hunterAny.hasPendingOrderForSymbol('BTCUSDT'), 'Should not have pending order after fill');
  });

  await summary.run('Pending orders cleared on cancel event', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config, false);
    const tracker = new MockPositionTracker();

    hunter.setPositionTracker(tracker as any);
    const hunterAny = hunter as any;

    // Add pending order
    hunterAny.addPendingOrder('order789', 'ETHUSDT', 'SELL');
    assertEqual(hunterAny.getPendingOrderCount(), 1, 'Should have pending order');

    // Simulate order cancelled event
    tracker.simulateOrderCancelled('order789', 'ETHUSDT');
    await wait(10);

    assertEqual(hunterAny.getPendingOrderCount(), 0, 'Pending order should be cleared after cancel');
  });

  await summary.run('Stale pending orders are cleaned up', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config, false);
    const hunterAny = hunter as any;

    // Add a pending order with old timestamp
    const oldOrder = { symbol: 'BTCUSDT', side: 'BUY', timestamp: Date.now() - 6 * 60 * 1000 };
    hunterAny.pendingOrders.set('oldOrder', oldOrder);

    // Add a recent pending order
    hunterAny.addPendingOrder('newOrder', 'ETHUSDT', 'SELL');

    assertEqual(hunterAny.getPendingOrderCount(), 2, 'Should have 2 pending orders initially');

    // Clean stale orders
    hunterAny.cleanStalePendingOrders();

    assertEqual(hunterAny.getPendingOrderCount(), 1, 'Should have 1 pending order after cleanup');
    assert(!hunterAny.hasPendingOrderForSymbol('BTCUSDT'), 'Old order should be removed');
    assert(hunterAny.hasPendingOrderForSymbol('ETHUSDT'), 'New order should remain');
  });

  await summary.run('Multiple pending orders for different symbols', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config, false);
    const hunterAny = hunter as any;

    // Add pending orders for different symbols
    hunterAny.addPendingOrder('order1', 'BTCUSDT', 'BUY');
    hunterAny.addPendingOrder('order2', 'ETHUSDT', 'SELL');
    hunterAny.addPendingOrder('order3', 'SOLUSDT', 'BUY');

    assertEqual(hunterAny.getPendingOrderCount(), 3, 'Should have 3 pending orders');

    // Check each symbol
    assert(hunterAny.hasPendingOrderForSymbol('BTCUSDT'), 'Should have pending for BTCUSDT');
    assert(hunterAny.hasPendingOrderForSymbol('ETHUSDT'), 'Should have pending for ETHUSDT');
    assert(hunterAny.hasPendingOrderForSymbol('SOLUSDT'), 'Should have pending for SOLUSDT');
    assert(!hunterAny.hasPendingOrderForSymbol('ADAUSDT'), 'Should not have pending for ADAUSDT');
  });

  await summary.run('Pending orders block duplicate trades', async () => {
    const config = createMockConfig();
    config.global.paperMode = false; // Need non-paper mode for this test
    const hunter = new Hunter(config, false);
    const tracker = new MockPositionTracker();

    hunter.setPositionTracker(tracker as any);
    const hunterAny = hunter as any;

    // Add a pending order for BTCUSDT
    hunterAny.addPendingOrder('existingOrder', 'BTCUSDT', 'BUY');

    // Try to check if we can trade BTCUSDT
    const canTrade = !hunterAny.hasPendingOrderForSymbol('BTCUSDT');
    assert(!canTrade, 'Should not be able to trade with pending order');

    // Check another symbol
    const canTradeOther = !hunterAny.hasPendingOrderForSymbol('ETHUSDT');
    assert(canTradeOther, 'Should be able to trade other symbols');
  });

  await summary.run('Hedge mode pending order counting', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config, true); // Hedge mode
    const hunterAny = hunter as any;

    // Add orders for same symbol, different sides (hedge mode scenario)
    hunterAny.addPendingOrder('longOrder', 'BTCUSDT', 'BUY');
    hunterAny.addPendingOrder('shortOrder', 'BTCUSDT', 'SELL');

    // In hedge mode, same symbol counts as 1 position
    assertEqual(hunterAny.getPendingOrderCount(), 1, 'Hedge mode should count unique symbols');

    // Add another symbol
    hunterAny.addPendingOrder('otherOrder', 'ETHUSDT', 'BUY');
    assertEqual(hunterAny.getPendingOrderCount(), 2, 'Should count 2 unique symbols');
  });

  summary.print();
}

async function testPendingOrderErrorHandling() {
  logSection('Testing Pending Order Error Handling');
  const summary = new TestSummary();

  await summary.run('Check if orders are removed on placement failure', async () => {
    const config = createMockConfig();
    config.global.paperMode = false;
    const hunter = new Hunter(config, false);
    const hunterAny = hunter as any;

    // Simulate what happens in placeTrade when an order fails
    // First, an order is attempted and tracked
    const orderId = 'failedOrder123';
    hunterAny.addPendingOrder(orderId, 'BTCUSDT', 'BUY');
    assertEqual(hunterAny.getPendingOrderCount(), 1, 'Should track pending order');

    // Then if it fails, it should be removed (this is what we're testing for)
    // This simulates what SHOULD happen in the catch block
    hunterAny.removePendingOrder(orderId);
    assertEqual(hunterAny.getPendingOrderCount(), 0, 'Should remove pending order on failure');
  });

  await summary.run('Verify orderId string conversion', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config, false);
    const hunterAny = hunter as any;

    // Add order with numeric ID (as might come from API)
    const numericId = 12345;
    hunterAny.addPendingOrder(numericId.toString(), 'BTCUSDT', 'BUY');

    // Should be able to remove with string version
    hunterAny.removePendingOrder('12345');
    assertEqual(hunterAny.getPendingOrderCount(), 0, 'Should handle numeric ID conversion');
  });

  await summary.run('Test pending order state inspection', async () => {
    const config = createMockConfig();
    const hunter = new Hunter(config, false);
    const hunterAny = hunter as any;

    // Add multiple orders
    hunterAny.addPendingOrder('order1', 'BTCUSDT', 'BUY');
    hunterAny.addPendingOrder('order2', 'ETHUSDT', 'SELL');

    // Inspect the map directly
    const pendingMap = hunterAny.pendingOrders;
    assertEqual(pendingMap.size, 2, 'Map should have 2 entries');

    // Check specific order details
    const order1 = pendingMap.get('order1');
    assert(order1 !== undefined, 'Should find order1');
    assertEqual(order1.symbol, 'BTCUSDT', 'Order1 symbol should match');
    assertEqual(order1.side, 'BUY', 'Order1 side should match');
    assert(order1.timestamp > 0, 'Order1 should have timestamp');
  });

  summary.print();
}

async function testRealScenario() {
  logSection('Testing Real Scenario - Order Placement and Tracking');
  const summary = new TestSummary();

  await summary.run('Simulate complete order flow', async () => {
    const config = createMockConfig();
    config.global.paperMode = false;
    const hunter = new Hunter(config, false);
    const tracker = new MockPositionTracker();

    hunter.setPositionTracker(tracker as any);
    const hunterAny = hunter as any;

    // Step 1: Check initial state
    assertEqual(hunterAny.getPendingOrderCount(), 0, 'Should start with no pending orders');
    assert(!hunterAny.hasPendingOrderForSymbol('ASTERUSDT'), 'Should have no pending for ASTERUSDT');

    // Step 2: Simulate first trade attempt
    log('  Simulating first trade attempt...', colors.gray);
    hunterAny.addPendingOrder('order1', 'ASTERUSDT', 'SELL');
    assert(hunterAny.hasPendingOrderForSymbol('ASTERUSDT'), 'Should now have pending order');

    // Step 3: Second liquidation comes in - should be blocked
    log('  Checking if second trade would be blocked...', colors.gray);
    const canTradeAgain = !hunterAny.hasPendingOrderForSymbol('ASTERUSDT');
    assert(!canTradeAgain, 'Second trade should be blocked');

    // Step 4: Simulate order fill
    log('  Simulating order fill event...', colors.gray);
    tracker.simulateOrderFilled('order1', 'ASTERUSDT');
    await wait(10);

    // Step 5: Check if we can trade again
    const canTradeNow = !hunterAny.hasPendingOrderForSymbol('ASTERUSDT');
    assert(canTradeNow, 'Should be able to trade again after fill');
  });

  await summary.run('Test the exact ASTERUSDT scenario', async () => {
    const config = createMockConfig();
    config.global.paperMode = false;
    config.symbols['ASTERUSDT'] = {
      volumeThresholdUSDT: 1000,
      tradeSize: 10,
      leverage: 5,
      tpPercent: 5,
      slPercent: 2,
      priceOffsetBps: 2,
      maxSlippageBps: 50,
      orderType: 'LIMIT'
    };

    const hunter = new Hunter(config, false);
    const hunterAny = hunter as any;

    // Simulate what happens when a liquidation is detected
    log('  First liquidation: ASTERUSDT BUY 1129.68 USDT', colors.gray);

    // This would trigger a SELL order
    hunterAny.addPendingOrder('mockOrder1', 'ASTERUSDT', 'SELL');
    log('  Added pending SELL order for ASTERUSDT', colors.gray);

    // Now another liquidation comes in
    log('  Second liquidation detected...', colors.gray);

    // Check if it would be skipped
    if (hunterAny.hasPendingOrderForSymbol('ASTERUSDT')) {
      log('  ❌ Trade skipped - already have pending order for ASTERUSDT', colors.yellow);
    }

    assert(hunterAny.hasPendingOrderForSymbol('ASTERUSDT'), 'Should have pending order blocking trade');

    // The issue: If the order failed or wasn't filled, it stays pending forever
    log('  Pending orders never cleared without fill/cancel event!', colors.red);
  });

  summary.print();
}

async function main() {
  console.clear();
  log('🧪 HUNTER PENDING ORDERS TEST SUITE', colors.cyan + colors.bold);
  log('=' .repeat(60), colors.cyan);

  try {
    await testPendingOrderManagement();
    await testPendingOrderErrorHandling();
    await testRealScenario();

    logSection('✨ All Pending Order Tests Complete');

    log('\n📋 DIAGNOSIS:', colors.yellow + colors.bold);
    log('The issue is that pending orders are added when trades are placed,', colors.yellow);
    log('but are ONLY removed when PositionManager emits fill/cancel events.', colors.yellow);
    log('If orders fail during placement, they remain in pendingOrders forever!', colors.red);
    log('\nFIX NEEDED: Add removePendingOrder() in catch blocks of placeTrade()', colors.green);

  } catch (error) {
    logSection('❌ Test Suite Failed');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}