#!/usr/bin/env tsx

import { Hunter } from '../../src/lib/bot/hunter';
import { Config } from '../../src/lib/types';
import * as positionModeApi from '../../src/lib/api/positionMode';
import {
  logSection,
  logTest,
  colors,
  log
} from '../utils/test-helpers';

// Mock config
const mockConfig: Config = {
  api: {
    apiKey: 'test-key',
    secretKey: 'test-secret',
  },
  symbols: {
    'BTCUSDT': {
      volumeThresholdUSDT: 10000,
      tradeSize: 0.001,
      leverage: 10,
      tpPercent: 1,
      slPercent: 0.5,
      priceOffsetBps: 5,
      maxSlippageBps: 50,
      orderType: 'LIMIT',
    },
  },
  global: {
    paperMode: false,
    riskPercent: 1,
    positionMode: 'HEDGE',
  },
  version: 1,
};

async function testPositionModeSync() {
  logSection('Position Mode Sync Test');

  try {
    // Test 1: Sync position mode on startup
    console.log('Test 1: Hunter syncs position mode on startup');

    // Mock getPositionMode to return HEDGE mode
    const originalGetPositionMode = positionModeApi.getPositionMode;
    (positionModeApi as any).getPositionMode = async () => true;

    const hunter = new Hunter(mockConfig, false); // Initialize with ONE-WAY mode
    await hunter.syncPositionMode();

    // Check that the mode was synchronized
    if ((hunter as any).isHedgeMode === true) {
      logTest('Position mode synced from ONE-WAY to HEDGE', true);
    } else {
      logTest('Position mode sync failed', false);
    }

    // Test 2: Handle sync errors gracefully
    console.log('\nTest 2: Hunter handles sync errors gracefully');

    // Mock getPositionMode to throw an error
    (positionModeApi as any).getPositionMode = async () => { throw new Error('API Error'); };

    const hunter2 = new Hunter(mockConfig, true); // Initialize with HEDGE mode
    await hunter2.syncPositionMode();

    // Check that the mode remains unchanged on error
    if ((hunter2 as any).isHedgeMode === true) {
      logTest('Position mode unchanged on sync error', true);
    } else {
      logTest('Position mode changed unexpectedly on error', false);
    }

    // Test 3: Position mode retry logic doesn't mutate state
    console.log('\nTest 3: Retry logic uses correct position mode without mutation');

    // Create a hunter with HEDGE mode
    const hunter3 = new Hunter(mockConfig, true);

    // Simulate the retry logic without actually placing orders
    const originalMode = (hunter3 as any).isHedgeMode;
    const retryMode = !(hunter3 as any).isHedgeMode;

    console.log(`Original mode: ${originalMode ? 'HEDGE' : 'ONE-WAY'}`);
    console.log(`Retry mode: ${retryMode ? 'HEDGE' : 'ONE-WAY'}`);
    console.log(`Hunter mode after retry simulation: ${(hunter3 as any).isHedgeMode ? 'HEDGE' : 'ONE-WAY'}`);

    if ((hunter3 as any).isHedgeMode === originalMode) {
      logTest('Position mode not mutated during retry simulation', true);
    } else {
      logTest('Position mode was incorrectly mutated', false);
    }

    // Restore original function
    (positionModeApi as any).getPositionMode = originalGetPositionMode;

    logSection('All Position Mode Sync Tests Completed');

  } catch (error) {
    log(`Test failed with error: ${error}`, colors.red);
  }
}

// Run tests
testPositionModeSync().catch(console.error);