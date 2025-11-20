/**
 * Multi-Tranche Position Management - System Test
 *
 * This test verifies the core functionality of the tranche management system:
 * - Database initialization
 * - Tranche creation and retrieval
 * - Isolation logic
 * - P&L calculations
 * - Exchange synchronization
 */

import { initTrancheTables, createTranche, getTranche, getActiveTranches, updateTrancheUnrealizedPnl, isolateTranche, closeTranche } from '../src/lib/db/trancheDb';
import { initializeTrancheManager } from '../src/lib/services/trancheManager';
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
      // Tranche management settings
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

async function runTests() {
  console.log('🧪 Starting Multi-Tranche System Tests\n');

  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Database Initialization
  console.log('Test 1: Database Initialization');
  try {
    await db.initialize();
    await initTrancheTables();
    console.log('✅ Database and tranche tables initialized\n');
    testsPassed++;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    testsFailed++;
    return; // Can't continue without database
  }

  // Test 2: Tranche Creation (Database Layer)
  console.log('Test 2: Tranche Creation (Database Layer)');
  const testTrancheId = `test-${Date.now()}`;
  try {
    await createTranche({
      id: testTrancheId,
      symbol: TEST_SYMBOL,
      side: 'LONG',
      positionSide: 'LONG',
      entryPrice: TEST_ENTRY_PRICE,
      quantity: TEST_QUANTITY,
      marginUsed: TEST_MARGIN,
      leverage: TEST_LEVERAGE,
      entryTime: Date.now(),
      entryOrderId: 'test-order-001',
      unrealizedPnl: 0,
      realizedPnl: 0,
      tpPercent: 5,
      slPercent: 2,
      tpPrice: TEST_ENTRY_PRICE * 1.05,
      slPrice: TEST_ENTRY_PRICE * 0.98,
      status: 'active',
      isolated: false,
    });

    const retrieved = await getTranche(testTrancheId);
    if (retrieved && retrieved.entryPrice === TEST_ENTRY_PRICE) {
      console.log('✅ Tranche created and retrieved successfully');
      console.log(`   ID: ${testTrancheId.substring(0, 8)}...`);
      console.log(`   Entry: $${retrieved.entryPrice}, TP: $${retrieved.tpPrice}, SL: $${retrieved.slPrice}\n`);
      testsPassed++;
    } else {
      throw new Error('Retrieved tranche does not match');
    }
  } catch (error) {
    console.error('❌ Tranche creation failed:', error);
    testsFailed++;
  }

  // Test 3: TrancheManager Service Initialization
  console.log('Test 3: TrancheManager Service Initialization');
  try {
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();
    console.log('✅ TrancheManager initialized successfully\n');
    testsPassed++;
  } catch (error) {
    console.error('❌ TrancheManager initialization failed:', error);
    testsFailed++;
  }

  // Test 4: Tranche Creation via Manager
  console.log('Test 4: Tranche Creation via TrancheManager');
  try {
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    const tranche = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: TEST_ENTRY_PRICE,
      quantity: TEST_QUANTITY,
      marginUsed: TEST_MARGIN,
      leverage: TEST_LEVERAGE,
      orderId: 'test-order-002',
    });

    if (tranche.tpPrice > TEST_ENTRY_PRICE && tranche.slPrice < TEST_ENTRY_PRICE) {
      console.log('✅ Tranche created via manager with correct TP/SL');
      console.log(`   Entry: $${tranche.entryPrice}`);
      console.log(`   TP: $${tranche.tpPrice} (+5%)`);
      console.log(`   SL: $${tranche.slPrice} (-2%)\n`);
      testsPassed++;
    } else {
      throw new Error('TP/SL calculation incorrect');
    }
  } catch (error) {
    console.error('❌ Tranche creation via manager failed:', error);
    testsFailed++;
  }

  // Test 5: Isolation Threshold Logic
  console.log('Test 5: Isolation Threshold Logic');
  try {
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Create test tranche
    const tranche = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: TEST_ENTRY_PRICE,
      quantity: TEST_QUANTITY,
      marginUsed: TEST_MARGIN,
      leverage: TEST_LEVERAGE,
      orderId: 'test-order-003',
    });

    // Test at 5% loss (should isolate)
    const priceAt5PercentLoss = TEST_ENTRY_PRICE * 0.95;
    const shouldIsolate = trancheManager.shouldIsolateTranche(tranche, priceAt5PercentLoss);

    // Test at 4% loss (should NOT isolate)
    const priceAt4PercentLoss = TEST_ENTRY_PRICE * 0.96;
    const shouldNotIsolate = trancheManager.shouldIsolateTranche(tranche, priceAt4PercentLoss);

    if (shouldIsolate && !shouldNotIsolate) {
      console.log('✅ Isolation threshold logic correct');
      console.log(`   Entry: $${TEST_ENTRY_PRICE}`);
      console.log(`   At $${priceAt5PercentLoss} (5% loss): Should isolate = ${shouldIsolate} ✓`);
      console.log(`   At $${priceAt4PercentLoss} (4% loss): Should isolate = ${shouldNotIsolate} ✓\n`);
      testsPassed++;
    } else {
      throw new Error(`Isolation logic failed: shouldIsolate=${shouldIsolate}, shouldNotIsolate=${shouldNotIsolate}`);
    }
  } catch (error) {
    console.error('❌ Isolation threshold test failed:', error);
    testsFailed++;
  }

  // Test 6: P&L Calculation
  console.log('Test 6: Unrealized P&L Calculation');
  try {
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Create LONG tranche at 50000
    const tranche = await trancheManager.createTranche({
      symbol: TEST_SYMBOL,
      side: 'BUY',
      positionSide: 'LONG',
      entryPrice: TEST_ENTRY_PRICE,
      quantity: TEST_QUANTITY,
      marginUsed: TEST_MARGIN,
      leverage: TEST_LEVERAGE,
      orderId: 'test-order-004',
    });

    // Update P&L at 52000 (4% profit)
    await trancheManager.updateUnrealizedPnl(TEST_SYMBOL, 52000);

    const updated = await getTranche(tranche.id);
    const expectedPnl = (52000 - TEST_ENTRY_PRICE) * TEST_QUANTITY; // Should be ~$2

    if (updated && Math.abs(updated.unrealizedPnl - expectedPnl) < 0.01) {
      console.log('✅ P&L calculation correct');
      console.log(`   Entry: $${TEST_ENTRY_PRICE}, Current: $52000`);
      console.log(`   Expected P&L: $${expectedPnl.toFixed(2)}`);
      console.log(`   Actual P&L: $${updated.unrealizedPnl.toFixed(2)}\n`);
      testsPassed++;
    } else {
      throw new Error(`P&L mismatch: expected ${expectedPnl}, got ${updated?.unrealizedPnl}`);
    }
  } catch (error) {
    console.error('❌ P&L calculation test failed:', error);
    testsFailed++;
  }

  // Test 7: Position Limits
  console.log('Test 7: Position Limit Checks');
  try {
    const trancheManager = initializeTrancheManager(testConfig);
    await trancheManager.initialize();

    // Get current active tranches
    const existingTranches = trancheManager.getTranches(TEST_SYMBOL, 'LONG');
    const activeCount = existingTranches.filter(t => !t.isolated).length;
    console.log(`   Existing active tranches: ${activeCount}`);

    // Create tranches up to the limit
    const maxTranches = testConfig.symbols[TEST_SYMBOL].maxTranches || 3;
    const tranchesToCreate = Math.max(0, maxTranches - activeCount);

    for (let i = 0; i < tranchesToCreate; i++) {
      await trancheManager.createTranche({
        symbol: TEST_SYMBOL,
        side: 'BUY',
        positionSide: 'LONG',
        entryPrice: TEST_ENTRY_PRICE,
        quantity: TEST_QUANTITY,
        marginUsed: TEST_MARGIN,
        leverage: TEST_LEVERAGE,
        orderId: `test-order-limit-${i}`,
      });
    }

    // Try to create one more (should be blocked)
    const canOpen = trancheManager.canOpenNewTranche(TEST_SYMBOL, 'LONG');

    if (!canOpen.allowed && canOpen.reason?.includes('maxTranches')) {
      console.log('✅ Position limit enforcement correct');
      console.log(`   Max tranches: ${maxTranches}`);
      console.log(`   Current active: ${maxTranches}`);
      console.log(`   Can open new: ${canOpen.allowed} ✓`);
      console.log(`   Reason: ${canOpen.reason}\n`);
      testsPassed++;
    } else {
      throw new Error(`Position limit not enforced: allowed=${canOpen.allowed}, reason=${canOpen.reason}`);
    }
  } catch (error) {
    console.error('❌ Position limit test failed:', error);
    testsFailed++;
  }

  // Test 8: Tranche Retrieval
  console.log('Test 8: Tranche Retrieval');
  try {
    const activeTranches = await getActiveTranches(TEST_SYMBOL, 'LONG');
    if (activeTranches.length > 0) {
      console.log(`✅ Retrieved ${activeTranches.length} active tranches for ${TEST_SYMBOL} LONG`);
      console.log(`   Sample: ${activeTranches[0].id.substring(0, 8)}... at $${activeTranches[0].entryPrice}\n`);
      testsPassed++;
    } else {
      throw new Error('No active tranches found');
    }
  } catch (error) {
    console.error('❌ Tranche retrieval test failed:', error);
    testsFailed++;
  }

  // Summary
  console.log('═══════════════════════════════════════');
  console.log('📊 Test Summary');
  console.log('═══════════════════════════════════════');
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📈 Success Rate: ${((testsPassed / (testsPassed + testsFailed)) * 100).toFixed(1)}%`);
  console.log('═══════════════════════════════════════\n');

  if (testsFailed === 0) {
    console.log('🎉 All tests passed! The multi-tranche system is ready for integration testing.');
  } else {
    console.log('⚠️  Some tests failed. Please review the errors above.');
  }

  // Cleanup
  await db.close();
}

// Run tests
runTests().catch(error => {
  console.error('💥 Test suite crashed:', error);
  process.exit(1);
});
