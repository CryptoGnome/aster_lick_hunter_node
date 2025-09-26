# 🚀 Aster DEX Liquidation Hunter Bot
<img width="1918" height="954" alt="image" src="https://github.com/user-attachments/assets/cfa2d243-ca66-4230-b834-1e558cb5ce0b" />


> ⚠️ **OPEN BETA WARNING** - Please trade with caution! This software is in open beta.

A smart trading bot that monitors and trades liquidation events on Aster DEX. Features automated trading, risk management, and a beautiful web dashboard.

## 💝 Support This Free Bot

**This bot is 100% FREE!** If you find it useful, please support development by creating your Aster DEX account with our referral link:

### 👉 [**Create Aster DEX Account (Support Development)**](https://www.asterdex.com/en/referral/3TixB2)

*Using our referral link costs you nothing extra but helps fund continued development. Thank you!*

## 🎯 What Makes This Bot Special

- 📈 **Real-time Liquidation Hunting** - Monitors and instantly trades liquidation events
- 💰 **Smart Position Management** - Automatic stop-loss and take-profit on every trade
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
- [Node.js 20+](https://nodejs.org/)
- [Aster DEX Account](https://www.asterdex.com/en/referral/3TixB2)

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
- **History** - View past trades

## ⚙️ Commands

```bash
npm run dev        # Run bot + dashboard
npm run start      # Production mode
npm run bot        # Run bot only
npm test           # Run tests
```

## 🛡️ Safety Features

- Paper mode for testing
- Automatic stop-loss/take-profit
- Position size limits
- WebSocket auto-reconnection

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
