# 🚀 Aster DEX Liquidation Hunter Bot
<img width="1919" height="954" alt="image" src="https://github.com/user-attachments/assets/aab678aa-1e84-47e3-9e75-373acb78bad5" />

> ⚠️ **OPEN BETA WARNING** - Please trade with caution! This software is in open beta.

A smart trading bot that monitors and trades liquidation events on Aster DEX. Features automated trading, risk management, and a beautiful web dashboard.

## 💝 Support This Free Bot

**This bot is 100% FREE!** If you find it useful, please support development by creating your Aster DEX account with our referral link:

### 👉 [**Create Aster DEX Account (Support Development)**](https://www.asterdex.com/en/referral/3TixB2)

*Using our referral link costs you nothing extra but helps fund continued development. Thank you!*

## 🎯 What Makes This Bot Special

- 📈 **Real-time Liquidation Hunting** - Monitors and instantly trades liquidation events
- 💰 **Smart Position Management** - Automatic stop-loss and take-profit on every trade
- 🎯 **Multi-Tranche System** - Isolate losing positions while continuing to trade fresh entries
- 🧪 **Paper Trading Mode** - Test strategies safely with simulated trades
- 🎨 **Beautiful Web Dashboard** - Monitor everything from a clean, modern UI
- ⚡ **One-Click Setup** - Get running in under 2 minutes
- 🔄 **Auto-Reconnection** - Never miss a trade due to connection issues
- 📊 **VWAP Protection** - Avoid bad entries with volume-weighted analysis
- 🛡️ **Risk Controls** - Position limits and leverage management built-in

## 🚀 Quick Start

### 📹 Video Setup Guide
**[🎥 Watch Complete Setup Tutorial](https://www.youtube.com/watch?v=Np9LZpWUhXY)** - Follow along with this step-by-step video guide!

### Prerequisites

Before installing the bot, make sure you have the following installed on your system:

1. **Node.js v20.0.0 or higher** (Required)
   - Download from: https://nodejs.org/
   - Verify installation: `node --version` (should show v20.x.x or higher)
   - Includes npm (Node Package Manager) which is required for installation

2. **Git** (Required for cloning the repository)
   - Windows: Download from https://git-scm.com/download/win
   - macOS: Install via Homebrew `brew install git` or from https://git-scm.com/download/mac
   - Linux: `sudo apt-get install git` (Ubuntu/Debian) or `sudo yum install git` (RHEL/CentOS)
   - Verify installation: `git --version`

3. **Aster DEX Account** (Required for live trading)
   - Create account at: https://www.asterdex.com/en/referral/3TixB2
   - Generate API keys for bot access (see Configuration section)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/CryptoGnome/aster_lick_hunter_node.git
cd aster_lick_hunter_node

# 2. Run setup wizard
npm run setup

# 3. Start the bot
npm run dev
```

### Configuration

1. **Get API Keys**: Sign in to [Aster DEX](https://www.asterdex.com/en/referral/3TixB2) → Settings → API Management
2. **Configure Bot**: Open http://localhost:3000/config
3. **Add API Keys**: Paste your keys in the web UI
4. **Start Trading**: Toggle paper mode off when ready

## 📊 Web Dashboard

Access at http://localhost:3000

- **Dashboard** - Monitor positions and P&L
- **Config** - Adjust all settings via UI
- **Tranches** - View and manage multi-tranche positions
- **History** - View past trades

## ⚙️ Commands

```bash
npm run dev        # Run bot + dashboard
npm run start      # Production mode
npm run bot        # Run bot only
npm test           # Run tests
```

## 🔄 Updating the Bot

When pulling updates from the repository:

```bash
# 1. Pull latest changes
git pull

# 2. Install any new dependencies
npm install

# 3. Build the project
npm run build

# 4. Run the bot
npm run dev
```

**Note**: The `npm install` step is crucial as dependencies may have changed between versions.

## 🧪 Testing Beta Features (Dev Branch)

Want to try the latest features before they're officially released? You can switch to the `dev` branch to access beta features and improvements.

### What is the Dev Branch?

- **main branch**: Stable, production-ready releases only
- **dev branch**: Latest features, improvements, and bug fixes (beta testing)

The dev branch contains cutting-edge features that are being tested before official release. While generally stable, it may occasionally have minor issues.

### Switching to Dev Branch

```bash
# 1. Make sure you have the latest code
git fetch origin

# 2. Switch to the dev branch
git checkout dev

# 3. Pull the latest dev changes
git pull origin dev

# 4. Install any new dependencies
npm install

# 5. Build and run
npm run build
npm run dev
```

### Switching Back to Stable (Main)

If you encounter issues or want to return to the stable release:

```bash
# 1. Switch back to main branch
git checkout main

# 2. Pull latest stable release
git pull origin main

# 3. Reinstall dependencies
npm install

# 4. Build and run
npm run build
npm run dev
```

### Keeping Dev Branch Updated

When on the dev branch, regularly pull updates to get the latest features:

```bash
# Quick update command
git pull origin dev && npm install && npm run build
```

### Reporting Beta Issues

Found a bug in the dev branch? Help us improve!

1. Check if you're on dev: `git branch --show-current`
2. [Create an Issue](https://github.com/CryptoGnome/aster_lick_hunter_node/issues/new) with:
   - Branch name (dev)
   - Steps to reproduce
   - Expected vs actual behavior
   - Console logs/screenshots

**Note**: Always start with paper mode when testing new beta features!

## 🎯 Advanced Features

### Multi-Tranche Position Management

The bot includes an intelligent **multi-tranche system** that dramatically improves trading performance when positions move against you:

#### What are Tranches?

Think of tranches as separate "sub-positions" within the same trading pair. Instead of one large position that you keep adding to, the bot tracks multiple independent entries:

- **Position goes underwater (>5% loss)?** → Bot automatically **isolates** it
- **Continue trading?** → Bot opens **new tranches** without adding to the loser
- **Keep making profits?** → Trade fresh entries while holding positions recover
- **Better margin usage** → Don't let one bad position lock up all your capital

#### Why Use Multi-Tranche?

**Traditional Trading Problem:**
```
Enter BTCUSDT LONG @ $50,000
Price drops to $47,500 (-5%)
You're stuck: Can't trade more without adding to losing position
Miss opportunities while waiting for recovery
```

**With Multi-Tranche System:**
```
Tranche #1: LONG @ $50,000 → Down 5% → ISOLATED (held separately)
Tranche #2: LONG @ $47,500 → Up 2% → CLOSE (+profit!)
Tranche #3: LONG @ $48,000 → Up 3% → CLOSE (+profit!)
Meanwhile, Tranche #1 recovers → Eventually closes at breakeven or profit
```

**Result:** You keep making money on new trades while bad positions recover naturally.

#### Key Benefits

✅ **Isolate Losing Positions** - Underwater positions tracked separately
✅ **Continue Trading** - Open fresh positions without adding to losers
✅ **Better Margin Efficiency** - Don't lock up capital in losing trades
✅ **Automatic Management** - Bot handles everything automatically
✅ **Configurable Strategies** - Choose FIFO, LIFO, or close best/worst first
✅ **Real-Time Monitoring** - Dashboard shows all tranches and their P&L

#### How to Enable

1. **Via Web UI** (Recommended):
   - Go to http://localhost:3000/config
   - Find your trading pair (e.g., BTCUSDT)
   - Scroll to "Tranche Management Settings"
   - Toggle "Enable Multi-Tranche Management"
   - Configure settings:
     - **Isolation Threshold**: When to isolate (default: 5% loss)
     - **Max Tranches**: Max active positions (default: 3)
     - **Max Isolated**: Max underwater positions before blocking new trades (default: 2)
     - **Closing Strategy**: FIFO (oldest first), LIFO (newest first), WORST_FIRST, BEST_FIRST
     - **SL/TP Strategy**: Which tranche's targets to use (NEWEST, OLDEST, BEST_ENTRY, AVERAGE)

2. **Monitor Your Tranches**:
   - Visit http://localhost:3000/tranches
   - See all active, isolated, and closed tranches
   - Real-time P&L tracking
   - Event timeline showing tranche lifecycle

#### Configuration Example

```json
{
  "symbols": {
    "BTCUSDT": {
      "enableTrancheManagement": true,
      "trancheIsolationThreshold": 5,
      "maxTranches": 3,
      "maxIsolatedTranches": 2,
      "allowTrancheWhileIsolated": true,
      "trancheStrategy": {
        "closingStrategy": "FIFO",
        "slTpStrategy": "NEWEST",
        "isolationAction": "HOLD"
      }
    }
  }
}
```

#### Safety & Risk Management

The multi-tranche system includes built-in safety features:

- **Position Limits**: Won't exceed max tranches per symbol
- **Isolation Blocking**: Stops new trades if too many positions are underwater
- **Exchange Sync**: Reconciles local tracking with exchange positions
- **Automatic Monitoring**: Checks every 10 seconds for positions needing isolation
- **Event Audit Trail**: Full history of every tranche action in database

**⚠️ Important Notes:**
- Start with **paper mode** to understand how tranches work
- Set conservative limits (3 max tranches, 2 max isolated is recommended)
- Higher isolation threshold (5-10%) prevents over-isolation
- Monitor the `/tranches` dashboard regularly

#### Advanced Use Cases

**Scalping Strategy:**
- Low isolation threshold (3%)
- High max tranches (5)
- LIFO closing (close newest first)
- Works great for quick in-and-out trades

**Hold & Recover Strategy:**
- High isolation threshold (10%)
- Moderate max tranches (3)
- FIFO closing (close oldest first)
- Good for trending markets

**Best Trade First:**
- BEST_FIRST closing strategy
- Take profits on winners quickly
- Hold losers for recovery
- Maximizes realized gains

## 🛡️ Safety Features

- Paper mode for testing
- Automatic stop-loss/take-profit
- Position size limits
- Multi-tranche isolation system
- WebSocket auto-reconnection

## 🌐 Remote Access Configuration

The bot supports remote access, allowing you to monitor and control it from any device on your network.

### Enable Remote WebSocket Access

1. **Via Web UI** (Recommended):
   - Navigate to http://localhost:3000/config
   - Go to "Server Settings" section
   - Toggle "Enable Remote WebSocket Access"
   - Save configuration
   - Access from remote device: `http://your_server_ip:3000`

2. **Via Environment Variable** (Advanced):
   - Copy `.env.example` to `.env.local`
   - Set `NEXT_PUBLIC_WS_HOST=your_server_ip`
   - Restart the application

### Remote Access Options

| Method | Description | Use Case |
|--------|-------------|----------|
| Auto-detect | Automatically uses browser's hostname | Default - works for most setups |
| Config Host | Set specific host in config UI | When using specific hostname/domain |
| Environment Variable | Override via `NEXT_PUBLIC_WS_HOST` | Docker/cloud deployments |

**Note**: When accessing remotely, ensure port 8080 (WebSocket) is accessible on your network.

## 📱 Configuration Options

All settings available in the web UI:

| Setting | Description | Default |
|---------|-------------|---------|
| Paper Mode | Test without real money | ON |
| Leverage | Position multiplier | 10x |
| Stop Loss | Max loss per trade | 20% |
| Take Profit | Target profit | 1% |
| Volume Filter | Min liquidation size | $1000 |

## 🚨 Important Notes

1. **Always start in paper mode** - Test your settings first
2. **API Security** - Never share your API keys
3. **Risk Warning** - Crypto trading involves significant risk

## 🤝 Need Help or Want to Contribute?

### 🐛 Found a Bug?
[**Create an Issue**](https://github.com/CryptoGnome/aster_lick_hunter_node/issues/new) - We'll fix it ASAP!

### 💡 Have an Idea?
[**Request a Feature**](https://github.com/CryptoGnome/aster_lick_hunter_node/issues/new?title=Feature%20Request:%20) - We love new ideas!

### 🔧 Want to Contribute?
1. Fork the repo
2. Create your feature branch (`git checkout -b feature/YourFeature`)
3. Commit changes (`git commit -m 'Add YourFeature'`)
4. Push (`git push origin feature/YourFeature`)
5. [Open a Pull Request](https://github.com/CryptoGnome/aster_lick_hunter_node/pulls)

### 💬 Join the Community
[**Discord Server**](https://discord.gg/P8Ev3Up) - Get help, share strategies, and chat with other traders!

## 📄 License

MIT License - Free to use and modify

## ⚠️ Disclaimer

**IMPORTANT RISK WARNING**: Trading cryptocurrency carries substantial risk of loss. This bot is provided for educational and research purposes only.

**No Warranty**: This is open source software provided "as is" without warranty of any kind. There may be bugs, errors, or unexpected behavior that could result in financial losses.

**Developer Liability**: The developers of this open source project are in no way responsible for any financial losses, damages, or other consequences that may result from using this software. By using this bot, you acknowledge and accept full responsibility for all trading decisions and outcomes.

**Use at Your Own Risk**: Only trade with funds you can afford to lose completely. Always do your own research, test thoroughly in paper mode, and trade responsibly. Never risk more than you can afford to lose.

---

<p align="center">
  <b>Support Development:</b> <a href="https://www.asterdex.com/en/referral/3TixB2">Create Aster DEX Account</a>
</p>
