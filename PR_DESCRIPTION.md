# Major Feature Update: Comprehensive Dashboard Overhaul

## ⚠️ Important Notes

**This is a significant codebase update** with 90 commits, 154 files changed, +31,495/-2,951 lines. It represents several months of development and includes many new features, architectural changes, and bug fixes.

**This PR supersedes the following open PRs:**
- #75 - TradingView Chart with Real-time Updates
- #79 - Protective orders with trailing take profit  
- #80 - UI/UX improvements and mobile optimization

Those features are included in this PR along with many additional improvements.

**⚠️ Expect bugs** - This is a substantial rewrite with many new features. Thorough testing is recommended before production use.

---

## 🔐 Breaking Changes

### Authentication System Replaced
- **Removed NextAuth** - Replaced with custom JWT-based authentication using `jose` + `bcryptjs`
- **Password hashing** - Dashboard passwords are now bcrypt hashed (plain text still supported for migration)
- **Cookie changed** - Auth cookie is now `auth-token` instead of `next-auth.session-token`
- **Why**: NextAuth had URL mismatch issues when accessing from different IPs/domains, and compared plain text to hashed passwords incorrectly

### Configuration Changes
- New fields in `config.default.json`: `debugMode`, `websocketPath`, `setupComplete`, `liquidationDatabase`
- `setupComplete` tracks onboarding state server-side (no longer relies on localStorage)
- Default `paperMode: false` and `useTradeQualityScoring: false`

---

## ✨ New Features

### 1. TradingView-Style Interactive Charts
- Full candlestick charting with OHLCV data
- Real-time price updates via WebSocket
- VWAP overlay with historical line
- Liquidation markers on chart
- Order lines for active positions
- Multiple timeframes (1m, 5m, 15m, 1h, 4h, 1d)
- Mobile gesture support (pinch zoom, pan)
- Magnet mode for precise order placement

<!-- TODO: Add screenshot of TradingView chart -->

### 2. Liquidation Discovery Page (`/discovery`)
- Analyze liquidation patterns across ALL symbols
- Volume analysis, frequency metrics, whale detection
- Symbol recommendations based on activity
- Market depth visualization
- Configurable data retention (default 90 days)
- Add symbols directly to config from discovery

<!-- TODO: Add screenshot of Discovery page -->

### 3. Trade Quality Scoring System
- VWAP regime detection (above/below VWAP)
- Spike velocity analysis
- Volume trend scoring
- Quality scores 0-3 affect position sizing (0.5x-1.5x)
- Passive mode: records scores without filtering trades
- Historical tracking with SQLite persistence
- **Disabled by default** - enable in Global Settings

<!-- TODO: Add screenshot of Trade Quality panel -->

### 4. Protective Orders with Trailing Take Profit
- Automatic SL/TP order placement
- Trailing TP that moves to break-even after partial profit
- Configurable activation thresholds
- Works with both long and short positions

### 5. Dynamic Position Sizing
- Percentage of balance mode
- Auto-calculates trade size based on account balance
- Min/max position limits
- Quality-adjusted sizing when trade scoring enabled

### 6. Multi-Tranche Position Management
- Isolate losing positions while continuing to trade
- Track multiple entries separately per symbol
- Configurable max tranches and isolation thresholds
- **Experimental/untested** - use with caution

### 7. Paper Trading Mode
- Virtual balance simulation
- No real trades executed
- Track P&L without risk
- **Experimental** - not thoroughly tested

### 8. Improved Onboarding Flow
- Step-by-step setup wizard for new users
- API key configuration
- Symbol selection with presets (Conservative/Balanced/Aggressive)
- Dashboard tour
- State persists server-side (works across devices)

<!-- TODO: Add screenshot of Onboarding wizard -->

---

## 🔧 Improvements

### WebSocket Reliability
- **Auto-detect host from browser** - No more hardcoded localhost issues
- Works correctly when accessing via IP, domain, or localhost
- Better reconnection handling
- Tab visibility detection - refreshes data when returning to tab

### UI/UX Enhancements
- Mobile-responsive design throughout
- Pull-to-refresh on mobile
- Dark/light theme support
- Improved error notifications
- Rate limit visualization
- Session performance tracking

<!-- TODO: Add screenshot of main dashboard -->

### Configuration
- Per-symbol threshold system toggle (now always visible)
- Liquidation database retention settings
- Trade size validation against exchange minimums
- Safe defaults ($1 USDT trade size for new symbols)

<!-- TODO: Add screenshot of Config page -->

### Security
- Next.js upgraded to 15.5.7 (CVE-2025-66478 fix)
- Bcrypt password hashing
- Secure cookie handling
- Session-based error tracking

---

## 🐛 Bug Fixes

- Fixed stale data when returning to browser tab
- Fixed WebSocket not connecting from non-localhost access
- Fixed authentication comparing plain text to hashed passwords
- Fixed threshold settings not displaying unless already in config
- Fixed liquidation database settings not persisting
- Fixed onboarding trade sizes using wrong units (was coin, now USDT)
- Fixed secure cookies only when actually using HTTPS
- Fixed various React hooks rule violations
- Removed deprecated type stub packages

---

## 📋 Known Issues / TODO

- **Risk Percentage setting** - UI exists but not yet implemented in bot logic
- **Paper Trading** - Not thoroughly tested
- **Tranche System** - Experimental, needs more testing
- **Trade Quality Scoring** - May need tuning for different market conditions

---

## 🧪 Testing Recommendations

1. **Fresh install test** - Delete `config.user.json` and go through onboarding
2. **Migration test** - Existing users should verify config loads correctly
3. **Multi-device test** - Access from different IPs/browsers
4. **Paper mode test** - Verify no real trades execute
5. **Discovery page** - Check liquidation data collection

---

## 📤 Upgrade Guide for Existing Users

1. **Backup your data:**
   - `config.user.json` - Your API keys and symbol settings
   - `data/` folder - Contains liquidation history database

2. **Recommended: Rebuild config from new defaults**
   - Many new settings won't appear in the UI unless they exist in your config
   - Start fresh with the onboarding wizard, then re-add your API keys and symbols
   - This ensures all new features are accessible

3. **Alternative: Keep existing config**
   - Your existing config will still work
   - New fields will be added automatically with defaults
   - Some UI elements may not appear until you re-save settings

4. **After upgrade:**
   - Clear browser cache/cookies (auth system changed)
   - Re-login with your dashboard password
   - Verify WebSocket connects (check browser console)

---

## 📦 Dependencies

- Upgraded: `next` 15.5.4 → 15.5.7
- Added: `jose`, `bcryptjs`, `lightweight-charts`
- Removed: `@types/uuid`, `@types/sqlite3` (now included in packages)

---

## 🔄 Running with PM2 (Optional)

PM2 is **optional** but recommended for production use. It provides:
- Process management and auto-restart on crash
- **System Logs feature** in the dashboard (requires PM2)
- Easy start/stop/restart via dashboard controls

### Install PM2
```bash
npm install -g pm2
```

### Start with PM2
```bash
pm2 start ecosystem.config.js
```

### Without PM2
The bot runs fine without PM2 using:
```bash
npm run dev      # Development mode
npm run start    # Production mode
```

**Note:** The System Logs section in the dashboard will show "PM2 not detected" if running without PM2. All other features work normally.

---

## 🙏 Credits

Built on top of the excellent [Aster Lick Hunter](https://github.com/CryptoGnome/aster_lick_hunter_node) by CryptoGnome.
