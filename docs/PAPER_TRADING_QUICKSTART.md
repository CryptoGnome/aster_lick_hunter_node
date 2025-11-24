# Paper Trading Quick Start Guide

## 🎯 What is Paper Trading?

Paper trading lets you test the bot with **simulated trades** using **real market data** - no real money at risk!

## ⚡ Quick Setup (5 minutes)

### 1. Enable Paper Mode

Edit your `config.user.json`:

```json
{
  "global": {
    "paperMode": true
  }
}
```

### 2. Start the Bot

```bash
npm run dev
```

### 3. Open Dashboard

Navigate to: `http://localhost:3000`

You'll see the **Paper Trading Dashboard** at the top showing:
- Virtual balance (starts at 1000 USDT)
- Session P&L
- Win rate
- Open positions

### 4. Watch It Trade

The bot will:
- ✅ Detect liquidation events (real market data)
- ✅ Place simulated orders
- ✅ Track virtual positions
- ✅ Trigger TP/SL automatically
- ✅ Calculate realistic P&L with fees

## 📊 Understanding the Dashboard

### Balance Section
- **Total Balance**: Your virtual USDT balance
- **Available**: Balance available for new trades
- **Session P&L**: Profit/loss since bot started
- **Used Margin**: Locked in open positions

### Statistics Section
- **Unrealized P&L**: Floating profit/loss on open positions
- **Realized P&L**: Closed trade profit/loss
- **Total Trades**: Number of trades executed
- **Win Rate**: Percentage of winning trades
- **W/L**: Wins vs Losses count

### Open Positions
Each position shows:
- Symbol (e.g., BTCUSDT)
- Side (LONG/SHORT)
- Entry price
- Current P&L
- P&L percentage

## 🎮 Try Your Strategy

### Example: Conservative Strategy

```json
{
  "global": {
    "paperMode": true,
    "riskPercent": 1
  },
  "symbols": {
    "BTCUSDT": {
      "tradeSize": 10,
      "leverage": 5,
      "tpPercent": 1.5,
      "slPercent": 2,
      "longVolumeThresholdUSDT": 50000,
      "shortVolumeThresholdUSDT": 50000
    }
  }
}
```

This will:
- Use 1% of balance per trade
- 5x leverage (safe)
- Take profit at 1.5%
- Stop loss at 2%
- Only trade on large liquidations (50k+)

### Example: Aggressive Strategy

```json
{
  "global": {
    "paperMode": true,
    "riskPercent": 2
  },
  "symbols": {
    "BTCUSDT": {
      "tradeSize": 20,
      "leverage": 10,
      "tpPercent": 2,
      "slPercent": 1.5,
      "longVolumeThresholdUSDT": 20000,
      "shortVolumeThresholdUSDT": 20000
    }
  }
}
```

This will:
- Use 2% of balance per trade
- 10x leverage (higher risk)
- Take profit at 2%
- Stop loss at 1.5%
- Trade on smaller liquidations (20k+)

## 📈 Monitoring Results

### Good Signs ✅
- Win rate above 60%
- Positive total P&L after 50+ trades
- Consistent gains over multiple days
- No large drawdowns

### Warning Signs ⚠️
- Win rate below 50%
- Frequent stop losses
- Large losing trades
- Inconsistent results

## 🔄 Switching to Live Trading

**Only after thorough paper trading!**

### Prerequisites
1. ✅ 70%+ win rate in paper trading
2. ✅ Positive P&L over 100+ trades
3. ✅ Strategy tested for at least 1 week
4. ✅ API keys configured
5. ✅ Understood all risks

### Switch Process

1. **Backup config**:
   ```bash
   cp config.user.json config.user.backup.json
   ```

2. **Change to live mode**:
   ```json
   {
     "global": {
       "paperMode": false,
       "riskPercent": 0.5  // Start conservative!
     }
   }
   ```

3. **Restart bot**:
   ```bash
   npm run dev
   ```

4. **Monitor closely**:
   - Watch first 10 trades
   - Be ready to stop if issues occur
   - Don't leave unattended initially

## 🛠️ Common Tasks

### Reset Paper Balance

Stop the bot and restart it. The balance resets to 1000 USDT.

### Test Different Symbols

Add more symbols to your config:

```json
{
  "symbols": {
    "BTCUSDT": { ... },
    "ETHUSDT": { ... },
    "SOLUSDT": { ... }
  }
}
```

### Adjust Risk

Change `riskPercent` in config (0.1 = 0.1% per trade):

```json
{
  "global": {
    "riskPercent": 1.5
  }
}
```

### Test TP/SL Levels

Modify in symbol config:

```json
{
  "symbols": {
    "BTCUSDT": {
      "tpPercent": 2.0,  // 2% take profit
      "slPercent": 1.5   // 1.5% stop loss
    }
  }
}
```

## 📝 Tips for Success

1. **Start Small**: Begin with low leverage (3-5x) and small position sizes

2. **Test Multiple Scenarios**: Try different market conditions (trending, ranging, volatile)

3. **Track Everything**: Keep notes on what settings work best

4. **Be Patient**: Test for at least a week before going live

5. **Understand Fees**: Paper mode includes realistic 0.02% maker / 0.04% taker fees

6. **Watch the Logs**: Terminal output shows all simulated trades

7. **Don't Rush**: Paper trading is free - use it extensively!

## ❓ FAQ

### Q: Does paper trading use real prices?
**A:** Yes! It uses real-time market data from Aster Finance exchange.

### Q: Are the trades visible on the exchange?
**A:** No, they're completely simulated. Nothing hits the exchange.

### Q: How realistic is it?
**A:** Very realistic. It simulates:
- Order execution at market prices
- Trading fees
- Margin requirements
- TP/SL triggers
- Liquidations

### Q: What's the starting balance?
**A:** 1000 USDT (will be configurable in future update)

### Q: Can I test with my actual balance?
**A:** Not yet, but coming soon!

### Q: How do I know if my strategy is good?
**A:** Look for:
- 70%+ win rate
- Positive P&L over 100+ trades
- Consistent results over 1+ week

### Q: When should I switch to live?
**A:** Only after:
- Extensive paper trading (1+ week minimum)
- Consistent profitability
- Understanding all bot features
- Comfortable with the risks

## 🆘 Troubleshooting

### Paper Trading Dashboard Not Showing
- Ensure `paperMode: true` in config
- Restart the bot
- Refresh browser

### No Trades Happening
- Check liquidation thresholds aren't too high
- Verify symbols are correct
- Check bot is running and connected

### Balance Not Updating
- Check browser console for errors
- Verify WebSocket connection
- Restart bot if needed

### TP/SL Not Triggering
- Ensure positions are open
- Check TP/SL prices are set
- Verify price updates are coming in

## 📚 Learn More

- [Full Paper Trading Documentation](./PAPER_TRADING.md)
- [Main README](../README.md)
- [Configuration Guide](../CLAUDE.md)

---

**Remember**: Paper trading is risk-free practice. Use it thoroughly before risking real money! 🎯
