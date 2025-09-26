# 🚀 Aster DEX Bot - Windows Deployment

Simple Docker deployment for Windows users.

## 📋 Prerequisites

- [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows/)
- Git (for updates)

## 🚀 Quick Start

1. **Clone the repository:**
   ```cmd
   git clone https://github.com/CryptoGnome/aster_lick_hunter_node.git
   cd aster_lick_hunter_node\deploy\windows
   ```

2. **Deploy the bot:**
   ```cmd
   deploy.bat
   ```

3. **Configure via web interface:**
   - Open http://localhost:3000
   - Go to http://localhost:3000/config
   - Add your Aster DEX API keys

## 🔧 Available Commands

- **`deploy.bat`** - Deploy the bot
- **`update.bat`** - Update to latest version
- **`cleanup.bat`** - Remove everything

## 📊 Access

- **Dashboard:** http://localhost:3000
- **Configuration:** http://localhost:3000/config

## 🛠️ Management

### View Logs
```cmd
docker compose logs -f
```

### Stop Bot
```cmd
docker compose stop
```

### Start Bot
```cmd
docker compose start
```

### Check Status
```cmd
docker compose ps
```

## 🔄 Updates

To update the bot to the latest version:
```cmd
update.bat
```

This will:
1. Stop the current bot
2. Pull latest code from GitHub
3. Rebuild containers
4. Restart the bot

## 🧹 Cleanup

To completely remove the bot and all data:
```cmd
cleanup.bat
```

⚠️ **Warning:** This will delete all configuration and trading data!

## 🚨 Troubleshooting

### Docker not found
- Install [Docker Desktop](https://docs.docker.com/desktop/install/windows/)
- Make sure Docker Desktop is running

### Port already in use
- Close any applications using ports 3000 or 8080
- Or change ports in `docker-compose.yml`

### Container won't start
- Check Docker Desktop is running
- Check logs: `docker compose logs`

## 📝 Notes

- Windows deployment is configured for **local access only**
- No Nginx proxy (simpler setup)
- Configuration is handled via web interface
- All data persists in `config/` and `data/` folders
