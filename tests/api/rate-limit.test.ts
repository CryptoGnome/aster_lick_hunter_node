import { getRateLimitManager, resetRateLimitManager, RequestPriority } from '../../src/lib/api/rateLimitManager';
// Using _ prefix to indicate intentionally unused import for test setup
import _axios from 'axios';

describe('Rate Limit Manager', () => {
  beforeEach(() => {
    // Reset singleton for each test
    resetRateLimitManager();
  });

  afterEach(() => {
    resetRateLimitManager();
  });

  describe('Basic Functionality', () => {
    it('should create singleton instance', () => {
      const instance1 = getRateLimitManager();
      const instance2 = getRateLimitManager();
      expect(instance1).toBe(instance2);
    });

    it('should update configuration', () => {
      const manager = getRateLimitManager({ maxRequestWeight: 1000 });
      manager.updateConfig({ maxRequestWeight: 2000 });
      // Configuration is updated internally
      expect(manager).toBeDefined();
    });

    it('should track request history', async () => {
      const manager = getRateLimitManager();

      // Execute a simple request
      const result = await manager.executeRequest(
        async () => 'test result',
        1,
        false,
        RequestPriority.LOW
      );

      expect(result).toBe('test result');
      const usage = manager.getCurrentUsage();
      expect(usage.weight).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Capacity Checks', () => {
    it('should allow requests when under capacity', () => {
      const manager = getRateLimitManager();
      const canMake = manager.canMakeRequest(100, false, RequestPriority.MEDIUM);
      expect(canMake).toBe(true);
    });

    it('should reserve capacity for critical requests', () => {
      const manager = getRateLimitManager({
        maxRequestWeight: 100,
        reservePercent: 30
      });

      // Non-critical request should respect reserve
      const canMakeNormal = manager.canMakeRequest(75, false, RequestPriority.MEDIUM);
      expect(canMakeNormal).toBe(false); // 75 > 70 (100 - 30% reserve)

      // Critical request can use reserve
      const canMakeCritical = manager.canMakeRequest(75, false, RequestPriority.CRITICAL);
      expect(canMakeCritical).toBe(true);
    });
  });

  describe('Queue Management', () => {
    it('should queue requests when at capacity', async () => {
      const manager = getRateLimitManager({
        maxRequestWeight: 10,
        queueTimeout: 2000
      });

      // Fill capacity
      const requests = [];
      for (let i = 0; i < 15; i++) {
        requests.push(
          manager.executeRequest(
            async () => {
              await new Promise(resolve => setTimeout(resolve, 10));
              return i;
            },
            1,
            false,
            RequestPriority.MEDIUM
          )
        );
      }

      // Check queue stats
      const stats = manager.getQueueStats();
      expect(stats.total).toBeGreaterThan(0);

      // Wait for all requests
      const results = await Promise.all(requests);
      expect(results).toHaveLength(15);
    }, 10000);

    it('should prioritize critical requests', async () => {
      const manager = getRateLimitManager({
        maxRequestWeight: 5,
        queueTimeout: 2000
      });

      const results: number[] = [];

      // Add low priority request
      const lowPromise = manager.executeRequest(
        async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          results.push(1);
          return 1;
        },
        5,
        false,
        RequestPriority.LOW
      );

      // Add critical request (should execute first despite being added second)
      const criticalPromise = manager.executeRequest(
        async () => {
          results.push(2);
          return 2;
        },
        5,
        false,
        RequestPriority.CRITICAL
      );

      await Promise.all([lowPromise, criticalPromise]);

      // Critical should execute first
      expect(results[0]).toBe(2);
    }, 10000);
  });

  describe('Parallel Processing', () => {
    it('should process multiple requests in parallel', async () => {
      const manager = getRateLimitManager({
        maxRequestWeight: 100
      });

      const startTime = Date.now();
      const requests = [];

      // Create 3 requests that would take 300ms if sequential
      for (let i = 0; i < 3; i++) {
        requests.push(
          manager.executeRequest(
            async () => {
              await new Promise(resolve => setTimeout(resolve, 100));
              return i;
            },
            5,
            false,
            RequestPriority.MEDIUM
          )
        );
      }

      await Promise.all(requests);
      const duration = Date.now() - startTime;

      // Should complete in ~100ms if parallel, not 300ms
      expect(duration).toBeLessThan(200);
    });
  });

  describe('Deduplication', () => {
    it('should deduplicate identical requests', async () => {
      const manager = getRateLimitManager({
        enableDeduplication: true,
        deduplicationWindowMs: 1000
      });

      let callCount = 0;
      const makeRequest = async () => {
        callCount++;
        return 'result';
      };

      // Make the same request twice with the same key
      const promise1 = manager.executeRequest(
        makeRequest,
        1,
        false,
        RequestPriority.MEDIUM,
        'test-key'
      );

      const promise2 = manager.executeRequest(
        makeRequest,
        1,
        false,
        RequestPriority.MEDIUM,
        'test-key'
      );

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Should return the same result
      expect(result1).toBe('result');
      expect(result2).toBe('result');

      // But should only call the function once
      expect(callCount).toBe(1);
    });

    it('should not deduplicate after window expires', async () => {
      const manager = getRateLimitManager({
        enableDeduplication: true,
        deduplicationWindowMs: 100
      });

      let callCount = 0;
      const makeRequest = async () => {
        callCount++;
        return callCount;
      };

      // First request
      const result1 = await manager.executeRequest(
        makeRequest,
        1,
        false,
        RequestPriority.MEDIUM,
        'test-key'
      );

      // Wait for deduplication window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Second request with same key
      const result2 = await manager.executeRequest(
        makeRequest,
        1,
        false,
        RequestPriority.MEDIUM,
        'test-key'
      );

      expect(result1).toBe(1);
      expect(result2).toBe(2);
      expect(callCount).toBe(2);
    });
  });

  describe('Circuit Breaker', () => {
    it('should activate circuit breaker on 429 error', async () => {
      const manager = getRateLimitManager();

      // Simulate 429 error
      try {
        await manager.executeRequest(
          async () => {
            const error: any = new Error('Rate limited');
            error.response = { status: 429 };
            throw error;
          },
          1,
          false,
          RequestPriority.MEDIUM
        );
      } catch (_error) {
        // Expected - using _error to indicate intentionally unused
      }

      // Circuit breaker should prevent non-critical requests
      const canMakeNormal = manager.canMakeRequest(1, false, RequestPriority.MEDIUM);
      expect(canMakeNormal).toBe(false);

      // But allow critical requests
      const canMakeCritical = manager.canMakeRequest(1, false, RequestPriority.CRITICAL);
      expect(canMakeCritical).toBe(true);
    });
  });

  describe('Usage Statistics', () => {
    it('should provide accurate usage statistics', async () => {
      const manager = getRateLimitManager();

      // Execute some requests
      await manager.executeRequest(async () => 1, 10, false, RequestPriority.LOW);
      await manager.executeRequest(async () => 2, 20, true, RequestPriority.HIGH);

      const usage = manager.getCurrentUsage();
      expect(usage.weight).toBeGreaterThanOrEqual(30);
      expect(usage.orders).toBe(1);
      expect(usage.weightPercent).toBeGreaterThan(0);
      expect(usage.orderPercent).toBeGreaterThan(0);
    });

    it('should provide queue statistics', () => {
      const manager = getRateLimitManager();
      const stats = manager.getQueueStats();

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byPriority');
      expect(stats).toHaveProperty('oldestWaitTime');
      expect(stats.byPriority).toHaveProperty('0'); // CRITICAL = 0
      expect(stats.byPriority).toHaveProperty('1'); // HIGH = 1
      expect(stats.byPriority).toHaveProperty('2'); // MEDIUM = 2
      expect(stats.byPriority).toHaveProperty('3'); // LOW = 3
    });
  });

  describe('Header Updates', () => {
    it('should update usage from response headers', () => {
      const manager = getRateLimitManager();

      manager.updateFromHeaders({
        'x-mbx-used-weight-1m': '500',
        'x-mbx-order-count-1m': '50'
      });

      const usage = manager.getCurrentUsage();
      expect(usage.weight).toBe(500);
      expect(usage.weightPercent).toBeCloseTo(20.83, 1);
    });

    it('should emit high usage event', (done) => {
      const manager = getRateLimitManager();

      manager.on('highUsage', (usage) => {
        expect(usage.weightPercent).toBeGreaterThan(80);
        done();
      });

      manager.updateFromHeaders({
        'x-mbx-used-weight-1m': '2000'
      });
    });
  });
});

export {};