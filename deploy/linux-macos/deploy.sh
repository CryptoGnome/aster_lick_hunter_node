#!/bin/bash

# Simple Docker deployment following the README workflow
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🚀 Aster DEX Bot - Docker Deploy${NC}"
echo "===================================="

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not installed${NC}"
    echo "Install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Detect docker compose command
if docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif docker-compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
else
    echo -e "${RED}❌ Docker Compose not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker ready${NC}"

# Create directories for volumes
echo -e "${YELLOW}📁 Creating volume directories...${NC}"
mkdir -p config data

if [ -d "config" ] && [ -d "data" ]; then
    echo -e "${GREEN}✅ Volume directories created (config/, data/)${NC}"
else
    echo -e "${RED}❌ Failed to create volume directories${NC}"
    exit 1
fi

# Configuration will be handled via web interface
echo -e "${GREEN}✅ Configuration will be handled via web interface${NC}"

# Network configuration
echo ""
echo -e "${YELLOW}🌐 Network Configuration${NC}"
echo "Choose deployment mode:"
echo "1) Local only (localhost:3000)"
echo "2) Expose with Nginx proxy"
echo ""
read -p "Select option [1-2]: " DEPLOY_MODE
DEPLOY_MODE=${DEPLOY_MODE:-1}

if [[ "$DEPLOY_MODE" == "2" ]]; then
    echo ""
    echo -e "${YELLOW}📡 External Access Setup${NC}"

    # Get server IP automatically (IPv4 only)
    SERVER_IP=$(curl -s -4 ifconfig.me 2>/dev/null || curl -s -4 ipinfo.io/ip 2>/dev/null || curl -s -4 icanhazip.com 2>/dev/null || echo "YOUR_SERVER_IP")

    read -p "HTTP port (default: 80): " HTTP_PORT
    HTTP_PORT=${HTTP_PORT:-80}

    echo ""
    echo "Access options:"
    echo "1) IP only (http://$SERVER_IP:$HTTP_PORT)"
    echo "2) Custom domain"
    echo ""
    read -p "Select option [1-2]: " DOMAIN_OPTION
    DOMAIN_OPTION=${DOMAIN_OPTION:-1}

    if [[ "$DOMAIN_OPTION" == "2" ]]; then
        read -p "Domain name (e.g., bot.example.com): " DOMAIN_NAME
        if [[ -z "$DOMAIN_NAME" ]]; then
            echo -e "${RED}❌ Domain name required${NC}"
            exit 1
        fi
        echo -e "${YELLOW}⚠️  Make sure $DOMAIN_NAME points to $SERVER_IP${NC}"
    else
        DOMAIN_NAME="_"
    fi

    # Export for Docker environment
    export HTTP_PORT="$HTTP_PORT"
    export DOMAIN_NAME="$DOMAIN_NAME"
    export USE_NGINX="true"
    export SERVER_IP="$SERVER_IP"

    echo -e "${GREEN}✅ External access configured${NC}"
    echo -e "${GREEN}   Server IP: $SERVER_IP${NC}"
    echo -e "${GREEN}   Port: $HTTP_PORT${NC}"
    if [[ "$DOMAIN_NAME" != "_" ]]; then
        echo -e "${GREEN}   Domain: $DOMAIN_NAME${NC}"
    fi
else
    export USE_NGINX="false"
    echo -e "${GREEN}✅ Local access only${NC}"
fi

# Build and start
echo ""
echo -e "${YELLOW}🔨 Building and starting containers...${NC}"
$DOCKER_COMPOSE down 2>/dev/null || true
$DOCKER_COMPOSE build

if [[ "$USE_NGINX" == "true" ]]; then
    $DOCKER_COMPOSE --profile nginx up -d
else
    $DOCKER_COMPOSE up -d bot
fi

# Wait for services to be ready
echo ""
echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"

# Function to check if frontend is ready
check_frontend_ready() {
    curl -s -f http://localhost:3000 > /dev/null 2>&1
}

# Wait up to 3 minutes for frontend to be ready
TIMEOUT=180
ELAPSED=0
INTERVAL=5

while [ $ELAPSED -lt $TIMEOUT ]; do
    if check_frontend_ready; then
        echo -e "${GREEN}✅ Frontend is ready!${NC}"
        break
    fi

    echo -n "."
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Frontend took longer than expected to start${NC}"
    echo -e "${YELLOW}   Checking container status...${NC}"
fi

# Check status
if $DOCKER_COMPOSE ps | grep -q "Up\|running"; then
    echo ""
    echo -e "${GREEN}✅ Bot deployed successfully!${NC}"
    echo ""
    if [[ "$USE_NGINX" == "true" ]]; then
        if [[ "$DOMAIN_NAME" != "_" ]]; then
            if [[ "$HTTP_PORT" != "80" ]]; then
                echo "📊 Dashboard: http://$DOMAIN_NAME:$HTTP_PORT"
            else
                echo "📊 Dashboard: http://$DOMAIN_NAME"
            fi
        else
            if [[ "$HTTP_PORT" != "80" ]]; then
                echo "📊 Dashboard: http://$SERVER_IP:$HTTP_PORT"
            else
                echo "📊 Dashboard: http://$SERVER_IP"
            fi
        fi
        echo "🌐 Local: http://localhost:3000"
        echo ""
        echo -e "${YELLOW}🔧 Configuration:${NC}"
        echo "   • Configure API keys via web interface"
        echo "   • Bot runs in paper mode until API keys are set"
    else
        echo "📊 Dashboard: http://localhost:3000"
        echo ""
        echo -e "${YELLOW}🔧 Next steps:${NC}"
        echo "   • Visit http://localhost:3000/config to set API keys"
        echo "   • Bot runs in paper mode until configured"
    fi
    echo "📝 Logs: $DOCKER_COMPOSE logs -f"
    echo "🛑 Stop: $DOCKER_COMPOSE stop"
else
    echo -e "${RED}❌ Failed to start${NC}"
    $DOCKER_COMPOSE logs
    exit 1
fi