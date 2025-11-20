/**
 * Multi-Tranche Position Management - Integration Tests
 *
 * Comprehensive automated tests for all integration points:
 * - Hunter integration (entry logic)
 * - PositionManager integration (exit logic)
 * - Exchange synchronization
 * - WebSocket broadcasting
 * - Full lifecycle scenarios
 */

import { EventEmitter } from 'events';
import { initTrancheTables, createTranche, getTranche, getActiveTranches, getAllTranchesForSymbol, closeTranche as dbCloseTranche } from '../src/lib/db/trancheDb';
import { initializeTrancheManager, getTrancheManager } from '../src/lib/services/trancheManager';
import { Config } from '../src/lib/types';
import { db } from '../src/lib/db/database';

const TEST_SYMBOL = 'BTCUSDT';
const TEST_ENTRY_PRICE = 50000;
const TEST_QUANTITY = 0.001;
const TEST_MARGIN = 5;
const TEST_LEVERAGE = 10;

// Test configuration
const testConfig: Config = {
  api: {
    apiKey: 'test-key',
    secretKey: 'test-secret',
  },
  symbols: {
    [TEST_SYMBOL]: {
      longVolumeThresholdUSDT: 10000,
      shortVolumeThresholdUSDT: 10000,
      tradeSize: 0.001,
      maxPositionMarginUSDT: 200,
      leverage: TEST_LEVERAGE,
      tpPercent: 5,
      slPercent: 2,
      priceOffsetBps: 2,
      maxSlippageBps: 50,
      orderType: 'LIMIT',
      postOnly: false,
      forceMarketOrders: false,
      vwapProtection: false,
      vwapTimeframe: '5m',
      vwapLookback: 200,
      useThreshold: false,
      thresholdTimeWindow: 60000,
      thresholdCooldown: 30000,
      enableTrancheManagement: true,
      trancheIsolationThreshold: 5,
      maxTranches: 3,
      maxIsolatedTranches: 2,
      trancheStrategy: {
        closingStrategy: 'FIFO',
        slTpStrategy: 'NEWEST',
        isolationAction: 'HOLD',
      },
      allowTrancheWhileIsolated: true,
      trancheAutoCloseIsolated: false,
    },
  },
  global: {
    paperMode: true,
    riskPercent: 90,
    positionMode: 'HEDGE',
    maxOpenPositions: 5,
    useThresholdSystem: false,
    server: {
      dashboardPassword: 'test',
      dashboardPort: 3000,
      websocketPort: 8080,
      useRemoteWebSocket: false,
      websocketHost: null,
    },
    rateLimit: {
      maxRequestWeight: 2400,
      maxOrderCount: 1200,
      reservePercent: 30,
      enableBatching: true,
      queueTimeout: 30000,
      enableDeduplication: true,
      deduplicationWindowMs: 1000,
      parallelProcessing: true,
      maxConcurrentRequests: 3,
    },
  },
  version: '1.1.0',
};

// Mock StatusBroadcaster for testing
class MockStatusBroadcaster extends EventEmitter {
  public broadcastedEvents: any[] = [];

  broadcastTrancheCreated(data: any) {
    this.broadcastedEvents.push({ type: 'tranche_created', data });
    this.emit('tranche_created', data);
  }

  broadcastTrancheIsolated(data: any) {
    this.broadcastedEvents.push({ type: 'tranche_isolated', data });
    this.emit('tranche_isolated', data);
  }

  broadcastTrancheClosed(data: any) {
    this.broadcastedEvents.push({ type: 'tranche_closed', data });
    this.emit('tranche_closed', data);
  }

  broadcastTrancheSyncUpdate(data: any) {
    this.broadcastedEvents.push({ type: 'tranche_sync', data });
    this.emit('tranche_sync', data);
  }

  broadcastTradingError(title: string, message: string, details?: any) {
    this.broadcastedEvents.push({ type: 'trading_error', title, message, details });
    this.emit('trading_error', { title, message, details });
  }

  clearEvents() {
    this.broadcastedEvents = [];
  }

  getEventsByType(type: string) {
    return this.broadcastedEvents.filter(e => e.type === type);
  }
}

// Helper to clean up test data
async function cleanupTestData() {
  // Delete events first (foreign key constraint)
  await db.run(`
    DELETE FROM tranche_events
    WHERE tranche_id IN (SELECT id FROM tranches WHERE symbol = ?)
  `, [TEST_SYMBOL]);

  // Then delete tranches
  await db.run('DELETE FROM tranches WHERE symbol = ?', [TEST_SYMBOL]);
}

async function runIntegrationTests() {
  console.log('🧪 Multi-Tranche Integration Tests\n');
  console.log('═══════════════════════════════════════\n');

  let testsPassed = 0;
  let testsFailed = 0;

  // Initialize database
  await db.initialize();
  await initTrancheTables();

  // Test Suite 1: Hunter Integration Tests
  console.log('📋 Test Suite 1: Hunter Integration\n');

  // Test 1.1: Pre-trade tranche limit check
  console.log('Test 1.1: Pre-trade Tranche Limit Check');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Create max tranches (3)
    for (let i = 0; i < 3; i++) {
      await trancheManager.createTranche({
        symbol: TEST_SYMBOL,
        side: 'BUY',
        positionSide: 'LONG',
        entryPrice: TEST_ENTRY_PRICE + i * 100,
        quantity: TEST_QUANTITY,
        marginUsed: TEST_MARGIN,
        leverage: TEST_LEVERAGE,
        orderId: `test-hunter-${i}`,
      });
    }

    // Verify we have 3 active tranches
    const activeTranches = await getActiveTranches(TEST_SYMBOL, 'LONG');
    const activeCount = activeTranches.filter(t => !t.isolated).length;

    // Verify limit is reached
    const canOpen = trancheManager.canOpenNewTranche(TEST_SYMBOL, 'LONG');

    if (activeCount === 3 && !canOpen.allowed && (canOpen.reason?.includes('maxTranches') || canOpen.reason?.includes('Max active tranches'))) {
      console.log('✅ Pre-trade limit check blocks new trades correctly');
      console.log(`   Active tranches: ${activeCount}/3`);
      console.log(`   Can open new: ${canOpen.allowed} ✓\n`);
      testsPassed++;
    } else {
      throw new Error(`Limit check failed: activeCount=${activeCount}, canOpen=${canOpen.allowed}, reason=${canOpen.reason}`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test 1.2: Post-order tranche creation
  console.log('Test 1.2: Post-order Tranche Creation');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    const tranchesBefore = await getActiveTranches(TEST_SYMBOL, 'LONG');
    const countBefore = tranchesBefore.length;

    // Simulate Hunter creating tranche after order filled
    await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: TEST_ENTRY_PRICE,
      quantity: TEST_QUANTITY,
      marginUsed: TEST_MARGIN,
      leverage: TEST_LEVERAGE,
      orderId: 'hunter-order-123',
    });

    const tranchesAfter = await getActiveTranches(TEST_SYMBOL, 'LONG');
    const countAfter = tranchesAfter.length;

    if (countAfter === countBefore + 1 && tranchesAfter[0].entryOrderId === 'hunter-order-123') {
      console.log('✅ Tranche created correctly after order fill\n');
      testsPassed++;
    } else {
      throw new Error('Tranche not created or order ID mismatch');
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test Suite 2: PositionManager Integration Tests
  console.log('═══════════════════════════════════════');
  console.log('📋 Test Suite 2: PositionManager Integration\n');

  // Test 2.1: Tranche closing on SL/TP fill (FIFO strategy)
  console.log('Test 2.1: Tranche Closing with FIFO Strategy');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Create 3 tranches at different entry prices
    const tranche1 = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50000,
      quantity: 0.001,
      marginUsed: 5,
      leverage: 10,
      orderId: 'order-1',
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const tranche2 = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50100,
      quantity: 0.001,
      marginUsed: 5,
      leverage: 10,
      orderId: 'order-2',
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const tranche3 = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50200,
      quantity: 0.001,
      marginUsed: 5,
      leverage: 10,
      orderId: 'order-3',
    });

    // Simulate position manager closing order (SELL = closing LONG)
    await trancheManager.processOrderFill({
      symbol: TEST_SYMBOL,
      side: 'SELL',
      positionSide: 'LONG',
      quantityFilled: 0.001,
      fillPrice: 52000,
      realizedPnl: 2.0,
      orderId: 'close-order-1',
    });

    // Verify FIFO: First tranche should be closed
    const tranche1After = await getTranche(tranche1.id);
    const tranche2After = await getTranche(tranche2.id);

    if (tranche1After?.status === 'closed' && tranche2After?.status === 'active') {
      console.log('✅ FIFO closing strategy works correctly');
      console.log(`   Tranche 1 (oldest): closed ✓`);
      console.log(`   Tranche 2 (middle): active ✓\n`);
      testsPassed++;
    } else {
      throw new Error('FIFO strategy not working correctly');
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test 2.2: Partial position close
  console.log('Test 2.2: Partial Position Close');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Create tranche with 0.003 BTC
    await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50000,
      quantity: 0.003,
      marginUsed: 15,
      leverage: 10,
      orderId: 'large-order',
    });

    // Close only 0.001 BTC (partial)
    await trancheManager.processOrderFill({
      symbol: TEST_SYMBOL,
      side: 'SELL',
      positionSide: 'LONG',
      quantityFilled: 0.001,
      fillPrice: 52000,
      realizedPnl: 2.0,
      orderId: 'partial-close-1',
    });

    const tranches = await getActiveTranches(TEST_SYMBOL, 'LONG');
    const remainingQty = tranches.reduce((sum, t) => sum + t.quantity, 0);

    if (Math.abs(remainingQty - 0.002) < 0.0001) {
      console.log('✅ Partial close handled correctly');
      console.log(`   Original: 0.003 BTC, Closed: 0.001 BTC`);
      console.log(`   Remaining: ${remainingQty.toFixed(4)} BTC ✓\n`);
      testsPassed++;
    } else {
      throw new Error(`Partial close quantity mismatch: ${remainingQty}`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test Suite 3: Exchange Synchronization
  console.log('═══════════════════════════════════════');
  console.log('📋 Test Suite 3: Exchange Synchronization\n');

  // Test 3.1: Sync with matching quantities
  console.log('Test 3.1: Exchange Sync - Matching Quantities');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Create 2 tranches (total 0.002 BTC)
    await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50000,
      quantity: 0.001,
      marginUsed: 5,
      leverage: 10,
      orderId: 'sync-1',
    });

    await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50100,
      quantity: 0.001,
      marginUsed: 5,
      leverage: 10,
      orderId: 'sync-2',
    });

    // Simulate exchange position with matching quantity
    const mockExchangePosition = {
      symbol: TEST_SYMBOL,
      positionAmt: '0.002',
      entryPrice: '50050',
      markPrice: '50500',
      unRealizedProfit: '0.9',
      liquidationPrice: '45000',
      leverage: '10',
      marginType: 'cross',
      isolatedMargin: '0',
      isAutoAddMargin: 'false',
      positionSide: 'LONG',
      updateTime: Date.now(),
    };

    await trancheManager.syncWithExchange(TEST_SYMBOL, 'LONG', mockExchangePosition);

    const group = trancheManager.getTrancheGroup(TEST_SYMBOL, 'LONG');

    if (group && group.syncStatus === 'synced') {
      console.log('✅ Exchange sync successful with matching quantities');
      console.log(`   Local: ${group.totalQuantity.toFixed(4)} BTC`);
      console.log(`   Exchange: 0.002 BTC`);
      console.log(`   Status: ${group.syncStatus} ✓\n`);
      testsPassed++;
    } else {
      throw new Error(`Sync status incorrect: ${group?.syncStatus}`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test 3.2: Sync with quantity drift
  console.log('Test 3.2: Exchange Sync - Quantity Drift Detection');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Create tranches totaling 0.003 BTC
    for (let i = 0; i < 3; i++) {
      await trancheManager.createTranche({
        symbol: TEST_SYMBOL,
        side: 'BUY',
        positionSide: 'LONG',
        entryPrice: 50000 + i * 50,
        quantity: 0.001,
        marginUsed: 5,
        leverage: 10,
        orderId: `drift-${i}`,
      });
    }

    // Simulate exchange position with less quantity (drift)
    const mockExchangePosition = {
      symbol: TEST_SYMBOL,
      positionAmt: '0.002', // 0.001 less than local
      entryPrice: '50050',
      markPrice: '50500',
      unRealizedProfit: '0.9',
      liquidationPrice: '45000',
      leverage: '10',
      marginType: 'cross',
      isolatedMargin: '0',
      isAutoAddMargin: 'false',
      positionSide: 'LONG',
      updateTime: Date.now(),
    };

    await trancheManager.syncWithExchange(TEST_SYMBOL, 'LONG', mockExchangePosition);

    const group = trancheManager.getTrancheGroup(TEST_SYMBOL, 'LONG');

    if (group && group.syncStatus === 'drift') {
      console.log('✅ Quantity drift detected correctly');
      console.log(`   Local: ${group.totalQuantity.toFixed(4)} BTC`);
      console.log(`   Exchange: 0.002 BTC`);
      console.log(`   Status: ${group.syncStatus} ✓`);
      console.log(`   Drift: ${((group.totalQuantity - 0.002) * 100).toFixed(1)}%\n`);
      testsPassed++;
    } else {
      throw new Error(`Drift not detected: ${group?.syncStatus}`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test Suite 4: Isolation Logic
  console.log('═══════════════════════════════════════');
  console.log('📋 Test Suite 4: Isolation Logic\n');

  // Test 4.1: Isolation threshold detection
  console.log('Test 4.1: Isolation Threshold Detection');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    const tranche = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50000,
      quantity: 0.001,
      marginUsed: 5,
      leverage: 10,
      orderId: 'iso-test',
    });

    // Update P&L at 47500 (5% loss - at threshold)
    await trancheManager.updateUnrealizedPnl(TEST_SYMBOL, 47500);

    // Test shouldIsolateTranche logic
    const shouldIsolate5 = trancheManager.shouldIsolateTranche(tranche, 47500); // 5% loss
    const shouldIsolate4 = trancheManager.shouldIsolateTranche(tranche, 48000); // 4% loss

    if (shouldIsolate5 && !shouldIsolate4) {
      console.log('✅ Isolation threshold detection correct');
      console.log(`   Entry: $50000`);
      console.log(`   At $47500 (5% loss): Should isolate = ${shouldIsolate5} ✓`);
      console.log(`   At $48000 (4% loss): Should isolate = ${shouldIsolate4} ✓\n`);
      testsPassed++;
    } else {
      throw new Error(`Threshold detection failed: shouldIsolate5=${shouldIsolate5}, shouldIsolate4=${shouldIsolate4}`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test 4.2: Manual tranche isolation
  console.log('Test 4.2: Manual Tranche Isolation');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Create tranche
    const tranche1 = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50000,
      quantity: 0.001,
      marginUsed: 5,
      leverage: 10,
      orderId: 'iso-manual',
    });

    // Manually isolate tranche
    await trancheManager.isolateTranche(tranche1.id, 47500);

    // Verify isolation
    const tranche1After = await getTranche(tranche1.id);

    // Create new tranche (should be allowed if allowTrancheWhileIsolated)
    const canOpen = trancheManager.canOpenNewTranche(TEST_SYMBOL, 'LONG');

    if (canOpen.allowed && tranche1After?.isolated) {
      await trancheManager.createTranche({
        symbol: TEST_SYMBOL,
        side: 'BUY',
        positionSide: 'LONG',
        entryPrice: 48000,
        quantity: 0.001,
        marginUsed: 5,
        leverage: 10,
        orderId: 'new-after-iso',
      });

      const group = trancheManager.getTrancheGroup(TEST_SYMBOL, 'LONG');

      if (group && group.activeTranches.length === 1 && group.isolatedTranches.length === 1) {
        console.log('✅ New tranche created successfully with isolated tranche');
        console.log(`   Active tranches: ${group.activeTranches.length}`);
        console.log(`   Isolated tranches: ${group.isolatedTranches.length} ✓\n`);
        testsPassed++;
      } else {
        throw new Error(`Tranche counts incorrect: active=${group?.activeTranches.length}, isolated=${group?.isolatedTranches.length}`);
      }
    } else {
      throw new Error(`Cannot open new tranche: canOpen=${canOpen.allowed}, isolated=${tranche1After?.isolated}`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test Suite 5: Event Broadcasting
  console.log('═══════════════════════════════════════');
  console.log('📋 Test Suite 5: Event Broadcasting\n');

  // Test 5.1: Tranche lifecycle events
  console.log('Test 5.1: Tranche Lifecycle Events');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    let createdEvent = false;
    let isolatedEvent = false;
    let closedEvent = false;

    trancheManager.on('trancheCreated', () => { createdEvent = true; });
    trancheManager.on('trancheIsolated', () => { isolatedEvent = true; });
    trancheManager.on('trancheClosed', () => { closedEvent = true; });

    // Create tranche
    const tranche = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50000,
      quantity: 0.001,
      marginUsed: 5,
      leverage: 10,
      orderId: 'event-test',
    });

    // Isolate
    await trancheManager.updateUnrealizedPnl(TEST_SYMBOL, 47500);
    await trancheManager.isolateTranche(tranche.id, 47500);

    // Close
    await trancheManager.closeTranche({
      trancheId: tranche.id,
      exitPrice: 48000,
      realizedPnl: -2.0,
      orderId: 'close-event',
    });

    if (createdEvent && isolatedEvent && closedEvent) {
      console.log('✅ All lifecycle events emitted correctly');
      console.log(`   Created: ${createdEvent} ✓`);
      console.log(`   Isolated: ${isolatedEvent} ✓`);
      console.log(`   Closed: ${closedEvent} ✓\n`);
      testsPassed++;
    } else {
      throw new Error(`Events missing: created=${createdEvent}, isolated=${isolatedEvent}, closed=${closedEvent}`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test Suite 6: Full Lifecycle Scenarios
  console.log('═══════════════════════════════════════');
  console.log('📋 Test Suite 6: Full Lifecycle Scenarios\n');

  // Test 6.1: Profitable trade full lifecycle
  console.log('Test 6.1: Profitable Trade - Entry to Exit');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Entry
    const tranche = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: 50000,
      quantity: 0.001,
      marginUsed: 5,
      leverage: 10,
      orderId: 'profit-trade',
    });

    // Price moves up 5% (TP hit)
    const tpPrice = 52500;
    await trancheManager.processOrderFill({
      symbol: TEST_SYMBOL,
      side: 'SELL',
      positionSide: 'LONG',
      quantityFilled: 0.001,
      fillPrice: tpPrice,
      realizedPnl: 2.5,
      orderId: 'tp-fill',
    });

    const closedTranche = await getTranche(tranche.id);

    if (closedTranche?.status === 'closed' && closedTranche.realizedPnl > 0) {
      console.log('✅ Profitable trade lifecycle complete');
      console.log(`   Entry: $${closedTranche.entryPrice}`);
      console.log(`   Exit: $${closedTranche.exitPrice}`);
      console.log(`   P&L: $${closedTranche.realizedPnl.toFixed(2)} ✓\n`);
      testsPassed++;
    } else {
      throw new Error('Trade lifecycle incomplete or not profitable');
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Test 6.2: Multi-tranche P&L tracking
  console.log('Test 6.2: Multi-Tranche P&L Tracking');
  try {
    await cleanupTestData();
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Create 3 tranches at different prices
    const entries = [50000, 49500, 49000];
    const trancheIds = [];
    for (const entry of entries) {
      const t = await trancheManager.createTranche({
        symbol: TEST_SYMBOL,
        side: 'BUY',
        positionSide: 'LONG',
        entryPrice: entry,
        quantity: 0.001,
        marginUsed: 5,
        leverage: 10,
        orderId: `multi-${entry}`,
      });
      trancheIds.push(t.id);
    }

    // Update P&L at profitable price (51000)
    await trancheManager.updateUnrealizedPnl(TEST_SYMBOL, 51000);

    const group = trancheManager.getTrancheGroup(TEST_SYMBOL, 'LONG');
    const allProfitable = group?.tranches.every(t => t.unrealizedPnl > 0);
    const totalPnL = group?.totalUnrealizedPnl || 0;

    // All tranches should be profitable at 51000
    if (allProfitable && totalPnL > 0 && group.tranches.length === 3) {
      console.log('✅ Multi-tranche P&L tracking successful');
      console.log(`   Total tranches: ${group.tranches.length}`);
      console.log(`   All profitable: ${allProfitable} ✓`);
      console.log(`   Total unrealized P&L: $${totalPnL.toFixed(2)}\n`);
      testsPassed++;
    } else {
      throw new Error(`P&L tracking failed: allProfitable=${allProfitable}, totalPnL=${totalPnL}, count=${group?.tranches.length}`);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    testsFailed++;
  }

  // Summary
  console.log('═══════════════════════════════════════');
  console.log('📊 Integration Test Summary');
  console.log('═══════════════════════════════════════');
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);
  console.log('═══════════════════════════════════════\n');

  if (testsFailed === 0) {
    console.log('🎉 All integration tests passed!');
    console.log('✅ Hunter integration working');
    console.log('✅ PositionManager integration working');
    console.log('✅ Exchange synchronization working');
    console.log('✅ Isolation logic working');
    console.log('✅ Event broadcasting working');
    console.log('✅ Full lifecycle scenarios working\n');
  } else {
    console.log('⚠️  Some integration tests failed. Please review the errors above.\n');
  }

  // Cleanup
  await cleanupTestData();
  await db.close();

  process.exit(testsFailed > 0 ? 1 : 0);
}

// Run tests
runIntegrationTests().catch(error => {
  console.error('💥 Integration test suite crashed:', error);
  process.exit(1);
});
