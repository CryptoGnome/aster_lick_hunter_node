# Backtester Caveats & Limitations

## What We've Built
A backtesting system integrated into the main bot that:
- Reads historical liquidations from the live database (`liquidations.db`)
- Fetches historical 1-minute candles from Binance API
- Simulates the bot's trading logic with configurable parameters
- Writes results to a separate database (`backtest.db`)
- Provides a UI to configure and run backtests with expandable trade details

---

## Known Caveats

### 1. **Entry Price Approximation** ⚠️ MAJOR
**Issue**: We enter at the **next candle's open** after a liquidation event.
- Real bot executes immediately at market price when liquidation happens
- Backtest waits for next 1-minute candle to open
- **Impact**: Could be off by several ticks to significant slippage in volatile moves

**Status**: **CAN'T FIX** - We don't have tick-by-tick order book data. We apply slippage estimation (8 bps default) but it's still an approximation.

---

### 2. **TP/SL Resolution Within Candle** ⚠️ MODERATE
**Issue**: When both TP and SL are hit in the same candle, we don't know which hit first.
- Using `tiePolicy: 'worst'` (assumes SL hit first) as default
- Real outcome depends on intra-candle price action we can't see

**Status**: **PARTIALLY ADDRESSABLE** - Could fetch tick data or use smaller timeframes (5s candles if available), but 1-minute is Binance's smallest public interval for futures.

**Current mitigation**: Configurable `tiePolicy` parameter ('worst', 'best', 'dir')

---

### 3. **VWAP Protection Not Implemented Yet** ⚠️ MODERATE
**Issue**: UI has VWAP protection settings but the engine doesn't calculate or apply VWAP filtering.
- Settings are captured but ignored in backtest execution
- Real bot would block trades against VWAP trend

**Status**: **CAN FIX** - Need to:
1. Calculate VWAP from candle data (typical price × volume)
2. Compare entry price to VWAP
3. Block LONG if price > VWAP, block SHORT if price < VWAP

**TODO**: Implement VWAP calculation in `engine.ts`

---

### 4. **Threshold System Edge Cases** ⚠️ MINOR
**Issue**: Multiple liquidations at the exact same millisecond timestamp.
- Real bot might process them sequentially with sub-millisecond gaps
- Backtest processes them in array order (database sort order)
- Could trigger multiple entries if cooldown hasn't expired

**Status**: **INTENTIONAL** - We're not deduplicating data. If the bot's logic (cooldown, threshold window) would allow it, we simulate it.

**Note**: The 60-second threshold system should naturally aggregate these anyway.

---

### 5. **Funding Fees Not Simulated** ⚠️ MINOR
**Issue**: Positions held across funding intervals (8-hour cycles) incur funding fees.
- Not calculated in backtest P&L
- Real trading would have these costs

**Status**: **CAN FIX** - Could add funding rate calculation:
1. Track position hold time
2. Apply funding rate at 00:00, 08:00, 16:00 UTC
3. Fetch historical funding rates from Binance

**Impact**: Generally small for positions held < 8 hours, but compounds for longer holds.

---

### 6. **Market Impact / Order Book Depth** ⚠️ MINOR
**Issue**: We assume infinite liquidity at the entry/exit price.
- Large orders would move the market
- Real bot uses limit orders that might not fill immediately

**Status**: **CAN'T FIX** - Would need historical order book snapshots. We use slippage estimation instead (8 bps default).

---

### 7. **Exchange Latency & Race Conditions** ⚠️ MINOR
**Issue**: Real trading has network latency, order queue delays, rate limits.
- Backtest assumes instant execution
- Multiple traders might be reacting to the same liquidation

**Status**: **CAN'T FIX** - Inherent limitation of backtesting. Slippage parameter accounts for some of this.

---

### 8. **Limited Historical Data** ℹ️ INFO
**Issue**: Liquidations table only has data from when the bot started recording.
- Can't backtest periods before bot was live
- User gets warning for 3-month and 1-year backtests

**Status**: **CAN'T FIX** - Historical liquidation data not publicly available in detail. Binance only provides aggregated liquidation orders, not the raw feed.

---

### 9. **DCA Entry Timing** ⚠️ MINOR
**Issue**: Each liquidation above threshold triggers a DCA entry at next candle open.
- Real bot might batch multiple liquidations or skip some due to rate limits
- Backtest processes every qualifying liquidation

**Status**: **MATCHES EXPECTED BEHAVIOR** - This is how the bot should work. If it's too aggressive, adjust threshold or cooldown settings.

---

### 10. **No Live Bot State Conflicts** ✅ SAFE
**Issue**: N/A - Backtester is fully isolated.
- Reads from `liquidations.db` (read-only)
- Writes to `backtest.db` (separate file)
- No risk of interfering with live trading

**Status**: **WORKING AS DESIGNED** - This was a critical safety requirement and it's properly implemented.

---

## Recommendations

### For Most Accurate Results:
1. ✅ Use **"worst" tie policy** (default) for conservative estimates
2. ✅ Enable **60-second threshold system** to match live bot behavior
3. ✅ Set **realistic slippage** (8-10 bps for liquid pairs, higher for low liquidity)
4. ✅ Test on **recent data** (last 1-2 weeks) where liquidation patterns are most relevant
5. ⚠️ **Implement VWAP protection** if you use it in live trading
6. ⚠️ **Add funding fees** for multi-day backtests

### What to Trust:
- ✅ **Trade frequency** - Good estimate of how often bot triggers
- ✅ **Win rate** - Directional accuracy (TP vs SL hit rate)
- ✅ **Relative performance** - Comparing different parameter sets
- ⚠️ **Absolute P&L** - Ballpark only, real results will vary by 10-30%

### What NOT to Trust:
- ❌ **Exact P&L down to the cent** - Too many unknowns
- ❌ **Extreme market conditions** - Flash crashes, liquidation cascades behave differently live
- ❌ **Very short timeframes** (< 1 day) - Not enough data points

---

## Next Steps to Improve

### High Priority:
1. **Implement VWAP filtering** - Critical if you use it live
2. **Add funding fees** - For multi-day backtests
3. **Calculate Sharpe ratio & max drawdown** - Better risk metrics

### Medium Priority:
4. **Add commission tiers** - VIP levels have different fees
5. **Simulate partial fills** - More realistic for large orders
6. **Add slippage variance** - Not always 8 bps, varies with volatility

### Low Priority:
7. **Fetch 5-second candles** (if Binance adds them) - Better TP/SL resolution
8. **Add position liquidation simulation** - If leverage is too high
9. **Monte Carlo analysis** - Run same backtest with random variation

---

## Bottom Line

The backtester is a **useful optimization tool** for:
- Finding profitable parameter ranges
- Understanding trade frequency and patterns  
- Comparing strategy variations
- Identifying obvious losers before risking real money

But it's **NOT a crystal ball**. Real trading will differ due to:
- Execution timing
- Market microstructure
- Exchange infrastructure
- Other market participants

**Use it to guide decisions, not as gospel.**
