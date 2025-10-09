#!/usr/bin/env node

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const readline = require('readline');

// API request configuration
const API_TIMEOUT_MS = 10000; // 10 second timeout
const MAX_RETRIES = 3;

const FORCE_OPTIMIZER_OVERWRITE = process.env.FORCE_OPTIMIZER_OVERWRITE === '1';
const FORCE_OPTIMIZER_CONFIRM = process.env.FORCE_OPTIMIZER_CONFIRM === '1';

// Realistic Slippage Model - Based on actual bot behavior
const EXIT_SLIPPAGE = {
  TP: 0.0010,          // 0.10% - TAKE_PROFIT_MARKET fills slightly worse than trigger
  SL: 0.0050,          // 0.50% - STOP_MARKET normal conditions (conservative baseline)
  SL_VOLATILE: 0.0080, // 0.80% - STOP_MARKET during high volatility/cascades
  ENTRY_LIMIT: 0.0000, // 0% - LIMIT orders don't slip (wait for fill at exact price)
  ENTRY_MARKET: 0.0020 // 0.20% - MARKET fallback orders (10% of entries)
};

const LIMIT_FILL_RATE = 0.85; // 85% of LIMIT orders actually fill (15% miss due to price movement)
const MARKET_FALLBACK_RATE = 0.10; // 10% of entries use MARKET orders instead of LIMIT

// Commission Model - Based on actual trading costs
const COMMISSION = {
  MAKER_FEE: 0.0002,        // 0.02% maker fee (LIMIT orders)
  TAKER_FEE: 0.0004,        // 0.04% taker fee (MARKET orders)
  AVG_FILLS_PER_TRADE: 1.5  // Average fills per complete trade (entry + exit, small partial fills)
                             // Chunking only happens on large orders (> maxQty)
                             // For typical trade sizes ($10-25), minimal chunking occurs
};

const DEFAULT_SCORING_WEIGHTS = {
  pnl: 50,
  sharpe: 30,
  drawdown: 20
};

function parseScoringWeights() {
  const parseWeight = (value, fallback) => {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return fallback;
    }

    return numeric;
  };

  const percent = {
    pnl: parseWeight(process.env.OPTIMIZER_WEIGHT_PNL, DEFAULT_SCORING_WEIGHTS.pnl),
    sharpe: parseWeight(process.env.OPTIMIZER_WEIGHT_SHARPE, DEFAULT_SCORING_WEIGHTS.sharpe),
    drawdown: parseWeight(process.env.OPTIMIZER_WEIGHT_DRAWDOWN, DEFAULT_SCORING_WEIGHTS.drawdown)
  };

  const total = percent.pnl + percent.sharpe + percent.drawdown;

  if (total <= 0) {
    const fallbackTotal = DEFAULT_SCORING_WEIGHTS.pnl + DEFAULT_SCORING_WEIGHTS.sharpe + DEFAULT_SCORING_WEIGHTS.drawdown;
    return {
      percent: { ...DEFAULT_SCORING_WEIGHTS },
      normalized: {
        pnl: DEFAULT_SCORING_WEIGHTS.pnl / fallbackTotal,
        sharpe: DEFAULT_SCORING_WEIGHTS.sharpe / fallbackTotal,
        drawdown: DEFAULT_SCORING_WEIGHTS.drawdown / fallbackTotal
      },
      isDefault: true
    };
  }

  return {
    percent,
    normalized: {
      pnl: percent.pnl / total,
      sharpe: percent.sharpe / total,
      drawdown: percent.drawdown / total
    },
    isDefault: false
  };
}

const scoringWeights = parseScoringWeights();
const normalizedScoringWeights = scoringWeights.normalized;

const formatWeightPercent = (value) => {
  if (!Number.isFinite(value)) {
    return '0%';
  }

  const rounded = Number(value.toFixed(1));
  if (Number.isInteger(rounded)) {
    return `${Math.trunc(rounded)}%`;
  }

  return `${rounded.toFixed(1)}%`;
};

// Connect to the database
const dbPath = path.join(__dirname, 'data', 'liquidations.db');
const db = new Database(dbPath, { readonly: true });

// Load current configuration
const configPath = path.join(__dirname, 'config.user.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const requestedSymbols = new Set(
  (process.env.OPTIMIZER_SYMBOLS || '')
    .split(',')
    .map(symbol => symbol.trim().toUpperCase())
    .filter(Boolean)
);

if (requestedSymbols.size > 0) {
  console.log(`OPTIMIZER SCOPE: ${Array.from(requestedSymbols).join(', ')}`);
} else {
  console.log('OPTIMIZER SCOPE: ALL SYMBOLS');
}

function shouldIncludeSymbol(symbol) {
  if (!symbol) {
    return false;
  }
  if (requestedSymbols.size === 0) {
    return true;
  }
  return requestedSymbols.has(symbol.toUpperCase());
}

function getSelectedSymbolEntries(symbolMap = config.symbols) {
  const entries = Object.entries(symbolMap || {});
  if (requestedSymbols.size === 0) {
    return entries;
  }
  return entries.filter(([symbol]) => shouldIncludeSymbol(symbol));
}

function getSelectedSymbolsList(symbolMap = config.symbols) {
  return getSelectedSymbolEntries(symbolMap).map(([symbol]) => symbol);
}

function getSelectedSymbolConfigMap(symbolMap = config.symbols) {
  return Object.fromEntries(getSelectedSymbolEntries(symbolMap));
}

// API helper functions for balance fetching
function buildSignedQuery(params, credentials) {
  const timestamp = Date.now();
  const queryString = new URLSearchParams({
    ...params,
    timestamp,
    recvWindow: 5000
  }).toString();

  const signature = crypto
    .createHmac('sha256', credentials.secretKey)
    .update(queryString)
    .digest('hex');

  return `${queryString}&signature=${signature}`;
}

async function getAccountBalance(credentials) {
  try {
    const queryString = buildSignedQuery({}, credentials);
    const response = await axios.get(
      `https://fapi.asterdex.com/fapi/v2/balance?${queryString}`,
      {
        headers: { 'X-MBX-APIKEY': credentials.apiKey }
      }
    );

    const usdtBalance = response.data.find(asset => asset.asset === 'USDT');
    return {
      totalWalletBalance: parseFloat(usdtBalance?.walletBalance || 0),
      availableBalance: parseFloat(usdtBalance?.availableBalance || 0),
      crossMargin: parseFloat(usdtBalance?.crossUnPnl || 0)
    };
  } catch (error) {
    console.error('??? Failed to fetch balance:', error.response?.data || error.message);
    return { totalWalletBalance: 0, availableBalance: 0, crossMargin: 0 };
  }
}

async function getLeverageBrackets(credentials) {
  try {
    const queryString = buildSignedQuery({}, credentials);
    const response = await axios.get(
      `https://fapi.asterdex.com/fapi/v1/leverageBracket?${queryString}`,
      {
        headers: { 'X-MBX-APIKEY': credentials.apiKey },
        timeout: API_TIMEOUT_MS
      }
    );

    // Convert to a lookup map: { 'BTCUSDT': [...brackets], 'ETHUSDT': [...brackets] }
    const bracketsMap = {};
    if (Array.isArray(response.data)) {
      for (const item of response.data) {
        if (item.symbol && Array.isArray(item.brackets)) {
          bracketsMap[item.symbol] = item.brackets;
        }
      }
    }
    return bracketsMap;
  } catch (error) {
    console.error('⚠️ Failed to fetch leverage brackets:', error.response?.data || error.message);
    return {};
  }
}

async function getAccountInfo(credentials) {
  try {
    const queryString = buildSignedQuery({}, credentials);
    const response = await axios.get(
      `https://fapi.asterdex.com/fapi/v2/account?${queryString}`,
      {
        headers: { 'X-MBX-APIKEY': credentials.apiKey }
      }
    );

    return response.data;
  } catch (error) {
    console.error('??? Failed to fetch account info:', error.response?.data || error.message);
    return null;
  }
}

// Leverage tier validation helpers
function getMaxLeverageForNotional(symbol, notionalValue, leverageBrackets) {
  const brackets = leverageBrackets[symbol];
  if (!brackets || !Array.isArray(brackets)) {
    // No tier data available - return conservative default
    return 10;
  }

  // Find the bracket that this notional value falls into
  for (const bracket of brackets) {
    const floor = bracket.notionalFloor || 0;
    const cap = bracket.notionalCap || Infinity;

    if (notionalValue >= floor && notionalValue < cap) {
      return bracket.initialLeverage || 10;
    }
  }

  // If notional exceeds all brackets, use the last bracket's leverage
  if (brackets.length > 0) {
    return brackets[brackets.length - 1].initialLeverage || 1;
  }

  return 10; // Fallback default
}

function isLeverageValidForNotional(symbol, leverage, notionalValue, leverageBrackets) {
  const maxAllowed = getMaxLeverageForNotional(symbol, notionalValue, leverageBrackets);
  return leverage <= maxAllowed;
}

function calculateMaxPositionsForLeverage(symbol, tradeSize, leverage, maxMargin, leverageBrackets) {
  const brackets = leverageBrackets[symbol];
  if (!brackets || !Array.isArray(brackets)) {
    // No tier data - use simple calculation
    return Math.floor(maxMargin / tradeSize);
  }

  let totalPositions = 0;
  let remainingMargin = maxMargin;
  let cumulativeNotional = 0;

  // Simulate adding positions until we hit a tier limit or run out of margin
  for (let i = 0; i < 1000; i++) { // Safety limit
    const nextNotional = cumulativeNotional + (tradeSize * leverage);

    if (!isLeverageValidForNotional(symbol, leverage, nextNotional, leverageBrackets)) {
      // Hit tier limit
      break;
    }

    if (remainingMargin < tradeSize) {
      // Out of margin
      break;
    }

    totalPositions++;
    cumulativeNotional = nextNotional;
    remainingMargin -= tradeSize;
  }

  return totalPositions;
}

async function getUserTrades(credentials, symbol, limit = 100, startTime = null, endTime = null) {
  try {
    const params = { symbol, limit };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    const queryString = buildSignedQuery(params, credentials);
    const response = await axios.get(
      `https://fapi.asterdex.com/fapi/v1/userTrades?${queryString}`,
      {
        headers: { 'X-MBX-APIKEY': credentials.apiKey }
      }
    );

    return response.data;
  } catch (error) {
    console.error(`??? Failed to fetch trade history for ${symbol}:`, error.response?.data || error.message);
    return [];
  }
}

async function getCurrentPositions(credentials) {
  try {
    const queryString = buildSignedQuery({}, credentials);
    const response = await axios.get(
      `https://fapi.asterdex.com/fapi/v2/positionRisk?${queryString}`,
      {
        headers: { 'X-MBX-APIKEY': credentials.apiKey }
      }
    );

    // Filter out positions with zero size
    const activePositions = response.data.filter(pos => parseFloat(pos.positionAmt) !== 0);
    return activePositions;
  } catch (error) {
    console.error('??? Failed to fetch positions:', error.response?.data || error.message);
    return [];
  }
}

// Retry wrapper for API calls with timeout
async function retryWithTimeout(fn, retries = MAX_RETRIES, timeoutMs = API_TIMEOUT_MS) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const result = await fn(controller.signal);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      const isLastAttempt = attempt === retries;

      if (isLastAttempt) {
        throw error;
      }

      // Wait before retry (exponential backoff: 1s, 2s, 4s)
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// NEW: Fetch historical price data (klines)
async function _getHistoricalPrices(symbol, interval = '1m', limit = 1000) {
  try {
    const response = await axios.get(
      `https://fapi.asterdex.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );

    // Convert kline data to price points
    const priceData = response.data.map(kline => ({
      timestamp: kline[0],          // Open time
      open: parseFloat(kline[1]),   // Open price
      high: parseFloat(kline[2]),   // High price
      low: parseFloat(kline[3]),    // Low price
      close: parseFloat(kline[4]),  // Close price
      volume: parseFloat(kline[5])  // Volume
    }));

    return priceData;
  } catch (error) {
    console.error(`??? Failed to fetch price data for ${symbol}:`, error.response?.data || error.message);
    return [];
  }
}

const MAX_KLINE_LIMIT = 1500;
const priceDataCache = new Map();

async function getCachedHistoricalPrices(symbol, interval = '1m', totalCandles = interval === '1m' ? 10080 : 1000) {
  const cacheKey = `${symbol}:${interval}:${totalCandles}`;
  if (priceDataCache.has(cacheKey)) {
    return priceDataCache.get(cacheKey);
  }

  const collected = [];
  let remaining = Math.max(totalCandles, 0);
  let endTime = undefined;

  while (remaining > 0) {
    const requestLimit = Math.min(remaining, MAX_KLINE_LIMIT);
    const params = new URLSearchParams({
      symbol,
      interval,
      limit: requestLimit
    });

    if (endTime) {
      params.append('endTime', endTime);
    }

    let response;
    try {
      response = await retryWithTimeout(async (signal) => {
        return await axios.get(`https://fapi.asterdex.com/fapi/v1/klines?${params.toString()}`, {
          timeout: API_TIMEOUT_MS,
          signal
        });
      });
    } catch (error) {
      console.error(`??? Failed to fetch price data for ${symbol} after ${MAX_RETRIES} retries:`, error.response?.data || error.message);
      break;
    }

    const rawKlines = Array.isArray(response.data) ? response.data : [];
    if (rawKlines.length === 0) {
      break;
    }

    const chunk = rawKlines.map(kline => ({
      timestamp: kline[0],
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5])
    }));

    // Prepend older chunks so the array stays chronological from oldest to newest
    collected.unshift(...chunk);

    const earliestTimestamp = chunk[0]?.timestamp;
    if (typeof earliestTimestamp === 'number') {
      endTime = earliestTimestamp - 1;
    } else {
      break;
    }

    if (rawKlines.length < requestLimit) {
      break; // No more data available
    }

    remaining = Math.max(totalCandles - collected.length, 0);
  }

  // Keep only the most recent `totalCandles` entries, preserving chronological order
  const priceData = collected.length > totalCandles
    ? collected.slice(collected.length - totalCandles)
    : collected;

  priceDataCache.set(cacheKey, priceData);
  return priceData;
}

console.log('???? LIQUIDATION BOT OPTIMIZATION TOOL');
console.log('====================================\n');

// Check liquidation price data coverage
function analyzePriceDataCoverage() {
  console.log('???? PRICE DATA COVERAGE ANALYSIS');
  console.log('===============================\n');

  const priceData = db.prepare(`
    SELECT
      event_time,
      price,
      volume_usdt,
      side
    FROM liquidations
    WHERE symbol = 'ASTERUSDT'
    ORDER BY event_time
    LIMIT 10
  `).all();

  console.log('Sample ASTERUSDT liquidation prices:');
  console.log('Time (ms)        | Price   | Volume  | Side | Gap (min)');
  console.log('-----------------|---------|---------|------|----------');

  let lastTime = 0;
  priceData.forEach((row, i) => {
    const gap = i > 0 ? (row.event_time - lastTime) / 1000 / 60 : 0;
    console.log(`${row.event_time.toString().padEnd(16)} | $${row.price.toFixed(4)} | $${row.volume_usdt.toFixed(0).padEnd(7)} | ${row.side.padEnd(4)} | ${gap.toFixed(1)}min`);
    lastTime = row.event_time;
  });

  // Check total coverage
  const coverage = db.prepare(`
    SELECT
      COUNT(*) as total_events,
      MIN(event_time) as first_time,
      MAX(event_time) as last_time,
      AVG(price) as avg_price,
      MIN(price) as min_price,
      MAX(price) as max_price
    FROM liquidations
    WHERE symbol = 'ASTERUSDT'
  `).get();

  const timeSpan = (coverage.last_time - coverage.first_time) / 1000 / 60 / 60; // hours
  const avgGap = timeSpan * 60 / coverage.total_events; // minutes per event

  console.log();
  console.log(`???? ASTERUSDT Price Coverage:`);
  console.log(`   Total Events: ${coverage.total_events}`);
  console.log(`   Time Span: ${timeSpan.toFixed(1)} hours`);
  console.log(`   Average Gap: ${avgGap.toFixed(1)} minutes between price points`);
  console.log(`   Price Range: $${coverage.min_price.toFixed(4)} - $${coverage.max_price.toFixed(4)}`);
  console.log();

  return avgGap;
}

// Helper functions
function formatNumber(num) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

function formatLargeNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toFixed(2);
}

function formatCurrency(num) {
  return Number.isFinite(num) ? `$${formatNumber(num)}` : 'n/a';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLD_WINDOW_MS = 60 * 1000;
const DEFAULT_THRESHOLD_COOLDOWN_MS = 30 * 1000;
const HUNTER_COOLDOWN_MS = 2 * 60 * 1000;

const optimizerModeRaw = process.env.OPTIMIZER_MODE ?? 'quick';
const OPTIMIZER_MODE = typeof optimizerModeRaw === 'string'
  ? optimizerModeRaw.trim().toLowerCase()
  : 'quick';
const MODE_SETTINGS = {
  quick: {
    thresholdMax: 12,
    tpMax: 5,
    slMax: 5,
    leverageMax: 5,
    marginMax: 4,
    windowMax: 4,
    cooldownMax: 4,
  },
  thorough: {
    thresholdMax: 48,
    tpMax: 24,
    slMax: 24,
    leverageMax: 10,
    marginMax: 10,
    windowMax: 12,
    cooldownMax: 12,
  }
};

const modeSettings = MODE_SETTINGS[OPTIMIZER_MODE] || MODE_SETTINGS.quick;
const IS_THOROUGH_MODE = OPTIMIZER_MODE === 'thorough';
const ENABLE_DIAGNOSTICS = process.env.OPTIMIZER_DIAGNOSTICS === '1';
const VOLATILITY_PENALTY_FACTOR = IS_THOROUGH_MODE ? 0.4 : 1;
const ENABLE_SCENARIOS = process.env.OPTIMIZER_ENABLE_SCENARIOS === '0' ? false : true;
const SCENARIO_PENALTY_WEIGHT = (() => {
  const raw = parseFloat(process.env.OPTIMIZER_SCENARIO_PENALTY || '0.5');
  if (!Number.isFinite(raw)) return 0.5;
  return Math.min(Math.max(raw, 0), 2);
})();
const CVAR_PENALTY_WEIGHT = (() => {
  const raw = parseFloat(process.env.OPTIMIZER_CVAR_PENALTY || '0.15');
  if (!Number.isFinite(raw)) return 0.15;
  return Math.min(Math.max(raw, 0), 1);
})();

const diagLog = (...args) => {
  if (ENABLE_DIAGNOSTICS) {
    console.log('[DIAG]', ...args);
  }
};

if (!MODE_SETTINGS[OPTIMIZER_MODE]) {
  console.log(`⚙️  Optimizer mode '${OPTIMIZER_MODE}' not recognized. Falling back to 'quick'.`);
}

function emitProgress(percent, stage) {
  if (!Number.isFinite(percent)) {
    return;
  }

  const clamped = Math.min(100, Math.max(0, percent));
  const label = typeof stage === 'string' && stage.trim().length > 0
    ? stage.trim()
    : 'Working...';

  console.log(`[[PROGRESS:${clamped.toFixed(2)}]] ${label}`);
}

const MIN_THRESHOLD_PERCENTILE = (() => {
  const raw = parseFloat(process.env.OPTIMIZER_MIN_THRESHOLD_PCTL || '0.35');
  if (!Number.isFinite(raw)) return 0.35;
  const clamped = Math.min(Math.max(raw, 0.15), 0.6);
  return parseFloat(clamped.toFixed(4));
})();

const symbolGapCache = new Map();

function getSymbolGapStats(symbol) {
  if (symbolGapCache.has(symbol)) {
    return symbolGapCache.get(symbol);
  }

  const rows = db.prepare(`
    SELECT event_time
    FROM liquidations
    WHERE symbol = ?
    ORDER BY event_time
  `).all(symbol);

  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]?.event_time;
    const curr = rows[i]?.event_time;
    const diff = Number.isFinite(curr) && Number.isFinite(prev)
      ? (curr - prev) / 1000
      : null;

    if (Number.isFinite(diff) && diff >= 0.5) {
      // Ignore extremely long gaps (> 12h) which likely represent downtime
      if (diff <= 12 * 60 * 60) {
        gaps.push(diff);
      }
    }
  }

  const avgGapSec = gaps.length
    ? gaps.reduce((sum, val) => sum + val, 0) / gaps.length
    : 60;

  const percentileValues = gaps.length
    ? computePercentiles(gaps, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98])
    : {};

  const stats = { gaps, avgGapSec, percentiles: percentileValues };
  symbolGapCache.set(symbol, stats);
  return stats;
}

function generateTimeWindowCandidates(symbol, currentMs, volStats) {
  const { gaps, avgGapSec, percentiles } = getSymbolGapStats(symbol);
  const baseDefaults = [20, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
  const candidates = new Set(baseDefaults);

  if (gaps.length) {
    Object.values(percentiles).forEach((sec) => {
      if (Number.isFinite(sec)) {
        const clamped = Math.max(10, Math.min(Math.round(sec), 600));
        candidates.add(clamped);
      }
    });

    const avgBased = [0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(mult => avgGapSec * mult);
    avgBased.forEach((sec) => {
      if (Number.isFinite(sec)) {
        const clamped = Math.max(10, Math.min(Math.round(sec), 600));
        candidates.add(clamped);
      }
    });
  }

  if (volStats?.perc95 && volStats.perc95 > 0) {
    if (volStats.perc95 >= 3) {
      [15, 20, 25, 30].forEach(sec => candidates.add(sec));
    } else if (volStats.perc95 <= 1) {
      [150, 180, 210, 240, 300, 360].forEach(sec => candidates.add(sec));
    }
  }

  if (Number.isFinite(currentMs) && currentMs > 0) {
    candidates.add(Math.max(10, Math.round(currentMs / 1000)));
  }

  const filteredSeconds = dedupeAndSort([...candidates]).filter(sec => sec >= 10 && sec <= 600);
  const sampledSeconds = sampleCandidates(filteredSeconds, modeSettings.windowMax);
  return sampledSeconds.map(sec => sec * 1000);
}

function generateCooldownCandidates(symbol, currentMs, windowCandidatesMs = [], volStats) {
  const { gaps, avgGapSec, percentiles } = getSymbolGapStats(symbol);
  const baseDefaults = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600];
  const candidates = new Set(baseDefaults);

  if (gaps.length) {
    Object.values(percentiles).forEach((sec) => {
      if (Number.isFinite(sec)) {
        const clamped = Math.max(5, Math.min(Math.round(sec), 900));
        candidates.add(clamped);
      }
    });

    const avgBased = [1, 1.25, 1.5, 2, 3, 4].map(mult => avgGapSec * mult);
    avgBased.forEach((sec) => {
      if (Number.isFinite(sec)) {
        const clamped = Math.max(5, Math.min(Math.round(sec), 900));
        candidates.add(clamped);
      }
    });
  }

  if (volStats?.perc95 && volStats.perc95 > 0) {
    if (volStats.perc95 >= 3) {
      [5, 10, 15, 20, 25].forEach(sec => candidates.add(sec));
    } else if (volStats.perc95 <= 1) {
      [120, 180, 240, 300, 360, 420].forEach(sec => candidates.add(sec));
    }
  }

  const windowSeconds = windowCandidatesMs
    .map((ms) => Math.max(5, Math.round(ms / 1000)))
    .filter((sec) => Number.isFinite(sec));

  if (windowSeconds.length) {
    const maxWindow = Math.max(...windowSeconds);
    const minWindow = Math.min(...windowSeconds);
    [0.5, 0.75, 1, 1.5, 2, 3].forEach(mult => {
      const sec = Math.round(maxWindow * mult);
      if (Number.isFinite(sec)) {
        candidates.add(Math.max(minWindow, Math.min(sec, 900)));
      }
    });
  }

  if (Number.isFinite(currentMs) && currentMs > 0) {
    candidates.add(Math.max(5, Math.round(currentMs / 1000)));
  }

  const filteredSeconds = dedupeAndSort([...candidates]).filter(sec => sec >= 5 && sec <= 900);
  const sampledSeconds = sampleCandidates(filteredSeconds, modeSettings.cooldownMax);
  return sampledSeconds.map(sec => sec * 1000);
}

function calculateCombinationScore(longResult, shortResult) {
  const combinedPnl = (longResult?.totalPnl || 0) + (shortResult?.totalPnl || 0);
  const rawLongSharpe = longResult?.sharpeRatio ?? 0;
  const rawShortSharpe = shortResult?.sharpeRatio ?? 0;
  const cappedLongSharpe = Number.isFinite(rawLongSharpe) ? Math.min(Math.max(rawLongSharpe, -5), 5) : 0;
  const cappedShortSharpe = Number.isFinite(rawShortSharpe) ? Math.min(Math.max(rawShortSharpe, -5), 5) : 0;
  const combinedSharpe = (cappedLongSharpe + cappedShortSharpe) / 2;
  const combinedDrawdown = Math.max(longResult?.maxDrawdown || 1, shortResult?.maxDrawdown || 1);
  const drawdownScore = combinedPnl / (combinedDrawdown + 1);

  const finalScore = (
    (combinedPnl * normalizedScoringWeights.pnl) +
    (combinedSharpe * normalizedScoringWeights.sharpe) +
    (drawdownScore * normalizedScoringWeights.drawdown)
  );

  return {
    finalScore,
    combinedPnl,
    combinedSharpe,
    drawdownScore,
    combinedDrawdown,
  };
}
const symbolSpanCache = new Map();


function dedupeAndSort(values) {
  return Array.from(new Set(values.filter(v => Number.isFinite(v) && v > 0))).sort((a, b) => a - b);
}

function sampleCandidates(values, maxCount) {
  const sorted = dedupeAndSort(values);
  if (!Number.isFinite(maxCount) || maxCount <= 0) {
    return sorted;
  }

  if (OPTIMIZER_MODE === 'thorough' || sorted.length <= maxCount) {
    return sorted;
  }

  const result = [];
  const step = (sorted.length - 1) / (maxCount - 1);
  for (let i = 0; i < maxCount; i++) {
    const index = Math.round(i * step);
    result.push(sorted[index]);
  }

  return dedupeAndSort(result);
}

function computePercentiles(values, percentiles) {
  if (!values.length) return {};

  const sorted = [...values].sort((a, b) => a - b);
  const results = {};
  percentiles.forEach(p => {
    if (p <= 0) {
      results[p] = sorted[0];
      return;
    }
    if (p >= 1) {
      results[p] = sorted[sorted.length - 1];
      return;
    }
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) {
      results[p] = sorted[lower];
    } else {
      const weight = index - lower;
      results[p] = sorted[lower] * (1 - weight) + sorted[upper] * weight;
    }
  });
  return results;
}

function getLiquidationVolumes(symbol, side) {
  const rows = db.prepare(`
    SELECT volume_usdt
    FROM liquidations
    WHERE symbol = ? AND side = ?
  `).all(symbol, side);

  return rows.map(row => parseFloat(row.volume_usdt) || 0).filter(v => v > 0);
}

function generateThresholdCandidates(symbol, side, currentThreshold, maxCount = modeSettings.thresholdMax) {
  const volumes = getLiquidationVolumes(symbol, side);
  if (volumes.length === 0) {
    return {
      candidates: currentThreshold ? [currentThreshold] : [],
      minAllowed: currentThreshold || 0
    };
  }

  // NEW APPROACH: Generate candidates based on LIQUIDATION DATA, not user's current setting
  // This ensures we explore the full realistic range regardless of user's initial config

  const candidates = [];

  // Sample across the full distribution of liquidation sizes
  const percentileTargets = new Set();
  const basePercentiles = volumes.length > 5000
    ? [0.05, 0.08, 0.1, 0.12, 0.15, 0.18, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.93, 0.95, 0.97, 0.98, 0.99]
    : volumes.length > 1500
      ? [0.08, 0.1, 0.12, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.97, 0.99]
      : [0.1, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95, 0.98];

  basePercentiles.forEach(p => percentileTargets.add(p));
  percentileTargets.add(Math.min(0.99, Math.max(0.01, MIN_THRESHOLD_PERCENTILE)));

  // log-spaced emphasis near lower tail
  const bucketCount = 8;
  for (let i = 1; i <= bucketCount; i++) {
    const weight = i / (bucketCount + 1);
    const p = Math.pow(weight, 1.8); // skew to lower percentiles
    percentileTargets.add(Math.min(0.995, Math.max(0.02, p)));
  }

  const sortedPercentiles = [...percentileTargets].sort((a, b) => a - b);

  const percentiles = computePercentiles(volumes, sortedPercentiles);

  sortedPercentiles.forEach((p) => {
    const value = percentiles[p];
    if (Number.isFinite(value) && value > 0) {
      candidates.push(Math.round(value / 10) * 10);
    }
  });

  const tenthPercentile = percentiles[0.10];
  const minThreshold = Number.isFinite(tenthPercentile)
    ? Math.round(tenthPercentile / 10) * 10
    : 0;
  if (minThreshold > 0) {
    candidates.push(minThreshold);
  }

  // Include current threshold only for comparison, not as an anchor
  if (currentThreshold && currentThreshold > 0) {
    candidates.push(currentThreshold);
  }

  const floorPriority = [
    MIN_THRESHOLD_PERCENTILE,
    0.5,
    0.45,
    0.40,
    0.35,
    0.30,
    0.25
  ];

  let minAllowedRaw = null;
  for (const key of floorPriority) {
    const value = percentiles[key];
    if (Number.isFinite(value) && value > 0) {
      minAllowedRaw = value;
      break;
    }
  }

  if (!Number.isFinite(minAllowedRaw) || minAllowedRaw <= 0) {
    minAllowedRaw = minThreshold || currentThreshold || 0;
  }

  const minAllowed = Math.max(
    Math.round((minAllowedRaw || 0) / 10) * 10,
    minThreshold > 0 ? minThreshold : 0
  );

  // Add intermediate values to fill gaps between percentiles
  const sorted = dedupeAndSort(candidates);
  const withIntermediates = [...sorted];

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    const gap = next - current;

    // If gap is large (> 50% of smaller value), add midpoint + weighted mid
    if (gap > current * 0.5 && gap > 100) {
      const midpoint = Math.round((current + next) / 2 / 10) * 10;
      if (midpoint > current && midpoint < next) {
        withIntermediates.push(midpoint);
      }
      const weighted = Math.round((current * 0.7 + next * 0.3) / 10) * 10;
      if (weighted > current && weighted < next) {
        withIntermediates.push(weighted);
      }
    }
  }

  let sampled = sampleCandidates(withIntermediates, maxCount)
    .filter(value => value >= minAllowed);

  if (!sampled.length) {
    const fallback = minAllowed || currentThreshold || minThreshold || 0;
    sampled = [fallback].filter(Boolean);
  }

  return {
    candidates: sampled,
    minAllowed: minAllowed || 0
  };
}

function computePriceVolatility(priceData) {
  if (!priceData || priceData.length < 2) {
    return {
      avgAbsReturn: 0.5,
      perc90: 1,
      perc95: 1.5
    };
  }

  const returns = [];
  for (let i = 1; i < priceData.length; i++) {
    const prev = priceData[i - 1].close;
    const curr = priceData[i].close;
    if (prev > 0) {
      const changePct = Math.abs(((curr - prev) / prev) * 100);
      if (Number.isFinite(changePct)) {
        returns.push(changePct);
      }
    }
  }

  if (!returns.length) {
    return {
      avgAbsReturn: 0.5,
      perc90: 1,
      perc95: 1.5
    };
  }

  const avgAbsReturn = returns.reduce((sum, val) => sum + val, 0) / returns.length;
  const percentileValues = computePercentiles(returns, [0.9, 0.95]);

  return {
    avgAbsReturn,
    perc90: percentileValues[0.9] || avgAbsReturn,
    perc95: percentileValues[0.95] || percentileValues[0.9] || avgAbsReturn
  };
}

function computeAtrStats(priceData, period = 14) {
  if (!Array.isArray(priceData) || priceData.length <= period) {
    return {
      atr: 0,
      atrMedian: 0,
      atr90: 0,
      atrMax: 0
    };
  }

  const trs = [];
  for (let i = 1; i < priceData.length; i++) {
    const prev = priceData[i - 1];
    const curr = priceData[i];
    if (!prev || !curr) continue;
    const high = Number.isFinite(curr.high) ? curr.high : curr.close;
    const low = Number.isFinite(curr.low) ? curr.low : curr.close;
    const prevClose = Number.isFinite(prev.close) ? prev.close : prev.open;
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose)) continue;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    if (Number.isFinite(tr)) {
      trs.push(tr);
    }
  }

  if (trs.length === 0) {
    return {
      atr: 0,
      atrMedian: 0,
      atr90: 0,
      atrMax: 0
    };
  }

  const atrSeries = [];
  let runningAtr = trs.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
  atrSeries.push(runningAtr);
  for (let i = period; i < trs.length; i++) {
    runningAtr = ((runningAtr * (period - 1)) + trs[i]) / period;
    atrSeries.push(runningAtr);
  }

  const atrSorted = [...atrSeries].sort((a, b) => a - b);
  const median = atrSorted[Math.floor(atrSorted.length / 2)] || 0;
  const p90 = atrSorted[Math.floor(atrSorted.length * 0.9)] || median;
  const max = atrSorted[atrSorted.length - 1] || p90;
  const latest = atrSeries[atrSeries.length - 1] || median;

  return {
    atr: latest,
    atrMedian: median,
    atr90: p90,
    atrMax: max
  };
}

function computePriceRangeStats(priceData, windowSize = 60) {
  if (!Array.isArray(priceData) || priceData.length === 0) {
    return {
      medianRange: 0,
      range80: 0,
      range90: 0,
      range95: 0,
      range98: 0
    };
  }

  const ranges = [];
  const window = Math.max(1, Math.round(windowSize));

  for (let i = 0; i < priceData.length; i++) {
    const start = Math.max(0, i - window + 1);
    let maxHigh = -Infinity;
    let minLow = Infinity;

    for (let j = start; j <= i; j++) {
      const candle = priceData[j];
      if (!candle) continue;
      const high = Number.isFinite(candle.high) ? candle.high : candle.close;
      const low = Number.isFinite(candle.low) ? candle.low : candle.close;
      if (!Number.isFinite(high) || !Number.isFinite(low) || low <= 0) continue;
      if (high > maxHigh) maxHigh = high;
      if (low < minLow) minLow = low;
    }

    if (!Number.isFinite(maxHigh) || !Number.isFinite(minLow) || minLow <= 0) {
      continue;
    }

    const rangePercent = ((maxHigh - minLow) / minLow) * 100;
    if (Number.isFinite(rangePercent)) {
      ranges.push(rangePercent);
    }
  }

  if (!ranges.length) {
    return {
      medianRange: 0,
      range80: 0,
      range90: 0,
      range95: 0,
      range98: 0
    };
  }

  const percentileValues = computePercentiles(ranges, [0.5, 0.8, 0.9, 0.95, 0.98]);

  return {
    medianRange: percentileValues[0.5] || 0,
    range80: percentileValues[0.8] || percentileValues[0.5] || 0,
    range90: percentileValues[0.9] || percentileValues[0.8] || 0,
    range95: percentileValues[0.95] || percentileValues[0.9] || 0,
    range98: percentileValues[0.98] || percentileValues[0.95] || 0
  };
}

function determineMinDcaSlots(range95) {
  if (!Number.isFinite(range95) || range95 <= 0) {
    return 6;
  }
  if (range95 >= 8) return 24;
  if (range95 >= 6) return 18;
  if (range95 >= 4) return 12;
  if (range95 >= 2) return 8;
  return 6;
}

function computeVolatilityPenalty(rangeStats, combinedDrawdown, margin, combinedPnl) {
  if (!rangeStats || !Number.isFinite(rangeStats.range95)) {
    return 0;
  }
  if (!Number.isFinite(combinedDrawdown) || !Number.isFinite(margin) || !Number.isFinite(combinedPnl)) {
    return 0;
  }
  if (margin <= 0 || combinedDrawdown <= 0) {
    return 0;
  }

  const volatilityExcess = Math.max(0, rangeStats.range95 - 4);
  if (volatilityExcess <= 0) {
    return 0;
  }

  const drawdownRatio = combinedDrawdown / margin;
  const penaltyFactor = Math.max(0, drawdownRatio - 0.75);
  if (penaltyFactor <= 0) {
    return 0;
  }

  const base = Math.max(combinedPnl, margin);
  return volatilityExcess * penaltyFactor * (base * 0.1);
}

function generateTpCandidates(volStats, currentTp, atrPercentStats = null) {
  const base = Math.max(volStats.avgAbsReturn || 0.3, 0.1);
  const highVol = Math.max(volStats.perc95 || base * 2, base);
  const midVol = Math.max(volStats.perc90 || base, base);

  const atrBase = atrPercentStats?.atr || base;
  const atrMedian = atrPercentStats?.atrMedian || atrBase;
  const atr90 = atrPercentStats?.atr90 || Math.max(atrMedian * 1.5, atrBase * 1.5);
  const atrMax = atrPercentStats?.atrMax || Math.max(atr90 * 1.5, atrBase * 2);

  const anchors = Number.isFinite(currentTp) && currentTp > 0
    ? [currentTp, currentTp * 0.5, currentTp * 0.75, currentTp * 1.25, currentTp * 1.5, currentTp * 2]
    : [];

  const general = [0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  const dynamic = [
    base * 0.5,
    base * 0.75,
    base,
    base * 1.25,
    base * 1.5,
    midVol,
    highVol,
    highVol * 1.5,
    highVol * 2,
    atrBase,
    atrMedian,
    atr90,
    atrMax,
    atrMedian * 0.75,
    atrMax * 1.25
  ];

  const rawCandidates = [...general, ...dynamic, ...anchors]
    .map(val => Number.isFinite(val) ? parseFloat(val.toFixed(2)) : null)
    .filter(val => typeof val === 'number' && val > 0.05 && val <= 40);

  const candidates = sampleCandidates(rawCandidates, modeSettings.tpMax)
    .filter(val => val >= 0.1 && val <= 30);  // Basic sanity bounds only

  return candidates;
}

function generateSlCandidates(volStats, currentSl, atrPercentStats = null) {
  const base = Math.max(volStats.perc95 || volStats.avgAbsReturn * 2 || currentSl || 1, 0.5);
  const atrBase = atrPercentStats?.atr || base;
  const atrMedian = atrPercentStats?.atrMedian || atrBase;
  const atr90 = atrPercentStats?.atr90 || Math.max(atrMedian * 1.5, base);
  const atrMax = atrPercentStats?.atrMax || Math.max(atr90 * 1.5, base * 2);

  const anchors = Number.isFinite(currentSl) && currentSl > 0
    ? [currentSl, currentSl * 0.5, currentSl * 0.75, currentSl * 1.25, currentSl * 1.5, currentSl * 2, currentSl * 3]
    : [];

  const general = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10, 12.5, 15];
  const dynamic = [
    base * 0.5,
    base * 0.75,
    base,
    base * 1.25,
    base * 1.5,
    base * 2,
    base * 3,
    atrBase,
    atrMedian,
    atr90,
    atrMax,
    atrMedian * 0.5
  ];

  const rawCandidates = [...general, ...dynamic, ...anchors]
    .map(val => Number.isFinite(val) ? parseFloat(val.toFixed(2)) : null)
    .filter(val => typeof val === 'number' && val > 0.1 && val <= 80);

  const candidates = sampleCandidates(rawCandidates, modeSettings.slMax)
    .filter(val => val >= 0.1 && val <= 40);  // Basic sanity bounds only

  return candidates;
}

function generateLeverageCandidates(currentLeverage) {
  const baseCandidates = [currentLeverage, 5, 7.5, 10, 12.5, 15, 17.5, 20, 25];
  const filtered = dedupeAndSort(baseCandidates).filter(val => val > 0 && val <= 25);
  return sampleCandidates(filtered, modeSettings.leverageMax);
}

function generateMarginCandidates(capitalBudget, currentMargin, minMargin = 0, minRequired = 0) {
  const clampedMin = Math.max(0, Math.min(capitalBudget, minMargin || 0));
  const base = Math.max(clampedMin, currentMargin > 0 ? currentMargin : Math.min(capitalBudget, minRequired || capitalBudget * 0.5));
  const multiples = [0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const generated = multiples
    .map(mult => Math.min(capitalBudget, Math.max(clampedMin, base * mult)))
    .concat([currentMargin, minRequired, capitalBudget * 0.6, capitalBudget * 0.85, capitalBudget]);
  const sanitized = dedupeAndSort(generated)
    .filter(val => Number.isFinite(val) && val > 0 && val <= capitalBudget + 1e-6);
  return sampleCandidates(sanitized, modeSettings.marginMax);
}

async function optimizeSymbolParameters(symbol, symbolConfig, capitalBudget, spanDays, leverageBrackets = {}) {
  const cloneConfig = { ...symbolConfig };

  const baseLongTradeSize = symbolConfig.longTradeSize ?? symbolConfig.tradeSize ?? 20;
  const baseShortTradeSize = symbolConfig.shortTradeSize ?? symbolConfig.tradeSize ?? baseLongTradeSize;
  const baseTradeSize = baseLongTradeSize;
  const currentMargin = symbolConfig.maxPositionMarginUSDT || Math.max(baseTradeSize * 5, 50);
  const leverageCurrent = symbolConfig.leverage || 10;
  const currentLongThreshold = symbolConfig.longVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;
  const currentShortThreshold = symbolConfig.shortVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;
  const currentTp = symbolConfig.tpPercent || 1;
  const currentSl = symbolConfig.slPercent || 5;
  const thresholdEnabled = symbolConfig.useThreshold !== false;
  const longBasePositions = Math.max(1, Math.floor(currentMargin / (baseTradeSize || 1)) || 1);
  const shortBasePositions = Math.max(1, Math.floor(currentMargin / (baseShortTradeSize || 1)) || 1);

  const diagnostics = ENABLE_DIAGNOSTICS
    ? {
        symbol,
        startHrTime: process.hrtime.bigint(),
        candidateCounts: {},
        rejections: {
          invalidMargin: 0,
          invalidTradeSize: 0,
          invalidMaxPositions: 0,
          slotDepth: 0,
          tierLimit: 0,
          missingLongSide: 0,
          missingShortSide: 0,
          profitFactor: 0,
          stopRate: 0,
          liquidationSafety: 0,
          riskReward: 0,
          winRate: 0,
          nonFiniteScore: 0
        },
        combinationsEvaluated: 0,
        combinationsAccepted: 0,
        backtests: { executed: 0, cacheHits: 0 },
        scenariosEvaluated: 0,
        tierAdjustments: 0
      }
    : null;

  const scenarioProfiles = ENABLE_SCENARIOS
    ? [
        {
          name: 'stress_high',
          overrides: {
            slippageMultiplier: 1.6,
            limitFillRate: 0.6,
            marketFallbackRate: 0.22
          }
        },
        {
          name: 'calm',
          overrides: {
            slippageMultiplier: 0.75,
            limitFillRate: 0.92,
            marketFallbackRate: 0.05
          }
        }
      ]
    : [];

  // Preload price data for volatility estimation
  const priceData = await getCachedHistoricalPrices(symbol, '1m', 10080);
  const volStats = computePriceVolatility(priceData);
  const rangeStats = computePriceRangeStats(priceData, 60);
  const atrStatsRaw = computeAtrStats(priceData);
  const lastClose = priceData?.[priceData.length - 1]?.close || 0;
  const priceDivisor = lastClose > 0 ? lastClose : 1;
  const atrPercentStats = {
    atr: atrStatsRaw.atr > 0 ? (atrStatsRaw.atr / priceDivisor) * 100 : volStats.perc90,
    atrMedian: atrStatsRaw.atrMedian > 0 ? (atrStatsRaw.atrMedian / priceDivisor) * 100 : volStats.avgAbsReturn,
    atr90: atrStatsRaw.atr90 > 0 ? (atrStatsRaw.atr90 / priceDivisor) * 100 : volStats.perc95,
    atrMax: atrStatsRaw.atrMax > 0 ? (atrStatsRaw.atrMax / priceDivisor) * 100 : volStats.perc95 * 1.5
  };
  const minSlotsFromVolatility = determineMinDcaSlots(rangeStats.range95);
  const requiredLongSlots = Math.max(longBasePositions, minSlotsFromVolatility);
  const requiredShortSlots = Math.max(shortBasePositions, minSlotsFromVolatility);
  const baseSlotMargin = Math.max(longBasePositions * baseTradeSize, shortBasePositions * baseShortTradeSize);
  const minRequiredMargin = Math.max(requiredLongSlots * baseTradeSize, requiredShortSlots * baseShortTradeSize);
  if (capitalBudget < minRequiredMargin) {
    console.log(`⚠️  ${symbol}: Available capital (${formatNumber(capitalBudget)}) is below volatility-driven minimum margin requirement (${formatNumber(minRequiredMargin)}). Optimization will be constrained.`);
  }
  const applyVolatilityPenalty = VOLATILITY_PENALTY_FACTOR > 0;

  const currentTimeWindowMs = symbolConfig.thresholdTimeWindow || DEFAULT_THRESHOLD_WINDOW_MS;
  const currentCooldownMs = symbolConfig.thresholdCooldown || DEFAULT_THRESHOLD_COOLDOWN_MS;
  const timeWindowCandidates = thresholdEnabled
    ? generateTimeWindowCandidates(symbol, currentTimeWindowMs, volStats)
    : [currentTimeWindowMs];
  const cooldownCandidates = thresholdEnabled
    ? generateCooldownCandidates(symbol, currentCooldownMs, timeWindowCandidates, volStats)
    : [currentCooldownMs];

  const longThresholdData = generateThresholdCandidates(symbol, 'SELL', currentLongThreshold || 1000);
  const shortThresholdData = generateThresholdCandidates(symbol, 'BUY', currentShortThreshold || 1000);
  const longThresholdCandidates = longThresholdData.candidates;
  const shortThresholdCandidates = shortThresholdData.candidates;
  const minLongThresholdAllowed = longThresholdData.minAllowed || 0;
  const minShortThresholdAllowed = shortThresholdData.minAllowed || 0;
  if (!longThresholdCandidates.length) {
    longThresholdCandidates.push(Math.max(minLongThresholdAllowed, currentLongThreshold || 10));
  }
  if (!shortThresholdCandidates.length) {
    shortThresholdCandidates.push(Math.max(minShortThresholdAllowed, currentShortThreshold || 10));
  }

  const tpCandidatesFull = generateTpCandidates(volStats, currentTp, atrPercentStats);
  const slCandidatesFull = generateSlCandidates(volStats, currentSl, atrPercentStats);
  const tpCandidates = tpCandidatesFull.length > 10
    ? [...tpCandidatesFull.slice(0, 5), ...tpCandidatesFull.slice(-5)]
    : tpCandidatesFull;
  const slCandidates = slCandidatesFull.length > 10
    ? [...slCandidatesFull.slice(0, 5), ...slCandidatesFull.slice(-5)]
    : slCandidatesFull;
  const leverageCandidates = generateLeverageCandidates(leverageCurrent);
  if (!leverageCandidates.length) {
    leverageCandidates.push(leverageCurrent);
  }

  const marginMinConstraint = Math.min(capitalBudget, Math.max(minRequiredMargin, currentMargin, baseSlotMargin));
  const marginCandidates = generateMarginCandidates(capitalBudget, currentMargin, marginMinConstraint, minRequiredMargin);
  if (!marginCandidates.length) {
    marginCandidates.push(marginMinConstraint > 0 ? marginMinConstraint : Math.max(currentMargin, 1));
  }

  if (diagnostics) {
    diagnostics.candidateCounts = {
      longThreshold: longThresholdCandidates.length,
      shortThreshold: shortThresholdCandidates.length,
      tp: tpCandidates.length,
      sl: slCandidates.length,
      leverage: leverageCandidates.length,
      margin: marginCandidates.length,
      timeWindow: thresholdEnabled ? timeWindowCandidates.length : 1,
      cooldown: thresholdEnabled ? cooldownCandidates.length : 1
    };
  }

  const backtestCache = new Map();
  const defaultCooldownMs = Math.max(0, currentCooldownMs);
  const defaultWindowMs = Math.max(5_000, currentTimeWindowMs || DEFAULT_THRESHOLD_WINDOW_MS);
  const defaultHunterCooldownMs = HUNTER_COOLDOWN_MS;

  const runBacktest = async (side, threshold, maxPositions, tradeSize, leverage, tp, sl, overrides = {}) => {
    const {
      cooldownMs = defaultCooldownMs,
      hunterCooldownMs = defaultHunterCooldownMs,
      windowMs = defaultWindowMs
    } = overrides;

    const key = [side, threshold, maxPositions, tradeSize, leverage, tp, sl, cooldownMs, hunterCooldownMs, windowMs]
      .map(v => Number.isFinite(v) ? Number(v).toFixed(6) : v)
      .join('|');

    if (backtestCache.has(key)) {
      if (diagnostics) {
        diagnostics.backtests.cacheHits += 1;
      }
      return backtestCache.get(key);
    }

    if (diagnostics) {
      diagnostics.backtests.executed += 1;
    }

    const result = await backtestSymbol(
      symbol,
      side,
      Math.max(1, Math.round(threshold)),
      maxPositions,
      tradeSize,
      leverage,
      tp,
      sl,
      {
        suppressLogs: true,
        cooldownMs,
        hunterCooldownMs,
        windowMs
      }
    );

    backtestCache.set(key, result);
    return result;
  };

  // Baseline performance
  const currentLongBacktest = await runBacktest('SELL', Math.max(1, currentLongThreshold), longBasePositions, baseTradeSize, leverageCurrent, currentTp, currentSl);
  const currentShortBacktest = await runBacktest('BUY', Math.max(1, currentShortThreshold), shortBasePositions, baseShortTradeSize, leverageCurrent, currentTp, currentSl);
  const currentTotalPnl = currentLongBacktest.totalPnl + currentShortBacktest.totalPnl;
  const dailyFactor = spanDays > 0 ? 1 / spanDays : 1;
  const currentDailyPnl = currentTotalPnl * dailyFactor;

  // Calculate initial scores for current config
  const rawCurrentLongSharpe = currentLongBacktest.sharpeRatio || 0;
  const rawCurrentShortSharpe = currentShortBacktest.sharpeRatio || 0;
  const cappedCurrentLongSharpe = Number.isFinite(rawCurrentLongSharpe) ? Math.min(Math.max(rawCurrentLongSharpe, -5), 5) : 0;
  const cappedCurrentShortSharpe = Number.isFinite(rawCurrentShortSharpe) ? Math.min(Math.max(rawCurrentShortSharpe, -5), 5) : 0;
  const currentSharpe = (cappedCurrentLongSharpe + cappedCurrentShortSharpe) / 2;
  const currentDrawdown = Math.max(currentLongBacktest.maxDrawdown || 1, currentShortBacktest.maxDrawdown || 1);
  const currentDrawdownScore = currentTotalPnl / (currentDrawdown + 1);
  const currentScoreRaw = (
    (currentTotalPnl * normalizedScoringWeights.pnl) +
    (currentSharpe * normalizedScoringWeights.sharpe) +
    (currentDrawdownScore * normalizedScoringWeights.drawdown)
  );
  const currentVolatilityPenaltyRaw = computeVolatilityPenalty(rangeStats, currentDrawdown, currentMargin, currentTotalPnl);
  const currentVolatilityPenalty = currentVolatilityPenaltyRaw * VOLATILITY_PENALTY_FACTOR;
  const currentFinalScore = applyVolatilityPenalty
    ? currentScoreRaw - currentVolatilityPenalty
    : currentScoreRaw;
  const currentCvar = Math.abs(((currentLongBacktest.cvar || 0) + (currentShortBacktest.cvar || 0)) / 2);
  const currentCvarPenalty = currentCvar * CVAR_PENALTY_WEIGHT;
  const currentFinalScoreAdjusted = currentFinalScore - currentCvarPenalty;
  const currentPayoff = ((currentLongBacktest.payoffRatio || 0) + (currentShortBacktest.payoffRatio || 0)) / 2;

  const baselineLongMaxPositions = Math.max(1, Math.floor(currentMargin / (baseTradeSize || 1)) || 1);
  const baselineShortMaxPositions = Math.max(1, Math.floor(currentMargin / (baseShortTradeSize || 1)) || 1);
  const baselineTierLong = calculateMaxPositionsForLeverage(
    symbol,
    baseTradeSize,
    leverageCurrent,
    currentMargin,
    leverageBrackets
  );
  const baselineTierShort = calculateMaxPositionsForLeverage(
    symbol,
    baseShortTradeSize,
    leverageCurrent,
    currentMargin,
    leverageBrackets
  );
  const baselineAllowedLongPositions = Math.max(
    1,
    Math.min(
      baselineLongMaxPositions,
      Number.isFinite(baselineTierLong) && baselineTierLong > 0 ? baselineTierLong : baselineLongMaxPositions
    )
  );
  const baselineAllowedShortPositions = Math.max(
    1,
    Math.min(
      baselineShortMaxPositions,
      Number.isFinite(baselineTierShort) && baselineTierShort > 0 ? baselineTierShort : baselineShortMaxPositions
    )
  );

  let bestCombination = {
    totalPnl: currentTotalPnl,
    finalScore: currentFinalScoreAdjusted,
    sharpeRatio: currentSharpe,
    drawdownScore: currentDrawdownScore,
    volatilityPenalty: currentVolatilityPenalty,
    leverage: leverageCurrent,
    margin: currentMargin,
    tp: currentTp,
    sl: currentSl,
    long: {
      threshold: Math.max(1, currentLongThreshold),
      result: currentLongBacktest,
      tradeSize: baseTradeSize,
      maxPositions: baselineAllowedLongPositions
    },
    short: {
      threshold: Math.max(1, currentShortThreshold),
      result: currentShortBacktest,
      tradeSize: baseShortTradeSize,
      maxPositions: baselineAllowedShortPositions
    },
    scenarioSummary: [],
    scenarioPenalty: 0,
    cvarPenalty: currentCvarPenalty,
    cvar: currentCvar,
    payoffRatio: currentPayoff
  };

  for (const leverage of leverageCandidates) {
    for (const margin of marginCandidates) {
      if (!Number.isFinite(margin) || margin <= 0) {
        if (diagnostics) diagnostics.rejections.invalidMargin += 1;
        continue;
      }

      const longTradeSize = baseTradeSize;
      const shortTradeSize = baseShortTradeSize;

      if (!Number.isFinite(longTradeSize) || longTradeSize <= 0 || !Number.isFinite(shortTradeSize) || shortTradeSize <= 0) {
        if (diagnostics) diagnostics.rejections.invalidTradeSize += 1;
        continue;
      }

      const longMaxPositions = Math.max(1, Math.floor(margin / longTradeSize));
      const shortMaxPositions = Math.max(1, Math.floor(margin / shortTradeSize));

      if (!Number.isFinite(longMaxPositions) || longMaxPositions <= 0 || !Number.isFinite(shortMaxPositions) || shortMaxPositions <= 0) {
        if (diagnostics) diagnostics.rejections.invalidMaxPositions += 1;
        continue;
      }

      const tierMaxLong = calculateMaxPositionsForLeverage(
        symbol,
        longTradeSize,
        leverage,
        margin,
        leverageBrackets
      );
      const tierMaxShort = calculateMaxPositionsForLeverage(
        symbol,
        shortTradeSize,
        leverage,
        margin,
        leverageBrackets
      );

      if (!Number.isFinite(tierMaxLong) || !Number.isFinite(tierMaxShort) || tierMaxLong <= 0 || tierMaxShort <= 0) {
        if (diagnostics) diagnostics.rejections.tierLimit += 1;
        continue;
      }

      const tierAdjusted = tierMaxLong < requiredLongSlots || tierMaxShort < requiredShortSlots;
      if (tierAdjusted && diagnostics) diagnostics.tierAdjustments += 1;

      const effectiveLongRequirement = Math.max(1, Math.min(requiredLongSlots, tierMaxLong));
      const effectiveShortRequirement = Math.max(1, Math.min(requiredShortSlots, tierMaxShort));
      const allowedLongPositions = Math.max(1, Math.min(longMaxPositions, tierMaxLong));
      const allowedShortPositions = Math.max(1, Math.min(shortMaxPositions, tierMaxShort));

      if (allowedLongPositions < effectiveLongRequirement || allowedShortPositions < effectiveShortRequirement) {
        if (diagnostics) diagnostics.rejections.slotDepth += 1;
        continue;
      }

      for (const tp of tpCandidates) {
        for (const sl of slCandidates) {
          let bestLongSide = null;
          for (const threshold of longThresholdCandidates) {
            if (!IS_THOROUGH_MODE && threshold < minLongThresholdAllowed) {
              continue;
            }
            const candidateThreshold = Math.max(1, threshold);
            const result = await runBacktest('SELL', candidateThreshold, allowedLongPositions, longTradeSize, leverage, tp, sl);
            if (!bestLongSide || result.totalPnl > bestLongSide.result.totalPnl) {
              bestLongSide = {
                threshold: candidateThreshold,
                result,
                tradeSize: longTradeSize,
                maxPositions: allowedLongPositions
              };
            }
          }

          let bestShortSide = null;
          for (const threshold of shortThresholdCandidates) {
            if (!IS_THOROUGH_MODE && threshold < minShortThresholdAllowed) {
              continue;
            }
            const candidateThreshold = Math.max(1, threshold);
            const result = await runBacktest('BUY', candidateThreshold, allowedShortPositions, shortTradeSize, leverage, tp, sl);
            if (!bestShortSide || result.totalPnl > bestShortSide.result.totalPnl) {
              bestShortSide = {
                threshold: candidateThreshold,
                result,
                tradeSize: shortTradeSize,
                maxPositions: allowedShortPositions
              };
            }
          }

          if (!bestLongSide || !bestShortSide) {
            if (diagnostics) {
              if (!bestLongSide) diagnostics.rejections.missingLongSide += 1;
              if (!bestShortSide) diagnostics.rejections.missingShortSide += 1;
            }
            continue;
          }

          const combinedPnl = bestLongSide.result.totalPnl + bestShortSide.result.totalPnl;
          const stopExitCount = (bestLongSide.result.exitReasons?.SL || 0) + (bestShortSide.result.exitReasons?.SL || 0);
          const totalTrades = (bestLongSide.result.totalTrades || 0) + (bestShortSide.result.totalTrades || 0);
          const stopRate = totalTrades > 0 ? stopExitCount / totalTrades : 0;
          const combinedProfitFactor = ((bestLongSide.result.profitFactor || 0) + (bestShortSide.result.profitFactor || 0)) / 2;

          // Skip combinations with poor profit factor or excessive stop rate
          if (combinedProfitFactor < 1.05 || stopRate > 0.65) {
            if (diagnostics) {
              if (combinedProfitFactor < 1.05) diagnostics.rejections.profitFactor += 1;
              if (stopRate > 0.65) diagnostics.rejections.stopRate += 1;
            }
            continue;
          }

          // CRITICAL: Liquidation distance check
          // Liquidation occurs at approximately (100 / leverage)% price move
          // Leave 10% safety margin for fees, funding, and slippage
          const liquidationDistance = (100 / leverage) * 0.9; // 90% of theoretical distance
          if (sl >= liquidationDistance) {
            if (diagnostics) diagnostics.rejections.liquidationSafety += 1;
            continue;  // SL would never execute - position gets liquidated first!
          }

          // Risk management constraint: Enforce minimum R:R ratio
          // Reject if TP/SL < 0.33 (worse than 1:3 R:R - requires >75% win rate)
          const riskRewardRatio = tp / sl;
          if (riskRewardRatio < 0.33) {
            if (diagnostics) diagnostics.rejections.riskReward += 1;
            continue;  // Skip combinations with terrible R:R ratios
          }

          // Calculate required win rate for profitability
          // Required WR = SL / (TP + SL)
          const requiredWinRate = sl / (tp + sl);
          const combinedWinRate = ((bestLongSide.result.winRate || 0) + (bestShortSide.result.winRate || 0)) / 2 / 100;

          // Skip if backtest win rate is below required (with 5% safety margin)
          if (combinedWinRate < requiredWinRate + 0.05) {
            if (diagnostics) diagnostics.rejections.winRate += 1;
            continue;  // Not profitable enough even in optimistic backtest
          }

          // Tri-factor weighted scoring system (weights configured via UI sliders)
          // Factor 1: Total PnL - prioritizes profit and capital deployment
          const pnlScore = combinedPnl;

          // Factor 2: Sharpe Ratio - monitors consistency
          // Cap Sharpe at 5.0 to prevent infinity from unrealistic backtests
          const rawLongSharpe = bestLongSide.result.sharpeRatio || 0;
          const rawShortSharpe = bestShortSide.result.sharpeRatio || 0;
          const cappedLongSharpe = Number.isFinite(rawLongSharpe) ? Math.min(Math.max(rawLongSharpe, -5), 5) : 0;
          const cappedShortSharpe = Number.isFinite(rawShortSharpe) ? Math.min(Math.max(rawShortSharpe, -5), 5) : 0;
          const combinedSharpe = (cappedLongSharpe + cappedShortSharpe) / 2;

          // Factor 3: PnL per Drawdown - keeps risk in check
          const combinedDrawdown = Math.max(bestLongSide.result.maxDrawdown || 1, bestShortSide.result.maxDrawdown || 1);
          const drawdownScore = combinedPnl / (combinedDrawdown + 1);  // +1 to avoid division by zero
          const combinedCvar = Math.abs(((bestLongSide.result.cvar || 0) + (bestShortSide.result.cvar || 0)) / 2);
          const combinedPayoff = ((bestLongSide.result.payoffRatio || 0) + (bestShortSide.result.payoffRatio || 0)) / 2;
          const cvarPenalty = Math.max(0, combinedCvar) * CVAR_PENALTY_WEIGHT;

          // Calculate weighted final score using normalized weights from the optimizer configuration
          const finalScore = (
            (pnlScore * normalizedScoringWeights.pnl) +
            (combinedSharpe * normalizedScoringWeights.sharpe) +
            (drawdownScore * normalizedScoringWeights.drawdown)
          ) - cvarPenalty;

          // Sanity check for NaN/Infinity
          if (!Number.isFinite(finalScore)) {
            if (diagnostics) diagnostics.rejections.nonFiniteScore += 1;
            continue;
          }

          const volatilityPenaltyRaw = computeVolatilityPenalty(rangeStats, combinedDrawdown, margin, combinedPnl);
          const volatilityPenalty = volatilityPenaltyRaw * VOLATILITY_PENALTY_FACTOR;
          const adjustedScore = applyVolatilityPenalty ? (finalScore - volatilityPenalty) : finalScore;
          if (diagnostics) diagnostics.combinationsEvaluated += 1;
          if (!Number.isFinite(adjustedScore)) {
            if (diagnostics) diagnostics.rejections.nonFiniteScore += 1;
            continue;
          }

          let scenarioPenalty = 0;
          let scenarioAdjustedScore = adjustedScore;
          let scenarioSummary = [];

          if (ENABLE_SCENARIOS && scenarioProfiles.length) {
            const scenarioResults = [];
            for (const profile of scenarioProfiles) {
              const overrides = {
                suppressLogs: true,
                ...profile.overrides
              };
              if (diagnostics) diagnostics.scenariosEvaluated += 1;
              const longScenario = await runBacktest(
                'SELL',
                bestLongSide.threshold,
                bestLongSide.maxPositions,
                longTradeSize,
                leverage,
                tp,
                sl,
                overrides
              );
              const shortScenario = await runBacktest(
                'BUY',
                bestShortSide.threshold,
                bestShortSide.maxPositions,
                shortTradeSize,
                leverage,
                tp,
                sl,
                overrides
              );
              const totalScenarioPnl = longScenario.totalPnl + shortScenario.totalPnl;
              const scenarioDrawdown = Math.max(longScenario.maxDrawdown || 1, shortScenario.maxDrawdown || 1);
              const scenarioSharpe = ((longScenario.sharpeRatio || 0) + (shortScenario.sharpeRatio || 0)) / 2;
              scenarioResults.push({
                name: profile.name,
                totalPnl: totalScenarioPnl,
                maxDrawdown: scenarioDrawdown,
                sharpeRatio: scenarioSharpe
              });
            }

            if (scenarioResults.length) {
              const worst = scenarioResults.reduce((prev, curr) => curr.totalPnl < prev.totalPnl ? curr : prev, scenarioResults[0]);
              scenarioPenalty = Math.max(0, (combinedPnl - worst.totalPnl) * SCENARIO_PENALTY_WEIGHT);
              scenarioAdjustedScore = adjustedScore - scenarioPenalty;
              scenarioSummary = scenarioResults;
            }
          }

          if (scenarioAdjustedScore > bestCombination.finalScore) {
            if (diagnostics) diagnostics.combinationsAccepted += 1;
            bestCombination = {
              totalPnl: combinedPnl,
              finalScore: scenarioAdjustedScore,
              sharpeRatio: combinedSharpe,
              drawdownScore: drawdownScore,
              volatilityPenalty,
              leverage,
              margin,
              tp,
              sl,
              long: bestLongSide,
              short: bestShortSide,
              scenarioPenalty,
              scenarioSummary,
              cvarPenalty,
              cvar: combinedCvar,
              payoffRatio: combinedPayoff
            };
          }
        }
      }
    }
  }

  let bestWindowMs = currentTimeWindowMs;
  let bestCooldownMs = currentCooldownMs;
  let cachedBestScore = bestCombination.finalScore;
  let cachedBestLongResult = bestCombination.long.result;
  let cachedBestShortResult = bestCombination.short.result;

  if (thresholdEnabled) {
    for (const windowMs of timeWindowCandidates) {
      for (const cooldownMs of cooldownCandidates) {
        const longResult = await runBacktest(
          'SELL',
          Math.max(1, bestCombination.long.threshold),
          bestCombination.long.maxPositions,
          bestCombination.long.tradeSize,
          bestCombination.leverage,
          bestCombination.tp,
          bestCombination.sl,
          { windowMs, cooldownMs }
        );

        const shortResult = await runBacktest(
          'BUY',
          Math.max(1, bestCombination.short.threshold),
          bestCombination.short.maxPositions,
          bestCombination.short.tradeSize,
          bestCombination.leverage,
          bestCombination.tp,
          bestCombination.sl,
          { windowMs, cooldownMs }
        );

        const metrics = calculateCombinationScore(longResult, shortResult);
        const metricsPenaltyRaw = computeVolatilityPenalty(rangeStats, metrics.combinedDrawdown, bestCombination.margin, metrics.combinedPnl);
        const metricsPenalty = metricsPenaltyRaw * VOLATILITY_PENALTY_FACTOR;
        const metricsScore = applyVolatilityPenalty ? (metrics.finalScore - metricsPenalty) : metrics.finalScore;

        if (metricsScore > cachedBestScore + 1e-6) {
          cachedBestScore = metricsScore;
          cachedBestLongResult = longResult;
          cachedBestShortResult = shortResult;
          bestWindowMs = windowMs;
          bestCooldownMs = cooldownMs;
          bestCombination.totalPnl = metrics.combinedPnl;
          bestCombination.sharpeRatio = metrics.combinedSharpe;
          bestCombination.drawdownScore = metrics.drawdownScore;
          bestCombination.volatilityPenalty = metricsPenalty;
        }
      }
    }
  }

  bestCombination.finalScore = cachedBestScore;
  bestCombination.long.result = cachedBestLongResult;
  bestCombination.short.result = cachedBestShortResult;
  bestCombination.windowMs = bestWindowMs;
  bestCombination.cooldownMs = bestCooldownMs;

  const finalMetrics = calculateCombinationScore(bestCombination.long.result, bestCombination.short.result);

  if (ENABLE_SCENARIOS && scenarioProfiles.length) {
    const scenarioResults = [];
    for (const profile of scenarioProfiles) {
      const overrides = {
        suppressLogs: true,
        windowMs: bestCombination.windowMs,
        cooldownMs: bestCombination.cooldownMs,
        ...profile.overrides
      };
      const longScenario = await runBacktest(
        'SELL',
        bestCombination.long.threshold,
        bestCombination.long.maxPositions,
        bestCombination.long.tradeSize,
        bestCombination.leverage,
        bestCombination.tp,
        bestCombination.sl,
        overrides
      );
      const shortScenario = await runBacktest(
        'BUY',
        bestCombination.short.threshold,
        bestCombination.short.maxPositions,
        bestCombination.short.tradeSize,
        bestCombination.leverage,
        bestCombination.tp,
        bestCombination.sl,
        overrides
      );
      const totalScenarioPnl = longScenario.totalPnl + shortScenario.totalPnl;
      const scenarioDrawdown = Math.max(longScenario.maxDrawdown || 1, shortScenario.maxDrawdown || 1);
      const scenarioSharpe = ((longScenario.sharpeRatio || 0) + (shortScenario.sharpeRatio || 0)) / 2;
      scenarioResults.push({
        name: profile.name,
        totalPnl: totalScenarioPnl,
        maxDrawdown: scenarioDrawdown,
        sharpeRatio: scenarioSharpe
      });
    }

    if (scenarioResults.length) {
      const worst = scenarioResults.reduce((prev, curr) => (curr.totalPnl < prev.totalPnl ? curr : prev), scenarioResults[0]);
      bestCombination.scenarioPenalty = Math.max(0, (finalMetrics.combinedPnl - worst.totalPnl) * SCENARIO_PENALTY_WEIGHT);
      bestCombination.scenarioSummary = scenarioResults;
    }
  }

  const finalPenaltyRaw = computeVolatilityPenalty(rangeStats, finalMetrics.combinedDrawdown, bestCombination.margin, finalMetrics.combinedPnl);
  const finalPenalty = finalPenaltyRaw * VOLATILITY_PENALTY_FACTOR;
  const finalScoreWithPenalty = applyVolatilityPenalty ? (finalMetrics.finalScore - finalPenalty) : finalMetrics.finalScore;
  const finalCvar = Math.abs(((bestCombination.long.result.cvar || 0) + (bestCombination.short.result.cvar || 0)) / 2);
  const finalCvarPenalty = finalCvar * CVAR_PENALTY_WEIGHT;
  bestCombination.cvarPenalty = finalCvarPenalty;
  const combinedPayoffRatio = ((bestCombination.long.result.payoffRatio || 0) + (bestCombination.short.result.payoffRatio || 0)) / 2;
  bestCombination.cvar = finalCvar;
  bestCombination.payoffRatio = combinedPayoffRatio;
  const finalScenarioAdjusted = finalScoreWithPenalty - (bestCombination.scenarioPenalty || 0) - finalCvarPenalty;
  bestCombination.totalPnl = finalMetrics.combinedPnl;
  bestCombination.sharpeRatio = finalMetrics.combinedSharpe;
  bestCombination.drawdownScore = finalMetrics.drawdownScore;
  bestCombination.finalScore = Math.max(bestCombination.finalScore, finalScenarioAdjusted);
  bestCombination.volatilityPenalty = finalPenalty;

  const optimizedDailyPnl = bestCombination.totalPnl * dailyFactor;

  const longImprovement = (bestCombination.long.result.totalPnl - currentLongBacktest.totalPnl) * dailyFactor;
  const shortImprovement = (bestCombination.short.result.totalPnl - currentShortBacktest.totalPnl) * dailyFactor;

  const vwapOptimized = symbolConfig.vwapProtection === false
    ? false
    : (bestCombination.long.threshold < Math.max(1, currentLongThreshold) * 0.7
      || bestCombination.short.threshold < Math.max(1, currentShortThreshold) * 0.7
      ? false
      : symbolConfig.vwapProtection);

  const optimizedSymbolConfig = {
    ...cloneConfig,
    longVolumeThresholdUSDT: Math.round(bestCombination.long.threshold),
    shortVolumeThresholdUSDT: Math.round(bestCombination.short.threshold),
    tradeSize: parseFloat((bestCombination.long.tradeSize).toFixed(2)),
    longTradeSize: parseFloat((bestCombination.long.tradeSize).toFixed(2)),
    shortTradeSize: parseFloat((bestCombination.short.tradeSize).toFixed(2)),
    maxPositionMarginUSDT: parseFloat(bestCombination.margin.toFixed(2)),
    leverage: bestCombination.leverage,
    tpPercent: parseFloat(bestCombination.tp.toFixed(2)),
    slPercent: parseFloat(bestCombination.sl.toFixed(2)),
    vwapProtection: vwapOptimized,
    thresholdTimeWindow: Math.round(bestCombination.windowMs || currentTimeWindowMs),
    thresholdCooldown: Math.round(bestCombination.cooldownMs || currentCooldownMs)
  };

  // Calculate and display max DCA positions based on leverage tiers
  const desiredLongPositions = Math.max(requiredLongSlots, minSlotsFromVolatility);
  const desiredShortPositions = Math.max(requiredShortSlots, minSlotsFromVolatility);

  const maxLongPositions = calculateMaxPositionsForLeverage(
    symbol,
    bestCombination.long.tradeSize,
    bestCombination.leverage,
    bestCombination.margin,
    leverageBrackets
  );
  const maxShortPositions = calculateMaxPositionsForLeverage(
    symbol,
    bestCombination.short.tradeSize,
    bestCombination.leverage,
    bestCombination.margin,
    leverageBrackets
  );

  // Warn if tier limits would restrict DCA capacity
  const tierWarning = (leverageBrackets[symbol] && (maxLongPositions < desiredLongPositions || maxShortPositions < desiredShortPositions))
    ? {
        hasWarning: true,
        maxLongPositions,
        wantedLongPositions: desiredLongPositions,
        maxShortPositions,
        wantedShortPositions: desiredShortPositions,
        message: `Leverage tier limits will restrict DCA positions. Max LONG: ${maxLongPositions} (wanted ${desiredLongPositions}), Max SHORT: ${maxShortPositions} (wanted ${desiredShortPositions}). Consider reducing leverage or trade size for more DCA room.`
      }
    : { hasWarning: false };

  if (tierWarning.hasWarning) {
    console.log(`⚠️  ${symbol}: ${tierWarning.message}\n`);
  }

  let diagnosticsSummary = null;
  if (diagnostics) {
    const durationMs = Number(process.hrtime.bigint() - diagnostics.startHrTime) / 1e6;
    const counts = diagnostics.candidateCounts;
    diagLog(
      `${symbol} candidate grids -> L-threshold:${counts.longThreshold} | S-threshold:${counts.shortThreshold} | TP:${counts.tp} | SL:${counts.sl} | leverage:${counts.leverage} | margin:${counts.margin} | window:${counts.timeWindow} | cooldown:${counts.cooldown}`
    );
    diagLog(
      `${symbol} combos evaluated:${diagnostics.combinationsEvaluated} accepted:${diagnostics.combinationsAccepted} backtests(executed:${diagnostics.backtests.executed}, cacheHits:${diagnostics.backtests.cacheHits}) scenarios:${diagnostics.scenariosEvaluated} duration:${durationMs.toFixed(1)}ms`
    );
    if (diagnostics.tierAdjustments) {
      diagLog(
        `${symbol} tier adjustments -> ${diagnostics.tierAdjustments} combos clipped to leverage-tier limits`
      );
    }
    const rejectionEntries = Object.entries(diagnostics.rejections)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${key}=${value}`);
    diagLog(
      `${symbol} rejection summary -> ${rejectionEntries.length ? rejectionEntries.join(', ') : 'none'}`
    );

    diagnosticsSummary = {
      candidateCounts: diagnostics.candidateCounts,
      rejections: diagnostics.rejections,
      backtests: diagnostics.backtests,
      combinationsEvaluated: diagnostics.combinationsEvaluated,
      combinationsAccepted: diagnostics.combinationsAccepted,
      scenariosEvaluated: diagnostics.scenariosEvaluated,
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
      tierAdjustments: diagnostics.tierAdjustments
    };
  }

  return {
    symbol,
    tierWarning,
    current: {
      longThreshold: Math.max(1, currentLongThreshold),
      shortThreshold: Math.max(1, currentShortThreshold),
      tradeSize: baseTradeSize,
      longTradeSize: baseTradeSize,
      shortTradeSize: baseShortTradeSize,
      margin: currentMargin,
      leverage: leverageCurrent,
      tp: currentTp,
      sl: currentSl,
      longMaxPositions: baselineAllowedLongPositions,
      shortMaxPositions: baselineAllowedShortPositions,
      thresholdTimeWindow: currentTimeWindowMs,
      thresholdCooldown: currentCooldownMs,
      performance: {
        long: currentLongBacktest,
        short: currentShortBacktest,
        totalPnl: currentTotalPnl,
        dailyPnl: currentDailyPnl
      },
      volatilityPenalty: currentVolatilityPenalty,
      cvarPenalty: currentCvarPenalty,
      cvar: currentCvar,
      payoffRatio: currentPayoff
    },
    optimized: {
      config: optimizedSymbolConfig,
      long: bestCombination.long,
      short: bestCombination.short,
      leverage: bestCombination.leverage,
      thresholdTimeWindow: bestCombination.windowMs,
      thresholdCooldown: bestCombination.cooldownMs,
      tp: bestCombination.tp,
      sl: bestCombination.sl,
      totalPnl: bestCombination.totalPnl,
      dailyPnl: optimizedDailyPnl,
      finalScore: bestCombination.finalScore,
      sharpeRatio: bestCombination.sharpeRatio,
      drawdownScore: bestCombination.drawdownScore,
      volatilityPenalty: bestCombination.volatilityPenalty,
      cvarPenalty: bestCombination.cvarPenalty || 0,
      cvar: bestCombination.cvar || 0,
      payoffRatio: bestCombination.payoffRatio || 0,
      scenarioPenalty: bestCombination.scenarioPenalty || 0,
      scenarios: bestCombination.scenarioSummary || []
    },
    improvements: {
      long: longImprovement,
      short: shortImprovement,
      totalDaily: optimizedDailyPnl - currentDailyPnl
    },
    spanDays,
    capitalBudget,
    diagnostics: diagnosticsSummary
  };
}

function getSymbolDataSpanDays(symbol) {
  if (symbolSpanCache.has(symbol)) {
    return symbolSpanCache.get(symbol);
  }

  const spanRow = db.prepare(`
    SELECT MIN(event_time) as first_time, MAX(event_time) as last_time
    FROM liquidations
    WHERE symbol = ?
  `).get(symbol);

  let spanDays = 0;
  if (spanRow && typeof spanRow.first_time === 'number' && typeof spanRow.last_time === 'number' && spanRow.last_time > spanRow.first_time) {
    spanDays = (spanRow.last_time - spanRow.first_time) / DAY_MS;
  }

  const minimumSpan = 1 / 24; // Assume at least 1 hour of data to avoid division by zero
  spanDays = Math.max(spanDays, minimumSpan);
  symbolSpanCache.set(symbol, spanDays);
  return spanDays;
}

// Helper function to analyze 60-second rolling windows
function analyzeRollingWindows(symbol, side, threshold, windowSize = 60000) {
  // Get all liquidations for this symbol and side, ordered by time
  const liquidations = db.prepare(`
    SELECT event_time, volume_usdt
    FROM liquidations
    WHERE symbol = ? AND side = ?
    ORDER BY event_time
  `).all(symbol, side);

  if (liquidations.length === 0) {
    return { totalTriggers: 0, avgWindowVolume: 0, maxWindowVolume: 0, dailyTriggers: 0 };
  }

  let triggers = 0;
  let windowVolumes = [];

  // For each liquidation, calculate the rolling 60-second window volume
  for (let i = 0; i < liquidations.length; i++) {
    const currentTime = liquidations[i].event_time;
    const windowStart = currentTime - windowSize;

    // Find all liquidations within the 60-second window BEFORE and INCLUDING current
    let windowVolume = 0;

    for (let j = i; j >= 0; j--) {
      if (liquidations[j].event_time >= windowStart && liquidations[j].event_time <= currentTime) {
        windowVolume += liquidations[j].volume_usdt;
      } else if (liquidations[j].event_time < windowStart) {
        break; // No need to go further back
      }
    }

    windowVolumes.push(windowVolume);

    // Check if this window crosses the threshold
    if (windowVolume >= threshold) {
      triggers++;
    }
  }

  const avgWindowVolume = windowVolumes.length > 0
    ? windowVolumes.reduce((a, b) => a + b, 0) / windowVolumes.length
    : 0;
  const maxWindowVolume = windowVolumes.length > 0
    ? Math.max(...windowVolumes)
    : 0;

  const spanMs = liquidations[liquidations.length - 1].event_time - liquidations[0].event_time;
  const spanDays = Math.max(spanMs / DAY_MS, 1 / 24);

  return {
    totalTriggers: triggers,
    avgWindowVolume,
    maxWindowVolume,
    dailyTriggers: spanDays > 0 ? triggers / spanDays : 0,
    spanDays
  };
}

// 1. Current Config Performance Analysis using Rolling Windows
function analyzeCurrentConfig() {
  console.log('???? ROLLING 60-SECOND WINDOW ANALYSIS');
  console.log('=====================================\n');

  for (const [symbol, symbolConfig] of getSelectedSymbolEntries()) {
    console.log(`???? ${symbol} Analysis:`);

    const timeWindowMs = symbolConfig.thresholdTimeWindow || DEFAULT_THRESHOLD_WINDOW_MS;
    const longThreshold = symbolConfig.longVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;
    const shortThreshold = symbolConfig.shortVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;
    const tradeSize = symbolConfig.tradeSize || 20;
    const leverage = symbolConfig.leverage || 10;
    const tpPercent = symbolConfig.tpPercent || 1;
    const profitPerTrade = tradeSize * leverage * (tpPercent / 100);

    // Analyze rolling windows for LONG opportunities (SELL liquidations)
    const longAnalysis = analyzeRollingWindows(symbol, 'SELL', longThreshold);
    const shortAnalysis = analyzeRollingWindows(symbol, 'BUY', shortThreshold);

    console.log(`   ???? LONG Opportunities (${(timeWindowMs/1000).toFixed(0)}s rolling SELL liquidations):`);
    console.log(`      Threshold: $${formatLargeNumber(longThreshold)}`);
    console.log(`      Daily Triggers: ${longAnalysis.dailyTriggers.toFixed(1)}`);
    console.log(`      Daily Profit: $${formatLargeNumber(longAnalysis.dailyTriggers * profitPerTrade)}`);
    console.log(`      Avg Window Volume: $${formatLargeNumber(longAnalysis.avgWindowVolume)}`);
    console.log(`      Max Window Volume: $${formatLargeNumber(longAnalysis.maxWindowVolume)}`);

    console.log(`   ???? SHORT Opportunities (${(timeWindowMs/1000).toFixed(0)}s rolling BUY liquidations):`);
    console.log(`      Threshold: $${formatLargeNumber(shortThreshold)}`);
    console.log(`      Daily Triggers: ${shortAnalysis.dailyTriggers.toFixed(1)}`);
    console.log(`      Daily Profit: $${formatLargeNumber(shortAnalysis.dailyTriggers * profitPerTrade)}`);
    console.log(`      Avg Window Volume: $${formatLargeNumber(shortAnalysis.avgWindowVolume)}`);
    console.log(`      Max Window Volume: $${formatLargeNumber(shortAnalysis.maxWindowVolume)}`);

    const totalDailyProfit = (longAnalysis.dailyTriggers + shortAnalysis.dailyTriggers) * profitPerTrade;
    console.log(`   ???? Total Daily Profit: $${formatLargeNumber(totalDailyProfit)}`);
    console.log();
  }
}

// 2. Threshold Optimization Analysis using Rolling Windows
function optimizeThresholds() {
  console.log('???? ROLLING WINDOW THRESHOLD OPTIMIZATION');
  console.log('========================================\n');

  const defaultSymbols = ['ASTERUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const focusSymbols = requestedSymbols.size === 0
    ? defaultSymbols.filter(symbol => config.symbols[symbol])
    : getSelectedSymbolsList();

  focusSymbols.forEach(symbol => {
    if (!config.symbols[symbol]) return;

    console.log(`???? ${symbol} Rolling Window Optimization:`);

    const symbolConfig = config.symbols[symbol];
    const timeWindowMs = symbolConfig.thresholdTimeWindow || DEFAULT_THRESHOLD_WINDOW_MS;
    const tradeSize = symbolConfig.tradeSize || 20;
    const leverage = symbolConfig.leverage || 10;
    const tpPercent = symbolConfig.tpPercent || 1;
    const profitPerTrade = tradeSize * leverage * (tpPercent / 100);
    const currentLong = symbolConfig.longVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;
    const currentShort = symbolConfig.shortVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;

    // Test different threshold levels
    const thresholds = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 25000, 50000];

    console.log(`   ???? LONG Opportunities (${(timeWindowMs/1000).toFixed(0)}s rolling SELL liquidations):`);
    console.log('   Threshold | Daily Triggers | Daily Profit | Current');
    console.log('   ----------|----------------|--------------|--------');

    thresholds.forEach(threshold => {
      const analysis = analyzeRollingWindows(symbol, 'SELL', threshold, timeWindowMs);
      const dailyProfit = analysis.dailyTriggers * profitPerTrade;
      const isCurrent = threshold === currentLong ? ' <- CURRENT' : '';

      console.log(`   $${threshold.toString().padEnd(8)} | ${analysis.dailyTriggers.toFixed(1).padEnd(14)} | $${formatLargeNumber(dailyProfit).padEnd(12)} |${isCurrent}`);
    });

    console.log('\n   ???? SHORT Opportunities (${(timeWindowMs/1000).toFixed(0)}s rolling BUY liquidations):');
    console.log('   Threshold | Daily Triggers | Daily Profit | Current');
    console.log('   ----------|----------------|--------------|--------');

    thresholds.forEach(threshold => {
      const analysis = analyzeRollingWindows(symbol, 'BUY', threshold, timeWindowMs);
      const dailyProfit = analysis.dailyTriggers * profitPerTrade;
      const isCurrent = threshold === currentShort ? ' <- CURRENT' : '';

      console.log(`   $${threshold.toString().padEnd(8)} | ${analysis.dailyTriggers.toFixed(1).padEnd(14)} | $${formatLargeNumber(dailyProfit).padEnd(12)} |${isCurrent}`);
    });

    console.log();
  });
}

// 3. Symbol Profitability Ranking
function rankSymbolProfitability() {
  console.log('???? SYMBOL PROFITABILITY RANKING');
  console.log('-------------------------------\n');

  const symbolStats = [];

  for (const [symbol, symbolConfig] of getSelectedSymbolEntries()) {
    const tradeSize = symbolConfig.tradeSize || 20;
    const leverage = symbolConfig.leverage || 10;
    const tpPercent = symbolConfig.tpPercent || 1;
    const longThreshold = symbolConfig.longVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;
    const shortThreshold = symbolConfig.shortVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;

    const stats = db.prepare(`
      SELECT
        COUNT(CASE WHEN side = 'SELL' AND volume_usdt >= ? THEN 1 END) as long_triggers,
        COUNT(CASE WHEN side = 'BUY' AND volume_usdt >= ? THEN 1 END) as short_triggers,
        COUNT(CASE WHEN side = 'SELL' THEN 1 END) as total_long_opportunities,
        COUNT(CASE WHEN side = 'BUY' THEN 1 END) as total_short_opportunities,
        AVG(CASE WHEN side = 'SELL' THEN volume_usdt END) as avg_long_volume,
        AVG(CASE WHEN side = 'BUY' THEN volume_usdt END) as avg_short_volume
      FROM liquidations
      WHERE symbol = ?
    `).get(longThreshold, shortThreshold, symbol);

    if (!stats || (stats.long_triggers + stats.short_triggers) === 0) continue;

    const profitPerTrade = tradeSize * leverage * (tpPercent / 100);
    const totalTriggers = stats.long_triggers + stats.short_triggers;
    const estimatedProfit = totalTriggers * profitPerTrade;
    const spanDays = getSymbolDataSpanDays(symbol);
    const dailyTriggers = spanDays > 0 ? totalTriggers / spanDays : 0;
    const dailyProfit = spanDays > 0 ? estimatedProfit / spanDays : 0;

    symbolStats.push({
      symbol,
      totalTriggers,
      estimatedProfit,
      dailyTriggers,
      dailyProfit,
      profitPerTrade,
      longCaptureRate: stats.total_long_opportunities > 0
        ? (stats.long_triggers / stats.total_long_opportunities * 100)
        : 0,
      shortCaptureRate: stats.total_short_opportunities > 0
        ? (stats.short_triggers / stats.total_short_opportunities * 100)
        : 0
    });
  }

  // Sort by daily profit
  symbolStats.sort((a, b) => b.dailyProfit - a.dailyProfit);

  console.log('Ranking by Daily Profit Potential:');
  console.log('Rank | Symbol    | Daily Triggers | Daily Profit | Capture Rate | Profit/Trade');
  console.log('-----|-----------|----------------|--------------|--------------|-------------');

  symbolStats.forEach((stat, i) => {
    console.log(`${(i + 1).toString().padEnd(4)} | ${stat.symbol.padEnd(9)} | ${stat.dailyTriggers.toFixed(1).padEnd(14)} | $${formatLargeNumber(stat.dailyProfit).padEnd(11)} | ${((stat.longCaptureRate + stat.shortCaptureRate) / 2).toFixed(1)}%${' '.padEnd(8)} | $${formatNumber(stat.profitPerTrade)}`);
  });

  console.log();
}

// Helper function to calculate risk metrics
function calculateRiskMetrics(trades) {
  if (trades.length === 0) {
    return { sharpeRatio: 0, maxDrawdown: 0, maxDrawdownPercent: 0, profitFactor: 0, cvar: 0, payoffRatio: 0 };
  }

  // Calculate returns for each trade
  const returns = trades.map(t => t.pnl);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate standard deviation
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Sharpe Ratio (assuming risk-free rate of 0)
  const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

  // Maximum Drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let runningPnl = 0;

  for (const trade of trades) {
    runningPnl += trade.pnl;
    if (runningPnl > peak) {
      peak = runningPnl;
    }
    const drawdown = peak - runningPnl;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  const maxDrawdownPercent = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

  // Profit Factor (total wins / total losses)
  const totalWins = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? Infinity : 0);

  const sortedReturns = [...returns].sort((a, b) => a - b);
  const tailCount = Math.max(1, Math.floor(sortedReturns.length * 0.05));
  const tailLosses = sortedReturns.slice(0, tailCount);
  const cvar = tailLosses.length ? tailLosses.reduce((sum, val) => sum + val, 0) / tailLosses.length : 0;
  const payoffRatio = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  return { sharpeRatio, maxDrawdown, maxDrawdownPercent, profitFactor, cvar, payoffRatio };
}

// REALISTIC BACKTEST ENGINE with Historical Price Integration
async function backtestSymbol(symbol, side, threshold, maxPositions, tradeSize, leverage, tpPercent, slPercent, options = {}) {
  const suppressLogs = options.suppressLogs || false;
  const cooldownMs = Number.isFinite(options.cooldownMs) ? Math.max(0, options.cooldownMs) : 0;
  const hunterCooldownMs = Number.isFinite(options.hunterCooldownMs) ? Math.max(0, options.hunterCooldownMs) : HUNTER_COOLDOWN_MS;
  const windowMs = Number.isFinite(options.windowMs) ? Math.max(1_000, options.windowMs) : DEFAULT_THRESHOLD_WINDOW_MS;
  const timeRange = options.timeRange || null;
  const priceDataOverride = Array.isArray(options.priceDataOverride) ? options.priceDataOverride : null;
  const slippageMultiplier = Number.isFinite(options.slippageMultiplier) ? Math.max(0.25, options.slippageMultiplier) : 1;
  const limitFillRate = Number.isFinite(options.limitFillRate) ? Math.min(Math.max(options.limitFillRate, 0.1), 0.99) : LIMIT_FILL_RATE;
  const marketFallbackRate = Number.isFinite(options.marketFallbackRate) ? Math.min(Math.max(options.marketFallbackRate, 0), 0.5) : MARKET_FALLBACK_RATE;
  const entryMarketSlippage = EXIT_SLIPPAGE.ENTRY_MARKET * slippageMultiplier;
  const exitSlippageCfg = {
    TP: EXIT_SLIPPAGE.TP * slippageMultiplier,
    SL: EXIT_SLIPPAGE.SL * slippageMultiplier,
    SL_VOLATILE: EXIT_SLIPPAGE.SL_VOLATILE * slippageMultiplier
  };
  const log = (...args) => {
    if (!suppressLogs) {
      console.log(...args);
    }
  };

  log(`???? Backtesting ${symbol} ${side === 'SELL' ? 'LONG' : 'SHORT'} with $${threshold} threshold...`);

  // Get liquidations ordered by time
  let liquidations = db.prepare(`
    SELECT event_time, volume_usdt, price
    FROM liquidations
    WHERE symbol = ? AND side = ?
    ORDER BY event_time
  `).all(symbol, side);

  if (timeRange && Number.isFinite(timeRange.start) && Number.isFinite(timeRange.end) && timeRange.end > timeRange.start) {
    liquidations = liquidations.filter(row => row.event_time >= timeRange.start && row.event_time <= timeRange.end);
  }

  if (liquidations.length === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, totalPnl: 0, winRate: 0,
      avgWin: 0, avgLoss: 0, avgDuration: 0, activePositions: 0,
      sharpeRatio: 0, maxDrawdown: 0, maxDrawdownPercent: 0,
      profitFactor: 0, cvar: 0, payoffRatio: 0
    };
  }

  // Get historical price data from API for accurate TP/SL simulation
  let priceData = [];
  if (priceDataOverride) {
    priceData = priceDataOverride;
  } else {
    try {
      priceData = await getCachedHistoricalPrices(symbol, '1m', 10080); // Last ~7 days at 1-minute resolution
    } catch (_error) {
      log(`   ??????  Could not fetch historical prices for ${symbol}, using liquidation prices`);
    }
  }

  // If we have historical price data, use it; otherwise fall back to liquidation prices
  let allPrices = priceData.length > 0
    ? priceData.map(p => ({ event_time: p.timestamp, price: p.close, high: p.high, low: p.low }))
    : db.prepare(`SELECT event_time, price, price as high, price as low FROM liquidations WHERE symbol = ? ORDER BY event_time`).all(symbol);

  if (timeRange && Number.isFinite(timeRange.start) && Number.isFinite(timeRange.end)) {
    allPrices = allPrices.filter(row => row.event_time >= timeRange.start && row.event_time <= timeRange.end);
  }

  let activePositions = [];
  let completedTrades = [];
  let totalPnl = 0;
  let priceIndex = 0;
  let lastEntryTime = -Infinity;
  let lastHunterEntryTime = -Infinity;

  // Calculate volatility factor from recent price movements (for slippage adjustment)
  const calculateVolatilityFactor = (currentIndex, lookbackPeriods = 20) => {
    if (allPrices.length < 2) return 1.0;

    const startIndex = Math.max(0, currentIndex - lookbackPeriods);
    const endIndex = Math.min(allPrices.length, currentIndex + 1);
    const slice = allPrices.slice(startIndex, endIndex);

    if (slice.length < 2) return 1.0;

    // Calculate average absolute return
    let sumAbsReturn = 0;
    let count = 0;
    for (let i = 1; i < slice.length; i++) {
      const prev = slice[i - 1].price || slice[i - 1].close;
      const curr = slice[i].price || slice[i].close;
      if (prev > 0) {
        sumAbsReturn += Math.abs((curr - prev) / prev);
        count++;
      }
    }

    if (count === 0) return 1.0;

    const avgReturn = sumAbsReturn / count;
    // Volatility factor: 1.0 = normal (0.5% avg move), scales up/down from there
    return Math.max(0.5, Math.min(3.0, avgReturn / 0.005));
  };

  const recordExit = (pos, exitPrice, exitReason, priceEventTime, volatilityFactor = 1.0) => {
    // Apply realistic slippage based on order type and market conditions
    let actualExitPrice = exitPrice;

    if (exitReason === 'TP') {
      // TAKE_PROFIT_MARKET: fills slightly worse than trigger price
      actualExitPrice = pos.isLong
        ? exitPrice * (1 - exitSlippageCfg.TP)
        : exitPrice * (1 + exitSlippageCfg.TP);
    } else if (exitReason === 'SL') {
      // STOP_MARKET: worse slippage, especially in volatile conditions
      const slippageRate = volatilityFactor > 1.5 ? exitSlippageCfg.SL_VOLATILE : exitSlippageCfg.SL;
      actualExitPrice = pos.isLong
        ? exitPrice * (1 - slippageRate)  // LONG SL: sell fills even lower
        : exitPrice * (1 + slippageRate); // SHORT SL: buy fills even higher
    }
    // EOD exits use actual exit price (no slippage)

    // Calculate gross PnL before commissions
    const grossPnl = pos.isLong
      ? (actualExitPrice - pos.entryPrice) * pos.size
      : (pos.entryPrice - actualExitPrice) * pos.size;

    // Calculate commission costs
    // Entry: mostly LIMIT (maker fee), some MARKET (taker fee)
    // Exit: TP uses TAKE_PROFIT_MARKET (taker), SL uses STOP_MARKET (taker)
    const notional = tradeSize * leverage;
    const entryCommission = notional * (COMMISSION.MAKER_FEE * 0.9 + COMMISSION.TAKER_FEE * 0.1); // 90% LIMIT, 10% MARKET
    const exitCommission = exitReason === 'EOD'
      ? notional * COMMISSION.MAKER_FEE  // EOD might use LIMIT
      : notional * COMMISSION.TAKER_FEE; // TP/SL use MARKET orders

    // Apply fill multiplier for order chunking (PositionManager splits orders)
    const totalCommission = (entryCommission + exitCommission) * COMMISSION.AVG_FILLS_PER_TRADE;

    // Net PnL after commissions
    const netPnl = grossPnl - totalCommission;

    totalPnl += netPnl;
    completedTrades.push({
      symbol,
      side: pos.isLong ? 'LONG' : 'SHORT',
      entryPrice: pos.entryPrice,
      exitPrice: actualExitPrice,
      triggerPrice: exitPrice,  // Store original trigger price for comparison
      slippage: Math.abs(actualExitPrice - exitPrice),
      grossPnl,           // PnL before commissions
      commission: totalCommission,  // Total commission cost
      pnl: netPnl,        // Net PnL after commissions
      exitReason,
      duration: priceEventTime - pos.entryTime,
      margin: tradeSize,
      volatilityFactor: exitReason === 'SL' ? volatilityFactor : null
    });
  };

  const evaluatePositionsOnBar = (priceBar, barIndex) => {
    const volatilityFactor = calculateVolatilityFactor(barIndex);

    activePositions = activePositions.filter(pos => {
      let shouldExit = false;
      let exitReason = null;
      let exitPrice = null;

      // Check if both TP and SL were touched in this candle
      const tpTouched = pos.isLong ? priceBar.high >= pos.tpPrice : priceBar.low <= pos.tpPrice;
      const slTouched = pos.isLong ? priceBar.low <= pos.slPrice : priceBar.high >= pos.slPrice;

      if (tpTouched && slTouched) {
        // Both touched - determine which hit first based on distance from entry
        const tpDistance = Math.abs(pos.tpPrice - pos.entryPrice);
        const slDistance = Math.abs(pos.slPrice - pos.entryPrice);

        // Probabilistic model: 70% of time, closer target hits first
        // 30% of time, further target hits (price whipsaws)
        const closerHitsFirst = Math.random() < 0.70;

        if (closerHitsFirst) {
          if (slDistance < tpDistance) {
            // SL is closer - assume it hit first (more realistic)
            exitReason = 'SL';
            exitPrice = pos.slPrice;
          } else {
            // TP is closer - assume it hit first
            exitReason = 'TP';
            exitPrice = pos.tpPrice;
          }
        } else {
          // Whipsaw scenario - further target hits
          if (slDistance < tpDistance) {
            exitReason = 'TP';
            exitPrice = pos.tpPrice;
          } else {
            exitReason = 'SL';
            exitPrice = pos.slPrice;
          }
        }
        shouldExit = true;
      } else if (tpTouched) {
        // Only TP touched
        shouldExit = true;
        exitReason = 'TP';
        exitPrice = pos.tpPrice;
      } else if (slTouched) {
        // Only SL touched
        shouldExit = true;
        exitReason = 'SL';
        exitPrice = pos.slPrice;
      }

      if (shouldExit) {
        recordExit(pos, exitPrice, exitReason, priceBar.event_time, volatilityFactor);
        return false;
      }
      return true;
    });
  };

  // Process each liquidation event
  for (let i = 0; i < liquidations.length; i++) {
    const currentEvent = liquidations[i];
    const currentTime = currentEvent.event_time;
    const windowStart = currentTime - windowMs;

    // Calculate rolling window volume
    let windowVolume = 0;
    for (let j = i; j >= 0; j--) {
      if (liquidations[j].event_time >= windowStart && liquidations[j].event_time <= currentTime) {
        windowVolume += liquidations[j].volume_usdt;
      } else if (liquidations[j].event_time < windowStart) {
        break;
      }
    }

    // Check for position exits using ALL price data between last check and now
    while (priceIndex < allPrices.length && allPrices[priceIndex].event_time <= currentTime) {
      const priceBar = allPrices[priceIndex];
      evaluatePositionsOnBar(priceBar, priceIndex);
      priceIndex++;
    }

    // Check if we can open new position
    const cooldownElapsed = currentTime - lastEntryTime >= cooldownMs;
    const hunterCooldownElapsed = currentTime - lastHunterEntryTime >= hunterCooldownMs;
    if (windowVolume >= threshold && activePositions.length < maxPositions && cooldownElapsed && hunterCooldownElapsed) {
      if (Math.random() > limitFillRate) {
        if (!suppressLogs && Math.random() < 0.1) {
          log(`   ???? LIMIT order did not fill (non-fill simulation)`);
        }
        continue;
      }

      let entryPrice = currentEvent.price;
      if (Math.random() < marketFallbackRate) {
        const isLong = side === 'SELL';
        entryPrice = isLong
          ? entryPrice * (1 + entryMarketSlippage)
          : entryPrice * (1 - entryMarketSlippage);
      }

      const isLong = side === 'SELL'; // Buy on SELL liquidations, Sell on BUY liquidations

      const tpPrice = isLong
        ? entryPrice * (1 + tpPercent/100)
        : entryPrice * (1 - tpPercent/100);
      const slPrice = isLong
        ? entryPrice * (1 - slPercent/100)
        : entryPrice * (1 + slPercent/100);

      activePositions.push({
        entryPrice,
        entryTime: currentTime,
        tpPrice,
        slPrice,
        isLong,
        size: tradeSize * leverage / entryPrice
      });
      lastEntryTime = currentTime;
      lastHunterEntryTime = currentTime;
    }
  }

  while (priceIndex < allPrices.length) {
    const priceBar = allPrices[priceIndex];
    evaluatePositionsOnBar(priceBar, priceIndex);
    priceIndex++;
  }

  if (activePositions.length > 0) {
    const fallbackEvent = liquidations[liquidations.length - 1];
    const lastBar = allPrices.length > 0
      ? allPrices[allPrices.length - 1]
      : {
          event_time: fallbackEvent?.event_time || Date.now(),
          price: fallbackEvent?.price ?? 0
        };

    activePositions.forEach(pos => {
      const fallbackPrice = typeof lastBar.price === 'number' && lastBar.price > 0
        ? lastBar.price
        : pos.entryPrice;
      recordExit(pos, fallbackPrice, 'EOD', lastBar.event_time || pos.entryTime);
    });

    activePositions = [];
  }

  // Calculate statistics
  const wins = completedTrades.filter(t => t.pnl > 0).length;
  const losses = completedTrades.filter(t => t.pnl < 0).length;
  const winRate = completedTrades.length > 0 ? (wins / completedTrades.length * 100) : 0;
  const avgWin = wins > 0 ? completedTrades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0) / wins : 0;
  const avgLoss = losses > 0 ? completedTrades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0) / losses : 0;
  const avgDuration = completedTrades.length > 0 ? completedTrades.reduce((sum, t) => sum + t.duration, 0) / completedTrades.length / 1000 / 60 : 0; // minutes

  // Calculate risk metrics
  const riskMetrics = calculateRiskMetrics(completedTrades);

  return {
    totalTrades: completedTrades.length,
    wins,
    losses,
    totalPnl,
    winRate,
    avgWin,
    avgLoss,
    avgDuration,
    activePositions: activePositions.length,
    recentTrades: completedTrades.slice(-3),
    ...riskMetrics
  };
}

// 4. Generate REALISTIC Backtest Optimization Recommendations
async function generateRecommendations(deployableCapital, leverageBrackets = {}, progressBounds = {}) {
  console.log('REALISTIC BACKTEST OPTIMIZATION');
  console.log('===================================\n');

  const { start = 55, end = 90 } = progressBounds;
  const progressSpan = Math.max(0, end - start);

  const recommendations = [];
  const optimizedConfig = JSON.parse(JSON.stringify(config));
  const sanitizedCapital = Number.isFinite(deployableCapital) && deployableCapital > 0 ? deployableCapital : 0;

  const symbolEntries = getSelectedSymbolEntries();
  if (symbolEntries.length === 0) {
    if (progressSpan > 0) {
      emitProgress(end, 'No symbols configured for optimization');
    }
    return { recommendations, optimizedConfig, recommendedGlobalMax: 0 };
  }

  const baselineTotalMargin = symbolEntries.reduce((sum, [, cfg]) => {
    const baseMargin = cfg.maxPositionMarginUSDT || (cfg.tradeSize || 20) * 5;
    const perSide = Number.isFinite(baseMargin) && baseMargin > 0 ? baseMargin : 0;
    return sum + perSide * 2;
  }, 0);

  const scaleFactor = baselineTotalMargin > 0 && sanitizedCapital > 0
    ? Math.max(0.25, Math.min(2.5, sanitizedCapital / baselineTotalMargin))
    : 1;

  const totalSymbols = symbolEntries.length;
  let processedSymbols = 0;

  for (const [symbol, symbolConfig] of symbolEntries) {
    processedSymbols += 1;
    if (progressSpan > 0) {
      const symbolProgress = start + (processedSymbols / totalSymbols) * progressSpan;
      emitProgress(symbolProgress, `Optimizing ${symbol} (${processedSymbols}/${totalSymbols})`);
    }
    console.log(`Analyzing ${symbol} (${processedSymbols}/${totalSymbols})`);
    const spanDays = getSymbolDataSpanDays(symbol);
    const fallbackMargin = (symbolConfig.tradeSize || 20) * 5;
    const baseMargin = symbolConfig.maxPositionMarginUSDT || fallbackMargin;
    const capitalBudget = Math.max(5, Math.min(sanitizedCapital || baseMargin, baseMargin * scaleFactor));

    const optimization = await optimizeSymbolParameters(symbol, symbolConfig, capitalBudget, spanDays, leverageBrackets);

    const currentDaily = optimization.current.performance.dailyPnl;
    const optimizedDaily = optimization.optimized.dailyPnl;
    const delta = optimization.improvements.totalDaily;

    console.log('SUMMARY ' + symbol + ': current $' + currentDaily.toFixed(2) +
      ' -> $' + optimizedDaily.toFixed(2) + ' (?? $' + delta.toFixed(2) + '/day)');

    recommendations.push({
      symbol,
      tierWarning: optimization.tierWarning,
      currentLong: optimization.current.longThreshold,
      currentShort: optimization.current.shortThreshold,
      optimizedLong: optimization.optimized.config.longVolumeThresholdUSDT,
      optimizedShort: optimization.optimized.config.shortVolumeThresholdUSDT,
      currentTradeSize: optimization.current.tradeSize,
      currentLongTradeSize: optimization.current.longTradeSize,
      currentShortTradeSize: optimization.current.shortTradeSize,
      currentMargin: optimization.current.margin,
      currentLeverage: optimization.current.leverage,
      currentTp: optimization.current.tp,
      currentSl: optimization.current.sl,
      currentLongMaxPositions: optimization.current.longMaxPositions,
      currentShortMaxPositions: optimization.current.shortMaxPositions,
      currentTimeWindow: optimization.current.thresholdTimeWindow,
      currentCooldown: optimization.current.thresholdCooldown,
      optimizedTradeSize: optimization.optimized.config.tradeSize,
      optimizedLongTradeSize: optimization.optimized.config.longTradeSize,
      optimizedShortTradeSize: optimization.optimized.config.shortTradeSize,
      optimizedMargin: optimization.optimized.config.maxPositionMarginUSDT,
      optimizedLeverage: optimization.optimized.leverage,
      optimizedTp: optimization.optimized.tp,
      optimizedSl: optimization.optimized.sl,
      optimizedLongMaxPositions: optimization.optimized.long.maxPositions,
      optimizedShortMaxPositions: optimization.optimized.short.maxPositions,
      optimizedTimeWindow: optimization.optimized.config.thresholdTimeWindow,
      optimizedCooldown: optimization.optimized.config.thresholdCooldown,
      longImprovement: optimization.improvements.long,
      shortImprovement: optimization.improvements.short,
      totalDailyImprovement: optimization.improvements.totalDaily,
      currentVolatilityPenalty: optimization.current.volatilityPenalty,
      currentCvarPenalty: optimization.current.cvarPenalty,
      currentCvar: optimization.current.cvar,
      currentPayoffRatio: optimization.current.payoffRatio,
      currentPerformance: optimization.current.performance,
      optimizedPerformance: {
        long: optimization.optimized.long.result,
        short: optimization.optimized.short.result,
        totalPnl: optimization.optimized.totalPnl,
        dailyPnl: optimization.optimized.dailyPnl
      },
      optimizedScore: optimization.optimized.finalScore,
      optimizedSharpe: optimization.optimized.sharpeRatio,
      optimizedDrawdownScore: optimization.optimized.drawdownScore,
      optimizedVolatilityPenalty: optimization.optimized.volatilityPenalty,
      optimizedCvarPenalty: optimization.optimized.cvarPenalty,
      optimizedScenarioPenalty: optimization.optimized.scenarioPenalty,
      optimizedCvar: optimization.optimized.cvar,
      optimizedPayoffRatio: optimization.optimized.payoffRatio,
      optimizedScenarios: optimization.optimized.scenarios,
      optimizedConfig: optimization.optimized.config,
      diagnostics: optimization.diagnostics,
      spanDays: optimization.spanDays
    });

    // CRITICAL FIX: Apply the optimized config to the final optimizedConfig object
    // This was missing - we were collecting recommendations but never updating optimizedConfig.symbols!
    optimizedConfig.symbols[symbol] = {
      ...optimizedConfig.symbols[symbol],
      ...optimization.optimized.config
    };
  }

  if (progressSpan > 0) {
    emitProgress(end, 'Per-symbol optimization complete');
  }

  console.log('KEY BACKTEST INSIGHTS:');
  console.log('- Optimization considers thresholds, TP/SL, trade size, leverage, and margin per symbol');
  console.log('- Deployable capital scaled to $' + formatLargeNumber(sanitizedCapital));
  console.log('- VWAP protection disabled automatically where aggressive thresholds outperform');
  console.log();

  // In hedge mode, maxOpenPositions counts unique symbols (hedged pairs count as one)
  // Each symbol can have LONG + SHORT positions, but counts as 1 for the global limit
  const recommendedGlobalMax = recommendations.length;

  const recommendedGlobalRounded = Math.max(1, Math.ceil(recommendedGlobalMax));

  if (!optimizedConfig.global) {
    optimizedConfig.global = {};
  }
  optimizedConfig.global.maxOpenPositions = recommendedGlobalRounded;

  const currentGlobalCap = config.global?.maxOpenPositions ?? 'n/a';
  console.log('Recommended global max open positions: ' + recommendedGlobalRounded + ' (current ' + currentGlobalCap + ')');
  console.log();

  return { recommendations, optimizedConfig, recommendedGlobalMax: recommendedGlobalRounded };
}// Capital allocation analysis for liquidation cascade strategy
function analyzeCapitalAllocation(balance, accountInfo, positions) {
  console.log('???? COMPLETE ACCOUNT SNAPSHOT');
  console.log('=============================\n');

  // Debug: Show raw account info
  console.log('???? DEBUG - Raw Account Data:');
  console.log('Balance API Response:', JSON.stringify(balance, null, 2));
  if (accountInfo) {
    console.log('Account API Response keys:', Object.keys(accountInfo));
    console.log('Account totalMarginBalance:', accountInfo.totalMarginBalance);
    console.log('Account totalWalletBalance:', accountInfo.totalWalletBalance);
  }
  console.log();

  console.log(`???? Account Balance Breakdown:`);
  console.log(`   Available Balance: $${formatLargeNumber(balance.availableBalance)}`);

  if (accountInfo) {
    // Calculate total account value properly
    const totalMarginBalance = parseFloat(accountInfo.totalMarginBalance || 0);
    const totalWalletBalance = parseFloat(accountInfo.totalWalletBalance || 0);
    const totalUnrealizedPNL = parseFloat(accountInfo.totalUnrealizedProfit || 0);
    const usedMargin = parseFloat(accountInfo.totalInitialMargin || 0);

    console.log(`   Total Margin Balance: $${formatLargeNumber(totalMarginBalance)}`);
    console.log(`   Total Wallet Balance: $${formatLargeNumber(totalWalletBalance)}`);
    console.log(`   Used in Positions: $${formatLargeNumber(usedMargin)}`);
    console.log(`   Unrealized PNL: $${formatLargeNumber(totalUnrealizedPNL)}`);
    console.log(`   Maintenance Margin: $${formatLargeNumber(parseFloat(accountInfo.totalMaintMargin || 0))}`);

    // Calculate true total account value
    const trueTotal = Math.max(totalMarginBalance, totalWalletBalance, balance.availableBalance + usedMargin);
    console.log(`   ???? CALCULATED TOTAL: $${formatLargeNumber(trueTotal)}`);

    // Store for later use
    this.calculatedTotal = trueTotal;
  }
  console.log();

  if (positions && positions.length > 0) {
    console.log(`???? CURRENT POSITIONS (${positions.length} active):`);
    console.log(`Symbol      | Side | Size      | Entry Price | Mark Price  | PNL      | Margin   | ROE%`);
    console.log(`------------|------|-----------|-------------|-------------|----------|----------|------`);

    let totalPNL = 0;
    let totalMargin = 0;

    positions.forEach(pos => {
      const pnl = parseFloat(pos.unRealizedProfit || 0);
      const positionAmt = parseFloat(pos.positionAmt || 0);
      const leverage = parseFloat(pos.leverage || 1) || 1;
      const entryPrice = parseFloat(pos.entryPrice || 0);
      const markPrice = parseFloat(pos.markPrice || 0);
      const notional = Math.abs(positionAmt * entryPrice);
      const marginFromExchange = parseFloat(pos.initialMargin || pos.positionInitialMargin || pos.isolatedMargin || 0);
      const derivedMargin = leverage > 0 ? notional / leverage : 0;
      const margin = marginFromExchange > 0 ? marginFromExchange : derivedMargin;
      const roe = margin > 0 ? (pnl / margin) * 100 : 0;

      totalPNL += pnl;
      totalMargin += margin;

      const side = positionAmt > 0 ? 'LONG' : 'SHORT';
      const size = Math.abs(positionAmt);

      console.log(`${pos.symbol.padEnd(11)} | ${side.padEnd(4)} | ${size.toFixed(4).padEnd(9)} | $${entryPrice.toFixed(4).padEnd(10)} | $${markPrice.toFixed(4).padEnd(10)} | $${pnl.toFixed(2).padEnd(8)} | $${margin.toFixed(2).padEnd(8)} | ${roe.toFixed(1)}%`);
    });

    console.log(`------------|------|-----------|-------------|-------------|----------|----------|------`);
    console.log(`TOTALS      |      |           |             |             | $${totalPNL.toFixed(2).padEnd(8)} | $${totalMargin.toFixed(2).padEnd(8)} |`);
    console.log();
  }

  let totalMaxAllocation = 0;
  const globalSettings = config.global;

  console.log(`?????? Global Settings:`);
  console.log(`   Risk Percent: ${globalSettings.riskPercent}%`);
  console.log(`   Max Open Positions: ${globalSettings.maxOpenPositions}`);
  console.log(`   Position Mode: ${globalSettings.positionMode}`);
  console.log();

  console.log(`???? Per-Symbol Capital Allocation:`);
  console.log(`Symbol      | Trade Size | Max Margin/Side | Max Positions | Strategy`);
  console.log(`------------|------------|------------------|---------------|----------`);

  for (const [symbol, symbolConfig] of getSelectedSymbolEntries()) {
    const tradeSize = symbolConfig.tradeSize || 20;
    const shortTradeSize = symbolConfig.shortTradeSize || tradeSize;
    const maxMarginPerSide = symbolConfig.maxPositionMarginUSDT || 100;
    const maxLongPositions = Math.floor(maxMarginPerSide / tradeSize);
    const maxShortPositions = Math.floor(maxMarginPerSide / shortTradeSize);

    totalMaxAllocation += maxMarginPerSide * 2;

    const _longThreshold = symbolConfig.longVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;
    const _shortThreshold = symbolConfig.shortVolumeThresholdUSDT || symbolConfig.volumeThresholdUSDT || 0;

    console.log(`${symbol.padEnd(11)} | $${tradeSize.toString().padEnd(9)} | $${maxMarginPerSide.toString().padEnd(16)} | ${maxLongPositions}L/${maxShortPositions}S${' '.padEnd(8)} | Cascade`);
  }

  console.log(`------------|------------|------------------|---------------|----------`);
  console.log(`TOTAL       |            | $${totalMaxAllocation.toString().padEnd(16)} |               |`);
  console.log();

  const utilizationRate = (totalMaxAllocation / balance.availableBalance * 100).toFixed(1);
  const safeUtilization = utilizationRate <= 80 ? '???' : utilizationRate <= 95 ? '??????' : '????';

  console.log(`???? Capital Utilization:`);
  console.log(`   Max Allocation (both sides): $${formatLargeNumber(totalMaxAllocation)} (${utilizationRate}% of available) ${safeUtilization}`);
  console.log(`   Safe Range: ???80% optimal, ???95% acceptable`);
  console.log();

  return { totalMaxAllocation, utilizationRate, calculatedTotal: this.calculatedTotal || 0 };
}

// Enhanced liquidation cascade analysis
function analyzeLiquidationCascades() {
  console.log('???? LIQUIDATION CASCADE ANALYSIS');
  console.log('================================\n');

  console.log('Strategy: Multiple Position Accumulation During Cascades');
  console.log('- Liquidation cascades create price dislocations');
  console.log('- Accumulate positions as price moves against liquidated traders');
  console.log('- Average down during cascades, exit on rebound\n');

  // Analyze cascade patterns in the data
  const cascadeAnalysis = db.prepare(`
    SELECT
      symbol,
      datetime(event_time/1000, 'unixepoch', 'start of minute') as minute,
      COUNT(*) as liquidation_count,
      SUM(volume_usdt) as total_volume,
      side
    FROM liquidations
    GROUP BY symbol, minute, side
    HAVING liquidation_count >= 3 OR total_volume >= 10000
    ORDER BY symbol, minute
  `).all();

  const cascadesBySymbol = {};
  cascadeAnalysis.forEach(row => {
    if (!cascadesBySymbol[row.symbol]) cascadesBySymbol[row.symbol] = [];
    cascadesBySymbol[row.symbol].push(row);
  });

  console.log('???? Cascade Frequency by Symbol:');
  console.log('Symbol      | Cascade Minutes | Avg Volume/Min | Max Liquidations/Min');
  console.log('------------|----------------|----------------|--------------------');

  for (const [symbol, cascades] of Object.entries(cascadesBySymbol)) {
    if (!config.symbols[symbol] || !shouldIncludeSymbol(symbol)) continue;

    const avgVolume = cascades.reduce((sum, c) => sum + c.total_volume, 0) / cascades.length;
    const maxLiqs = Math.max(...cascades.map(c => c.liquidation_count));

    console.log(`${symbol.padEnd(11)} | ${cascades.length.toString().padEnd(14)} | $${formatLargeNumber(avgVolume).padEnd(13)} | ${maxLiqs}`);
  }
  console.log();
}

// Main execution - now async
async function analyzeRealTradingHistory(credentials) {
  console.log('???? REAL TRADING HISTORY ANALYSIS');
  console.log('=================================\n');

  const defaultSymbols = ['ASTERUSDT'];
  const symbols = requestedSymbols.size === 0
    ? defaultSymbols.filter(symbol => config.symbols[symbol])
    : getSelectedSymbolsList();
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  for (const symbol of symbols) {
    if (!config.symbols[symbol]) continue;

    console.log(`???? ${symbol} Real Trade Analysis:`);

    try {
      // Get trades from last 7 days
      const trades = await getUserTrades(credentials, symbol, 1000, sevenDaysAgo);

      if (trades.length === 0) {
        console.log(`   No trades found in last 7 days`);
        console.log();
        continue;
      }

      // Analyze real trading performance
      let totalPnl = 0;
      let wins = 0;
      let losses = 0;
      let totalCommission = 0;

      trades.forEach(trade => {
        const pnl = parseFloat(trade.realizedPnl);
        const commission = parseFloat(trade.commission);

        totalPnl += pnl;
        totalCommission += Math.abs(commission);

        if (pnl > 0) wins++;
        else if (pnl < 0) losses++;
      });

      const totalTrades = wins + losses;
      const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
      const avgWin = wins > 0 ? trades.filter(t => parseFloat(t.realizedPnl) > 0).reduce((sum, t) => sum + parseFloat(t.realizedPnl), 0) / wins : 0;
      const avgLoss = losses > 0 ? Math.abs(trades.filter(t => parseFloat(t.realizedPnl) < 0).reduce((sum, t) => sum + parseFloat(t.realizedPnl), 0) / losses) : 0;
      const dailyPnl = totalPnl / 7;

      console.log(`   ???? Real Performance (Last 7 days):`);
      console.log(`      Total Trades: ${trades.length} fills (${totalTrades} with PnL)`);
      console.log(`      Win Rate: ${winRate.toFixed(1)}% (${wins}W/${losses}L)`);
      console.log(`      Total PnL: $${totalPnl.toFixed(2)} | Daily: $${dailyPnl.toFixed(2)}/day`);
      console.log(`      Avg Win: $${avgWin.toFixed(2)} | Avg Loss: $${avgLoss.toFixed(2)}`);
      console.log(`      Total Commissions: $${totalCommission.toFixed(2)}`);

      // Compare with backtest
      const symbolConfig = config.symbols[symbol];
      const currentLong = symbolConfig.longVolumeThresholdUSDT || 0;
      const tradeSize = symbolConfig.tradeSize || 20;
      const leverage = symbolConfig.leverage || 10;
      const tpPercent = symbolConfig.tpPercent || 1;
      const slPercent = symbolConfig.slPercent || 5;
      const maxPositions = Math.floor((symbolConfig.maxPositionMarginUSDT || 100) / tradeSize);

      const cooldownMs = symbolConfig.thresholdCooldown || DEFAULT_THRESHOLD_COOLDOWN_MS;
      const timeWindowMs = symbolConfig.thresholdTimeWindow || DEFAULT_THRESHOLD_WINDOW_MS;
      const backtestResult = await backtestSymbol(symbol, 'SELL', currentLong, maxPositions, tradeSize, leverage, tpPercent, slPercent, {
        cooldownMs,
        hunterCooldownMs: HUNTER_COOLDOWN_MS,
        windowMs: timeWindowMs
      });
      const spanDays = getSymbolDataSpanDays(symbol);
      const backtestDaily = spanDays > 0 ? backtestResult.totalPnl / spanDays : 0;

      console.log(`   ???? Backtest vs Reality Comparison:`);
      console.log(`      Backtest Daily: $${backtestDaily.toFixed(2)}/day | Real Daily: $${dailyPnl.toFixed(2)}/day`);
      console.log(`      Backtest Win Rate: ${backtestResult.winRate.toFixed(1)}% | Real Win Rate: ${winRate.toFixed(1)}%`);
      console.log(`      Accuracy: ${Math.abs(backtestResult.winRate - winRate) < 10 ? '??? Good' : '??? Poor'} (${Math.abs(backtestResult.winRate - winRate).toFixed(1)}% diff)`);

      if (Math.abs(dailyPnl - backtestDaily) > 50) {
        console.log(`      ??????  Large discrepancy detected - backtest may need refinement`);
      }

    } catch (error) {
      console.log(`   ??? Failed to analyze ${symbol}: ${error.message}`);
    }

    console.log();
  }
}

// Capital allocation optimizer
function optimizeCapitalAllocation(accountInfo, recommendations, symbolConfigs = config.symbols) {
  console.log('???? CAPITAL ALLOCATION OPTIMIZER');
  console.log('================================\n');

  const totalWalletBalance = parseFloat(accountInfo?.totalWalletBalance ?? 0);
  const availableBalance = parseFloat(accountInfo?.availableBalance ?? 0);
  const targetUtilization = 0.80; // 80% max utilization
  const maxAllocation = totalWalletBalance * targetUtilization;

  console.log(`???? Total Wallet Balance: $${formatLargeNumber(totalWalletBalance)}`);
  console.log(`???? Available Balance: $${formatLargeNumber(availableBalance)}`);
  console.log(`???? Target Utilization: ${(targetUtilization * 100).toFixed(0)}%`);
  console.log(`???? Max Safe Allocation: $${formatLargeNumber(maxAllocation)}\n`);

  // Calculate total required allocation with current config
  let currentTotalAllocation = 0;
  for (const [_symbol, symbolConfig] of getSelectedSymbolEntries(symbolConfigs)) {
    currentTotalAllocation += symbolConfig.maxPositionMarginUSDT || 100;
  }

  const balanceRatio = totalWalletBalance > 0 ? (currentTotalAllocation / totalWalletBalance * 100) : 0;
  console.log(`???? Current Total Allocation: $${formatLargeNumber(currentTotalAllocation)} (${balanceRatio.toFixed(1)}% of total balance)`);

  if (currentTotalAllocation > maxAllocation) {
    console.log(`??????  OVERALLOCATED by $${formatLargeNumber(currentTotalAllocation - maxAllocation)}`);
    console.log(`???? Recommendation: Reduce per-symbol allocation or disable low-performing symbols\n`);
  } else {
    console.log(`??? Capital allocation within safe range\n`);
  }

  // Rank symbols by expected daily profit improvement
  const rankedSymbols = recommendations
    .sort((a, b) => b.totalDailyImprovement - a.totalDailyImprovement);

  console.log('???? Symbol Priority by Expected Daily Profit Improvement:');
  console.log('Rank | Symbol    | Current Daily | Optimized Daily | Improvement | Allocation');
  console.log('-----|-----------|---------------|-----------------|-------------|------------');

  rankedSymbols.forEach((_rec, i) => {
    const symbolConfig = symbolConfigs[_rec.symbol];
    const allocation = symbolConfig.maxPositionMarginUSDT || 100;
    const currentDaily = _rec.currentPerformance.dailyPnl;
    const optimizedDaily = currentDaily + _rec.totalDailyImprovement;
    const improvement = _rec.totalDailyImprovement;

    console.log(
      `${(i + 1).toString().padEnd(4)} | ` +
      `${_rec.symbol.padEnd(9)} | ` +
      `$${currentDaily.toFixed(2).padEnd(13)} | ` +
      `$${optimizedDaily.toFixed(2).padEnd(15)} | ` +
      `+$${improvement.toFixed(2).padEnd(11)} | ` +
      `$${formatLargeNumber(allocation)}`
    );
  });

  console.log();

  // Suggest allocation rebalancing
  if (currentTotalAllocation > maxAllocation) {
    console.log('???? REBALANCING RECOMMENDATIONS:');
    const symbolCount = Math.max(Object.keys(symbolConfigs).length, 1);
    const allocationPerSymbol = Math.floor(maxAllocation / symbolCount);

    console.log(`   Option 1: Equal allocation of $${formatLargeNumber(allocationPerSymbol)} per symbol`);
    console.log(`   Option 2: Weighted by expected profitability (top performers get more)`);
    console.log(`   Option 3: Disable bottom 25% performers and reallocate to top performers\n`);
  }

  return {
    currentAllocation: currentTotalAllocation,
    maxSafeAllocation: maxAllocation,
    isOverallocated: currentTotalAllocation > maxAllocation,
    rankedSymbols
  };
}

// Generate optimization summary with actionable recommendations
function generateOptimizationSummary(recommendations, capitalOptimization, optimizedConfig, recommendedGlobalMax) {
  console.log('???? OPTIMIZATION SUMMARY');
  console.log('======================\n');

  // Calculate total improvements
  const totalDailyImprovement = recommendations.reduce((sum, _rec) => sum + _rec.totalDailyImprovement, 0);
  const totalCurrentDaily = recommendations.reduce((sum, _rec) => sum + _rec.currentPerformance.dailyPnl, 0);
  const totalOptimizedDaily = totalCurrentDaily + totalDailyImprovement;
  const improvementPercent = Math.abs(totalCurrentDaily) > 1e-6
    ? (totalDailyImprovement / Math.abs(totalCurrentDaily)) * 100
    : null;

  console.log('???? PERFORMANCE SUMMARY:');
  console.log(`   Current Daily P&L: $${totalCurrentDaily.toFixed(2)}`);
  console.log(`   Optimized Daily P&L: $${totalOptimizedDaily.toFixed(2)}`);
  const improvementText = improvementPercent === null
    ? 'n/a (baseline ??? 0)'
    : `${improvementPercent.toFixed(1)}%`;
  console.log(`   Total Daily Improvement: +$${totalDailyImprovement.toFixed(2)} (+${improvementText})`);
  console.log(`   Monthly Improvement: +$${(totalDailyImprovement * 30).toFixed(2)}\n`);

  // Threshold recommendations
  console.log('???? RECOMMENDED THRESHOLD CHANGES:');
  recommendations.forEach(_rec => {
    if (_rec.optimizedLong !== _rec.currentLong || _rec.optimizedShort !== _rec.currentShort) {
      console.log(`   ${_rec.symbol}:`);
      if (_rec.optimizedLong !== _rec.currentLong) {
        console.log(`      LONG: $${formatLargeNumber(_rec.currentLong)} ??? $${formatLargeNumber(_rec.optimizedLong)} (+$${_rec.longImprovement.toFixed(2)}/day)`);
      }
      if (_rec.optimizedShort !== _rec.currentShort) {
        console.log(`      SHORT: $${formatLargeNumber(_rec.currentShort)} ??? $${formatLargeNumber(_rec.optimizedShort)} (+$${_rec.shortImprovement.toFixed(2)}/day)`);
      }
      console.log(`      Trade Size (L/S): $${_rec.currentLongTradeSize.toFixed(2)} ??? $${_rec.optimizedLongTradeSize.toFixed(2)} / $${_rec.currentShortTradeSize.toFixed(2)} ??? $${_rec.optimizedShortTradeSize.toFixed(2)}`);
      console.log(`      TP/SL: ${_rec.currentTp.toFixed(2)}%/${_rec.currentSl.toFixed(2)}% ??? ${_rec.optimizedTp.toFixed(2)}%/${_rec.optimizedSl.toFixed(2)}%`);
      console.log(`      Leverage: ${_rec.currentLeverage.toFixed(2)}x ??? ${_rec.optimizedLeverage.toFixed(2)}x`);
      if (_rec.optimizedScore !== undefined) {
        console.log(`      Score: ${_rec.optimizedScore.toFixed(2)} (PnL: ${formatWeightPercent(scoringWeights.percent.pnl)}, Sharpe: ${formatWeightPercent(scoringWeights.percent.sharpe)}, Drawdown: ${formatWeightPercent(scoringWeights.percent.drawdown)})`);
      }
    }
  });

  console.log();

  // Capital allocation recommendations
  if (capitalOptimization.isOverallocated) {
    console.log('??????  CAPITAL ALLOCATION WARNING:');
    console.log(`   Current: $${formatLargeNumber(capitalOptimization.currentAllocation)}`);
    console.log(`   Safe Max: $${formatLargeNumber(capitalOptimization.maxSafeAllocation)}`);
    console.log(`   Overallocated by: $${formatLargeNumber(capitalOptimization.currentAllocation - capitalOptimization.maxSafeAllocation)}\n`);
  }

  if (recommendedGlobalMax) {
    const currentGlobal = config.global?.maxOpenPositions;
    console.log('???? Global Position Capacity:');
    console.log(`   Current maxOpenPositions: ${currentGlobal ?? 'n/a'}`);
    console.log(`   Recommended maxOpenPositions: ${recommendedGlobalMax}`);
    console.log();
  }

  // Export recommendations as JSON
  const exportData = {
    timestamp: new Date().toISOString(),
    summary: {
      currentDailyPnl: totalCurrentDaily,
      optimizedDailyPnl: totalOptimizedDaily,
      dailyImprovement: totalDailyImprovement,
      monthlyImprovement: totalDailyImprovement * 30,
      improvementPercent: improvementPercent,
      recommendedMaxOpenPositions: recommendedGlobalMax
    },
    recommendations: recommendations.map(_rec => ({
      symbol: _rec.symbol,
      tierWarning: _rec.tierWarning,
      thresholds: {
        current: { long: _rec.currentLong, short: _rec.currentShort },
        optimized: { long: _rec.optimizedLong, short: _rec.optimizedShort }
      },
      settings: {
        current: {
          tradeSize: _rec.currentTradeSize,
          longTradeSize: _rec.currentLongTradeSize,
          shortTradeSize: _rec.currentShortTradeSize,
          maxPositionMarginUSDT: _rec.currentMargin,
          leverage: _rec.currentLeverage,
          tpPercent: _rec.currentTp,
          slPercent: _rec.currentSl,
          maxPositionsLong: _rec.currentLongMaxPositions,
          maxPositionsShort: _rec.currentShortMaxPositions,
          thresholdTimeWindow: _rec.currentTimeWindow,
          thresholdCooldown: _rec.currentCooldown
        },
        optimized: {
          tradeSize: _rec.optimizedTradeSize,
          longTradeSize: _rec.optimizedLongTradeSize,
          shortTradeSize: _rec.optimizedShortTradeSize,
          maxPositionMarginUSDT: _rec.optimizedMargin,
          leverage: _rec.optimizedLeverage,
          tpPercent: _rec.optimizedTp,
          slPercent: _rec.optimizedSl,
          maxPositionsLong: _rec.optimizedLongMaxPositions,
          maxPositionsShort: _rec.optimizedShortMaxPositions,
          thresholdTimeWindow: _rec.optimizedTimeWindow,
          thresholdCooldown: _rec.optimizedCooldown,
          vwapProtection: _rec.optimizedConfig?.vwapProtection
        }
      },
      risk: {
        current: {
          volatilityPenalty: _rec.currentVolatilityPenalty,
          cvarPenalty: _rec.currentCvarPenalty,
          cvar: _rec.currentCvar,
          payoffRatio: _rec.currentPayoffRatio
        },
        optimized: {
          volatilityPenalty: _rec.optimizedVolatilityPenalty,
          cvarPenalty: _rec.optimizedCvarPenalty,
          scenarioPenalty: _rec.optimizedScenarioPenalty,
          cvar: _rec.optimizedCvar,
          payoffRatio: _rec.optimizedPayoffRatio
        },
        scenarios: _rec.optimizedScenarios
      },
      diagnostics: _rec.diagnostics,
      improvement: {
        long: _rec.longImprovement,
        short: _rec.shortImprovement,
        total: _rec.totalDailyImprovement
      },
      performance: {
        current: {
          long: {
            trades: _rec.currentPerformance.long.totalTrades,
            winRate: _rec.currentPerformance.long.winRate,
            pnl: _rec.currentPerformance.long.totalPnl,
            sharpe: _rec.currentPerformance.long.sharpeRatio,
            maxDrawdown: _rec.currentPerformance.long.maxDrawdown
          },
          short: {
            trades: _rec.currentPerformance.short.totalTrades,
            winRate: _rec.currentPerformance.short.winRate,
            pnl: _rec.currentPerformance.short.totalPnl,
            sharpe: _rec.currentPerformance.short.sharpeRatio,
            maxDrawdown: _rec.currentPerformance.short.maxDrawdown
          }
        },
        optimized: {
          long: {
            trades: _rec.optimizedPerformance.long.totalTrades,
            winRate: _rec.optimizedPerformance.long.winRate,
            pnl: _rec.optimizedPerformance.long.totalPnl,
            sharpe: _rec.optimizedPerformance.long.sharpeRatio,
            maxDrawdown: _rec.optimizedPerformance.long.maxDrawdown
          },
          short: {
            trades: _rec.optimizedPerformance.short.totalTrades,
            winRate: _rec.optimizedPerformance.short.winRate,
            pnl: _rec.optimizedPerformance.short.totalPnl,
            sharpe: _rec.optimizedPerformance.short.sharpeRatio,
            maxDrawdown: _rec.optimizedPerformance.short.maxDrawdown
          }
        }
      },
      scoring: {
        finalScore: _rec.optimizedScore,
        sharpeRatio: _rec.optimizedSharpe,
        drawdownScore: _rec.optimizedDrawdownScore,
        weights: {
          pnl: normalizedScoringWeights.pnl,
          sharpe: normalizedScoringWeights.sharpe,
          drawdown: normalizedScoringWeights.drawdown
        },
        weightPercent: {
          pnl: scoringWeights.percent.pnl,
          sharpe: scoringWeights.percent.sharpe,
          drawdown: scoringWeights.percent.drawdown
        }
      }
    })),
    capitalAllocation: capitalOptimization,
    recommendedMaxOpenPositions: recommendedGlobalMax,
    optimizedConfig
  };

  // Write to JSON file
  fs.writeFileSync(
    path.join(__dirname, 'optimization-results.json'),
    JSON.stringify(exportData, null, 2)
  );

  console.log('???? Results saved to: optimization-results.json\n');

  return exportData;
}

function askYesNo(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

async function maybeApplyOptimizedConfig(originalConfig, optimizedConfig, summary) {
  const autoMode = FORCE_OPTIMIZER_OVERWRITE;
  const autoConfirm = FORCE_OPTIMIZER_CONFIRM || autoMode;

  const canPrompt = Boolean(process.stdin.isTTY || process.stdout.isTTY);
  if (!canPrompt && !autoMode) {
    console.log('dY>` No interactive TTY detected. Skipping config overwrite prompt (set FORCE_OPTIMIZER_OVERWRITE or run in an interactive shell).');
    return;
  }

  console.log('dY"S Optimization Delta Overview:');
  if (summary) {
    console.log(`   Current Daily P&L: ${formatCurrency(summary.currentDailyPnl)}`);
    console.log(`   Optimized Daily P&L: ${formatCurrency(summary.optimizedDailyPnl)}`);
    console.log(`   Daily Improvement: ${formatCurrency(summary.dailyImprovement)} (Monthly +${formatCurrency(summary.monthlyImprovement)})`);
    if (summary.recommendedMaxOpenPositions) {
      console.log(`   Current maxOpenPositions: ${config.global?.maxOpenPositions ?? 'n/a'}`);
      console.log(`   Recommended maxOpenPositions: ${summary.recommendedMaxOpenPositions}`);
    }
  } else {
    console.log('   (Detailed summary unavailable)');
  }
  console.log();

  let confirm = autoConfirm;
  if (!confirm) {
    confirm = await askYesNo('Overwrite config.user.json with optimized settings? (y/N): ');
  } else {
    console.log('dY"? Auto-confirm enabled via FORCE_OPTIMIZER_OVERWRITE/CONFIRM environment variables');
  }

  if (!confirm) {
    console.log('???sT???,?  Keeping existing config.user.json');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(__dirname, `config.user.backup-${timestamp}.json`);

  fs.writeFileSync(backupPath, JSON.stringify(originalConfig, null, 2));
  fs.writeFileSync(configPath, JSON.stringify(optimizedConfig, null, 2));

  console.log(`dY-,  Backup saved to ${backupPath}`);
  console.log('???o. config.user.json overwritten with optimized settings');
}

async function main() {
  try {
    emitProgress(0, 'Initializing optimizer');
    const modeLabel = MODE_SETTINGS[OPTIMIZER_MODE] ? OPTIMIZER_MODE : 'quick';
    console.log(`⚙️  Optimizer run mode: ${modeLabel === 'quick' ? 'Quick (fast sweep)' : 'Thorough (expanded search)'}\n`);

    const weightSummary = `${formatWeightPercent(scoringWeights.percent.pnl)} / ${formatWeightPercent(scoringWeights.percent.sharpe)} / ${formatWeightPercent(scoringWeights.percent.drawdown)}`;
    const weightLabel = scoringWeights.isDefault ? ' (default)' : '';
    console.log(`???? Using scoring weights (PnL / Sharpe / Drawdown): ${weightSummary}${weightLabel}\n`);

    console.log('???? Fetching complete account snapshot...\n');
    emitProgress(5, 'Fetching account snapshot');
    const [balance, accountInfo, positions, leverageBrackets] = await Promise.all([
      getAccountBalance(config.api),
      getAccountInfo(config.api),
      getCurrentPositions(config.api),
      getLeverageBrackets(config.api)
    ]);
    emitProgress(10, 'Account snapshot loaded');

    // Display leverage tier info for key symbols
    if (Object.keys(leverageBrackets).length > 0) {
      console.log('📈 Leverage tiers loaded for', Object.keys(leverageBrackets).length, 'symbols\n');
    } else {
      console.log('⚠️  Warning: Could not fetch leverage tiers - using conservative defaults\n');
    }

    // Core analyses
    const _avgGap = analyzePriceDataCoverage();
    emitProgress(18, 'Price data coverage analyzed');

    const capitalInfo = analyzeCapitalAllocation(balance, accountInfo, positions);
    emitProgress(24, 'Account snapshot analyzed');

    analyzeLiquidationCascades();
    emitProgress(28, 'Cascade patterns analyzed');

    analyzeCurrentConfig();
    emitProgress(32, 'Current configuration performance analyzed');

    await analyzeRealTradingHistory(config.api);
    emitProgress(36, 'Real trading history analyzed');

    optimizeThresholds();
    emitProgress(40, 'Threshold sweeps completed');

    rankSymbolProfitability();
    emitProgress(45, 'Symbol profitability ranked');

    // Generate recommendations with backtest
    // Use CALCULATED TOTAL for optimal capital allocation
    emitProgress(50, 'Starting per-symbol optimization');
    const deployableCapital = capitalInfo.calculatedTotal || parseFloat(accountInfo?.totalWalletBalance ?? 0);
    const { recommendations, optimizedConfig, recommendedGlobalMax } = await generateRecommendations(deployableCapital, leverageBrackets, { start: 55, end: 88 });
    emitProgress(90, 'Per-symbol optimization complete');

    // Optimize capital allocation
    const selectedOptimizedConfigs = getSelectedSymbolConfigMap(optimizedConfig.symbols);
    const capitalOptimization = optimizeCapitalAllocation(accountInfo, recommendations, selectedOptimizedConfigs);
    emitProgress(94, 'Capital allocation optimized');

    // Generate final summary
    const optimizationResults = generateOptimizationSummary(recommendations, capitalOptimization, optimizedConfig, recommendedGlobalMax);
    emitProgress(97, 'Optimization summary prepared');

    emitProgress(98, 'Preparing configuration updates');
    await maybeApplyOptimizedConfig(config, optimizedConfig, optimizationResults.summary);
    emitProgress(99, 'Finalizing optimizer run');

    emitProgress(100, 'Optimization complete');
    console.log('???? Optimization analysis complete!');
    const totalValue = parseFloat(accountInfo?.totalMarginBalance || balance.totalWalletBalance || 0);
    console.log(`???? Total account value: $${formatLargeNumber(totalValue)}`);
    console.log('???? Strategy: Accumulate positions during cascades, profit on rebounds');
    console.log('\n???? Review optimization-results.json for detailed recommendations and the fully optimized config snapshot');

  } catch (error) {
    console.error('??? Error:', error.message);
    console.error(error.stack);
  } finally {
    db.close();
  }
}

// Run the analysis
main();



