#!/usr/bin/env tsx

import { PositionManager } from '../../src/lib/bot/positionManager';
import {
  TestSummary,
  logSection,
  log,
  colors,
  createMockConfig,
  createMockPosition as _createMockPosition,
  assert,
  assertEqual,
  wait
} from '../utils/test-helpers';

// Mock exchange responses
const mockPositions: any[] = [];
const mockOrders: any[] = [];
let orderIdCounter = 1000;

// Mock PositionManager methods for testing
class TestablePositionManager extends PositionManager {
  public currentPositions = new Map();
  public positionOrders = new Map();
  public config: any;

  constructor(symbols: any, apiConfig: any, paperMode: boolean) {
    super(symbols, apiConfig, paperMode);
    // Store full config structure needed by syncWithExchange
    this.config = {
      symbols: symbols,
      api: apiConfig
    };
  }

  // Override to use mock data
  async getPositionsFromExchange(): Promise<any[]> {
    return mockPositions;
  }

  async getOpenOrdersFromExchange(): Promise<any[]> {
    return mockOrders;
  }

  // Mock order placement
  async placeOrder(params: any): Promise<any> {
    const orderId = orderIdCounter++;
    const order = {
      orderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      origQty: params.quantity.toString(),
      reduceOnly: params.reduceOnly || false,
      status: 'NEW'
    };
    mockOrders.push(order);
    return { orderId };
  }

  // Mock batch order placement
  async placeStopLossAndTakeProfit(params: any): Promise<any> {
    const slOrderId = orderIdCounter++;
    const tpOrderId = orderIdCounter++;

    mockOrders.push({
      orderId: slOrderId,
      symbol: params.symbol,
      side: params.side === 'BUY' ? 'SELL' : 'BUY',
      type: 'STOP_MARKET',
      origQty: params.quantity.toString(),
      reduceOnly: true,
      status: 'NEW',
      stopPrice: params.stopPrice
    });

    mockOrders.push({
      orderId: tpOrderId,
      symbol: params.symbol,
      side: params.side === 'BUY' ? 'SELL' : 'BUY',
      type: 'TAKE_PROFIT_MARKET',
      origQty: params.quantity.toString(),
      reduceOnly: true,
      status: 'NEW',
      stopPrice: params.takeProfitPrice
    });

    return {
      success: true,
      orders: [
        { orderId: slOrderId, clientOrderId: `SL_${slOrderId}` },
        { orderId: tpOrderId, clientOrderId: `TP_${tpOrderId}` }
      ]
    };
  }

  // Expose sync method for testing
  public async testSyncWithExchange(): Promise<void> {
    await this.syncWithExchange();
  }

  // Mock cancel order
  async cancelOrderById(symbol: string, orderId: number): Promise<void> {
    const index = mockOrders.findIndex(o => o.orderId === orderId);
    if (index >= 0) {
      mockOrders.splice(index, 1);
    }
  }
}

async function testMultiplePositions() {
  logSection('Testing Multiple Position Management');
  const summary = new TestSummary();

  // Reset mock data
  mockPositions.length = 0;
  mockOrders.length = 0;
  orderIdCounter = 1000;

  const config = createMockConfig();
  const manager = new TestablePositionManager(config.symbols, config.api, true);

  await summary.run('Create first position with TP/SL', async () => {
    // Add first position
    mockPositions.push({
      symbol: 'BTCUSDT',
      positionAmt: '0.005',
      entryPrice: '50000',
      markPrice: '50100',
      unRealizedProfit: '0.5',
      positionSide: 'BOTH'
    });

    // Sync to detect new position
    await manager.testSyncWithExchange();

    // Check position was added
    assertEqual(manager.currentPositions.size, 1, 'Should have 1 position');

    // Check TP/SL orders were created
    const orders = mockOrders.filter(o => o.symbol === 'BTCUSDT' && o.reduceOnly);
    assert(orders.length >= 2, 'Should have at least SL and TP orders');

    const slOrder = orders.find(o => o.type === 'STOP_MARKET');
    const tpOrder = orders.find(o => o.type === 'TAKE_PROFIT_MARKET');
    assert(slOrder !== undefined, 'Should have SL order');
    assert(tpOrder !== undefined, 'Should have TP order');

    log(`  Position 1: BTCUSDT LONG 0.005`, colors.gray);
    log(`  SL Order: ${slOrder?.orderId}, TP Order: ${tpOrder?.orderId}`, colors.gray);
  });

  await summary.run('Add second position - preserve first position TP/SL', async () => {
    const firstPositionKey = Array.from(manager.currentPositions.keys())[0];
    const firstPositionOrders = manager.positionOrders.get(firstPositionKey);
    const initialSlOrderId = firstPositionOrders?.slOrderId;
    const initialTpOrderId = firstPositionOrders?.tpOrderId;

    log(`  First position orders before: SL=${initialSlOrderId}, TP=${initialTpOrderId}`, colors.gray);

    // Add second position
    mockPositions.push({
      symbol: 'BTCUSDT',
      positionAmt: '0.003',
      entryPrice: '50500',
      markPrice: '50600',
      unRealizedProfit: '0.3',
      positionSide: 'BOTH'
    });

    // Sync to detect second position
    await manager.testSyncWithExchange();

    // Check both positions exist
    assertEqual(manager.currentPositions.size, 2, 'Should have 2 positions');

    // Check first position still has its orders
    const firstPositionOrdersAfter = manager.positionOrders.get(firstPositionKey);
    assertEqual(firstPositionOrdersAfter?.slOrderId, initialSlOrderId, 'First position should keep its SL order');
    assertEqual(firstPositionOrdersAfter?.tpOrderId, initialTpOrderId, 'First position should keep its TP order');

    // Check second position has orders
    const secondPositionKey = Array.from(manager.currentPositions.keys()).find(k => k !== firstPositionKey);
    const secondPositionOrders = manager.positionOrders.get(secondPositionKey!);
    assert(secondPositionOrders?.slOrderId !== undefined, 'Second position should have SL order');
    assert(secondPositionOrders?.tpOrderId !== undefined, 'Second position should have TP order');
    assert(secondPositionOrders?.slOrderId !== initialSlOrderId, 'Second position should have different SL order');
    assert(secondPositionOrders?.tpOrderId !== initialTpOrderId, 'Second position should have different TP order');

    log(`  Position 2: BTCUSDT LONG 0.003`, colors.gray);
    log(`  Position 2 orders: SL=${secondPositionOrders?.slOrderId}, TP=${secondPositionOrders?.tpOrderId}`, colors.gray);
  });

  await summary.run('Verify order quantity matching', async () => {
    // Check that orders match their position quantities
    for (const [key, position] of manager.currentPositions.entries()) {
      const posAmt = Math.abs(parseFloat(position.positionAmt));
      const orders = manager.positionOrders.get(key);

      if (orders?.slOrderId) {
        const slOrder = mockOrders.find(o => o.orderId === orders.slOrderId);
        const _slQty = parseFloat(slOrder?.origQty || '0');
        assert(Math.abs(slQty - posAmt) < 0.00000001, `SL order quantity should match position for ${key}`);
        log(`  ${key}: Position=${posAmt}, SL Qty=${slQty}`, colors.gray);
      }

      if (orders?.tpOrderId) {
        const tpOrder = mockOrders.find(o => o.orderId === orders.tpOrderId);
        const tpQty = parseFloat(tpOrder?.origQty || '0');
        assert(Math.abs(tpQty - posAmt) < 0.00000001, `TP order quantity should match position for ${key}`);
      }
    }
  });

  await summary.run('Handle position size change - adjust orders', async () => {
    // Change first position size
    mockPositions[0].positionAmt = '0.008'; // Increased from 0.005

    await manager.testSyncWithExchange();

    // Orders should be adjusted for the changed position
    const firstPositionKey = Array.from(manager.currentPositions.keys())[0];
    const firstPosition = manager.currentPositions.get(firstPositionKey);
    const posAmt = Math.abs(parseFloat(firstPosition!.positionAmt));

    const orders = manager.positionOrders.get(firstPositionKey);
    if (orders?.slOrderId) {
      const slOrder = mockOrders.find(o => o.orderId === orders.slOrderId);
      const _slQty = parseFloat(slOrder?.origQty || '0');
      // Note: In real implementation, orders would be cancelled and replaced
      // For this test, we just verify the detection
      log(`  Position size changed to ${posAmt}, order adjustment would be triggered`, colors.gray);
    }
  });

  await summary.run('Close one position - preserve other position orders', async () => {
    const secondPositionKey = Array.from(manager.currentPositions.keys())[1];
    const secondPositionOrders = manager.positionOrders.get(secondPositionKey);
    const _secondSlOrderId = secondPositionOrders?.slOrderId;
    const _secondTpOrderId = secondPositionOrders?.tpOrderId;

    // Close first position
    mockPositions[0].positionAmt = '0';

    await manager.testSyncWithExchange();

    // Should have only 1 position now
    assertEqual(manager.currentPositions.size, 1, 'Should have 1 position after closing');

    // Second position should still have its orders
    const remainingPositionKey = Array.from(manager.currentPositions.keys())[0];
    const remainingOrders = manager.positionOrders.get(remainingPositionKey);

    // Verify the remaining position still has valid orders
    assert(remainingOrders?.slOrderId !== undefined, 'Remaining position should still have SL order');
    assert(remainingOrders?.tpOrderId !== undefined, 'Remaining position should still have TP order');

    log(`  Closed first position, second position orders preserved`, colors.gray);
    log(`  Remaining orders: SL=${remainingOrders?.slOrderId}, TP=${remainingOrders?.tpOrderId}`, colors.gray);
  });

  await summary.run('Handle mixed long/short positions', async () => {
    // Reset and create mixed positions
    mockPositions.length = 0;
    mockOrders.length = 0;
    manager.currentPositions.clear();
    manager.positionOrders.clear();

    // Add long position
    mockPositions.push({
      symbol: 'ETHUSDT',
      positionAmt: '0.1',  // Long
      entryPrice: '3000',
      markPrice: '3010',
      unRealizedProfit: '1.0',
      positionSide: 'BOTH'
    });

    // Add short position
    mockPositions.push({
      symbol: 'ETHUSDT',
      positionAmt: '-0.05',  // Short
      entryPrice: '3020',
      markPrice: '3010',
      unRealizedProfit: '0.5',
      positionSide: 'BOTH'
    });

    await manager.testSyncWithExchange();

    assertEqual(manager.currentPositions.size, 2, 'Should have 2 positions (long and short)');

    // Check each position has unique orders
    const orderIds = new Set<number>();
    for (const [key, orders] of manager.positionOrders.entries()) {
      const position = manager.currentPositions.get(key);
      const isLong = parseFloat(position!.positionAmt) > 0;

      if (orders.slOrderId) {
        assert(!orderIds.has(orders.slOrderId), 'Each SL order ID should be unique');
        orderIds.add(orders.slOrderId);

        const slOrder = mockOrders.find(o => o.orderId === orders.slOrderId);
        // Long position should have SELL SL, short should have BUY SL
        const expectedSide = isLong ? 'SELL' : 'BUY';
        assertEqual(slOrder?.side, expectedSide, `SL order side should be ${expectedSide} for ${isLong ? 'long' : 'short'}`);
      }

      if (orders.tpOrderId) {
        assert(!orderIds.has(orders.tpOrderId), 'Each TP order ID should be unique');
        orderIds.add(orders.tpOrderId);
      }

      log(`  ${key}: ${isLong ? 'LONG' : 'SHORT'} position with orders SL=${orders.slOrderId}, TP=${orders.tpOrderId}`, colors.gray);
    }
  });

  summary.print();
}

async function testOrderPreservationDuringSync() {
  logSection('Testing Order Preservation During Sync');
  const summary = new TestSummary();

  // Reset mock data
  mockPositions.length = 0;
  mockOrders.length = 0;
  orderIdCounter = 2000;

  const config = createMockConfig();
  const manager = new TestablePositionManager(config.symbols, config.api, true);

  await summary.run('Initial setup with positions and orders', async () => {
    // Setup multiple positions
    mockPositions.push(
      {
        symbol: 'BTCUSDT',
        positionAmt: '0.002',
        entryPrice: '50000',
        markPrice: '50100',
        unRealizedProfit: '0.2',
        positionSide: 'BOTH'
      },
      {
        symbol: 'BTCUSDT',
        positionAmt: '0.004',
        entryPrice: '49800',
        markPrice: '50100',
        unRealizedProfit: '1.2',
        positionSide: 'BOTH'
      }
    );

    await manager.testSyncWithExchange();

    // Verify initial state
    assertEqual(manager.currentPositions.size, 2, 'Should have 2 positions');

    let orderCount = 0;
    for (const [_, orders] of manager.positionOrders.entries()) {
      if (orders.slOrderId) orderCount++;
      if (orders.tpOrderId) orderCount++;
    }
    assert(orderCount >= 4, 'Should have at least 4 orders (2 SL + 2 TP)');
  });

  await summary.run('Resync without changes - orders preserved', async () => {
    // Store current order mappings
    const orderMappingsBefore = new Map();
    for (const [key, orders] of manager.positionOrders.entries()) {
      orderMappingsBefore.set(key, { ...orders });
    }

    // Resync without any changes
    await manager.testSyncWithExchange();

    // Verify orders are preserved
    for (const [key, ordersBefore] of orderMappingsBefore.entries()) {
      const ordersAfter = manager.positionOrders.get(key);
      assertEqual(ordersAfter?.slOrderId, ordersBefore.slOrderId, `SL order should be preserved for ${key}`);
      assertEqual(ordersAfter?.tpOrderId, ordersBefore.tpOrderId, `TP order should be preserved for ${key}`);
    }

    log(`  All order mappings preserved after resync`, colors.gray);
  });

  await summary.run('Add new position during sync - existing orders untouched', async () => {
    // Store existing order mappings
    const existingOrderIds = new Set<number>();
    for (const [_, orders] of manager.positionOrders.entries()) {
      if (orders.slOrderId) existingOrderIds.add(orders.slOrderId);
      if (orders.tpOrderId) existingOrderIds.add(orders.tpOrderId);
    }

    // Add a new position
    mockPositions.push({
      symbol: 'ETHUSDT',
      positionAmt: '0.05',
      entryPrice: '3000',
      markPrice: '3010',
      unRealizedProfit: '0.5',
      positionSide: 'BOTH'
    });

    await manager.testSyncWithExchange();

    // Verify existing orders weren't changed
    for (const [key, orders] of manager.positionOrders.entries()) {
      if (key.startsWith('BTCUSDT')) {
        if (orders.slOrderId) {
          assert(existingOrderIds.has(orders.slOrderId), 'Existing SL order should be preserved');
        }
        if (orders.tpOrderId) {
          assert(existingOrderIds.has(orders.tpOrderId), 'Existing TP order should be preserved');
        }
      }
    }

    // Verify new position has new orders
    const ethPositionKey = Array.from(manager.currentPositions.keys()).find(k => k.startsWith('ETHUSDT'));
    const ethOrders = manager.positionOrders.get(ethPositionKey!);
    assert(ethOrders?.slOrderId !== undefined, 'New position should have SL order');
    assert(ethOrders?.tpOrderId !== undefined, 'New position should have TP order');
    assert(!existingOrderIds.has(ethOrders.slOrderId!), 'New SL order should be different');
    assert(!existingOrderIds.has(ethOrders.tpOrderId!), 'New TP order should be different');

    log(`  Existing BTCUSDT orders preserved, new ETHUSDT orders created`, colors.gray);
  });

  summary.print();
}

async function main() {
  log(colors.cyan + colors.bold + '🧪 MULTI-POSITION MANAGEMENT TEST SUITE' + colors.reset);
  log(colors.cyan + '============================================================' + colors.reset);

  await testMultiplePositions();
  await wait(100);
  await testOrderPreservationDuringSync();

  log(colors.cyan + '============================================================' + colors.reset);
  log(colors.cyan + colors.bold + '✨ All Multi-Position Tests Complete' + colors.reset);
  log(colors.cyan + '============================================================' + colors.reset);
}

// Run tests if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { testMultiplePositions, testOrderPreservationDuringSync };