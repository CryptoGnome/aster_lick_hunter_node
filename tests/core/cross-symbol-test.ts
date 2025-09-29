#!/usr/bin/env tsx

import { PositionManager } from '../../src/lib/bot/positionManager';
import {
  TestSummary,
  logSection,
  log,
  colors,
  createMockConfig,
  assert,
  assertEqual,
  wait as _wait
} from '../utils/test-helpers';

// Create a testable version of PositionManager
class TestablePositionManager extends PositionManager {
  public currentPositions = new Map();
  public positionOrders = new Map();
  private mockPositions: any[] = [];
  private mockOrders: any[] = [];

  // Expose protected methods for testing
  public simulateAccountUpdate(positions: any[]): void {
    const event = {
      e: 'ACCOUNT_UPDATE',
      E: Date.now(),
      a: {
        P: positions.map(p => ({
          s: p.symbol,
          pa: p.positionAmt.toString(),
          ep: p.entryPrice || '0',
          mp: p.markPrice || '0',
          up: p.unRealizedProfit || '0',
          ps: p.positionSide || 'BOTH',
          mt: 'cross',
          iw: '0',
          iam: 'false'
        }))
      }
    };

    (this as any).handleAccountUpdate(event);
  }

  // Mock exchange data methods
  async getPositionsFromExchange(): Promise<any[]> {
    return this.mockPositions;
  }

  async getOpenOrdersFromExchange(): Promise<any[]> {
    return this.mockOrders;
  }

  setMockPositions(positions: any[]): void {
    this.mockPositions = positions;
  }

  setMockOrders(orders: any[]): void {
    this.mockOrders = orders;
  }

  async testSyncWithExchange(): Promise<void> {
    await (this as any).syncWithExchange();
  }
}

async function testCrossSymbolTPSLPreservation() {
  logSection('Testing Cross-Symbol TP/SL Preservation');
  const summary = new TestSummary();

  const config = createMockConfig();
  // Add multiple symbols to config
  config.symbols['ETHUSDT'] = { ...config.symbols['BTCUSDT'] };
  config.symbols['SOLUSDT'] = { ...config.symbols['BTCUSDT'] };

  const manager = new TestablePositionManager(config, false);

  await summary.run('Setup initial BTCUSDT position with TP/SL', async () => {
    // Set up BTCUSDT position
    manager.setMockPositions([
      {
        symbol: 'BTCUSDT',
        positionAmt: '0.01',
        entryPrice: '50000',
        markPrice: '50100',
        unRealizedProfit: '1.0',
        positionSide: 'BOTH'
      }
    ]);

    // Mock TP/SL orders for BTCUSDT
    manager.setMockOrders([
      {
        orderId: 1001,
        symbol: 'BTCUSDT',
        type: 'STOP_MARKET',
        side: 'SELL',
        origQty: '0.01',
        reduceOnly: true
      },
      {
        orderId: 1002,
        symbol: 'BTCUSDT',
        type: 'TAKE_PROFIT_MARKET',
        side: 'SELL',
        origQty: '0.01',
        reduceOnly: true
      }
    ]);

    await manager.testSyncWithExchange();

    // Verify BTCUSDT position and orders are tracked
    const btcKey = 'BTCUSDT_LONG_BOTH';
    assert(manager.currentPositions.has(btcKey), 'Should have BTCUSDT position');
    assert(manager.positionOrders.has(btcKey), 'Should have BTCUSDT orders tracked');

    const btcOrders = manager.positionOrders.get(btcKey);
    assertEqual(btcOrders?.slOrderId, 1001, 'Should track BTCUSDT SL order');
    assertEqual(btcOrders?.tpOrderId, 1002, 'Should track BTCUSDT TP order');

    log(`  BTCUSDT position established with SL=${btcOrders?.slOrderId}, TP=${btcOrders?.tpOrderId}`, colors.gray);
  });

  await summary.run('Add ETHUSDT position - BTCUSDT orders should remain', async () => {
    // Store BTCUSDT orders before adding new position
    const btcKey = 'BTCUSDT_LONG_BOTH';
    const btcOrdersBefore = { ...manager.positionOrders.get(btcKey) };

    // Now add ETHUSDT position while BTCUSDT still exists
    manager.setMockPositions([
      {
        symbol: 'BTCUSDT',
        positionAmt: '0.01',
        entryPrice: '50000',
        markPrice: '50100',
        unRealizedProfit: '1.0',
        positionSide: 'BOTH'
      },
      {
        symbol: 'ETHUSDT',
        positionAmt: '0.1',
        entryPrice: '3000',
        markPrice: '3010',
        unRealizedProfit: '1.0',
        positionSide: 'BOTH'
      }
    ]);

    // Add mock orders for ETHUSDT while keeping BTCUSDT orders
    manager.setMockOrders([
      {
        orderId: 1001,
        symbol: 'BTCUSDT',
        type: 'STOP_MARKET',
        side: 'SELL',
        origQty: '0.01',
        reduceOnly: true
      },
      {
        orderId: 1002,
        symbol: 'BTCUSDT',
        type: 'TAKE_PROFIT_MARKET',
        side: 'SELL',
        origQty: '0.01',
        reduceOnly: true
      },
      {
        orderId: 2001,
        symbol: 'ETHUSDT',
        type: 'STOP_MARKET',
        side: 'SELL',
        origQty: '0.1',
        reduceOnly: true
      },
      {
        orderId: 2002,
        symbol: 'ETHUSDT',
        type: 'TAKE_PROFIT_MARKET',
        side: 'SELL',
        origQty: '0.1',
        reduceOnly: true
      }
    ]);

    await manager.testSyncWithExchange();

    // Verify both positions exist
    assertEqual(manager.currentPositions.size, 2, 'Should have 2 positions');

    // Check BTCUSDT orders are preserved
    const btcOrdersAfter = manager.positionOrders.get(btcKey);
    assertEqual(btcOrdersAfter?.slOrderId, btcOrdersBefore.slOrderId, 'BTCUSDT SL order should be preserved');
    assertEqual(btcOrdersAfter?.tpOrderId, btcOrdersBefore.tpOrderId, 'BTCUSDT TP order should be preserved');

    // Check ETHUSDT has its own orders
    const ethKey = 'ETHUSDT_LONG_BOTH';
    const ethOrders = manager.positionOrders.get(ethKey);
    assert(ethOrders?.slOrderId === 2001, 'ETHUSDT should have its own SL order');
    assert(ethOrders?.tpOrderId === 2002, 'ETHUSDT should have its own TP order');

    log(`  BTCUSDT orders: SL=${btcOrdersAfter?.slOrderId}, TP=${btcOrdersAfter?.tpOrderId}`, colors.gray);
    log(`  ETHUSDT orders: SL=${ethOrders?.slOrderId}, TP=${ethOrders?.tpOrderId}`, colors.gray);
  });

  await summary.run('Simulate ACCOUNT_UPDATE with only new position', async () => {
    // This simulates what might happen when exchange sends partial update
    // Store current state
    const btcKey = 'BTCUSDT_LONG_BOTH';
    const btcOrdersBefore = { ...manager.positionOrders.get(btcKey) };

    // Simulate ACCOUNT_UPDATE that only includes the new position
    // This is the problematic scenario - exchange might only send changed positions
    manager.simulateAccountUpdate([
      {
        symbol: 'SOLUSDT',
        positionAmt: '1.0',
        entryPrice: '100',
        markPrice: '101',
        unRealizedProfit: '1.0',
        positionSide: 'BOTH'
      }
    ]);

    // Check if BTCUSDT orders were incorrectly deleted
    const btcOrdersAfter = manager.positionOrders.get(btcKey);

    if (!btcOrdersAfter || !btcOrdersAfter.slOrderId || !btcOrdersAfter.tpOrderId) {
      log(`  ❌ BUG CONFIRMED: BTCUSDT orders were cleared when SOLUSDT was added`, colors.red);
      log(`  Before: SL=${btcOrdersBefore.slOrderId}, TP=${btcOrdersBefore.tpOrderId}`, colors.gray);
      log(`  After: SL=${btcOrdersAfter?.slOrderId || 'DELETED'}, TP=${btcOrdersAfter?.tpOrderId || 'DELETED'}`, colors.gray);
      assert(false, 'BTCUSDT orders should not be deleted when adding SOLUSDT');
    } else {
      log(`  ✅ BTCUSDT orders preserved: SL=${btcOrdersAfter.slOrderId}, TP=${btcOrdersAfter.tpOrderId}`, colors.green);
    }
  });

  await summary.run('Test with all positions in ACCOUNT_UPDATE', async () => {
    // Reset state
    manager.currentPositions.clear();
    manager.positionOrders.clear();

    // Set up multiple positions
    manager.setMockPositions([
      { symbol: 'BTCUSDT', positionAmt: '0.01', entryPrice: '50000', positionSide: 'BOTH' },
      { symbol: 'ETHUSDT', positionAmt: '0.1', entryPrice: '3000', positionSide: 'BOTH' }
    ]);

    manager.setMockOrders([
      { orderId: 3001, symbol: 'BTCUSDT', type: 'STOP_MARKET', side: 'SELL', origQty: '0.01', reduceOnly: true },
      { orderId: 3002, symbol: 'BTCUSDT', type: 'TAKE_PROFIT_MARKET', side: 'SELL', origQty: '0.01', reduceOnly: true },
      { orderId: 4001, symbol: 'ETHUSDT', type: 'STOP_MARKET', side: 'SELL', origQty: '0.1', reduceOnly: true },
      { orderId: 4002, symbol: 'ETHUSDT', type: 'TAKE_PROFIT_MARKET', side: 'SELL', origQty: '0.1', reduceOnly: true }
    ]);

    await manager.testSyncWithExchange();

    // Simulate ACCOUNT_UPDATE with all positions
    manager.simulateAccountUpdate([
      { symbol: 'BTCUSDT', positionAmt: '0.01', entryPrice: '50000', positionSide: 'BOTH' },
      { symbol: 'ETHUSDT', positionAmt: '0.1', entryPrice: '3000', positionSide: 'BOTH' }
    ]);

    // Both should still have orders
    const btcOrders = manager.positionOrders.get('BTCUSDT_LONG_BOTH');
    const ethOrders = manager.positionOrders.get('ETHUSDT_LONG_BOTH');

    assert(btcOrders?.slOrderId === 3001, 'BTCUSDT should keep SL order');
    assert(btcOrders?.tpOrderId === 3002, 'BTCUSDT should keep TP order');
    assert(ethOrders?.slOrderId === 4001, 'ETHUSDT should keep SL order');
    assert(ethOrders?.tpOrderId === 4002, 'ETHUSDT should keep TP order');

    log(`  All orders preserved when full update received`, colors.green);
  });

  summary.print();
}

async function main() {
  log(colors.cyan + colors.bold + '🧪 CROSS-SYMBOL TP/SL TEST SUITE' + colors.reset);
  log(colors.cyan + '============================================================' + colors.reset);

  await testCrossSymbolTPSLPreservation();

  log(colors.cyan + '============================================================' + colors.reset);
  log(colors.cyan + colors.bold + '✨ Test Complete' + colors.reset);
  log(colors.cyan + '============================================================' + colors.reset);
}

// Run tests if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { testCrossSymbolTPSLPreservation };