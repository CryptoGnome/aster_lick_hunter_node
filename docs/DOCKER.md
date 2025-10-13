# Docker Deployment Guide

This guide explains how to run the Aster Lick Hunter Node application in Docker containers.

## Prerequisites

- Docker Engine 20.10+ or Docker Desktop
- Docker Compose 2.0+
- At least 2GB of available RAM
- Ports 3000 and 8080 available (or configure custom ports)

## Quick Start

### 1. Clone and Navigate to Project

```bash
cd aster_lick_hunter_node
```

### 2. Create Environment Configuration

Copy the example environment file and customize it:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your settings:

```env
NEXTAUTH_SECRET=your-secure-random-secret-here
NEXT_PUBLIC_WS_HOST=localhost
DASHBOARD_PORT=3000
WEBSOCKET_PORT=8080
```

### 3. Create User Configuration

Create your `config.user.json` with your API keys and trading settings:

```json
{
  "api": {
    "apiKey": "your-binance-api-key",
    "secretKey": "your-binance-secret-key"
  },
  "symbols": {
    "ASTERUSDT": {
      "longVolumeThresholdUSDT": 1000,
      "shortVolumeThresholdUSDT": 2500,
      "tradeSize": 0.69,
      "leverage": 10,
      "tpPercent": 1,
      "slPercent": 20
    }
  },
  "global": {
    "paperMode": true,
    "positionMode": "HEDGE"
  }
}
```

### 4. Build and Run

```bash
# Build the Docker image
docker-compose build

# Start the container
docker-compose up -d

# View logs
docker-compose logs -f
```

### 5. Access the Application

- **Dashboard**: http://localhost:3000
- **WebSocket**: ws://localhost:8080
- **Health Check**: http://localhost:3000/api/health

## Docker Commands

### Basic Operations

```bash
# Start containers
docker-compose up -d

# Stop containers
docker-compose down

# Restart containers
docker-compose restart

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f aster-bot

# Check container status
docker-compose ps
```

### Building and Updating

```bash
# Rebuild after code changes
docker-compose build --no-cache

# Pull latest changes and rebuild
git pull
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Database and Data Management

```bash
# Backup database
docker-compose exec aster-bot cp /app/data/trading.db /app/data/trading.db.backup

# Access container shell
docker-compose exec aster-bot sh

# View database files
docker-compose exec aster-bot ls -lah /app/data
```

### Troubleshooting

```bash
# Check container health
docker-compose ps

# View detailed logs
docker-compose logs --tail=100 -f

# Restart specific service
docker-compose restart aster-bot

# Remove everything and start fresh
docker-compose down -v
docker-compose up -d --build
```

## Configuration

### Environment Variables

The following environment variables can be set in `.env.local` or `docker-compose.yml`:

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXTAUTH_SECRET` | Secret for NextAuth session encryption | Required |
| `NEXT_PUBLIC_WS_HOST` | WebSocket host for client connections | `localhost` |
| `DASHBOARD_PORT` | Port for web dashboard | `3000` |
| `WEBSOCKET_PORT` | Port for WebSocket server | `8080` |
| `NODE_ENV` | Node environment | `production` |

### Volume Mounts

The Docker setup uses the following volume mounts:

- `./data:/app/data` - Persists database and application data
- `./config.user.json:/app/config.user.json` - User configuration (optional)
- `./.env.local:/app/.env.local` - Environment variables (optional)

### Custom Ports

To use different ports, modify the `docker-compose.yml`:

```yaml
ports:
  - "8000:3000"  # Map host port 8000 to container port 3000
  - "9000:8080"  # Map host port 9000 to container port 8080
```

Or set environment variables:

```bash
DASHBOARD_PORT=8000 WEBSOCKET_PORT=9000 docker-compose up -d
```

## Production Deployment

### Security Best Practices

1. **Generate a Strong Secret**:
   ```bash
   openssl rand -base64 32
   ```
   Use this value for `NEXTAUTH_SECRET`.

2. **Use Environment Variables**: Don't commit `.env.local` or `config.user.json` to version control.

3. **Enable HTTPS**: Use a reverse proxy (nginx, Traefik, Caddy) for SSL/TLS.

4. **Restrict Network Access**: Configure firewall rules to limit access.

5. **Regular Backups**: Automate database backups.

### Reverse Proxy Example (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

### Docker Compose Production Example

```yaml
version: '3.8'

services:
  aster-bot:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: aster-lick-hunter
    restart: always
    ports:
      - "127.0.0.1:3000:3000"  # Only bind to localhost
      - "127.0.0.1:8080:8080"
    volumes:
      - ./data:/app/data
      - ./config.user.json:/app/config.user.json:ro
    environment:
      - NODE_ENV=production
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
      - NEXT_PUBLIC_WS_HOST=${NEXT_PUBLIC_WS_HOST}
    networks:
      - aster-network
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G

networks:
  aster-network:
    driver: bridge
```

## Monitoring

### Health Checks

The container includes a built-in health check:

```bash
# Check health status
docker-compose ps

# Manual health check
curl http://localhost:3000/api/health
```

### Logs

```bash
# Follow all logs
docker-compose logs -f

# Filter by time
docker-compose logs --since 1h

# Export logs
docker-compose logs > logs.txt
```

### Resource Usage

```bash
# View resource usage
docker stats aster-lick-hunter

# Detailed container info
docker inspect aster-lick-hunter
```

## Backup and Restore

### Backup

```bash
#!/bin/bash
# backup.sh
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
docker-compose exec -T aster-bot cat /app/data/trading.db > "$BACKUP_DIR/trading_$TIMESTAMP.db"

# Backup configuration
cp config.user.json "$BACKUP_DIR/config_$TIMESTAMP.json"

echo "Backup completed: $TIMESTAMP"
```

### Restore

```bash
#!/bin/bash
# restore.sh
BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./restore.sh <backup_file>"
  exit 1
fi

# Stop container
docker-compose down

# Restore database
cp "$BACKUP_FILE" ./data/trading.db

# Start container
docker-compose up -d

echo "Restore completed"
```

## Troubleshooting

### Container Won't Start

1. Check logs: `docker-compose logs`
2. Verify ports are available: `netstat -tuln | grep -E '3000|8080'`
3. Check disk space: `df -h`
4. Verify configuration files exist

### Database Issues

```bash
# Check database file
docker-compose exec aster-bot ls -lah /app/data/

# Access SQLite directly
docker-compose exec aster-bot sqlite3 /app/data/trading.db ".tables"
```

### Permission Issues

```bash
# Fix data directory permissions
sudo chown -R 1001:1001 ./data

# Or run with current user
docker-compose run --user $(id -u):$(id -g) aster-bot
```

### Network Issues

```bash
# Check network
docker network ls
docker network inspect aster_aster-network

# Recreate network
docker-compose down
docker network prune
docker-compose up -d
```

## Advanced Configuration

### Multi-Container Setup

For scaling or separating concerns:

```yaml
version: '3.8'

services:
  web:
    build: .
    command: npm run start:web
    ports:
      - "3000:3000"
    
  bot:
    build: .
    command: npm run start:bot
    ports:
      - "8080:8080"
    
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

### Development Mode

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  aster-bot:
    build:
      context: .
      target: deps  # Use deps stage for development
    command: npm run dev
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
```

Run with: `docker-compose -f docker-compose.dev.yml up`

## Support

For issues or questions:
- Check logs: `docker-compose logs -f`
- Review health status: `curl http://localhost:3000/api/health`
- Consult main README.md for application-specific help

---

**Note**: Always test in paper mode before running with real funds.
