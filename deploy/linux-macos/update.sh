#!/bin/bash

# Update script for Aster DEX Bot
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔄 Aster DEX Bot - Update${NC}"
echo "=========================="

# Check if we're in the right directory
if [ ! -f "../../package.json" ] || [ ! -f "deploy.sh" ]; then
    echo -e "${RED}❌ Run this script from the deploy/ directory${NC}"
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

echo -e "${GREEN}✅ Docker Compose ready${NC}"

# Check if containers are running
RUNNING_CONTAINERS=$($DOCKER_COMPOSE ps -q 2>/dev/null | wc -l)
if [ "$RUNNING_CONTAINERS" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Bot is currently running${NC}"
    echo -e "${YELLOW}   This will stop the bot temporarily during update${NC}"
    echo ""
    read -p "Continue with update? [y/N]: " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Update cancelled"
        exit 0
    fi

    echo ""
    echo -e "${YELLOW}🛑 Stopping containers...${NC}"
    $DOCKER_COMPOSE down
else
    echo -e "${GREEN}✅ No running containers${NC}"
fi

# Go to project root
cd ../..

# Check git status
echo ""
echo -e "${YELLOW}📋 Checking git status...${NC}"
if ! git status &>/dev/null; then
    echo -e "${RED}❌ Not a git repository${NC}"
    exit 1
fi

# Show current branch and status
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${GREEN}   Current branch: $CURRENT_BRANCH${NC}"

if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${YELLOW}⚠️  You're not on main branch${NC}"
    read -p "Switch to main branch? [y/N]: " SWITCH_BRANCH
    if [[ "$SWITCH_BRANCH" =~ ^[Yy]$ ]]; then
        git checkout main
    fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}⚠️  You have uncommitted changes${NC}"
    echo ""
    git status --short
    echo ""
    read -p "Stash changes and continue? [y/N]: " STASH_CHANGES
    if [[ "$STASH_CHANGES" =~ ^[Yy]$ ]]; then
        git stash push -m "Auto-stash before update $(date)"
        echo -e "${GREEN}✅ Changes stashed${NC}"
    else
        echo "Update cancelled"
        exit 0
    fi
fi

# Update from remote
echo ""
echo -e "${YELLOW}⬇️  Pulling latest changes...${NC}"
git fetch origin
git pull origin main

echo -e "${GREEN}✅ Code updated${NC}"

# Go back to deploy directory
cd deploy/linux-macos/

# Rebuild and restart
echo ""
echo -e "${YELLOW}🔨 Rebuilding containers...${NC}"
$DOCKER_COMPOSE build --no-cache

echo ""
echo -e "${YELLOW}🚀 Starting updated bot...${NC}"
$DOCKER_COMPOSE up -d

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

if $DOCKER_COMPOSE ps | grep -q "Up\|running"; then
    echo ""
    echo -e "${GREEN}✅ Bot updated and restarted successfully!${NC}"
    echo ""
    echo "📝 Logs: $DOCKER_COMPOSE logs -f"
    echo "📊 Status: $DOCKER_COMPOSE ps"
else
    echo -e "${RED}❌ Failed to start after update${NC}"
    echo ""
    echo "Check logs: $DOCKER_COMPOSE logs"
    exit 1
fi
