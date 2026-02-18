#!/usr/bin/env tsx
/**
 * Liquidation-Based Backtest
 * 
 * Correlates liquidation events from our DB with historical kline data
 * to measure how often price moves in the expected direction after
 * a liquidation cascade signal.
 * 
 * Strategy: When large liquidations happen (e.g. $10k of SELL liquidations in 60s),
 * it means longs are being stopped out. We buy the dip (mean reversion).
 * Vice versa for BUY liquidations (shorts being rekt → we short the bounce).
 */

import axios from 'axios';
import Database from 'better-sqlite3';
import path from 'path';

const BASE_URL = 'https://fapi.asterdex.com';
const DB_PATH = path.join(__dirname, '..', 'data', 'liquidations.db');

// ── Config ──────────────────────────────────────────────────────────────
const SYMBOLS = ['ETHUSDT', 'ASTERUSDT', 'SOLUSDT', 'HYPEUSDT', 'ZECUSDT', 'XRPUSDT', '1000PEPEUSDT', 'FARTCOINUSDT'];
const THRESHOLDS = [3000, 5000, 8000, 10000, 15000, 20000];
const TP_PERCENTS = [0.5, 1.0, 1.5, 2.0];
const MAX_HOLD_MINUTES = 240;
const LOOKBACK_DAYS = 30;
const SIGNAL_WINDOW_SECONDS = 60;
const SIGNAL_COOLDOWN_SECONDS = 30;

// ── Types ───────────────────────────────────────────────────────────────
interface LiqEvent {
  symbol: string;
  side: string;
  volume_usdt: number;
  event_time: number;
}

interface KlineData {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Signal {
  time: number;
  side: string;
  price: number;
  windowVolume: number;
}

interface BacktestResult {
  symbol: string;
  threshold: number;
  tpPct: number;
  signals: number;
  wins: number;
  losses: number;
  winRate: number;
  avgHoldMinutes: number;
  maxAdverseExcursion: number; // Worst % move against us before TP hit
  avgLossPct: number; // Average loss on losing trades
  expectedValue: number; // Per-trade expected value as % of position
}

// ── Kline Fetching ──────────────────────────────────────────────────────
async function fetchKlines(symbol: string, startMs: number, endMs: number): Promise<KlineData[]> {
  const allKlines: KlineData[] = [];
  let currentEnd = endMs;
  let requestCount = 0;

  while (currentEnd > startMs) {
    try {
      const response = await axios.get(`${BASE_URL}/fapi/v1/klines`, {
        params: { symbol, interval: '1m', limit: 1500, endTime: currentEnd },
        timeout: 10000,
      });

      const data = response.data;
      if (!data || data.length === 0) break;

      const parsed: KlineData[] = data.map((k: any[]) => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
      }));

      allKlines.push(...parsed);
      currentEnd = parsed[0].openTime - 1;
      requestCount++;

      // Progress
      const coverage = ((endMs - currentEnd) / (endMs - startMs) * 100).toFixed(0);
      process.stdout.write(`\r  ${symbol}: ${requestCount} requests, ${allKlines.length} candles (${coverage}% coverage)`);

      // Rate limit: 200ms between requests
      await new Promise(r => setTimeout(r, 200));
    } catch (e: any) {
      console.error(`\n  Error fetching ${symbol}: ${e.message}`);
      break;
    }
  }

  process.stdout.write('\n');

  // Sort and deduplicate
  allKlines.sort((a, b) => a.openTime - b.openTime);
  const seen = new Set<number>();
  return allKlines.filter(k => {
    if (seen.has(k.openTime)) return false;
    seen.add(k.openTime);
    return true;
  });
}

// ── Signal Generation ───────────────────────────────────────────────────
function generateSignals(
  liquidations: LiqEvent[],
  threshold: number,
  klineMap: Map<number, KlineData>
): Signal[] {
  const signals: Signal[] = [];
  const windowMs = SIGNAL_WINDOW_SECONDS * 1000;
  const cooldownMs = SIGNAL_COOLDOWN_SECONDS * 1000;

  for (let i = 0; i < liquidations.length; i++) {
    const liq = liquidations[i];

    // Sum same-side volume in rolling window
    let windowVol = 0;
    for (let j = i; j >= 0; j--) {
      if (liquidations[j].event_time < liq.event_time - windowMs) break;
      if (liquidations[j].side === liq.side) {
        windowVol += liquidations[j].volume_usdt;
      }
    }

    if (windowVol < threshold) continue;

    // Cooldown: skip if same side signal within cooldown period
    const lastSameSide = signals.filter(s => s.side === liq.side);
    const lastSignal = lastSameSide[lastSameSide.length - 1];
    if (lastSignal && liq.event_time - lastSignal.time < cooldownMs) continue;

    // Get entry price from kline at signal time
    const minuteKey = Math.floor(liq.event_time / 60000);
    const entryCandle = klineMap.get(minuteKey);
    if (!entryCandle) continue;

    signals.push({
      time: liq.event_time,
      side: liq.side,
      price: entryCandle.close,
      windowVolume: windowVol,
    });
  }

  return signals;
}

// ── Trade Simulation ────────────────────────────────────────────────────
function simulateTrades(
  signals: Signal[],
  klineMap: Map<number, KlineData>,
  tpPct: number
): BacktestResult & { symbol: string; threshold: number } {
  let wins = 0;
  let losses = 0;
  let totalHoldMinutes = 0;
  let maxAdverseExcursion = 0;
  let totalLossPct = 0;

  for (const signal of signals) {
    // Mean reversion: SELL liquidation (longs rekt) → we BUY, BUY liquidation (shorts rekt) → we SELL
    const isLong = signal.side === 'SELL';
    const entryPrice = signal.price;
    const tpPrice = isLong
      ? entryPrice * (1 + tpPct / 100)
      : entryPrice * (1 - tpPct / 100);

    let hit = false;
    let worstExcursion = 0;

    for (let m = 1; m <= MAX_HOLD_MINUTES; m++) {
      const minuteKey = Math.floor(signal.time / 60000) + m;
      const candle = klineMap.get(minuteKey);
      if (!candle) continue;

      // Track max adverse excursion
      if (isLong) {
        const adverse = (entryPrice - candle.low) / entryPrice * 100;
        if (adverse > worstExcursion) worstExcursion = adverse;
      } else {
        const adverse = (candle.high - entryPrice) / entryPrice * 100;
        if (adverse > worstExcursion) worstExcursion = adverse;
      }

      // Check TP hit
      if (isLong && candle.high >= tpPrice) {
        wins++;
        totalHoldMinutes += m;
        hit = true;
        break;
      } else if (!isLong && candle.low <= tpPrice) {
        wins++;
        totalHoldMinutes += m;
        hit = true;
        break;
      }
    }

    if (worstExcursion > maxAdverseExcursion) {
      maxAdverseExcursion = worstExcursion;
    }

    if (!hit) {
      losses++;
      // Calculate actual loss at exit
      const exitMinute = Math.floor(signal.time / 60000) + MAX_HOLD_MINUTES;
      const exitCandle = klineMap.get(exitMinute);
      if (exitCandle) {
        const lossPct = isLong
          ? (exitCandle.close - entryPrice) / entryPrice * 100
          : (entryPrice - exitCandle.close) / entryPrice * 100;
        totalLossPct += lossPct; // This will be negative for actual losses
      } else {
        totalLossPct -= tpPct; // Assume worst case
      }
    }
  }

  const total = wins + losses;
  const avgLossPct = losses > 0 ? totalLossPct / losses : 0;
  
  // Expected value: (winRate × tpPct) + ((1-winRate) × avgLossPct)
  const winRate = total > 0 ? wins / total : 0;
  const expectedValue = (winRate * tpPct) + ((1 - winRate) * avgLossPct);

  return {
    symbol: '',
    threshold: 0,
    tpPct,
    signals: total,
    wins,
    losses,
    winRate: winRate * 100,
    avgHoldMinutes: wins > 0 ? totalHoldMinutes / wins : 0,
    maxAdverseExcursion,
    avgLossPct,
    expectedValue,
  };
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        LIQUIDATION MEAN-REVERSION BACKTEST                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const db = new Database(DB_PATH, { readonly: true });

  const lookbackMs = LOOKBACK_DAYS * 86400 * 1000;
  const startTime = Date.now() - lookbackMs;

  // Load all liquidation events
  const liquidations: LiqEvent[] = db.prepare(`
    SELECT symbol, side, volume_usdt, event_time
    FROM liquidations
    WHERE event_time > ?
      AND symbol IN (${SYMBOLS.map(s => `'${s}'`).join(',')})
    ORDER BY symbol, event_time
  `).all(startTime) as LiqEvent[];

  console.log(`📊 Loaded ${liquidations.length} liquidation events (last ${LOOKBACK_DAYS} days)\n`);

  // Group liquidations by symbol
  const liqBySymbol = new Map<string, LiqEvent[]>();
  for (const liq of liquidations) {
    if (!liqBySymbol.has(liq.symbol)) liqBySymbol.set(liq.symbol, []);
    liqBySymbol.get(liq.symbol)!.push(liq);
  }

  // Fetch klines for each symbol
  console.log('📈 Fetching historical klines from exchange...\n');
  const klinesBySymbol = new Map<string, Map<number, KlineData>>();

  for (const symbol of SYMBOLS) {
    const klines = await fetchKlines(symbol, startTime, Date.now());
    const klineMap = new Map<number, KlineData>();
    for (const k of klines) {
      klineMap.set(Math.floor(k.openTime / 60000), k);
    }
    klinesBySymbol.set(symbol, klineMap);
    console.log(`  ✅ ${symbol}: ${klines.length} candles (${(klines.length / 60 / 24).toFixed(1)} days)`);
  }

  console.log('\n');

  // Run backtest for all combinations
  const allResults: BacktestResult[] = [];

  for (const symbol of SYMBOLS) {
    const klineMap = klinesBySymbol.get(symbol);
    const symbolLiqs = liqBySymbol.get(symbol) || [];

    if (!klineMap || klineMap.size < 100 || symbolLiqs.length < 10) {
      console.log(`⚠️  ${symbol}: insufficient data (${symbolLiqs.length} liqs, ${klineMap?.size || 0} candles)\n`);
      continue;
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${symbol} (${symbolLiqs.length} liquidation events)`);
    console.log(`${'═'.repeat(70)}`);
    console.log('Threshold │ TP%  │ Signals │ Wins │ Win%  │ AvgHold │ MaxAE  │  EV/trade');
    console.log('──────────┼──────┼─────────┼──────┼───────┼─────────┼────────┼──────────');

    for (const threshold of THRESHOLDS) {
      const signals = generateSignals(symbolLiqs, threshold, klineMap);
      if (signals.length < 3) continue;

      for (const tpPct of TP_PERCENTS) {
        const result = simulateTrades(signals, klineMap, tpPct);
        result.symbol = symbol;
        result.threshold = threshold;
        allResults.push(result);

        const evStr = result.expectedValue >= 0
          ? `+${result.expectedValue.toFixed(3)}%`
          : `${result.expectedValue.toFixed(3)}%`;
        const evColor = result.expectedValue >= 0 ? '🟢' : '🔴';

        console.log(
          `${String(threshold).padStart(9)} │ ${String(tpPct).padStart(4)} │ ${String(result.signals).padStart(7)} │ ${String(result.wins).padStart(4)} │ ${result.winRate.toFixed(1).padStart(5)}% │ ${(result.avgHoldMinutes > 0 ? result.avgHoldMinutes.toFixed(0) + 'm' : 'n/a').padStart(7)} │ ${result.maxAdverseExcursion.toFixed(2).padStart(5)}% │ ${evColor} ${evStr}`
        );
      }
    }
  }

  // ── Summary: Best configs per symbol ──
  console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║               TOP CONFIGS PER SYMBOL                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // For each symbol, find the best config by expected value (with minimum 5 signals)
  const symbolGroups = new Map<string, BacktestResult[]>();
  for (const r of allResults) {
    if (!symbolGroups.has(r.symbol)) symbolGroups.set(r.symbol, []);
    symbolGroups.get(r.symbol)!.push(r);
  }

  console.log('Symbol          │ Threshold │ TP%  │ Signals │ Win%  │ AvgHold │ EV/trade │ EV×Signals');
  console.log('────────────────┼───────────┼──────┼─────────┼───────┼─────────┼──────────┼───────────');

  const bestPerSymbol: BacktestResult[] = [];

  for (const [symbol, results] of symbolGroups) {
    // Filter to configs with enough signals and positive EV
    const viable = results.filter(r => r.signals >= 5 && r.winRate >= 60);
    if (viable.length === 0) {
      console.log(`${symbol.padEnd(15)} │ No viable configs (insufficient signals or win rate < 60%)`);
      continue;
    }

    // Sort by total expected value (EV × signal count) — balances quality and frequency
    viable.sort((a, b) => {
      const totalA = a.expectedValue * a.signals;
      const totalB = b.expectedValue * b.signals;
      return totalB - totalA;
    });

    const best = viable[0];
    bestPerSymbol.push(best);
    const totalEV = (best.expectedValue * best.signals).toFixed(3);

    console.log(
      `${symbol.padEnd(15)} │ ${String(best.threshold).padStart(9)} │ ${String(best.tpPct).padStart(4)} │ ${String(best.signals).padStart(7)} │ ${best.winRate.toFixed(1).padStart(5)}% │ ${(best.avgHoldMinutes > 0 ? best.avgHoldMinutes.toFixed(0) + 'm' : 'n/a').padStart(7)} │ ${best.expectedValue >= 0 ? '+' : ''}${best.expectedValue.toFixed(3).padStart(7)}% │ ${totalEV}%`
    );
  }

  // ── Current config comparison ──
  console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║         CURRENT CONFIG vs BACKTEST OPTIMAL                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const currentConfig: Record<string, { threshold: number; tp: number }> = {
    ETHUSDT: { threshold: 15000, tp: 1.5 },
    ASTERUSDT: { threshold: 10000, tp: 1.5 },
    SOLUSDT: { threshold: 8000, tp: 1.5 },
    HYPEUSDT: { threshold: 5000, tp: 1.5 },
    ZECUSDT: { threshold: 4000, tp: 1.5 },
    FARTCOINUSDT: { threshold: 10000, tp: 1.5 },
  };

  for (const [symbol, config] of Object.entries(currentConfig)) {
    const current = allResults.find(r => r.symbol === symbol && r.threshold === config.threshold && r.tpPct === config.tp);
    const best = bestPerSymbol.find(r => r.symbol === symbol);
    
    if (current) {
      console.log(`${symbol}:`);
      console.log(`  Current (threshold=${config.threshold}, tp=${config.tp}%): Win ${current.winRate.toFixed(1)}%, EV ${current.expectedValue >= 0 ? '+' : ''}${current.expectedValue.toFixed(3)}%/trade, ${current.signals} signals`);
      if (best && (best.threshold !== config.threshold || best.tpPct !== config.tp)) {
        console.log(`  Optimal (threshold=${best.threshold}, tp=${best.tpPct}%): Win ${best.winRate.toFixed(1)}%, EV ${best.expectedValue >= 0 ? '+' : ''}${best.expectedValue.toFixed(3)}%/trade, ${best.signals} signals`);
      } else {
        console.log(`  → Current config IS optimal`);
      }
    } else {
      console.log(`${symbol}: No data for current config (threshold=${config.threshold})`);
    }
    console.log('');
  }

  db.close();
  console.log('✅ Backtest complete');
}

main().catch(console.error);
