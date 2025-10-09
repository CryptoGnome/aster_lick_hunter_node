# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Type
This is a cryptocurrency liquidation hunting bot built with Next.js 15 and TypeScript. The application monitors liquidation events on the Aster Finance exchange and automatically places trades to capitalize on price movements, with both a web UI for monitoring and a backend bot service.

## Development Commands

```bash
# Install dependencies
npm install

# Run both web UI and bot concurrently (development)
npm run dev

# Run only the web UI (development)
npm run dev:web

# Run only the bot (development with watch mode)
npm run dev:bot

# Build for production
npm run build

# Start production (both web and bot)
npm start

# Run only the bot (one-time)
npm run bot

# Run linting
npm run lint

# Check TypeScript types
npx tsc --noEmit

# Run all tests
npm test

# Run specific test suites
npm run test:hunter          # Test Hunter component
npm run test:position        # Test PositionManager
npm run test:rate           # Test rate limiting
npm run test:ws             # Test WebSocket functionality
npm run test:errors         # Test error logging
npm run test:integration    # Test trading flow integration
npm run test:watch          # Run tests in watch mode

# Setup (install + build + config)
npm run setup
npm run setup:config        # Setup configuration only
```

## Architecture Overview

The application has a dual architecture with cross-platform process management:
1. **Web UI**: Next.js application for configuration and monitoring
2. **Bot Service**: Standalone Node.js service that runs the trading logic
3. **Process Manager**: Cross-platform process orchestration with graceful shutdown

### Key Components

- **Hunter** (`src/lib/bot/hunter.ts`): Monitors liquidation WebSocket streams and triggers trades
- **PositionManager** (`src/lib/bot/positionManager.ts`): Manages open positions, SL/TP orders, and user data streams
- **AsterBot** (`src/bot/index.ts`): Main bot orchestrator that coordinates Hunter and PositionManager
- **StatusBroadcaster** (`src/bot/websocketServer.ts`): WebSocket server for real-time status updates to web UI
- **ProcessManager** (`scripts/process-manager.js`): Handles process lifecycle and graceful shutdowns across platforms
- **Services**: Helper services for balance (`balanceService.ts`), pricing (`priceService.ts`), VWAP calculations (`vwapService.ts`), and WebSocket management (`websocketService.ts`)
- **Error System**: Custom error types (`TradingErrors.ts`) and centralized error logging (`errorLogger.ts`)
- **Databases**:
  - SQLite for liquidation history (`src/lib/db/liquidationDb.ts`)
  - Error logs database (`src/lib/db/errorLogsDb.ts`)

### Data Flow
1. Hunter connects to `wss://fstream.asterdex.com/ws/!forceOrder@arr` for liquidation events
2. When a qualifying liquidation occurs, Hunter analyzes order book depth and places intelligent limit orders
3. PositionManager monitors user data stream for order fills and automatically places SL/TP orders
4. Status updates are broadcasted to the web UI via internal WebSocket server on port 8080
5. All errors are logged to SQLite database with full context for debugging

## Project Structure

- **src/app/**: Next.js pages and API routes
- **src/bot/**: Standalone bot service entry point and WebSocket server
- **src/lib/**: Shared business logic
  - `types.ts`: Core TypeScript interfaces for trading data
  - `api/`: Exchange API interaction (auth, orders, market data, rate limiting)
  - `bot/`: Bot components (hunter, position manager, config)
  - `errors/`: Custom error types and handling
  - `db/`: Database operations and schemas
  - `services/`: Shared services (balance, pricing, VWAP, WebSocket, error logging)
- **src/components/**: React components for the web UI
- **scripts/**: Build and process management scripts
- **tests/**: Comprehensive test suite with unit and integration tests
- **config.user.json**: User-specific trading configuration (API keys, symbols, risk parameters)
- **config.default.json**: Default configuration template with safe defaults

## Configuration System

The bot uses a dual-configuration system for security and flexibility:

### Configuration Files
- **`config.user.json`**: User-specific configuration (not tracked by git)
  - Contains your API keys and custom settings
  - Auto-created on first run if missing
  - This file is in `.gitignore` to protect your credentials

- **`config.default.json`**: Default configuration template (tracked by git)
  - Contains safe default values
  - Used as a fallback for missing fields
  - New settings are automatically merged to user config

### Initial Setup
Run `npm run setup:config` to:
- Migrate existing `config.json` to `config.user.json` (if it exists)
- Create `config.user.json` from defaults (if no config exists)
- Remove `config.json` from git tracking (if applicable)

### Configuration Structure
- **api**: API credentials for Aster Finance exchange
- **symbols**: Per-symbol trading configuration (volume thresholds, leverage, SL/TP percentages)
- **global**: Global settings (paper mode, risk percentage)
- **version**: Config schema version for automatic migrations

Example symbol configuration:
```json
"BTCUSDT": {
  "volumeThresholdUSDT": 10000,  // Minimum liquidation volume to trigger
  "tradeSize": 0.001,            // Base trade size
  "leverage": 5,                 // Leverage multiplier
  "tpPercent": 5,                // Take profit percentage
  "slPercent": 2,                // Stop loss percentage
  "priceOffsetBps": 2,          // Basis points offset for limit orders
  "maxSlippageBps": 50,         // Maximum allowed slippage
  "orderType": "LIMIT"          // Order type (LIMIT or MARKET)
}
```

## API Integration

Connects to Aster Finance exchange API (`https://fapi.asterdex.com`):
- **Authentication**: HMAC SHA256 signatures with API key/secret
- **Market Data**: WebSocket streams for liquidations, mark prices, klines
- **User Data**: WebSocket stream for account updates and order fills
- **Trading**: REST API for placing orders, setting leverage, managing positions
- **Rate Limiting**: Intelligent rate limit management with automatic retry and backoff

## Operating Modes

### Paper Mode
- Set `"paperMode": true` in config.user.json
- Simulates trading without placing real orders
- Generates mock liquidation events for testing
- Safe for development and testing

### Live Mode
- Requires valid API keys in config.user.json
- Places real orders on the exchange
- Monitors real liquidation streams
- Manages actual positions with real money

## Testing Architecture

The project includes a comprehensive test suite:
- **Unit Tests**: Individual component testing (Hunter, PositionManager, services)
- **Integration Tests**: End-to-end trading flow validation
- **API Tests**: Income API and position closing functionality
- **Performance Tests**: Metrics tracking and performance monitoring
- **Test Helpers** (`tests/utils/test-helpers.ts`): Utilities for test execution
- **Run All Script** (`tests/run-all.ts`): Orchestrates test execution with detailed reporting

Additional specialized tests:
- **Multi-position handling**: Tests for managing multiple positions simultaneously
- **Pending orders**: Hunter's pending order management
- **Position mode sync**: Exchange position mode synchronization
- **Retry logic**: Position mode setting retry mechanisms

## Error Handling

Custom error types provide detailed context:
- **NotionalError**: Order value too small
- **RateLimitError**: API rate limit exceeded
- **InsufficientBalanceError**: Insufficient account balance
- **ReduceOnlyError**: Invalid reduce-only order
- **PricePrecisionError**: Invalid price precision
- **QuantityPrecisionError**: Invalid quantity precision

All errors are:
- Logged to SQLite database with full context
- Displayed in the web UI error dashboard
- Include timestamps, stack traces, and relevant trading data

## Key Dependencies

- **concurrently**: Runs web UI and bot service simultaneously
- **tsx**: TypeScript execution for bot service with watch mode
- **ws**: WebSocket client for exchange connections and internal status server
- **axios**: HTTP client for REST API calls
- **@radix-ui/***: UI component library for the web interface
- **recharts**: Charts for displaying trading data
- **tailwindcss**: v4 for styling
- **sqlite3**: Database for liquidation history and error logs
- **zod**: Schema validation for configuration and API responses
- **sonner**: Toast notifications for the web UI

## Development Workflow

1. Configure `config.user.json` with your trading parameters (start in paper mode)
2. Run `npm run dev` to start both web UI and bot
3. Access web UI at http://localhost:3000 to monitor bot status
4. Bot logs will show in the terminal with detailed trade information
5. Use `/config` page to adjust settings without restarting
6. Run tests with `npm test` to validate changes

## Safety Features

- Paper mode for safe testing
- Automatic stop-loss and take-profit orders on all positions
- Risk management with configurable risk percentage per trade
- WebSocket auto-reconnection with exponential backoff
- Graceful shutdown handling (Ctrl+C to stop) with cross-platform support
- Intelligent limit orders with order book analysis and slippage protection
- Exchange filter validation (price, quantity, notional limits)
- VWAP-based entry filtering to avoid adverse price movements
- SQLite database for liquidation history and pattern analysis
- Comprehensive error logging and recovery mechanisms

## Process Management

The application uses a custom process manager (`scripts/process-manager.js`) that:
- Handles cross-platform process spawning (Windows/Unix)
- Ensures graceful shutdown of all child processes
- Manages process groups for clean termination
- Provides colored console output for debugging
- Implements timeout-based force kill as fallback

## Web UI Structure

The Next.js application uses App Router with key pages:
- `/` (dashboard): Main trading dashboard with positions, liquidation feed, and bot status
- `/config`: Configuration page for editing trading parameters and API keys
- `/api/*`: REST endpoints for bot communication (balance, positions, trades, config, errors)

## Database Operations

### Liquidation Database
- Stores all liquidation events for analysis
- Tracks trading patterns and performance metrics
- Provides historical data for strategy optimization

### Error Logs Database
- Persists all application errors with context
- Enables debugging and issue tracking
- Accessible via web UI error dashboard

## Important Instructions for Claude Code

**NEVER** start the development server or run `npm run dev` or any server commands. The user manages the server themselves and starting additional servers can cause port conflicts and issues.

**SECURITY NOTE**: User configuration is stored in `config.user.json` which is automatically excluded from git. Never commit API keys or sensitive configuration to version control.

**TYPE CHECKING**: Always run `npx tsc --noEmit` to check for TypeScript errors after making changes to ensure type safety.

## Making API Calls to Aster Finance Exchange

When you need to check or verify data from the Aster Finance exchange (e.g., account balance, positions, order status, market data), you can make API calls using the configured API credentials. Here's how to do it:

### Loading Configuration

First, load the API credentials from the configuration:

```typescript
import { loadConfig } from './src/lib/bot/config';

const config = await loadConfig();
const credentials = config.api; // { apiKey: string, secretKey: string }
```

Or use the config loader directly:

```typescript
import { configLoader } from './src/lib/config/configLoader';

const config = await configLoader.loadConfig();
const credentials = config.api;
```

### Authentication and API Calls

The bot uses HMAC SHA256 authentication. You can use the existing auth utilities:

#### For Account Data (Balance, Positions, Orders):
```typescript
import { getBalance, getPositions, getOpenOrders, getAccountInfo } from './src/lib/api/market';

// Get account balance
const balance = await getBalance(credentials);

// Get current positions
const positions = await getPositions(credentials);

// Get open orders
const openOrders = await getOpenOrders(undefined, credentials);

// Get account info (includes positions and account details)
const accountInfo = await getAccountInfo(credentials);
```

#### For Market Data (Public, no authentication needed):
```typescript
import { getMarkPrice, getKlines, getExchangeInfo, getOrderBook, getBookTicker } from './src/lib/api/market';

// Get current mark prices for all symbols
const markPrices = await getMarkPrice();

// Get klines (candlestick data)
const klines = await getKlines('BTCUSDT', '1m', 100);

// Get exchange information (symbols, price/quantity precision, etc.)
const exchangeInfo = await getExchangeInfo();

// Get order book depth
const orderBook = await getOrderBook('BTCUSDT', 5);

// Get best bid/ask prices
const bookTicker = await getBookTicker('BTCUSDT');
```

#### For Order Management:
```typescript
import { queryOrder, getAllOrders, setLeverage, placeOrder, cancelOrder } from './src/lib/api/orders';

// Query specific order
const orderDetails = await queryOrder({ symbol: 'BTCUSDT', orderId: 12345 }, credentials);

// Get all orders for a symbol
const allOrders = await getAllOrders('BTCUSDT', credentials);

// Change leverage
const leverageResponse = await setLeverage('BTCUSDT', 10, credentials);

// Place an order
const orderResponse = await placeOrder({
  symbol: 'BTCUSDT',
  side: 'BUY',
  type: 'LIMIT',
  quantity: 0.001,
  price: 50000,
  timeInForce: 'GTC'
}, credentials);

// Cancel an order
const cancelResponse = await cancelOrder('BTCUSDT', 12345, credentials);
```

### Base URL and Headers

All API calls use:
- **Base URL**: `https://fapi.asterdex.com`
- **Request Headers**:
  - `X-MBX-APIKEY`: Your API key
  - `Content-Type`: `application/x-www-form-urlencoded` (for POST requests)

### Authentication Building Blocks

If you need to construct custom API calls:

```typescript
import { buildSignedQuery, buildSignedForm, getTimestamp } from './src/lib/api/auth';

// For GET requests (sign query parameters)
const queryString = buildSignedQuery({ symbol: 'BTCUSDT' }, credentials);
const response = await axios.get(`https://fapi.asterdex.com/fapi/v1/openOrders?${queryString}`, {
  headers: { 'X-MBX-APIKEY': credentials.apiKey }
});

// For POST requests (sign form data)
const formData = buildSignedForm({ symbol: 'BTCUSDT', leverage: 10 }, credentials);
const response = await axios.post('https://fapi.asterdex.com/fapi/v1/leverage', formData, {
  headers: {
    'X-MBX-APIKEY': credentials.apiKey,
    'Content-Type': 'application/x-www-form-urlencoded'
  }
});
```

### Rate Limit Management

The API includes intelligent rate limit management:
- Automatic retry with exponential backoff
- Request queuing when limits are reached
- Visual indicators in the web UI
- Configurable limits per endpoint

### Important Notes

- All signed requests include timestamp and are valid for 5 seconds (recvWindow: 5000ms)
- Always check the API documentation at `docs/aster-finance-futures-api.md` for endpoint details
- Use paper mode (`"paperMode": true` in config.user.json) when testing to avoid real trades
- API responses include detailed error information in `error.response?.data` for debugging
- The rate limit manager automatically handles 429 errors and retries requests

## Git Branching Strategy

This project follows a **Git Flow Lite** strategy optimized for small teams and continuous deployment:

### Branch Structure
```
main (production-ready stable releases only)
  └── dev (primary integration branch - all work merges here)
         └── feature/feature-name (temporary feature branches)
         └── fix/bug-description (temporary bug fix branches)
         └── hotfix/critical-issue (urgent production fixes)
```

### Branch Types and Naming Conventions

1. **main**: Production branch (stable releases only)
   - Contains only stable, production-ready releases
   - Protected branch - requires PR to merge
   - Never commit directly to main
   - Only merge from dev when ready for production release

2. **dev**: Primary development/integration branch
   - **All work merges to dev first**
   - Default branch for all development
   - All feature branches created from dev
   - All PRs target dev by default
   - Regularly tested and kept stable

3. **feature/**: Temporary feature branches
   - **ALWAYS** create a temporary feature branch for new work
   - Created from: `dev`
   - Merge back to: `dev` (via PR)
   - Naming: `feature/short-description` (e.g., `feature/add-trailing-stop`)
   - **Delete after merging to dev**

4. **fix/**: Temporary bug fix branches
   - Created from: `dev`
   - Merge back to: `dev` (via PR)
   - Naming: `fix/issue-number-description` (e.g., `fix/42-order-validation`)
   - **Delete after merging to dev**

5. **hotfix/**: Critical production fixes
   - Created from: `main`
   - Merge back to: `main` AND `dev`
   - Naming: `hotfix/critical-issue` (e.g., `hotfix/api-auth-failure`)
   - **Delete after merging**

### Core Workflow Principles

**IMPORTANT**:
- ✅ **ALWAYS** create a temporary branch (feature/fix) for any new work
- ✅ **ALWAYS** merge to dev first (never directly to main)
- ✅ **ALWAYS** delete temporary branches after merging
- ✅ Use main **ONLY** for stable production releases
- ❌ **NEVER** commit directly to dev or main
- ❌ **NEVER** create PRs from dev to main unless releasing to production

### Branch Management Commands

#### Initial Setup (one-time)
```bash
# Create and push dev branch from main
git checkout main
git pull origin main
git checkout -b dev
git push -u origin dev

# Set dev as default branch on GitHub
gh repo edit --default-branch dev
```

#### Feature Development Workflow (Standard Process)
```bash
# 1. Start a new feature (ALWAYS create a temp branch)
git checkout dev
git pull origin dev
git checkout -b feature/my-feature

# 2. Work on the feature
# ... make changes, commit regularly ...

# 3. Keep feature branch updated with dev
git fetch origin
git rebase origin/dev  # or merge if preferred

# 4. Push feature branch to remote
git push -u origin feature/my-feature

# 5. Create PR to dev (NOT main)
gh pr create --base dev --title "feat: add my feature" --body "Description of changes"

# 6. After PR is merged to dev, clean up the temp branch
git checkout dev
git pull origin dev
git branch -d feature/my-feature
git push origin --delete feature/my-feature
```

#### Releasing to Production (main branch)
```bash
# ONLY use main for stable production releases

# 1. Ensure dev is stable, tested, and ready for production
git checkout dev
git pull origin dev

# 2. Create PR from dev to main for the release
gh pr create --base main --head dev --title "Release: v1.2.0" --body "Release notes..."

# 3. After PR is approved and merged to main
git checkout main
git pull origin main
git tag -a v1.2.0 -m "Release version 1.2.0"
git push origin v1.2.0

# 4. Sync the release back to dev
git checkout dev
git merge main
git push origin dev
```

#### Hotfix Workflow
```bash
# 1. Create hotfix from main
git checkout main
git pull origin main
git checkout -b hotfix/critical-fix

# 2. Make the fix
# ... implement fix ...

# 3. Push and create PR to main
git push -u origin hotfix/critical-fix
gh pr create --base main --title "hotfix: fix critical issue" --body "Urgent fix for..."

# 4. After merging to main, also merge to dev
git checkout dev
git pull origin dev
git merge main
git push origin dev

# 5. Clean up
git branch -d hotfix/critical-fix
git push origin --delete hotfix/critical-fix
```

### Branch Cleanup

#### List and Review Branches
```bash
# View all local branches
git branch

# View all remote branches
git branch -r

# View branches merged into main
git branch -r --merged origin/main

# View unmerged branches
git branch -r --no-merged origin/main
```

#### Clean Up Stale Branches
```bash
# Delete local branches that have been merged
git branch --merged | grep -v "\*\|main\|dev" | xargs -n 1 git branch -d

# Prune deleted remote branches from local
git remote prune origin

# Delete multiple remote branches
git push origin --delete branch1 branch2 branch3

# Delete remote branches that are fully merged to main (careful!)
git branch -r --merged origin/main | grep -v main | grep -v dev | sed 's/origin\///' | xargs -n 1 git push origin --delete
```

### Commit Message Conventions

Follow conventional commits format:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Test additions or fixes
- `chore:` Maintenance tasks
- `perf:` Performance improvements

Examples:
```bash
git commit -m "feat: add WebSocket reconnection logic"
git commit -m "fix: resolve order validation error for small quantities"
git commit -m "docs: update API authentication examples"
```

### Branch Protection Rules

1. **Never delete**: `main`, `dev`
2. **Always delete**: Temporary feature/fix branches after merging
3. **Require PR reviews**: For merges to `main` and `dev`
4. **Run tests**: CI/CD should pass before merging
5. **No force push**: To `main` or `dev`
6. **No direct commits**: To `main` or `dev`
7. **Linear history**: Prefer rebase for feature branches, merge for releases

### Important Notes for Claude Code

**Critical Workflow Rules**:
1. ✅ **ALWAYS** create a temporary branch for any new feature or fix
2. ✅ **ALWAYS** pull latest dev before creating a new branch: `git pull origin dev`
3. ✅ **ALWAYS** merge temp branches to dev first (never to main)
4. ✅ **ALWAYS** delete temp branches after merging to dev
5. ✅ Use main **ONLY** for stable production releases
6. ❌ **NEVER** commit directly to dev or main
7. ❌ **NEVER** push directly to dev without a PR
8. ❌ **NEVER** work directly on dev or main branches

**Before Starting Any Work**:
```bash
# Check current branch
git branch --show-current

# If on dev or main, create a temp branch first!
git checkout dev
git pull origin dev
git checkout -b feature/my-new-work
```

**General Guidelines**:
- Keep feature branches small and focused
- Regularly sync feature branches with dev to avoid conflicts
- Use descriptive branch names that indicate the purpose
- Delete merged branches immediately to keep the repository clean
- Tag all production releases on main with version numbers