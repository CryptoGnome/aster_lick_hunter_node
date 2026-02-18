# Liquidation Data Analysis & Conservative Configuration Recommendations
**Date:** February 8, 2026  
**Data Period:** Last 7 days

## Executive Summary

Your bot was liquidated during the BTC crash from ~$108k to ~$60k. Based on 7 days of liquidation data across 226 symbols, here are the key findings:

### Top 5 Most Liquid Symbols (By Total Volume)
1. **BTCUSDT**: $46.4M volume, 1,817 liquidations (avg $25.5k each)
2. **ETHUSDT**: $30.1M volume, 1,492 liquidations (avg $20.1k each)  
3. **SOLUSDT**: $7M volume, 895 liquidations (avg $7.8k each)
4. **XAGUSDT** (Silver): $3.2M volume, 389 liquidations (avg $8.3k each)
5. **BNBUSDT**: $2.8M volume, 377 liquidations (avg $7.3k each)

### Current Configuration Issues

**Your Active Symbols:**
- ETHUSDT, ASTERUSDT, HYPEUSDT, ZECUSDT, SOLUSDT, FARTCOINUSDT

**Problems Identified:**
1. **Too low volume thresholds** - You're catching too many small liquidations
2. **Excessive leverage** (8-10x) - Fatal during cascades
3. **Tiny stop losses** (90-99%) - Essentially no stop loss = liquidation risk
4. **No correlation protection** - All your symbols move together with BTC
5. **Position sizing too aggressive** (10-25% of balance per trade)

### Large Liquidation Events (Last 3 Days)

The data shows **30 liquidations >$50k** in just 3 days, with the largest being:
- **BTCUSDT** $472k (SELL) - Feb 7 05:28
- **BTCUSDT** $325k (BUY) - Feb 6 15:47  
- **BTCUSDT** $252k (BUY) - Feb 6 14:33
- **BTCUSDT** $243k (SELL) - Feb 7 07:06

## Conservative Configuration Recommendations

### Phase 1: Survival Mode (Immediate)

**Global Settings:**
```json
{
  "riskPercent": 20,              // DOWN from 90 (only risk 20% max)
  "maxOpenPositions": 3,          // DOWN from 10 (focus on best opportunities)
  "paperMode": true               // TEST FIRST before going live again
}
```

**Per Symbol Settings (All Symbols):**
```json
{
  "positionSizingMode": "PERCENTAGE",
  "percentageOfBalance": 0.05,    // 5% per trade (DOWN from 10-25%)
  "leverage": 3,                  // DOWN from 8-10x (survival leverage)
  "slPercent": 8,                 // REAL stop loss at 8% (not 90%!)
  "tpPercent": 2,                 // Conservative 2% target
  "vwapProtection": true,         // Keep this
  "orderType": "LIMIT",
  "useThreshold": true
}
```

### Phase 2: Symbol-Specific Thresholds

Based on 7-day liquidation averages, here are conservative thresholds:

#### Tier 1: High Liquidity (Trade These)
```json
"BTCUSDT": {
  "longVolumeThresholdUSDT": 100000,   // Only massive longs (avg is $25k)
  "shortVolumeThresholdUSDT": 100000,  // Only massive shorts
  "percentageOfBalance": 0.08,         // 8% position
  "leverage": 3,
  "slPercent": 8,
  "tpPercent": 2
}

"ETHUSDT": {
  "longVolumeThresholdUSDT": 80000,    // Only large liquidations (avg is $20k)
  "shortVolumeThresholdUSDT": 80000,
  "percentageOfBalance": 0.08,
  "leverage": 3,
  "slPercent": 8,
  "tpPercent": 2
}

"SOLUSDT": {
  "longVolumeThresholdUSDT": 30000,    // avg is $7.8k, set 4x higher
  "shortVolumeThresholdUSDT": 30000,
  "percentageOfBalance": 0.05,
  "leverage": 3,
  "slPercent": 8,
  "tpPercent": 2
}
```

#### Tier 2: Medium Liquidity (Cautious)
```json
"BNBUSDT": {
  "longVolumeThresholdUSDT": 25000,    // avg $7.3k
  "shortVolumeThresholdUSDT": 25000,
  "percentageOfBalance": 0.05,
  "leverage": 3,
  "slPercent": 8,
  "tpPercent": 2
}

"XRPUSDT": {
  "longVolumeThresholdUSDT": 20000,    // avg $5.3k
  "shortVolumeThresholdUSDT": 20000,
  "percentageOfBalance": 0.05,
  "leverage": 3,
  "slPercent": 8,
  "tpPercent": 2
}
```

#### Tier 3: Your Current Symbols (Need Adjustment)

**HYPEUSDT**: 743 liquidations, avg $1,766
```json
"longVolumeThresholdUSDT": 15000,     // UP from 5000
"shortVolumeThresholdUSDT": 15000,    // UP from 5000
"percentageOfBalance": 0.03,          // DOWN from 0.25
"leverage": 3,                        // DOWN from 10
"slPercent": 8,                       // DOWN from 90
"tpPercent": 1.5
```

**ASTERUSDT**: 970 liquidations, avg $2,693
```json
"longVolumeThresholdUSDT": 20000,     // UP from 10000
"shortVolumeThresholdUSDT": 20000,    // UP from 10000  
"percentageOfBalance": 0.05,          // DOWN from 0.25
"leverage": 3,                        // DOWN from 8
"slPercent": 8,                       // DOWN from 99
"tpPercent": 1.5
```

**ZECUSDT**: 124 liquidations, avg $2,938
```json
"longVolumeThresholdUSDT": 15000,     // UP from 4000
"shortVolumeThresholdUSDT": 15000,    // UP from 4000
"percentageOfBalance": 0.03,          // DOWN from 0.25
"leverage": 3,                        // DOWN from 8
"slPercent": 8,                       // DOWN from 99
"tpPercent": 1.5
```

**FARTCOINUSDT**: 59 liquidations, avg $628 (LOW LIQUIDITY!)
```json
"longVolumeThresholdUSDT": 5000,      // Keep high (avg is only $628)
"shortVolumeThresholdUSDT": 5000,
"percentageOfBalance": 0.02,          // DOWN from 0.1 (VERY SMALL)
"leverage": 2,                        // VERY LOW
"slPercent": 8,
"tpPercent": 1.5
```

### Phase 3: Risk Management Rules

**Circuit Breakers to Add:**
1. **Max Daily Loss**: Stop trading if down >5% for the day
2. **Correlation Check**: Don't trade if BTC is dropping >10% in 1 hour
3. **Cascade Detection**: Pause if >5 liquidations >$100k in 5 minutes
4. **Drawdown Limit**: Reduce position sizes by 50% if down >10% from peak

**Position Sizing Formula:**
```
Position Size = (Account Balance * percentageOfBalance) / leverage
Max Loss Per Trade = Position Size * slPercent = ~2.7% with 8% SL @ 3x leverage
```

With these settings:
- 5% position @ 3x leverage @ 8% SL = 1.2% account risk per trade
- 8% position @ 3x leverage @ 8% SL = 2% account risk per trade

### Why These Changes Matter

**Before (Your Settings):**
- 25% position @ 10x leverage = 250% exposure
- 90% stop loss = essentially no stop = liquidation at ~10% move
- Result: One BTC cascade = complete liquidation ❌

**After (Recommended):**
- 5% position @ 3x leverage = 15% exposure  
- 8% stop loss = controlled loss at 2.4% account
- Result: Can survive 40+ losing trades before liquidation ✅

### Liquidation Price Protection

At 3x leverage with 8% stop loss:
- **Entry**: $100
- **Stop Loss**: $92 (-8%)
- **Liquidation**: ~$67 (-33% from entry)
- **Buffer**: 25% between SL and liquidation

At 10x leverage with 90% SL (your old settings):
- **Entry**: $100  
- **Stop Loss**: $10 (never triggers)
- **Liquidation**: ~$90 (-10% from entry)
- **Buffer**: NONE - direct liquidation

### Implementation Plan

1. **Week 1**: Paper mode with new settings
   - Test on live liquidation data
   - Verify stop losses trigger correctly
   - Monitor max drawdown

2. **Week 2**: Go live with 50% of recommended position sizes
   - Start with BTCUSDT and ETHUSDT only
   - Verify real SL/TP execution
   - Build confidence

3. **Week 3**: Full recommended position sizes
   - Add other Tier 1 symbols
   - Monitor correlation during BTC moves
   - Adjust thresholds based on results

4. **Week 4**: Optimize
   - Increase position sizes if profitable
   - Add more symbols gradually
   - Never exceed 5% risk per trade

## Key Takeaways

1. **You survived the data collection phase** - That's valuable!
2. **The bot CAN be profitable** - But needs proper risk management
3. **90% stop loss = no stop loss** - This killed you
4. **High leverage during cascades = liquidation** - Keep it low
5. **Small, frequent wins > rare big wins** - Survive to trade another day

## Questions to Consider

1. What's your account size? (Affects position sizing)
2. What's your risk tolerance per day? (5%? 10%?)
3. Do you want to add BTC correlation filters?
4. Should we implement the tranche system to isolate losers?
5. Do you want automatic circuit breakers?

---

**Next Steps:** Review this analysis, test in paper mode, then implement conservatively. The goal is to survive first, profit second.
