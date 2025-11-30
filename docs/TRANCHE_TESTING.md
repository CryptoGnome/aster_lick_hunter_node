# Multi-Tranche Position Management - Testing Guide

## Overview

This guide provides comprehensive testing procedures for the multi-tranche position management system. The system allows tracking multiple virtual position entries (tranches) per symbol while syncing with a single exchange position.

## Prerequisites

Before testing, ensure:
- [ ] TypeScript compilation passes: `npx tsc --noEmit` ✅
- [ ] All Phase 1-5 code is committed to `feature/multi-tranche-management` branch
- [ ] Database is initialized with tranche tables
- [ ] Configuration includes tranche-enabled symbols

## Test Environment Setup

### 1. Configuration Setup

Add tranche management settings to your test symbol in `config.user.json`:

```json
{
  "symbols": {
    "BTCUSDT": {
      "enableTrancheManagement": true,
      "trancheIsolationThreshold": 5,
      "maxTranches": 3,
      "maxIsolatedTranches": 2,
      "trancheStrategy": {
        "closingStrategy": "FIFO",
        "slTpStrategy": "NEWEST",
        "isolationAction": "HOLD"
      },
      "allowTrancheWhileIsolated": true,
      "trancheAutoCloseIsolated": false
    }
  },
  "global": {
    "paperMode": true
  }
}
```

### 2. Database Verification

Check that tranche tables were created:

```bash
# Open database
sqlite3 liquidations.db

# Verify tables exist
.tables
# Should show: tranches, tranche_events

# Check tranche table schema
.schema tranches

# Check events table schema
.schema tranche_events

# Exit
.exit
```

Expected `tranches` table columns:
- id, symbol, side, positionSide, entryPrice, quantity, marginUsed, leverage
- entryTime, entryOrderId, exitPrice, exitTime, exitOrderId
- unrealizedPnl, realizedPnl, tpPercent, slPercent, tpPrice, slPrice
- status, isolated, isolationTime, isolationPrice, notes

## Manual Testing Checklist

### Phase 1: Database Layer Tests

#### Test 1.1: Database Initialization
- [ ] Start bot: `npm run dev:bot`
- [ ] Verify log: `✅ Database initialized`
- [ ] Check for tranche table creation logs
- [ ] No database errors in console

#### Test 1.2: Database CRUD Operations
```bash
# Test creating a tranche record directly
node -e "
const { createTranche } = require('./src/lib/db/trancheDb');
createTranche({
  id: 'test-uuid-001',
  symbol: 'BTCUSDT',
  side: 'LONG',
  positionSide: 'LONG',
  entryPrice: 50000,
  quantity: 0.001,
  marginUsed: 5,
  leverage: 10,
  entryTime: Date.now(),
  entryOrderId: '123456',
  unrealizedPnl: 0,
  realizedPnl: 0,
  tpPercent: 5,
  slPercent: 2,
  tpPrice: 52500,
  slPrice: 49000,
  status: 'active',
  isolated: false
}).then(() => console.log('✅ Tranche created')).catch(e => console.error('❌ Error:', e));
"
```

Expected: `✅ Tranche created`

Verify in database:
```bash
sqlite3 liquidations.db "SELECT * FROM tranches WHERE id='test-uuid-001';"
```

### Phase 2: TrancheManager Service Tests

#### Test 2.1: TrancheManager Initialization
- [ ] Enable tranche management for BTCUSDT in config
- [ ] Start bot: `npm run dev:bot`
- [ ] Look for log: `✅ Tranche Manager initialized for 1 symbol(s): BTCUSDT`
- [ ] Verify no initialization errors

#### Test 2.2: Tranche Creation via Manager
```bash
# Create test script
node -e "
const { loadConfig } = require('./src/lib/bot/config');
const { initializeTrancheManager } = require('./src/lib/services/trancheManager');

(async () => {
  const config = await loadConfig();
  const tm = initializeTrancheManager(config);
  await tm.initialize();

  const tranche = await tm.createTranche({
    symbol: 'BTCUSDT',
    side: 'BUY',
    positionSide: 'LONG',
    entryPrice: 50000,
    quantity: 0.001,
    marginUsed: 5,
    leverage: 10,
    orderId: 'test-order-001'
  });

  console.log('✅ Tranche created:', tranche.id.substring(0, 8));
  console.log('Entry:', tranche.entryPrice, 'TP:', tranche.tpPrice, 'SL:', tranche.slPrice);
})();
"
```

Expected output:
- `✅ Tranche created: xxxxxxxx`
- Entry, TP, and SL prices calculated correctly

#### Test 2.3: Isolation Logic
```bash
# Test isolation threshold calculation
node -e "
const { loadConfig } = require('./src/lib/bot/config');
const { initializeTrancheManager } = require('./src/lib/services/trancheManager');

(async () => {
  const config = await loadConfig();
  const tm = initializeTrancheManager(config);
  await tm.initialize();

  // Create tranche at 50000
  const tranche = await tm.createTranche({
    symbol: 'BTCUSDT',
    side: 'BUY',
    positionSide: 'LONG',
    entryPrice: 50000,
    quantity: 0.001,
    marginUsed: 5,
    leverage: 10,
    orderId: 'test-order-002'
  });

  console.log('Tranche created at entry:', tranche.entryPrice);

  // Test isolation at 47500 (5% loss)
  const shouldIsolate = tm.shouldIsolateTranche(tranche, 47500);
  console.log('Should isolate at 47500 (5% loss)?', shouldIsolate);

  // Test at 48000 (4% loss)
  const shouldNotIsolate = tm.shouldIsolateTranche(tranche, 48000);
  console.log('Should isolate at 48000 (4% loss)?', shouldNotIsolate);
})();
"
```

Expected:
- Should isolate at 47500: `true` ✅
- Should isolate at 48000: `false` ✅

### Phase 3: Hunter Integration Tests

#### Test 3.1: Pre-Trade Tranche Checks
- [ ] Enable paper mode and tranche management
- [ ] Set `maxTranches: 2` for BTCUSDT
- [ ] Start bot and wait for liquidation opportunities
- [ ] Observe logs for tranche limit checks
- [ ] After 2 tranches created, verify 3rd trade is blocked

Expected logs:
```
Hunter: Tranche Limit Reached - BTCUSDT
Hunter: Active tranches (2) >= maxTranches (2)
```

#### Test 3.2: Tranche Creation on Order Fill
- [ ] Clear existing tranches from database
- [ ] Start bot with paper mode enabled
- [ ] Wait for a liquidation opportunity and order placement
- [ ] Check logs for: `Hunter: Created tranche xxxxxxxx for BTCUSDT BUY`
- [ ] Verify tranche in database:

```bash
sqlite3 liquidations.db "SELECT id, symbol, side, entryPrice, quantity, status FROM tranches ORDER BY entryTime DESC LIMIT 1;"
```

Expected: New tranche record with correct details

### Phase 4: PositionManager Integration Tests

#### Test 4.1: Tranche Closing on SL/TP Fill
This test requires actual positions to be closed. Best tested in paper mode with mock fills:

- [ ] Create 2 tranches for BTCUSDT LONG (via Hunter)
- [ ] Simulate SL/TP order fill (requires live trading or paper mode simulation)
- [ ] Check logs for: `PositionManager: Processed tranche close for BTCUSDT LONG`
- [ ] Verify tranches marked as closed in database

```bash
sqlite3 liquidations.db "SELECT id, status, exitPrice, realizedPnl FROM tranches WHERE status='closed' ORDER BY exitTime DESC LIMIT 5;"
```

#### Test 4.2: Exchange Synchronization
- [ ] Create 2 tranches manually in database (total quantity 0.002 BTC)
- [ ] Open position on exchange with quantity 0.002 BTC
- [ ] Trigger ACCOUNT_UPDATE event
- [ ] Check logs for: `PositionManager: Synced tranches for BTCUSDT LONG with exchange`
- [ ] Verify sync status in TrancheGroup is 'synced'

### Phase 5: Real-Time Broadcasting Tests

#### Test 5.1: WebSocket Tranche Events
- [ ] Start bot: `npm run dev`
- [ ] Open dashboard: http://localhost:3000
- [ ] Open browser console (F12)
- [ ] Look for WebSocket connection: `ws://localhost:8080`
- [ ] Create a tranche (via liquidation opportunity)
- [ ] Verify WebSocket messages received:
  - `tranche_created` with tranche details
  - `tranche_pnl_update` with P&L updates

Expected WebSocket message format:
```json
{
  "type": "tranche_created",
  "data": {
    "trancheId": "uuid-here",
    "symbol": "BTCUSDT",
    "side": "LONG",
    "entryPrice": 50000,
    "quantity": 0.001,
    "marginUsed": 5,
    "leverage": 10,
    "tpPrice": 52500,
    "slPrice": 49000,
    "timestamp": "2025-10-12T..."
  }
}
```

#### Test 5.2: Isolation Broadcasting
- [ ] Create tranche at entry price (e.g., 50000)
- [ ] Wait for price to drop >5% OR manually trigger isolation
- [ ] Check browser console for `tranche_isolated` WebSocket event
- [ ] Verify log: `⚠️  Tranche isolated: xxxxxxxx for BTCUSDT (-5.XX% loss)`

#### Test 5.3: Closing Broadcasting
- [ ] Have active tranche
- [ ] Close position (SL/TP hit or manual close)
- [ ] Check browser console for `tranche_closed` WebSocket event
- [ ] Verify log: `💰 Tranche closed: xxxxxxxx for BTCUSDT (PnL: $X.XX)`

## Integration Testing Scenarios

### Scenario 1: Full Lifecycle - Profitable Trade
1. Enable tranche management for BTCUSDT
2. Wait for liquidation opportunity (LONG)
3. Hunter places order → Tranche created
4. Price moves up 5% → TP hit
5. PositionManager closes tranche
6. Verify tranche status='closed' with positive realizedPnl

### Scenario 2: Isolation Flow
1. Create tranche at entry 50000 (LONG)
2. Price drops to 47500 (5% loss)
3. Isolation monitor detects threshold breach
4. Tranche marked as isolated
5. New liquidation opportunity occurs
6. New tranche created (old one still isolated)
7. Price recovers to 51000
8. Both tranches profitable, close together

### Scenario 3: Multi-Tranche Position
1. Create 3 tranches for BTCUSDT LONG:
   - Tranche 1: Entry 50000, qty 0.001
   - Tranche 2: Entry 49500, qty 0.001
   - Tranche 3: Entry 49000, qty 0.001
2. Total exchange position: 0.003 BTC
3. Price moves to 52000
4. Verify all tranches show unrealized profit
5. Close position (SL/TP or manual)
6. Verify FIFO closing: Tranche 1 closes first

### Scenario 4: Exchange Sync with Drift
1. Create 2 tranches (total 0.002 BTC)
2. Manually close 0.001 BTC on exchange
3. Trigger ACCOUNT_UPDATE
4. Verify sync detects drift (>1%)
5. Check logs for quantity mismatch warning
6. Verify appropriate tranche closed

## Performance Testing

### Test 1: Database Performance
```bash
# Insert 100 tranches
for i in {1..100}; do
  sqlite3 liquidations.db "INSERT INTO tranches (id, symbol, side, positionSide, entryPrice, quantity, marginUsed, leverage, entryTime, unrealizedPnl, realizedPnl, tpPercent, slPercent, tpPrice, slPrice, status, isolated) VALUES ('test-$i', 'BTCUSDT', 'LONG', 'LONG', 50000, 0.001, 5, 10, $(date +%s)000, 0, 0, 5, 2, 52500, 49000, 'active', 0);"
done

# Query performance
time sqlite3 liquidations.db "SELECT * FROM tranches WHERE symbol='BTCUSDT' AND status='active';"
```

Expected: Query completes in <100ms

### Test 2: Isolation Monitoring Performance
- [ ] Create 10 active tranches across multiple symbols
- [ ] Start isolation monitoring (10s interval)
- [ ] Monitor CPU usage during checks
- [ ] Verify no performance degradation

### Test 3: Concurrent Tranche Operations
- [ ] Multiple trades happening simultaneously
- [ ] Verify no race conditions
- [ ] Check database locks handled correctly
- [ ] No duplicate tranches created

## Error Handling Tests

### Test 1: TrancheManager Not Initialized
- [ ] Disable tranche management in config
- [ ] Start bot
- [ ] Trigger trade
- [ ] Verify log: `TrancheManager check failed (not initialized?), continuing with trade`
- [ ] Trade completes normally

### Test 2: Database Error Handling
- [ ] Corrupt database file
- [ ] Start bot
- [ ] Verify error logged but bot continues
- [ ] Database recreated on next start

### Test 3: Invalid Configuration
- [ ] Set `maxTranches: 0`
- [ ] Start bot
- [ ] Verify validation error or warning
- [ ] Bot uses safe default (3)

## Success Criteria

The multi-tranche system passes testing if:
- ✅ All database operations complete without errors
- ✅ Tranches created automatically on order fills
- ✅ Isolation threshold correctly triggers at configured %
- ✅ Exchange synchronization detects and handles drift
- ✅ Position closes respect closing strategy (FIFO/LIFO/etc)
- ✅ WebSocket broadcasts all tranche events to UI
- ✅ No memory leaks or performance degradation
- ✅ Error handling gracefully degrades (continues trading)
- ✅ Database persists tranches across bot restarts
- ✅ All TypeScript compilation passes

## Known Limitations & Edge Cases

### Limitations:
1. Exchange only allows one SL/TP per position (handled via strategies)
2. Tranche tracking is local - not visible to exchange
3. Position mode must be HEDGE for best results
4. Requires paper mode for full testing without real funds

### Edge Cases to Test:
- [ ] Position closed manually on exchange (not via bot)
- [ ] Network interruption during tranche creation
- [ ] Multiple tranches closing simultaneously
- [ ] Isolated tranche never recovers (stays isolated)
- [ ] Max tranches reached, then one closes, then new trade

## Next Steps After Testing

Once manual testing is complete:
1. Document any bugs found → create GitHub issues
2. Proceed to Phase 6: UI Dashboard Components
3. Create automated unit tests for critical paths
4. Prepare for merge to `dev` branch
5. Update user documentation

## Test Execution Log

Date: _____________
Tester: _____________

| Test | Status | Notes |
|------|--------|-------|
| Database Init | ⬜ Pass / ⬜ Fail | |
| Tranche Creation | ⬜ Pass / ⬜ Fail | |
| Isolation Logic | ⬜ Pass / ⬜ Fail | |
| Exchange Sync | ⬜ Pass / ⬜ Fail | |
| WebSocket Events | ⬜ Pass / ⬜ Fail | |
| Full Lifecycle | ⬜ Pass / ⬜ Fail | |
| Error Handling | ⬜ Pass / ⬜ Fail | |

---

**Important**: Always test in **paper mode** first before enabling live trading with tranche management!
