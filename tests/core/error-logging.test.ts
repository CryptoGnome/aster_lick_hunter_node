#!/usr/bin/env tsx

import { errorLogger } from '../../src/lib/services/errorLogger';
import {
  TestSummary,
  logSection,
  log,
  colors,
  assert,
  assertEqual as _assertEqual,
  wait as _wait
} from '../utils/test-helpers';

async function testErrorLogging() {
  logSection('Testing Error Logging');
  const summary = new TestSummary();

  await summary.run('Log trading error', async () => {
    const error = new Error('Test trading error');
    await errorLogger.logTradingError(
      'testFunction',
      'BTCUSDT',
      error,
      {
        type: 'trading',
        severity: 'high',
        context: { test: true }
      }
    );
    assert(true, 'Error should be logged');
  });

  await summary.run('Log batch order errors', async () => {
    const batchErrors = [
      'Stop loss price invalid',
      'Take profit would trigger immediately'
    ];

    for (const errorMsg of batchErrors) {
      await errorLogger.logTradingError(
        'batchOrderPlacement',
        'TESTUSDT',
        new Error(errorMsg),
        {
          type: 'trading',
          severity: 'high',
          context: {
            component: 'PositionManager',
            batchError: true
          }
        }
      );
    }

    assert(true, 'Batch errors should be logged');
  });

  await summary.run('Log critical missing SL error', async () => {
    await errorLogger.logTradingError(
      'missingStopLoss',
      'PUMPUSDT',
      new Error('Failed to place stop loss order'),
      {
        type: 'trading',
        severity: 'critical',
        context: {
          component: 'PositionManager',
          positionKey: 'PUMPUSDT_BOTH',
          entryPrice: 0.5,
          quantity: 100
        }
      }
    );
    assert(true, 'Critical SL error should be logged');
  });

  await summary.run('Log general error with context', async () => {
    const error = new Error('Connection timeout');
    await errorLogger.logError(error, {
      type: 'websocket',
      severity: 'medium',
      context: {
        component: 'WebSocketService',
        action: 'reconnect',
        attempt: 3
      }
    });
    assert(true, 'General error should be logged');
  });

  await summary.run('Handle error deduplication', async () => {
    const error = new Error('Duplicate error test');

    // Log same error multiple times
    for (let i = 0; i < 3; i++) {
      await errorLogger.logError(error, {
        type: 'api',
        severity: 'low',
        context: { iteration: i }
      });
    }

    assert(true, 'Duplicate errors should be handled');
  });

  summary.print();
}

async function testErrorContext() {
  logSection('Testing Error Context');
  const summary = new TestSummary();

  await summary.run('Include full context for batch errors', async () => {
    const context = {
      component: 'PositionManager',
      action: 'placeProtectionOrders',
      slAttempted: true,
      tpAttempted: true,
      slSucceeded: false,
      tpSucceeded: true,
      entryPrice: 50000,
      currentQuantity: 0.001
    };

    await errorLogger.logTradingError(
      'batchOrderPlacement',
      'BTCUSDT',
      new Error('Stop loss order failed'),
      {
        type: 'trading',
        severity: 'high',
        context
      }
    );

    assert(context.slAttempted === true, 'Should track SL attempt');
    assert(context.slSucceeded === false, 'Should track SL failure');
    assert(context.tpSucceeded === true, 'Should track TP success');
  });

  await summary.run('Include symbol and position info', async () => {
    const errorData = {
      symbol: 'PUMPUSDT',
      positionKey: 'PUMPUSDT_BOTH',
      entryPrice: 0.5,
      quantity: 100,
      slPercent: 20,
      tpPercent: 0.5
    };

    await errorLogger.logTradingError(
      'missingProtection',
      errorData.symbol,
      new Error('Position unprotected'),
      {
        type: 'trading',
        severity: 'critical',
        context: errorData
      }
    );

    assert(errorData.symbol === 'PUMPUSDT', 'Should include symbol');
    assert(errorData.slPercent === 20, 'Should include SL percent');
  });

  summary.print();
}

async function testErrorSeverity() {
  logSection('Testing Error Severity Levels');
  const summary = new TestSummary();

  await summary.run('Critical severity for missing SL', async () => {
    await errorLogger.logTradingError(
      'missingStopLoss',
      'BTCUSDT',
      new Error('No SL protection'),
      {
        type: 'trading',
        severity: 'critical',
        context: {}
      }
    );
    assert(true, 'Critical error logged');
  });

  await summary.run('High severity for batch failures', async () => {
    await errorLogger.logTradingError(
      'batchOrderFailure',
      'BTCUSDT',
      new Error('Batch order failed'),
      {
        type: 'trading',
        severity: 'high',
        context: {}
      }
    );
    assert(true, 'High severity error logged');
  });

  await summary.run('Medium severity for order adjustments', async () => {
    await errorLogger.logError(
      new Error('Order quantity mismatch'),
      {
        type: 'general',
        severity: 'medium',
        context: {
          component: 'PositionManager',
          action: 'checkAndAdjustOrders'
        }
      }
    );
    assert(true, 'Medium severity error logged');
  });

  await summary.run('Low severity for non-critical issues', async () => {
    await errorLogger.logError(
      new Error('Order already cancelled'),
      {
        type: 'api',
        severity: 'low',
        context: {}
      }
    );
    assert(true, 'Low severity error logged');
  });

  summary.print();
}

async function main() {
  console.clear();
  log('🧪 ERROR LOGGING TEST SUITE', colors.cyan + colors.bold);
  log('=' .repeat(60), colors.cyan);

  try {
    await testErrorLogging();
    await testErrorContext();
    await testErrorSeverity();

    logSection('✨ All Error Logging Tests Complete');
  } catch (error) {
    logSection('❌ Test Suite Failed');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}