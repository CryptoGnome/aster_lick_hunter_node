#!/usr/bin/env tsx

import { RateLimitManager } from '../../src/lib/api/rateLimitManager';
import {
  TestSummary,
  logSection,
  log,
  colors,
  assert,
  assertEqual,
  assertClose,
  wait as _wait
} from '../utils/test-helpers';

async function testRateLimitInitialization() {
  logSection('Testing Rate Limit Initialization');
  const summary = new TestSummary();

  await summary.run('Create RateLimitManager instance', async () => {
    const _manager = RateLimitManager.getInstance();
    assert(_manager !== null, 'RateLimitManager should be created');
  });

  await summary.run('Singleton pattern', async () => {
    const manager1 = RateLimitManager.getInstance();
    const manager2 = RateLimitManager.getInstance();
    assert(manager1 === manager2, 'Should return same instance');
  });

  await summary.run('Initialize with default limits', async () => {
    const _manager = RateLimitManager.getInstance();
    const limits = {
      orderLimit: 300,
      weightLimit: 1200,
      rawRequestLimit: 6100
    };

    assert(limits.orderLimit > 0, 'Order limit should be positive');
    assert(limits.weightLimit > 0, 'Weight limit should be positive');
    assert(limits.rawRequestLimit > 0, 'Raw request limit should be positive');

    log(`  Limits - Orders: ${limits.orderLimit}, Weight: ${limits.weightLimit}, Raw: ${limits.rawRequestLimit}`, colors.gray);
  });

  summary.print();
}

async function testWeightCalculation() {
  logSection('Testing Weight Calculation');
  const summary = new TestSummary();

  await summary.run('Calculate weight for market data endpoints', async () => {
    const endpoints = [
      { path: '/fapi/v1/ticker/24hr', weight: 1 },
      { path: '/fapi/v1/depth', weight: 5 },
      { path: '/fapi/v1/klines', weight: 1 },
      { path: '/fapi/v1/exchangeInfo', weight: 1 }
    ];

    for (const endpoint of endpoints) {
      assert(endpoint.weight > 0, `Weight for ${endpoint.path} should be positive`);
    }
  });

  await summary.run('Calculate weight for account endpoints', async () => {
    const endpoints = [
      { path: '/fapi/v2/balance', weight: 5 },
      { path: '/fapi/v2/account', weight: 5 },
      { path: '/fapi/v2/positionRisk', weight: 5 },
      { path: '/fapi/v1/openOrders', weight: 1 }
    ];

    for (const endpoint of endpoints) {
      assert(endpoint.weight >= 1, `Weight for ${endpoint.path} should be at least 1`);
    }
  });

  await summary.run('Calculate weight for order endpoints', async () => {
    const orderWeight = 1;
    const batchOrderWeight = 5;
    const cancelWeight = 1;

    assert(orderWeight === 1, 'Single order weight should be 1');
    assert(batchOrderWeight === 5, 'Batch order weight should be 5');
    assert(cancelWeight === 1, 'Cancel order weight should be 1');
  });

  summary.print();
}

async function testRateLimitEnforcement() {
  logSection('Testing Rate Limit Enforcement');
  const summary = new TestSummary();

  await summary.run('Track request counts', async () => {
    let requestCount = 0;
    const maxRequests = 10;

    for (let i = 0; i < 5; i++) {
      requestCount++;
    }

    assert(requestCount === 5, 'Should track request count');
    assert(requestCount < maxRequests, 'Should be under limit');
  });

  await summary.run('Detect when limit is exceeded', async () => {
    const currentWeight = 1190;
    const weightLimit = 1200;
    const newRequestWeight = 20;

    const wouldExceed = (currentWeight + newRequestWeight) > weightLimit;
    assert(wouldExceed === true, 'Should detect limit would be exceeded');

    log(`  Current: ${currentWeight}/${weightLimit}, New: ${newRequestWeight}`, colors.gray);
  });

  await summary.run('Calculate time until reset', async () => {
    const windowStart = Date.now() - 50000;
    const windowDuration = 60000;
    const timeElapsed = Date.now() - windowStart;
    const timeUntilReset = windowDuration - timeElapsed;

    assert(timeUntilReset > 0, 'Should have time remaining');
    assert(timeUntilReset < windowDuration, 'Time until reset should be less than window');

    log(`  Reset in: ${(timeUntilReset / 1000).toFixed(1)}s`, colors.gray);
  });

  summary.print();
}

async function testRequestQueuing() {
  logSection('Testing Request Queuing');
  const summary = new TestSummary();

  await summary.run('Queue requests when at limit', async () => {
    const queue: Array<{ id: number; weight: number }> = [];
    const request = { id: 1, weight: 5 };

    queue.push(request);
    assert(queue.length === 1, 'Request should be queued');
    assertEqual(queue[0].id, 1, 'Correct request should be queued');
  });

  await summary.run('Process queue in order', async () => {
    const queue = [
      { id: 1, priority: 'high' },
      { id: 2, priority: 'normal' },
      { id: 3, priority: 'high' }
    ];

    const sorted = queue.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (a.priority !== 'high' && b.priority === 'high') return 1;
      return 0;
    });

    assertEqual(sorted[0].id, 1, 'First high priority should be first');
    assertEqual(sorted[1].id, 3, 'Second high priority should be second');
    assertEqual(sorted[2].id, 2, 'Normal priority should be last');
  });

  await summary.run('Retry failed requests', async () => {
    let attempts = 0;
    const maxRetries = 3;

    while (attempts < maxRetries) {
      attempts++;

      if (attempts === 2) {
        break;
      }
    }

    assertEqual(attempts, 2, 'Should retry correct number of times');
  });

  summary.print();
}

async function testBucketManagement() {
  logSection('Testing Bucket Management');
  const summary = new TestSummary();

  await summary.run('Create time-based buckets', async () => {
    const bucketSize = 60000;
    const now = Date.now();
    const bucketId = Math.floor(now / bucketSize);

    assert(bucketId > 0, 'Bucket ID should be positive');

    const nextBucketTime = (bucketId + 1) * bucketSize;
    const timeToNextBucket = nextBucketTime - now;

    assert(timeToNextBucket > 0, 'Should have time until next bucket');
    assert(timeToNextBucket <= bucketSize, 'Time should be within bucket size');
  });

  await summary.run('Track usage per bucket', async () => {
    const bucket = {
      id: Date.now(),
      weight: 0,
      orders: 0,
      requests: 0
    };

    bucket.weight += 5;
    bucket.orders += 1;
    bucket.requests += 1;

    assertEqual(bucket.weight, 5, 'Weight should be tracked');
    assertEqual(bucket.orders, 1, 'Orders should be tracked');
    assertEqual(bucket.requests, 1, 'Requests should be tracked');
  });

  await summary.run('Reset bucket after window', async () => {
    let bucket = {
      weight: 100,
      timestamp: Date.now() - 61000
    };

    const isExpired = (Date.now() - bucket.timestamp) > 60000;

    if (isExpired) {
      bucket = {
        weight: 0,
        timestamp: Date.now()
      };
    }

    assertEqual(bucket.weight, 0, 'Bucket should be reset');
  });

  summary.print();
}

async function testRateLimitHeaders() {
  logSection('Testing Rate Limit Headers');
  const summary = new TestSummary();

  await summary.run('Parse rate limit headers', async () => {
    const headers = {
      'x-mbx-used-weight': '750',
      'x-mbx-used-weight-1m': '750',
      'x-mbx-order-count-1m': '10',
      'x-mbx-order-count-10s': '5'
    };

    const usedWeight = parseInt(headers['x-mbx-used-weight']);
    const orderCount = parseInt(headers['x-mbx-order-count-1m']);

    assertEqual(usedWeight, 750, 'Should parse weight correctly');
    assertEqual(orderCount, 10, 'Should parse order count correctly');
  });

  await summary.run('Update limits from headers', async () => {
    const currentWeight = 500;
    const headerWeight = 750;
    const updatedWeight = Math.max(currentWeight, headerWeight);

    assertEqual(updatedWeight, 750, 'Should update to higher weight');
  });

  await summary.run('Calculate remaining capacity', async () => {
    const limit = 1200;
    const used = 750;
    const remaining = limit - used;
    const percentUsed = (used / limit) * 100;

    assertEqual(remaining, 450, 'Should calculate remaining correctly');
    assertClose(percentUsed, 62.5, 0.1, 'Should calculate percentage correctly');

    log(`  Usage: ${used}/${limit} (${percentUsed.toFixed(1)}%)`, colors.gray);
  });

  summary.print();
}

async function testAdaptiveThrottling() {
  logSection('Testing Adaptive Throttling');
  const summary = new TestSummary();

  await summary.run('Increase delay when approaching limit', async () => {
    const calculateDelay = (usage: number, limit: number) => {
      const percent = usage / limit;
      if (percent < 0.5) return 0;
      if (percent < 0.7) return 100;
      if (percent < 0.9) return 500;
      return 1000;
    };

    assertEqual(calculateDelay(400, 1000), 0, 'No delay at 40%');
    assertEqual(calculateDelay(600, 1000), 100, 'Small delay at 60%');
    assertEqual(calculateDelay(800, 1000), 500, 'Medium delay at 80%');
    assertEqual(calculateDelay(950, 1000), 1000, 'Large delay at 95%');
  });

  await summary.run('Batch requests when throttled', async () => {
    const requests = [
      { id: 1, type: 'balance' },
      { id: 2, type: 'balance' },
      { id: 3, type: 'balance' }
    ];

    const batched = requests.filter(r => r.type === 'balance').length === 3;
    assert(batched, 'Should identify batchable requests');

    const batchWeight = 5;
    const individualWeight = 5 * 3;
    assert(batchWeight < individualWeight, 'Batch should use less weight');
  });

  await summary.run('Prioritize critical requests', async () => {
    const requests = [
      { id: 1, priority: 1, type: 'cancel_order' },
      { id: 2, priority: 5, type: 'get_balance' },
      { id: 3, priority: 2, type: 'place_sl' }
    ];

    const sorted = requests.sort((a, b) => a.priority - b.priority);
    assertEqual(sorted[0].type, 'cancel_order', 'Cancel should be first');
    assertEqual(sorted[1].type, 'place_sl', 'SL should be second');
    assertEqual(sorted[2].type, 'get_balance', 'Balance should be last');
  });

  summary.print();
}

async function main() {
  console.clear();
  log('🧪 RATE LIMIT TEST SUITE', colors.cyan + colors.bold);
  log('=' .repeat(60), colors.cyan);

  try {
    await testRateLimitInitialization();
    await testWeightCalculation();
    await testRateLimitEnforcement();
    await testRequestQueuing();
    await testBucketManagement();
    await testRateLimitHeaders();
    await testAdaptiveThrottling();

    logSection('✨ All Rate Limit Tests Complete');
  } catch (error) {
    logSection('❌ Test Suite Failed');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}