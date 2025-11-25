# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**Project Type**: Cryptocurrency liquidation hunting bot (Next.js 15 + TypeScript)
**Architecture**: Dual-process (Web UI + Standalone Bot Service)
**Trading Strategy**: Contrarian liquidation trading with VWAP protection
**Exchange**: Aster Finance futures API

**⚠️ IMPORTANT FOR CLAUDE CODE**:
- **NEVER** run `npm run dev` or start the development server (user manages this)
- **ALWAYS** run `npx tsc --noEmit` after code changes to verify TypeScript
- **NEVER** commit API keys or `config.user.json` to version control
- **ALWAYS** create a temporary feature/fix branch before making changes
- **ALWAYS** merge to `dev` branch first (never directly to `main`)

## Development Commands

```bash
# Installation & Setup
npm install                  # Install dependencies
npm run setup               # Full setup (install + config + build)
npm run setup:config        # Setup configuration only

# Development
npm run dev                 # Run both web UI and bot (development)
npm run dev:web             # Run only web UI
npm run dev:bot             # Run only bot with watch mode
npm run bot                 # Run bot once (no watch)

# Production
npm run build               # Build for production
npm start                   # Start production (both web and bot)

# Code Quality
npm run lint                # Run ESLint
npx tsc --noEmit           # Check TypeScript types

# Testing
npm test                        # Run all tests
npm run test:hunter             # Test Hunter component
npm run test:position           # Test PositionManager
npm run test:rate               # Test rate limiting
npm run test:ws                 # Test WebSocket functionality
npm run test:errors             # Test error logging
npm run test:integration        # Test trading flow integration
npm run test:tranche            # Test tranche system (basic)
npm run test:tranche:integration # Test tranche integration (comprehensive)
npm run test:tranche:all        # Run all tranche tests
npm run test:watch              # Run tests in watch mode

# Utilities
npm run optimize:ui         # Run configuration optimizer
```

## Architecture Overview

### Dual-Process System

1. **Web UI** (Next.js 15)
   - Dashboard for monitoring positions and P&L
   - Configuration interface at `/config`
   - API routes in `src/app/api/*`
   - NextAuth authentication with password protection
   - Real-time WebSocket connection to bot service

2. **Bot Service** (Standalone Node.js)
   - Entry point: `src/bot/index.ts`
   - Runs independently of web UI
   - Connects to Aster Finance exchange
   - Broadcasts status updates via WebSocket (port 8080)

3. **Process Manager** (`scripts/process-manager.js`)
   - Cross-platform process orchestration (Windows/Unix)
   - Graceful shutdown handling
   - Manages both web and bot processes

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Hunter** | `src/lib/bot/hunter.ts` | Monitors liquidation streams, triggers trades |
| **PositionManager** | `src/lib/bot/positionManager.ts` | Manages positions, SL/TP orders, user data streams |
| **TrancheManager** | `src/lib/services/trancheManager.ts` | Tracks multiple position entries (tranches) per symbol |
| **AsterBot** | `src/bot/index.ts` | Main orchestrator coordinating Hunter and PositionManager |
| **StatusBroadcaster** | `src/bot/websocketServer.ts` | WebSocket server for real-time UI updates |
| **ProcessManager** | `scripts/process-manager.js` | Cross-platform process lifecycle management |

### Multi-Tranche Position Management

The bot includes an advanced **multi-tranche system** that tracks multiple virtual position entries per symbol:

**What are Tranches?**
- Virtual position entries tracked locally while exchange sees one combined position
- Allows isolation of underwater positions (>5% loss by default)
- Continue trading fresh positions without adding to losers
- Better margin utilization and risk management

**Key Components:**
- **Database Layer** (`src/lib/db/trancheDb.ts`): Tranche and event storage with SQLite
- **TrancheManager Service** (`src/lib/services/trancheManager.ts`): Core tranche lifecycle management
- **Hunter Integration**: Pre-trade limit checks, post-order tranche creation
- **PositionManager Integration**: Tranche closing on SL/TP fills, exchange synchronization
- **UI Dashboard** (`/tranches`): Real-time tranche visualization and management

**Configuration (per symbol):**
```json
{
  "enableTrancheManagement": true,
  "trancheIsolationThreshold": 5,        // % loss before isolation
  "maxTranches": 3,                      // Max active tranches
  "maxIsolatedTranches": 2,              // Max isolated tranches
  "trancheStrategy": {
    "closingStrategy": "FIFO",           // FIFO, LIFO, WORST_FIRST, BEST_FIRST
    "slTpStrategy": "NEWEST",            // NEWEST, OLDEST, BEST_ENTRY, AVERAGE
    "isolationAction": "HOLD"            // Action when isolated
  },
  "allowTrancheWhileIsolated": true,    // Continue trading with isolated tranches
  "trancheAutoCloseIsolated": false     // Auto-close when recovered
}
```

**Testing:**
```bash
npm run test:tranche              # Basic system tests
npm run test:tranche:integration  # Full integration tests (100% passing)
npm run test:tranche:all          # Run all tranche tests
```

**Documentation:**
- Implementation Plan: `docs/TRANCHE_IMPLEMENTATION_PLAN.md`
- Testing Guide: `docs/TRANCHE_TESTING.md`
- User Guide: `docs/TRANCHE_USER_GUIDE.md` (for end users)

### Services (`src/lib/services/`)

- **balanceService.ts**: Real-time balance tracking via WebSocket
- **priceService.ts**: Real-time mark price streaming
- **vwapService.ts** + **vwapStreamer.ts**: VWAP calculations for entry filtering
- **errorLogger.ts**: Centralized error logging to SQLite
- **configManager.ts**: Hot-reload configuration management
- **pnlService.ts**: Real-time P&L tracking and session metrics
- **thresholdMonitor.ts**: 60-second rolling volume threshold tracking
- **trancheManager.ts**: Multi-tranche position tracking and lifecycle management

### API Layer (`src/lib/api/`)

- **auth.ts**: HMAC SHA256 authentication for exchange API
- **market.ts**: Market data (prices, order book, positions, balance)
- **orders.ts**: Order placement, cancellation, leverage management
- **rateLimitManager.ts**: Intelligent rate limit management with queuing
- **positionMode.ts**: Position mode management (ONE_WAY vs HEDGE)
- **userDataStream.ts**: User data stream (account updates, order fills)

### Data Flow

```
Liquidation Stream (WSS) → Hunter → Analyzes → Places Order
                                         ↓
                              User Data Stream → PositionManager
                                         ↓
                              Places SL/TP Orders → Monitors Position
                                         ↓
                              StatusBroadcaster → Web UI (WebSocket)
```

## Configuration System

### Dual Configuration Files

**`config.user.json`** (Your settings - NOT in git):
- API keys and secrets
- Custom trading parameters
- Auto-created on first run from defaults
- In `.gitignore` for security

**`config.default.json`** (Template - tracked in git):
- Safe default values
- Fallback for missing fields
- Source for new installations

### Configuration Structure

```json
{
  "api": {
    "apiKey": "your-api-key",
    "secretKey": "your-secret-key"
  },
  "symbols": {
    "BTCUSDT": {
      "longVolumeThresholdUSDT": 10000,    // Min liquidation $ to trigger long
      "shortVolumeThresholdUSDT": 10000,   // Min liquidation $ to trigger short
      "tradeSize": 0.001,                  // Base trade size in BTC
      "longTradeSize": 100,                // Optional: margin in USDT for longs
      "shortTradeSize": 100,               // Optional: margin in USDT for shorts
      "maxPositionMarginUSDT": 200,        // Max margin exposure per symbol
      "leverage": 10,                      // Leverage (1-125)
      "tpPercent": 5,                      // Take profit %
      "slPercent": 2,                      // Stop loss %
      "priceOffsetBps": 2,                 // Limit order price offset (basis points)
      "maxSlippageBps": 50,                // Max acceptable slippage
      "orderType": "LIMIT",                // LIMIT or MARKET
      "vwapProtection": true,              // Enable VWAP entry filtering
      "vwapTimeframe": "5m",               // VWAP timeframe (1m, 5m, 15m, 30m, 1h)
      "vwapLookback": 200,                 // Number of candles for VWAP
      "useThreshold": false,               // Enable 60s rolling threshold
      "thresholdTimeWindow": 60000,        // Time window for volume accumulation (ms)
      "thresholdCooldown": 30000           // Cooldown between triggers (ms)
    }
  },
  "global": {
    "paperMode": true,                     // Safe testing mode (no real trades)
    "riskPercent": 90,                     // Max risk % of account balance
    "positionMode": "HEDGE",               // ONE_WAY or HEDGE
    "maxOpenPositions": 5,                 // Max concurrent positions
    "useThresholdSystem": false,           // Enable global threshold system
    "server": {
      "dashboardPassword": "your-password", // Web UI password
      "dashboardPort": 3000,               // Web UI port
      "websocketPort": 8080,               // Bot WebSocket port
      "useRemoteWebSocket": false,         // Enable remote access
      "websocketHost": null                // Custom WebSocket host (null = auto)
    },
    "rateLimit": {
      "maxRequestWeight": 2400,            // Max weight per minute
      "maxOrderCount": 1200,               // Max orders per minute
      "reservePercent": 30,                // Reserve % for critical ops
      "enableBatching": true,              // Batch order operations
      "queueTimeout": 30000,               // Queue timeout (ms)
      "enableDeduplication": true,         // Deduplicate requests
      "deduplicationWindowMs": 1000,       // Deduplication window
      "parallelProcessing": true,          // Process requests in parallel
      "maxConcurrentRequests": 3           // Max concurrent API calls
    }
  },
  "version": "1.1.0"
}
```

## Trading Strategy

The bot implements a **contrarian liquidation hunting strategy**:

1. **Liquidation Detection**: Monitors `wss://fstream.asterdex.com/ws/!forceOrder@arr`
2. **Opportunity Analysis**:
   - Long liquidations (forced sells) → Buy opportunity
   - Short liquidations (forced buys) → Sell opportunity
3. **VWAP Protection**: Only enter when price is favorable relative to volume-weighted average
4. **Smart Order Placement**: Analyzes order book depth, uses intelligent limit orders
5. **Automatic Risk Management**: Immediate SL/TP orders on every position

**Key Features**:
- Volume thresholds filter insignificant liquidations
- VWAP filtering prevents bad entries during trends
- Smart limit orders improve fill rates and reduce slippage
- Threshold system can accumulate volume over 60-second windows
- Multi-symbol support with independent configurations

See `docs/STRATEGY.md` for comprehensive strategy documentation.

## Operating Modes

### Paper Mode (`"paperMode": true`)
- Simulates trading without real orders
- Generates mock liquidation events
- Safe for testing and development
- No API keys required

### Live Mode (`"paperMode": false`)
- Requires valid API keys
- Places real orders on exchange
- Manages actual positions with real money
- **Start with small amounts!**

## Project Structure

```
src/
├── app/                    # Next.js pages and API routes
│   ├── api/               # REST endpoints for bot communication
│   ├── config/            # Configuration page
│   └── page.tsx           # Main dashboard
├── bot/                   # Standalone bot service
│   ├── index.ts          # Bot entry point (AsterBot class)
│   └── websocketServer.ts # Status broadcasting WebSocket server
├── lib/
│   ├── api/              # Exchange API interaction
│   ├── bot/              # Bot components (Hunter, PositionManager)
│   ├── db/               # Database operations (SQLite)
│   ├── errors/           # Custom error types (TradingErrors.ts)
│   ├── services/         # Shared services
│   ├── validation/       # Trade size and config validation
│   └── types.ts          # Core TypeScript interfaces
├── components/           # React components for web UI
├── hooks/               # React hooks
└── middleware.ts        # NextAuth authentication middleware

scripts/                  # Build and process management
tests/                   # Comprehensive test suite
config.user.json         # User configuration (NOT in git)
config.default.json      # Default configuration template
```

## Database Operations

**Liquidation Database** (`src/lib/db/liquidationDb.ts`):
- Stores all liquidation events
- 7-day automatic cleanup via `cleanupScheduler`
- Used for pattern analysis and performance tracking

**Error Logs Database** (`src/lib/db/errorLogsDb.ts`):
- Persists all application errors with full context
- Includes stack traces, timestamps, and trading data
- Accessible via web UI at `/errors`

**Tranche Database** (`src/lib/db/trancheDb.ts`):
- Stores all tranche entries and lifecycle events
- Tracks active, isolated, and closed tranches
- Audit trail via `tranche_events` table
- Indexed for performance (symbol, side, status, entry_time)
- Automatic cleanup of old closed tranches

## Error Handling

### Custom Error Types (`src/lib/errors/TradingErrors.ts`)

- **NotionalError**: Order value too small for exchange
- **RateLimitError**: API rate limit exceeded
- **InsufficientBalanceError**: Insufficient account balance
- **ReduceOnlyError**: Invalid reduce-only order
- **PricePrecisionError**: Invalid price precision
- **QuantityPrecisionError**: Invalid quantity precision

All errors are:
- Logged to SQLite with full context
- Displayed in web UI error dashboard
- Include timestamps and stack traces

## API Integration

**Base URL**: `https://fapi.asterdex.com`
**Authentication**: HMAC SHA256 signatures
**Documentation**: `docs/aster-finance-futures-api.md`

### Making API Calls

```typescript
import { loadConfig } from './src/lib/bot/config';
import { getBalance, getPositions, getMarkPrice } from './src/lib/api/market';
import { placeOrder, cancelOrder } from './src/lib/api/orders';

// Load credentials
const config = await loadConfig();
const credentials = config.api;

// Account data (requires auth)
const balance = await getBalance(credentials);
const positions = await getPositions(credentials);

// Market data (public, no auth)
const markPrices = await getMarkPrice();
const orderBook = await getOrderBook('BTCUSDT', 5);

// Trading (requires auth)
const order = await placeOrder({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'LIMIT',
  quantity: 0.001,
  price: 50000,
  timeInForce: 'GTC'
}, credentials);
```

### Rate Limiting

The API includes intelligent rate limit management:
- Automatic retry with exponential backoff
- Request queuing when limits approached
- Deduplication to prevent redundant requests
- Visual indicators in web UI
- Configurable limits per endpoint

## Testing Architecture

```bash
# Run all tests with detailed reporting
npm test

# Individual test suites
npm run test:hunter          # Hunter liquidation detection
npm run test:position        # PositionManager SL/TP logic
npm run test:rate           # Rate limit manager
npm run test:ws             # WebSocket functionality
npm run test:errors         # Error logging system
npm run test:integration    # End-to-end trading flow
```

**Test Structure**:
- **Unit Tests**: Individual component testing
- **Integration Tests**: End-to-end flow validation
- **API Tests**: Income API, position closing
- **Performance Tests**: Metrics tracking
- **Test Helpers**: `tests/utils/test-helpers.ts`

## Git Branching Strategy

**Git Flow Lite** - optimized for small teams:

```
main (production releases only)
  └── dev (primary integration - all work merges here)
         └── feature/* (temporary branches)
         └── fix/* (temporary branches)
         └── hotfix/* (critical production fixes)
```

### Workflow Rules

**✅ ALWAYS**:
- Create a temporary `feature/*` or `fix/*` branch for new work
- Pull latest `dev` before creating a branch: `git pull origin dev`
- Merge to `dev` first (never directly to `main`)
- Delete temporary branches after merging to `dev`
- Use `main` ONLY for stable production releases

**❌ NEVER**:
- Commit directly to `dev` or `main`
- Push to `dev` without a PR
- Create PRs from `dev` to `main` unless releasing to production
- Work directly on `dev` or `main` branches

### Standard Feature Development

```bash
# 1. Start new feature (ALWAYS create temp branch)
git checkout dev
git pull origin dev
git checkout -b feature/my-feature

# 2. Work on feature, commit regularly
git add .
git commit -m "feat: add my feature"

# 3. Push and create PR to dev (NOT main)
git push -u origin feature/my-feature
gh pr create --base dev --title "feat: add my feature" --body "Description"

# 4. After PR merged to dev, clean up
git checkout dev
git pull origin dev
git branch -d feature/my-feature
git push origin --delete feature/my-feature
```

### Commit Message Conventions

Follow conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code formatting
- `refactor:` Code refactoring
- `test:` Test changes
- `chore:` Maintenance tasks
- `perf:` Performance improvements

### Releasing to Production

```bash
# 1. Create PR from dev to main
gh pr create --base main --head dev --title "Release: v1.2.0" --body "Release notes..."

# 2. After PR merged, tag the release
git checkout main
git pull origin main
git tag -a v1.2.0 -m "Release version 1.2.0"
git push origin v1.2.0

# 3. Sync release back to dev
git checkout dev
git merge main
git push origin dev
```

## Authentication & Security

### Dashboard Authentication

The web UI uses NextAuth for password protection:
- Configure password in `config.user.json` → `global.server.dashboardPassword`
- Default is `"admin"` - **CHANGE THIS!**
- Middleware protects all routes except `/api/auth/*`
- Session-based authentication

**Security Warnings**:
- Bot displays warnings for default/weak passwords on startup
- Extra warnings when remote WebSocket access is enabled
- Minimum recommended password length: 8 characters

### Remote Access

Enable remote monitoring from other devices on your network:

1. **Via Web UI** (Recommended):
   - Go to http://localhost:3000/config
   - Server Settings → Enable Remote WebSocket Access
   - Save configuration

2. **Via Environment Variable**:
   - Set `NEXT_PUBLIC_WS_HOST=your_server_ip` in `.env.local`
   - Restart application

**Network Configuration**:
- Port 3000: Web UI (HTTP)
- Port 8080: WebSocket status server
- Both must be accessible on network for remote access

## Safety Features

- **Paper mode** for risk-free testing
- **Automatic stop-loss** on every position (STOP_MARKET orders)
- **Automatic take-profit** on every position (LIMIT orders)
- **Position size limits** per symbol and globally
- **Leverage limits** configurable per symbol
- **WebSocket auto-reconnection** with exponential backoff
- **Graceful shutdown** handling (Ctrl+C) - cross-platform
- **Exchange filter validation** (price, quantity, notional limits)
- **VWAP-based entry filtering** to avoid adverse price movements
- **Trade size validation** against exchange minimums
- **Rate limit protection** with automatic queuing and backoff
- **Comprehensive error logging** to SQLite database

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `next` 15.5.4 | Web UI framework |
| `react` 19.1.0 | UI components |
| `ws` | WebSocket client/server |
| `axios` | HTTP client for REST API |
| `tsx` | TypeScript execution with watch mode |
| `concurrently` | Run web + bot simultaneously |
| `@radix-ui/*` | UI component library |
| `recharts` | Trading charts |
| `tailwindcss` v4 | Styling |
| `sqlite3` | Database for history and logs |
| `better-sqlite3` | Synchronous SQLite |
| `zod` | Schema validation |
| `sonner` | Toast notifications |
| `next-auth` | Dashboard authentication |

## Development Workflow

1. **Initial Setup**:
   ```bash
   git clone <repo>
   cd aster_lick_hunter_node
   npm run setup
   ```

2. **Configure Bot**:
   - Open http://localhost:3000/config
   - Add API keys (or use paper mode)
   - Configure symbols and risk parameters
   - Set strong dashboard password

3. **Start Development**:
   ```bash
   npm run dev  # User manages this, not Claude Code!
   ```

4. **Monitor**:
   - Dashboard: http://localhost:3000
   - Configuration: http://localhost:3000/config
   - Errors: http://localhost:3000/errors
   - Terminal logs show detailed bot activity

5. **Make Changes**:
   - Create feature branch: `git checkout -b feature/my-change`
   - Make changes, test with `npx tsc --noEmit`
   - Commit and push
   - Create PR to `dev` branch

6. **Test Changes**:
   ```bash
   npm test                    # Run all tests
   npx tsc --noEmit           # Type checking
   npm run lint               # Code quality
   ```

## Common Tasks

### Updating Configuration
- **Via Web UI**: http://localhost:3000/config (hot-reloads automatically)
- **Via File**: Edit `config.user.json` (auto-detected and reloaded)

### Checking Account Data
```typescript
import { getBalance, getPositions } from './src/lib/api/market';
import { loadConfig } from './src/lib/bot/config';

const config = await loadConfig();
const balance = await getBalance(config.api);
const positions = await getPositions(config.api);
```

### Viewing Errors
- Web UI: http://localhost:3000/errors
- Database: `liquidations.db` (errors table)
- Terminal: Real-time error logging

### Database Access
```bash
# Open SQLite database
sqlite3 liquidations.db

# View liquidations
SELECT * FROM liquidations ORDER BY timestamp DESC LIMIT 10;

# View errors
SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT 10;
```

## Process Management

The custom process manager (`scripts/process-manager.js`) handles:
- Cross-platform process spawning (Windows uses `cmd.exe`, Unix uses shell)
- Graceful shutdown of all child processes
- Process group management for clean termination
- Colored console output for debugging
- Timeout-based force kill as fallback
- Signal handling (SIGINT, SIGTERM, SIGBREAK on Windows)

**Graceful Shutdown**:
- Press Ctrl+C to stop bot
- 5-second timeout for graceful shutdown
- Force kill if timeout exceeded
- All services stop cleanly (WebSockets, databases, streams)

## Troubleshooting

### Bot won't start
1. Check API keys in `config.user.json`
2. Verify `npm install` completed successfully
3. Run `npx tsc --noEmit` to check for TypeScript errors
4. Check port 3000 and 8080 are not in use

### Orders rejected
1. Check trade size meets exchange minimums (bot validates on startup)
2. Verify sufficient account balance
3. Check position mode matches config (ONE_WAY vs HEDGE)
4. Review error logs at `/errors`

### WebSocket connection issues
1. Check `websocketPort` in config (default: 8080)
2. Verify firewall allows port 8080
3. For remote access, ensure `useRemoteWebSocket: true`
4. Check browser console for connection errors

### Rate limit errors
1. Reduce `maxRequestWeight` and `maxOrderCount` in config
2. Increase `reservePercent` for more headroom
3. Enable `enableBatching` to batch requests
4. Monitor rate limits in web UI

## Important Notes for Claude Code

1. **Server Management**: User controls when to start/stop the server. Never run `npm run dev`, `npm start`, or any server commands.

2. **Type Safety**: Always run `npx tsc --noEmit` after making changes to ensure TypeScript compilation succeeds.

3. **Security**: Never commit `config.user.json` or API keys to version control. This file is in `.gitignore`.

4. **Branching**: Always create a temporary `feature/*` or `fix/*` branch before making changes. Never commit directly to `dev` or `main`.

5. **Testing**: Run relevant tests before committing. Use `npm test` for full test suite or individual test commands for specific components.

6. **Configuration**: Configuration changes can be made via web UI at `/config` and will hot-reload automatically. Manual file edits are also detected.

7. **Error Investigation**: Check `/errors` page in web UI and `error_logs` table in database for detailed error context.

8. **API Calls**: Use existing API utilities in `src/lib/api/` rather than making raw axios calls. They include proper authentication, rate limiting, and error handling.

9. **Paper Mode**: Always recommend starting in paper mode when testing new features or strategies.

10. **Documentation**: Refer to `docs/STRATEGY.md` for trading strategy details and `docs/aster-finance-futures-api.md` for API documentation.
