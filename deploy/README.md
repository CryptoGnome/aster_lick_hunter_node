# 🚀 Aster DEX Bot - Docker Deployment

**Professional-grade Docker deployment for the Aster DEX Liquidation Hunter Bot.**

Deploy your trading bot in minutes with our automated Docker solution. Perfect for both beginners and experienced users.

## 📋 What You Get

- **🔧 One-click deployment** - Get running in under 5 minutes
- **🌐 Cross-platform support** - Linux, macOS, and Windows
- **🛡️ Production-ready** - Auto-restart, health checks, volume persistence
- **🌍 Remote access** - Optional Nginx proxy for VPS deployment
- **🔄 Easy updates** - Automated update scripts
- **🧹 Clean removal** - Complete cleanup when needed

## 🎯 Choose Your Platform

### 🐧 Linux & macOS Users
**Full-featured deployment with optional remote access**

```bash
cd deploy/linux-macos/
./deploy.sh
```

**Features:**
- ✅ Local and remote access options
- ✅ Nginx reverse proxy (optional)
- ✅ Custom domain support
- ✅ Automatic IP detection
- ✅ SSL-ready configuration

### 🪟 Windows Users
**Simplified local deployment**

```cmd
cd deploy\windows\
deploy.bat
```

**Features:**
- ✅ Local access (localhost:3000)
- ✅ Simple batch scripts
- ✅ Docker Desktop integration
- ✅ Windows-optimized workflow

## 🚀 Quick Start Guide

### Step 1: Prerequisites

**All Platforms:**
- [Docker](https://docs.docker.com/get-docker/) installed and running
- [Git](https://git-scm.com/) for cloning and updates

**Platform-specific:**
- **Linux/macOS:** Terminal access
- **Windows:** Command Prompt or PowerShell + [Docker Desktop](https://docs.docker.com/desktop/install/windows/)

### Step 2: Clone Repository

```bash
git clone https://github.com/CryptoGnome/aster_lick_hunter_node.git
cd aster_lick_hunter_node/deploy/
```

### Step 3: Choose Your Deployment

#### 🐧 Linux/macOS Deployment

```bash
cd linux-macos/
./deploy.sh
```

**Interactive Setup:**
1. **Network Configuration**
   - Option 1: Local only (localhost:3000)
   - Option 2: External access with Nginx proxy

2. **External Access Options** (if selected)
   - Choose HTTP port (default: 80)
   - IP-only access or custom domain
   - Automatic server IP detection

3. **Automated Deployment**
   - Docker build and container startup
   - Health checks and volume verification
   - Ready-to-use URLs displayed

#### 🪟 Windows Deployment

```cmd
cd windows\
deploy.bat
```

**Automated Process:**
1. Docker environment verification
2. Container build and startup
3. Health checks and volume verification
4. Local access at http://localhost:3000

### Step 4: Configure Your Bot

1. **Open the dashboard:**
   - **Local:** http://localhost:3000
   - **Remote:** Your configured URL

2. **Set up API keys:**
   - Navigate to http://your-url/config
   - Add your Aster DEX API credentials
   - Configure trading parameters

3. **Start trading:**
   - Bot runs in paper mode by default
   - Switch to live trading when ready

## 🛠️ Management Commands

### Linux/macOS

```bash
# View logs
docker compose logs -f

# Stop bot
docker compose stop

# Start bot
docker compose start

# Update bot
./update.sh

# Complete removal
./cleanup.sh
```

### Windows

```cmd
# View logs
docker compose logs -f

# Stop bot
docker compose stop

# Start bot
docker compose start

# Update bot
update.bat

# Complete removal
cleanup.bat
```

## 🔄 Updates

Keep your bot up-to-date with the latest features and fixes:

### Linux/macOS
```bash
cd deploy/linux-macos/
./update.sh
```

### Windows
```cmd
cd deploy\windows\
update.bat
```

**Update Process:**
1. Stops running containers safely
2. Pulls latest code from GitHub
3. Rebuilds containers with new code
4. Restarts bot with preserved data
5. Verifies successful update

## 🌐 Access Your Bot

### Local Access
- **Dashboard:** http://localhost:3000
- **Configuration:** http://localhost:3000/config
- **API:** http://localhost:8080

### Remote Access (Linux/macOS only)
- **With Domain:** http://your-domain.com
- **With IP:** http://your-server-ip
- **Custom Port:** http://your-server-ip:port

## 📊 Monitoring

### Health Checks
Both deployments include automated health monitoring:
- ✅ Frontend responsiveness
- ✅ Volume mount verification
- ✅ Container status monitoring
- ✅ Write permission validation

### Log Access
```bash
# Real-time logs
docker compose logs -f

# Specific service logs
docker compose logs -f bot

# Last 100 lines
docker compose logs --tail=100
```

## 🛡️ Data Persistence

Your bot data is safely stored in Docker volumes:

- **📁 config/** - Bot configuration and API keys
- **📁 data/** - Trading history and database
- **🔄 Auto-backup** - Data survives container restarts
- **💾 Portable** - Easy to backup and migrate

## 🚨 Troubleshooting

### Common Issues

#### Docker Not Found
```bash
# Install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

#### Port Already in Use
```bash
# Find what's using port 3000
sudo lsof -i :3000

# Kill the process (replace PID)
sudo kill -9 PID
```

#### Permission Denied (Linux)
```bash
# Add user to docker group
sudo usermod -aG docker $USER
# Logout and login again
```

#### Container Won't Start
```bash
# Check Docker daemon
sudo systemctl status docker

# Check logs
docker compose logs

# Rebuild containers
docker compose build --no-cache
```

### Windows-Specific Issues

#### Docker Desktop Not Running
- Start Docker Desktop from Windows Start Menu
- Wait for Docker to fully initialize

#### Script Execution Policy (PowerShell)
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## 🔒 Security Best Practices

### API Keys
- ✅ Stored in secure Docker volumes
- ✅ Never logged or exposed
- ✅ Web interface configuration only

### Network Security
- ✅ Minimal port exposure
- ✅ Optional Nginx proxy with security headers
- ✅ Local-only option for sensitive environments

### Container Security
- ✅ Non-root user execution
- ✅ Minimal attack surface
- ✅ Isolated environment

## 📈 Performance Optimization

### Resource Allocation
```yaml
# Optional: Add to docker-compose.yml
deploy:
  resources:
    limits:
      memory: 1G
      cpus: '0.5'
```

### Log Rotation
```bash
# Limit log size
docker compose config --services | xargs docker update --log-opt max-size=10m --log-opt max-file=3
```

## 🆘 Support

### Getting Help
1. **Check logs first:** `docker compose logs`
2. **Verify configuration:** Visit /config page
3. **Restart if needed:** `docker compose restart`
4. **Update to latest:** Run update script

### Community Support
- **Discord:** [Join our community](https://discord.gg/P8Ev3Up)
- **GitHub Issues:** [Report bugs](https://github.com/CryptoGnome/aster_lick_hunter_node/issues)
- **Documentation:** [Full documentation](https://github.com/CryptoGnome/aster_lick_hunter_node)

## 📄 File Structure

```
deploy/
├── README.md              # This file
├── linux-macos/           # Linux & macOS deployment
│   ├── deploy.sh          # Main deployment script
│   ├── update.sh          # Update script
│   ├── cleanup.sh         # Cleanup script
│   ├── docker-compose.yml # Docker configuration
│   ├── Dockerfile         # Container definition
│   └── nginx.conf         # Nginx configuration
└── windows/               # Windows deployment
    ├── deploy.bat         # Main deployment script
    ├── update.bat         # Update script
    ├── cleanup.bat        # Cleanup script
    ├── docker-compose.yml # Docker configuration
    ├── Dockerfile         # Container definition
    └── README.md          # Windows-specific docs
```

## ⚠️ Important Notes

- **Start in paper mode** - Always test your configuration first
- **Backup your data** - Export configurations before major updates
- **Monitor performance** - Check logs regularly for optimal operation
- **Keep updated** - Run update scripts monthly for latest features

---

<p align="center">
  <strong>🚀 Ready to start trading? Choose your platform above and deploy in minutes!</strong>
</p>

<p align="center">
  <em>Professional Docker deployment made simple.</em>
</p>
