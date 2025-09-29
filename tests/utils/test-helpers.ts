import { Config } from '../../src/lib/bot/config';
import { LiquidationEvent, OrderBook, Position } from '../../src/lib/types';
import WebSocket from 'ws';
import { EventEmitter } from 'events';

export const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  bold: '\x1b[1m'
};

export function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

export function logSection(title: string) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.cyan + colors.bold);
  console.log('='.repeat(60));
}

export function logTest(name: string, passed: boolean, details?: string) {
  const symbol = passed ? '✅' : '❌';
  const color = passed ? colors.green : colors.red;
  log(`${symbol} ${name}`, color);
  if (details) {
    log(`   ${details}`, colors.gray);
  }
}

export class TestSummary {
  private tests: { name: string; passed: boolean; error?: string }[] = [];
  private startTime: number = Date.now();

  add(name: string, passed: boolean, error?: string) {
    this.tests.push({ name, passed, error });
    logTest(name, passed, error);
  }

  async run(name: string, testFn: () => Promise<void>): Promise<void> {
    try {
      await testFn();
      this.add(name, true);
    } catch (error) {
      this.add(name, false, error instanceof Error ? error.message : String(error));
    }
  }

  print() {
    const duration = Date.now() - this.startTime;
    const passed = this.tests.filter(t => t.passed).length;
    const failed = this.tests.filter(t => !t.passed).length;

    logSection('Test Summary');
    log(`Total: ${this.tests.length} | Passed: ${passed} | Failed: ${failed}`,
        failed > 0 ? colors.red : colors.green);
    log(`Duration: ${(duration / 1000).toFixed(2)}s`, colors.gray);

    if (failed > 0) {
      log('\nFailed tests:', colors.red);
      this.tests.filter(t => !t.passed).forEach(t => {
        log(`  - ${t.name}`, colors.red);
        if (t.error) log(`    ${t.error}`, colors.gray);
      });
    }
  }
}

export function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected} but got ${actual}`);
  }
}

export function assertClose(actual: number, expected: number, tolerance: number = 0.0001, message?: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(message || `Expected ${expected} (±${tolerance}) but got ${actual}`);
  }
}

export function createMockConfig(): Config {
  return {
    api: {
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key'
    },
    symbols: {
      'BTCUSDT': {
        volumeThresholdUSDT: 10000,
        tradeSize: 0.001,
        leverage: 5,
        tpPercent: 2,
        slPercent: 1,
        priceOffsetBps: 5,
        maxSlippageBps: 50,
        orderType: 'LIMIT'
      }
    },
    global: {
      paperMode: true,
      riskPercentage: 1,
      maxConcurrentPositions: 5,
      enableVwapFilter: true,
      minVolumeUSDT: 5000
    },
    version: '2.0'
  };
}

export function createMockLiquidation(overrides?: Partial<LiquidationEvent>): LiquidationEvent {
  return {
    symbol: 'BTCUSDT',
    side: 'SELL',
    orderType: 'LIMIT',
    timeInForce: 'IOC',
    origQty: '0.5',
    price: '50000',
    avgPrice: '50000',
    orderStatus: 'FILLED',
    lastFilledQty: '0.5',
    filledAccumulatedQty: '0.5',
    tradeTime: Date.now(),
    ...overrides
  };
}

export function createMockOrderBook(spread: number = 10): OrderBook {
  const midPrice = 50000;
  return {
    lastUpdateId: Date.now(),
    bids: [
      [`${midPrice - spread/2}`, '1.0'],
      [`${midPrice - spread}`, '2.0'],
      [`${midPrice - spread*1.5}`, '3.0'],
      [`${midPrice - spread*2}`, '4.0'],
      [`${midPrice - spread*2.5}`, '5.0']
    ],
    asks: [
      [`${midPrice + spread/2}`, '1.0'],
      [`${midPrice + spread}`, '2.0'],
      [`${midPrice + spread*1.5}`, '3.0'],
      [`${midPrice + spread*2}`, '4.0'],
      [`${midPrice + spread*2.5}`, '5.0']
    ]
  };
}

export function createMockPosition(overrides?: Partial<Position>): Position {
  return {
    symbol: 'BTCUSDT',
    positionSide: 'BOTH',
    positionAmt: '0.001',
    entryPrice: '50000',
    markPrice: '50100',
    unRealizedProfit: '0.10',
    liquidationPrice: '45000',
    leverage: '5',
    marginType: 'cross',
    isolatedMargin: '0',
    isAutoAddMargin: 'false',
    maxNotionalValue: '1000000',
    ...overrides
  };
}

export class MockWebSocketServer extends EventEmitter {
  private server: WebSocket.Server | null = null;
  private clients: Set<WebSocket> = new Set();
  private port: number;

  constructor(port: number = 8081) {
    super();
    this.port = port;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = new WebSocket.Server({ port: this.port });

      this.server.on('connection', (ws) => {
        this.clients.add(ws);
        this.emit('connection', ws);

        ws.on('close', () => {
          this.clients.delete(ws);
        });

        ws.on('message', (data) => {
          this.emit('message', data.toString());
        });
      });

      this.server.on('listening', () => {
        resolve();
      });
    });
  }

  broadcast(data: any) {
    const message = JSON.stringify(data);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.clients.forEach(client => client.close());
      this.clients.clear();

      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export class MockWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  public isConnected: boolean = false;
  private messages: any[] = [];

  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.emit('open');
        resolve();
      });

      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        this.messages.push(message);
        this.emit('message', message);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.emit('close');
      });

      this.ws.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });
    });
  }

  send(data: any) {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(data));
    }
  }

  getMessages(): any[] {
    return [...this.messages];
  }

  clearMessages() {
    this.messages = [];
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function mockApiResponse<T>(data: T, delay: number = 10): Promise<T> {
  return new Promise(resolve => {
    setTimeout(() => resolve(data), delay);
  });
}