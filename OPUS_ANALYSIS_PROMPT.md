# Liquidation Bot Configuration Optimization Analysis

## Mission
Analyze 7 days of real liquidation data from Asterdex futures exchange and determine optimal bot configuration settings that maximize profitability while managing liquidation risk.

## Critical Context

**The Core Problem:**
- Bot is PROFITABLE when running with 90% stop loss (essentially no SL - lets positions breathe)
- Bot gets LIQUIDATED during major cascades (BTC dropped from $108k to $60k)
- Bot is UNPROFITABLE with tight stop losses (e.g., 8% SL) - gets stopped out too early
- Cannot backtest easily - real liquidation events are unpredictable and cascade effects are complex

**Strategy:**
Contrarian liquidation hunting - trade opposite direction of forced liquidations:
- Long liquidations (forced sells) → Buy opportunity
- Short liquidations (forced buys) → Sell opportunity
- Assumes mean reversion after forced liquidation events

**Current Settings (Updated):**
- Leverage: 5x
- Stop Loss: 90% (essentially disabled)
- Position Size: 8-15% of balance per trade
- Max Positions: 5
- Risk: 50% of account
- Volume Thresholds: $8k-$50k depending on symbol
- VWAP Protection: Enabled
- No correlation filters
- No cascade detection

## Liquidation Data (7 Days - Feb 2-9, 2026)

### Overall Statistics
```json
{
  "total_liquidations": 15766,
  "unique_symbols": 226,
  "total_volume_usdt": 148723913.67,
  "avg_volume_usdt": 9432.36,
  "min_volume_usdt": 0.01,
  "max_volume_usdt": 1274476,
  "data_span_days": 7
}
```

### Top 30 Symbols by Volume (Full Dataset)
```json
[
  {"symbol":"BTCUSDT","count":1817,"total_volume":46408421.5,"avg_volume":25541.23,"long_liq_count":638,"short_liq_count":1179,"avg_long_volume":37858.32,"avg_short_volume":19106.01},
  {"symbol":"ETHUSDT","count":1492,"total_volume":30050872.55,"avg_volume":20141.34,"long_liq_count":480,"short_liq_count":1012,"avg_long_volume":29912.82,"avg_short_volume":15437.9},
  {"symbol":"SOLUSDT","count":895,"total_volume":7019075.45,"avg_volume":7842.54,"long_liq_count":226,"short_liq_count":669,"avg_long_volume":22087.96,"avg_short_volume":3020.47},
  {"symbol":"XAGUSDT","count":389,"total_volume":3241883.08,"avg_volume":8333.89,"long_liq_count":80,"short_liq_count":309,"avg_long_volume":14950.26,"avg_short_volume":6686.16},
  {"symbol":"BNBUSDT","count":377,"total_volume":2762176.32,"avg_volume":7326.73,"long_liq_count":57,"short_liq_count":320,"avg_long_volume":11699.6,"avg_short_volume":6647.77},
  {"symbol":"ASTERUSDT","count":970,"total_volume":2613110.52,"avg_volume":2693.93,"long_liq_count":274,"short_liq_count":696,"avg_long_volume":4107.17,"avg_short_volume":2126.31},
  {"symbol":"XRPUSDT","count":435,"total_volume":2310892.81,"avg_volume":5312.4,"long_liq_count":119,"short_liq_count":316,"avg_long_volume":9344.19,"avg_short_volume":3886.32},
  {"symbol":"HYPEUSDT","count":743,"total_volume":1312581.69,"avg_volume":1766.6,"long_liq_count":308,"short_liq_count":435,"avg_long_volume":2175.57,"avg_short_volume":1434.28}
]
```

### Volume Distribution by Symbol
Shows concentration of liquidation sizes:
```json
[
  {"symbol":"BTCUSDT","under_1k":843,"1k-5k":441,"5k-10k":173,"10k-50k":255,"50k-100k":53,"over_100k":52},
  {"symbol":"ETHUSDT","under_1k":763,"1k-5k":325,"5k-10k":119,"10k-50k":194,"50k-100k":47,"over_100k":46},
  {"symbol":"SOLUSDT","under_1k":539,"1k-5k":190,"5k-10k":59,"10k-50k":87,"50k-100k":9,"over_100k":11},
  {"symbol":"ASTERUSDT","under_1k":715,"1k-5k":181,"5k-10k":28,"10k-50k":42,"50k-100k":4,"over_100k":4},
  {"symbol":"HYPEUSDT","under_1k":593,"1k-5k":101,"5k-10k":25,"10k-50k":20,"50k-100k":2,"over_100k":2},
  {"symbol":"ZECUSDT","under_1k":65,"1k-5k":34,"5k-10k":14,"10k-50k":11,"50k-100k":0,"over_100k":0}
]
```

### Cascade Events (3 Days - Clusters of Liquidations)
**50 largest cascade events** where ≥3 liquidations occurred in same minute OR total volume >$50k:
- BTCUSDT: Multiple $200k-$600k cascade events during crash
- ETHUSDT: Frequent $100k-$200k cascades
- SOLUSDT: Significant cascades during volatility
- Pattern: Cascades cluster around major BTC moves

**Sample Major Cascades:**
- Feb 6 00:13 - BTCUSDT SELL: $605,894 (single event)
- Feb 5 20:17 - BTCUSDT SELL: $1,274,476 (single massive liquidation)
- Feb 6 00:14 - AVAXUSDT SELL: $287,384 cascade
- Feb 6 00:19 - ETHUSDT SELL: $526,635 cascade
- Feb 6 01:47 - ETHUSDT BUY: $594,553 (mean reversion)

### Hourly Pattern Analysis
```json
[
  {"hour":"00","count":1355,"volume":23582749.98},  // High activity - cascades
  {"hour":"01","count":450,"volume":2838479.25},
  {"hour":"17","count":719,"volume":13127082.97},   // High activity
  {"hour":"18","count":726,"volume":9991179.14},
  {"hour":"20","count":798,"volume":9408914.11},    // High activity
  {"hour":"22","count":514,"volume":6439237.74}
]
```

### Recent Large Liquidations (Last 3 Days)
100 liquidations >$50k show:
- **Feb 7 cascade**: BTC drop from $70k to $60k area - massive SELL liquidations followed by BUY bounces
- **Feb 6 crash**: Major capitulation at midnight UTC - cascade of multi-symbol liquidations
- **Feb 5 volatility**: Sharp moves creating $100k-$300k liquidations
- Pattern: Large liquidations often come in clusters (cascades)

## Key Questions to Answer

### 1. Volume Threshold Optimization
- Current: $8k-$50k per symbol
- **Question:** What volume threshold per symbol minimizes noise while capturing profitable trades?
- **Consider:** 
  - 80% of BTC liquidations are <$5k but only represent 11% of volume
  - Large liquidations (>$50k) are only 2.9% of count but represent massive opportunities
  - Should we use tiered thresholds (e.g., higher during cascades)?

### 2. Leverage & Position Sizing
- Current: 5x leverage, 8-15% position size
- **Question:** Optimal leverage and position sizing to survive cascades while maintaining profitability?
- **Consider:**
  - At 5x with 15% position → 75% exposure per trade
  - Need buffer between stop loss and liquidation price
  - Lower leverage = survives longer but needs larger positions for profitability

### 3. Stop Loss Strategy
- Current: 90% (essentially disabled)
- **Question:** What stop loss % allows mean reversion while protecting from liquidation?
- **Consider:**
  - Contrarian strategy REQUIRES holding through adverse moves
  - Tight SLs (8%) kill profitability per user's real experience
  - Options: 
    - Keep 90% SL but reduce position size/leverage?
    - Use trailing stops that only activate after profit?
    - Dynamic SL based on volatility?
    - No SL but strict position limits?

### 4. Symbol Selection
- Current: Trading 6 symbols (ETH, SOL, ASTER, HYPE, ZEC, FARTCOIN)
- **Question:** Which symbols offer best risk/reward for this strategy?
- **Consider:**
  - BTC/ETH: Highest volume but highest correlation (cascade risk)
  - Alts: Lower correlation but lower liquidity and higher volatility
  - Should we focus on fewer, higher-liquidity symbols?

### 5. Cascade Detection & Circuit Breakers
- Current: None
- **Question:** When should bot pause trading to avoid getting caught in cascades?
- **Consider:**
  - Feb 6 midnight cascade: 10+ major liquidations in 5 minutes across multiple symbols
  - If BTC drops >X% in Y minutes → pause all trading?
  - If multiple large liquidations (>$100k) occur simultaneously → pause?
  - Resume after calm period?

### 6. Correlation Management
- Current: None - all positions can be correlated
- **Question:** Should bot limit correlated positions?
- **Consider:**
  - BTC crash liquidated SOL, ETH, ASTER simultaneously
  - Max positions is 5 but if all are BTC-correlated, it's effectively 1 position
  - Limit to 1-2 BTC-correlated positions at a time?

### 7. Time-Based Filters
- **Question:** Should bot avoid certain hours or days?
- **Consider:**
  - Midnight UTC shows highest cascade activity
  - Certain hours have better mean reversion?
  - Weekend volatility different from weekdays?

### 8. Position Management
- Current: Open position → hold until TP (1.5%) or SL (90%)
- **Question:** Should bot have dynamic exit strategies?
- **Consider:**
  - Scale out of positions (take 50% at 0.75% profit, let 50% run)?
  - Time-based exits (close after X hours regardless)?
  - Volatility-based exits?

### 9. Entry Timing
- Current: Immediate entry after liquidation detection
- **Question:** Should bot wait for confirmation or enter immediately?
- **Consider:**
  - During cascades, waiting might be better (let it bottom out)
  - During single liquidations, immediate entry captures bounce
  - VWAP filter already provides some entry quality control

### 10. Risk Management Framework
- Current: 50% max risk, 5 positions
- **Question:** Optimal risk allocation across positions?
- **Consider:**
  - Should newer positions be smaller (scale in)?
  - Should position size vary by symbol volatility?
  - Kelly Criterion considerations?

## Analysis Framework

Please provide:

### A. Recommended Configuration
Specific values for:
- `longVolumeThresholdUSDT` per symbol
- `shortVolumeThresholdUSDT` per symbol  
- `leverage` per symbol
- `percentageOfBalance` per symbol
- `slPercent` per symbol
- `tpPercent` per symbol
- `maxOpenPositions` global
- `riskPercent` global
- New symbols to add (from top 30)
- Symbols to remove (if any)

### B. New Features to Implement
Prioritized list of:
1. Cascade detection rules (specific thresholds)
2. Circuit breaker conditions (when to pause)
3. Correlation filters (how to limit correlated positions)
4. Time-based filters (if any)
5. Dynamic position sizing rules

### C. Risk Scenarios
Model these scenarios with your recommended config:
1. **Feb 6 Cascade** - BTC $70k→$60k in 24 hours
2. **Slow Bleed** - Market drops 2% daily for 5 days
3. **Choppy Market** - ±3% daily swings for a week
4. **Bull Run** - Market up 5% daily for 5 days

For each scenario:
- Estimated max drawdown
- Probability of liquidation
- Expected profit/loss

### D. Implementation Priority
Rank changes by:
1. Immediate (implement now)
2. High (implement within 1 week)
3. Medium (implement within 1 month)
4. Low (nice to have)

## Constraints

- Cannot backtest easily (liquidations are unpredictable)
- User's experience: Bot IS profitable without tight SLs
- Exchange: Asterdex futures (similar to Binance Futures API)
- Available leverage: 1x-125x per symbol
- Position modes: ONE-WAY or HEDGE (currently HEDGE)
- VWAP protection is working well, should keep
- Threshold system (60s accumulation) exists but may not be optimal

## Output Format

Please structure response as:

```markdown
# Liquidation Bot Optimization - Recommendations

## Executive Summary
[2-3 paragraphs: Key findings and philosophy]

## Recommended Configuration

### Global Settings
[riskPercent, maxOpenPositions, etc.]

### Symbol Settings
[Per-symbol configs with rationale]

### Symbols to Add/Remove
[Justification based on data]

## New Features (Prioritized)

### 1. Cascade Detection
[Specific implementation]

### 2. Circuit Breakers  
[Specific rules]

### 3. [Other features...]

## Risk Analysis

### Scenario 1: Major Cascade (Feb 6 style)
[Analysis]

### Scenario 2-4: [Other scenarios]

## Implementation Roadmap
[Priority ranking with estimated effort]

## Rationale
[Data-driven explanation of key decisions]
```

## Additional Context

- User is testing in production (not paper mode)
- User values profitability over safety (but wants to avoid liquidation)
- User's observation: "mostly only profitable when running no stop loss"
- Bot uses LIMIT orders with price offset (working well)
- Bot has tranche system (not yet functional) for tracking multiple entries per symbol
- Exchange is relatively new (Asterdex) - liquidity varies by symbol

**Be concise, data-driven, and actionable.** Focus on configurations that can be implemented immediately in the JSON config file.
