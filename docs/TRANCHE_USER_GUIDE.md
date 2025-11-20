# Multi-Tranche Position Management - User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [What Are Tranches?](#what-are-tranches)
3. [Why Use Multi-Tranche Management?](#why-use-multi-tranche-management)
4. [Getting Started](#getting-started)
5. [Configuration Guide](#configuration-guide)
6. [Using the Tranche Dashboard](#using-the-tranche-dashboard)
7. [Trading Strategies](#trading-strategies)
8. [Monitoring & Troubleshooting](#monitoring--troubleshooting)
9. [Best Practices](#best-practices)
10. [FAQ](#faq)

---

## Introduction

The **Multi-Tranche Position Management System** is an advanced feature that allows the bot to track multiple independent position entries (tranches) within the same trading pair. This enables you to:

- Isolate losing positions automatically
- Continue trading fresh entries without adding to underwater positions
- Generate consistent profits while bad positions recover
- Maximize margin efficiency and avoid locked capital

This guide will help you understand, configure, and use the tranche system effectively.

---

## What Are Tranches?

Think of **tranches** as individual "sub-positions" within the same trading symbol.

### Traditional Position Management

Normally, when you trade a symbol multiple times, your positions stack together:

```
Entry #1: LONG BTCUSDT @ $50,000 (0.01 BTC)
Entry #2: LONG BTCUSDT @ $49,000 (0.01 BTC)
Combined Position: LONG BTCUSDT @ $49,500 (0.02 BTC) - Average entry
```

**Problem:** If the first entry is losing, you can't exit it without closing the entire combined position.

### Multi-Tranche Management

With tranches, each entry is tracked separately:

```
Tranche #1: LONG BTCUSDT @ $50,000 (0.01 BTC) → Down 5% → ISOLATED
Tranche #2: LONG BTCUSDT @ $49,000 (0.01 BTC) → Up 2% → CLOSE (+profit)
Tranche #3: LONG BTCUSDT @ $48,500 (0.01 BTC) → Up 3% → CLOSE (+profit)

Exchange sees: One combined position (updated as tranches close)
Bot tracks: Three separate entries with independent P&L
```

**Solution:** You can close profitable tranches individually while holding losing tranches for recovery.

---

## Why Use Multi-Tranche Management?

### Key Benefits

| Feature | Without Tranches | With Tranches |
|---------|-----------------|---------------|
| **Losing Position** | Must hold entire position or take full loss | Isolate loser, trade fresh entries |
| **Profit Opportunities** | Blocked until position recovers | Continue trading and profiting |
| **Margin Efficiency** | Capital locked in underwater position | Only isolated tranches locked |
| **Risk Management** | All-or-nothing closes | Granular control per entry |
| **Profitability** | Wait for breakeven/profit | Generate profits while holding losers |

### Real-World Example

**Scenario:** BTCUSDT liquidation hunting with 5% isolation threshold

```
09:00 - Enter LONG @ $50,000 (Tranche #1)
09:15 - Price drops to $47,500 (-5%)
        → Tranche #1 ISOLATED automatically
09:30 - New liquidation spike
        → Enter LONG @ $47,800 (Tranche #2)
09:45 - Price hits $48,700 (+1.8%)
        → Close Tranche #2 for +1.8% profit
10:00 - Another liquidation spike
        → Enter LONG @ $48,200 (Tranche #3)
10:15 - Price hits $49,300 (+2.3%)
        → Close Tranche #3 for +2.3% profit
10:30 - Price recovers to $50,500
        → Close Tranche #1 for +1% profit

Result: +5.1% total profit vs -5% loss without tranches
```

---

## Getting Started

### Prerequisites

1. Bot must be installed and running
2. Access to web dashboard at `http://localhost:3000`
3. At least one symbol configured in your config
4. Understanding of basic trading concepts (leverage, SL/TP)

### Quick Setup (5 Minutes)

1. **Enable Tranches:**
   - Open http://localhost:3000/config
   - Select your trading symbol (e.g., BTCUSDT)
   - Find "Tranche Management Settings"
   - Toggle **"Enable Multi-Tranche Management"** to ON

2. **Start with Defaults:**
   - Isolation Threshold: 5%
   - Max Tranches: 3
   - Max Isolated: 2
   - Closing Strategy: FIFO (First In, First Out)

3. **Test in Paper Mode:**
   - Ensure "Paper Mode" is enabled
   - Monitor the `/tranches` dashboard
   - Watch how tranches are created and isolated

4. **Go Live (When Ready):**
   - Disable paper mode
   - Start with small position sizes
   - Monitor closely for the first few trades

---

## Configuration Guide

### Access Configuration

**Via Web UI:**
1. Navigate to http://localhost:3000/config
2. Select your symbol from the list
3. Scroll to "Tranche Management Settings"

### Core Settings

#### 1. Enable Multi-Tranche Management
- **Type:** Toggle (ON/OFF)
- **Default:** OFF
- **Description:** Master switch for tranche system
- **Recommendation:** Start OFF in paper mode, enable after testing

#### 2. Isolation Threshold
- **Type:** Percentage (0-100%)
- **Default:** 5%
- **Description:** Unrealized loss % that triggers automatic isolation
- **Examples:**
  - **3%**: Aggressive isolation (more tranches, quicker isolation)
  - **5%**: Balanced (recommended for most strategies)
  - **10%**: Conservative (fewer isolations, higher tolerance)
- **Formula:** `(currentPrice - entryPrice) / entryPrice * 100`

#### 3. Max Tranches
- **Type:** Number (1-10)
- **Default:** 3
- **Description:** Maximum active tranches per symbol/side
- **Recommendations:**
  - **1-2**: Conservative, minimal complexity
  - **3-5**: Balanced, good for most strategies
  - **6+**: Aggressive, requires more monitoring

#### 4. Max Isolated Tranches
- **Type:** Number (1-10)
- **Default:** 2
- **Description:** Max underwater tranches before blocking new trades
- **Safety:** Prevents accumulating too many losing positions
- **Formula:** `max_isolated = max_tranches - 1` (keep at least 1 slot for profitable trading)

#### 5. Allow Tranche While Isolated
- **Type:** Toggle (ON/OFF)
- **Default:** ON
- **Description:** Allow new tranches even when some are isolated
- **Use Cases:**
  - **ON**: Continue trading despite isolated tranches (recommended)
  - **OFF**: Block all new trades until isolated tranches close

### Strategy Settings

The tranche system uses optimized strategies that are hardcoded for best performance:

#### 1. Closing Strategy: LIFO (Last In, First Out)
**Automatically configured** - closes newest tranches first.

**Why LIFO?**
- Perfect for liquidation hunting strategies
- Quick profit-taking on recent entries
- Keeps older positions for potential recovery
- Minimizes complexity

**Example:**
```
Tranches:
#1: LONG @ $50,000 → -5% (oldest, underwater)
#2: LONG @ $48,000 → +2% (middle, profitable)
#3: LONG @ $49,000 → +1% (newest, profitable)

SL/TP triggers → LIFO closes #3 first, then #2, then #1
```

#### 2. Best Entry Tracking
The bot tracks which tranche has the most favorable entry price:
- **For LONG positions:** Lowest entry price
- **For SHORT positions:** Highest entry price

This is used for display purposes and P&L tracking to help you understand your best positions.

#### 3. Isolation Action
Determines what happens when a tranche is isolated.

| Action | Description | Status |
|--------|-------------|--------|
| **HOLD** | Keep position, wait for recovery | ✅ Implemented |
| **REDUCE_LEVERAGE** | Lower leverage to reduce risk | 🔜 Future |
| **PARTIAL_CLOSE** | Close portion to reduce exposure | 🔜 Future |

**Currently:** Only HOLD is implemented. Future versions will add dynamic risk management.

---

## Using the Tranche Dashboard

Access the dashboard at **http://localhost:3000/tranches**

### Dashboard Overview

The tranche dashboard provides real-time visibility into all your tranches:

1. **Symbol Selector**
   - Choose which symbol to view
   - Select side (LONG/SHORT)
   - Auto-refreshes every 5 seconds

2. **Summary Metrics**
   - Total Active Tranches
   - Total Isolated Tranches
   - Total Closed Tranches
   - Combined Unrealized P&L
   - Combined Realized P&L

3. **Tranche Breakdown Tab**
   - **Active Tranches:** Currently open positions
   - **Isolated Tranches:** Underwater positions (>threshold)
   - **Closed Tranches:** Historical completed trades
   - Color-coded status indicators

4. **Event Timeline Tab**
   - Real-time event stream
   - Tranche creation notifications
   - Isolation events
   - Close events with P&L
   - Sync updates from exchange

### Reading Tranche Cards

Each tranche displays:

```
┌─────────────────────────────────────────┐
│ Tranche #abc123 | LONG                  │
│ ───────────────────────────────────────│
│ Entry: $50,000.00 | Time: 10:30:15 AM  │
│ Quantity: 0.01 BTC | Margin: $100 USDT │
│ Leverage: 10x | Unrealized P&L: -$5.00│
│ TP: $50,500 (1%) | SL: $49,000 (2%)   │
│ Status: 🔴 ISOLATED                    │
└─────────────────────────────────────────┘
```

**Status Colors:**
- 🟢 **GREEN**: Active (profitable or within threshold)
- 🔴 **RED**: Isolated (underwater > threshold)
- ⚫ **GRAY**: Closed (historical)

### Timeline Events

Events appear in real-time and show:
- ✅ **Tranche Created**: New entry opened
- ⚠️ **Tranche Isolated**: Position went underwater
- 💰 **Tranche Closed**: Exit with P&L
- 🔄 **Exchange Sync**: Reconciliation with exchange
- 📊 **P&L Update**: Unrealized P&L changed

---

## Trading Strategies

The tranche system automatically uses **LIFO closing** for all strategies. Configure these parameters to match your trading style:

### Strategy 1: Aggressive Scalping

**Goal:** Fast in-and-out trades with minimal isolation time

**Configuration:**
```json
{
  "trancheIsolationThreshold": 3,
  "maxTranches": 5,
  "maxIsolatedTranches": 2,
  "allowTrancheWhileIsolated": true
}
```

**Characteristics:**
- Low 3% isolation threshold → quick isolation
- High max tranches (5) → more opportunities
- LIFO automatically takes profits on newest entries
- Good for high-volatility, liquid pairs

**Pros:** Maximum trading frequency, quick profit generation
**Cons:** More isolated tranches, requires active monitoring

---

### Strategy 2: Hold & Recover

**Goal:** Hold losing positions long-term while scalping profits

**Configuration:**
```json
{
  "trancheIsolationThreshold": 10,
  "maxTranches": 3,
  "maxIsolatedTranches": 2,
  "allowTrancheWhileIsolated": true
}
```

**Characteristics:**
- High 10% isolation threshold → rare isolation
- Moderate max tranches (3) → balanced
- LIFO lets profitable new entries close first
- Good for trending, less volatile pairs

**Pros:** Fewer isolations, simpler management
**Cons:** Takes longer to recover underwater positions

---

### Strategy 3: Balanced Approach

**Goal:** Balance between quick profits and position recovery

**Configuration:**
```json
{
  "trancheIsolationThreshold": 5,
  "maxTranches": 4,
  "maxIsolatedTranches": 2,
  "allowTrancheWhileIsolated": true
}
```

**Characteristics:**
- Balanced 5% isolation threshold
- Moderate max tranches (4)
- LIFO closes newest (often most profitable)
- Good for mixed market conditions

**Pros:** Good balance of profit-taking and recovery
**Cons:** Middle-ground complexity

---

### Strategy 4: Conservative Risk Management

**Goal:** Minimal complexity, tight risk control

**Configuration:**
```json
{
  "trancheIsolationThreshold": 7,
  "maxTranches": 2,
  "maxIsolatedTranches": 1,
  "allowTrancheWhileIsolated": false
}
```

**Characteristics:**
- Moderate 7% isolation threshold
- Low max tranches (2) → simple tracking
- Block new trades when isolated → no compounding losses
- LIFO minimizes exposure time

**Pros:** Simple, controlled risk
**Cons:** Fewer trading opportunities

---

## Monitoring & Troubleshooting

### Normal Operation Indicators

✅ **Healthy Tranche System:**
- Active tranches cycling (opening/closing regularly)
- Isolated tranches recovering over time
- Positive net realized P&L trend
- Dashboard updates every 5 seconds
- Timeline shows regular events

### Warning Signs

⚠️ **Potential Issues:**
- Max isolated tranches reached frequently
- Tranches not closing for extended periods
- Large negative unrealized P&L building up
- Sync status showing "drift" or "conflict"
- No new tranches being created

### Common Issues & Solutions

#### Issue 1: Too Many Isolated Tranches

**Symptom:** Max isolated limit reached, new trades blocked

**Causes:**
- Isolation threshold too low
- Market moving strongly against positions
- Max tranches set too high

**Solutions:**
1. Increase isolation threshold (5% → 7% or 10%)
2. Reduce max tranches (5 → 3)
3. Wait for market recovery
4. Manually close worst tranches via exchange

---

#### Issue 2: Tranches Not Being Created

**Symptom:** No new tranches appearing despite liquidation signals

**Causes:**
- `enableTrancheManagement` not enabled
- Max tranches limit reached
- Max isolated tranches blocking new entries
- TrancheManager initialization failed

**Solutions:**
1. Check config UI: Tranche Management toggle ON
2. View current tranche count in dashboard
3. Check bot console for TrancheManager errors
4. Restart bot if initialization failed

---

#### Issue 3: Sync Drift Detected

**Symptom:** Timeline shows "Exchange sync drift detected"

**Causes:**
- Manual trades made outside bot
- Partial fills not tracked correctly
- Database/memory state mismatch

**Solutions:**
1. Let TrancheManager auto-reconcile (happens automatically)
2. Check exchange position size matches tranche totals
3. If persistent, restart bot to re-sync from exchange

---

#### Issue 4: Unrealized P&L Not Updating

**Symptom:** P&L values frozen or stale

**Causes:**
- WebSocket connection lost
- Price service not updating
- Dashboard auto-refresh stopped

**Solutions:**
1. Check WebSocket connection status (top of timeline tab)
2. Refresh browser page
3. Check bot console for WebSocket errors
4. Verify `priceService` is running

---

### Logs to Check

**Bot Console:**
```
TrancheManager: Created tranche [ID] for BTCUSDT LONG
TrancheManager: Isolated tranche [ID] (P&L: -5.2%)
TrancheManager: Closed tranche [ID] with P&L: $12.50
```

**Database Queries:**
```sql
-- View all active tranches
SELECT * FROM tranches WHERE status = 'active';

-- View isolated tranches
SELECT * FROM tranches WHERE isolated = 1;

-- View tranche events (audit trail)
SELECT * FROM tranche_events ORDER BY event_time DESC LIMIT 20;
```

---

## Best Practices

### 1. Start in Paper Mode
- Enable tranches in paper mode first
- Monitor for at least 24 hours
- Understand how isolation/closing works
- Adjust settings based on simulated results

### 2. Conservative Initial Settings
```json
{
  "trancheIsolationThreshold": 5,    // Balanced threshold
  "maxTranches": 3,                  // Moderate complexity
  "maxIsolatedTranches": 2,          // Safety buffer
  "allowTrancheWhileIsolated": true  // Continue trading
}
```
Note: LIFO closing and best entry tracking are automatically configured.

### 3. Monitor Regularly
- Check `/tranches` dashboard daily
- Review timeline events for patterns
- Watch for repeated isolations (adjust threshold)
- Track realized P&L trends

### 4. Adjust Based on Market Conditions

**Trending Market (Strong Direction):**
- Increase isolation threshold (7-10%)
- Use FIFO closing (ride trend)
- Higher max tranches (4-5)

**Choppy Market (Range-Bound):**
- Decrease isolation threshold (3-5%)
- Use LIFO closing (quick exits)
- Moderate max tranches (3-4)

**High Volatility:**
- Increase isolation threshold (8-12%)
- Reduce max tranches (2-3)
- Use WORST_FIRST closing (cut losses)

### 5. Risk Management Rules

**Position Sizing:**
- Each tranche should be manageable in isolation
- Total margin across all tranches ≤ max position margin
- Don't overleverage individual tranches

**Isolation Management:**
- Don't let isolated tranches exceed 50% of total margin
- If >2 tranches isolated, reduce new trade frequency
- Consider manual intervention if isolation persists >24h

**Leverage Control:**
- Lower leverage (5-10x) when using tranches
- Higher leverage increases isolation risk
- Balance between profit potential and safety

### 6. Testing New Strategies

Before deploying a new tranche strategy:

1. **Backtest (Manual):**
   - Review historical data
   - Estimate isolation frequency
   - Calculate expected P&L

2. **Paper Trade (1-2 weeks):**
   - Enable in paper mode
   - Monitor actual isolation rate
   - Adjust settings as needed

3. **Small Live Test (1 week):**
   - Start with minimal position sizes
   - One symbol only
   - Monitor closely

4. **Full Deployment:**
   - Increase position sizes gradually
   - Add more symbols one at a time
   - Maintain monitoring routine

---

## FAQ

### General Questions

**Q: Do I need special API permissions for tranches?**
A: No, tranches are tracked locally by the bot. Standard trading API permissions are sufficient.

**Q: Will tranches work with paper mode?**
A: Yes! Paper mode fully supports tranches with simulated fills and P&L.

**Q: Can I use tranches on multiple symbols simultaneously?**
A: Yes, each symbol has independent tranche tracking and configuration.

**Q: What happens if the bot restarts?**
A: Tranches are persisted in the SQLite database and automatically reloaded on startup.

---

### Configuration Questions

**Q: What's the best isolation threshold?**
A: Start with 5%. Adjust based on your risk tolerance and market volatility:
- Aggressive: 3%
- Balanced: 5-7%
- Conservative: 10%+

**Q: How many max tranches should I allow?**
A: Recommended: 3-5 for most strategies. More tranches = more complexity and monitoring.

**Q: Should I allow tranches while isolated?**
A: Generally YES. This lets you keep trading while bad positions recover. Set to NO if you want stricter risk control.

**Q: Can I change the closing strategy?**
A: The closing strategy is automatically set to LIFO (Last In, First Out), which is optimal for liquidation hunting. LIFO closes newest tranches first, allowing quick profit-taking while letting older positions recover. This is hardcoded for simplicity and best performance.

---

### Technical Questions

**Q: How does the bot track tranches vs exchange positions?**
A: The bot maintains a local "virtual" tracking layer while the exchange sees one combined position. The bot reconciles differences automatically.

**Q: What if I manually close a position on the exchange?**
A: TrancheManager detects the close and reconciles local tranches accordingly. Check timeline for sync events.

**Q: Can I manually close a specific tranche?**
A: Not directly. The bot's closing strategy determines which tranches close. You can close the entire exchange position manually if needed.

**Q: What happens if quantities drift (bot vs exchange)?**
A: TrancheManager auto-syncs every 10 seconds and detects drift >1%. It creates recovery tranches or adjusts existing ones as needed.

---

### Troubleshooting Questions

**Q: My tranches aren't being created. Why?**
A: Check:
1. Is `enableTrancheManagement` enabled in config?
2. Have you reached max tranches limit?
3. Are too many tranches isolated (blocking new entries)?
4. Check bot console for TrancheManager errors

**Q: Why is my P&L not updating?**
A: Check:
1. WebSocket connection status (timeline tab)
2. Refresh browser page
3. Verify bot is running and connected to exchange

**Q: What does "sync drift" mean?**
A: Exchange position quantity doesn't match sum of local tranches (>1% difference). Usually auto-reconciles within 10 seconds.

**Q: Can I delete old closed tranches?**
A: Yes, closed tranches are automatically cleaned up after a configurable retention period. You can also manually delete from database:
```sql
DELETE FROM tranches WHERE status = 'closed' AND exit_time < [timestamp];
```

---

### Advanced Questions

**Q: Can I implement custom closing strategies?**
A: Yes, modify `selectTranchesToClose()` in `src/lib/services/trancheManager.ts`. Requires TypeScript knowledge.

**Q: How do I export tranche data for analysis?**
A: Query the database:
```sql
SELECT * FROM tranches WHERE symbol = 'BTCUSDT' ORDER BY entry_time DESC;
```
Or use the `/api/tranches` API endpoint.

**Q: Can I disable tranches for specific symbols only?**
A: Yes, set `enableTrancheManagement: false` for that symbol in config. Other symbols remain unaffected.

**Q: Does the tranche system support hedging mode?**
A: Yes, tranches work with both ONE_WAY and HEDGE position modes. In HEDGE mode, LONG and SHORT sides have independent tranche tracking.

---

## Support & Resources

### Documentation
- **Implementation Plan:** `docs/TRANCHE_IMPLEMENTATION_PLAN.md`
- **Testing Guide:** `docs/TRANCHE_TESTING.md`
- **Technical Docs:** `CLAUDE.md` (Multi-Tranche section)

### Community
- **Discord:** [Join Server](https://discord.gg/P8Ev3Up)
- **GitHub Issues:** [Report Problems](https://github.com/CryptoGnome/aster_lick_hunter_node/issues)

### Code References
- **TrancheManager:** `src/lib/services/trancheManager.ts`
- **Database Layer:** `src/lib/db/trancheDb.ts`
- **UI Dashboard:** `src/app/tranches/page.tsx`
- **Types:** `src/lib/types.ts` (Tranche interfaces)

---

## Conclusion

The multi-tranche system is a powerful tool for managing complex trading scenarios. By isolating losing positions and continuing to trade fresh entries, you can:

✅ Generate consistent profits even when some positions are underwater
✅ Maximize margin efficiency and capital utilization
✅ Maintain trading velocity without adding to losers
✅ Implement sophisticated strategies with granular control

**Remember:**
- Start in paper mode
- Use conservative settings initially
- Monitor regularly via `/tranches` dashboard
- Adjust based on market conditions
- Test new strategies thoroughly before deployment

Happy trading! 🚀
