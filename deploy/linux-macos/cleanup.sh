#!/bin/bash

# Clean removal script
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${RED}🧹 Aster DEX Bot - Cleanup${NC}"
echo "============================"

# Detect docker compose command
if docker compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif docker-compose version &> /dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
else
    echo -e "${YELLOW}⚠️  Docker Compose not found${NC}"
    DOCKER_COMPOSE=""
fi

# Confirmation
echo -e "${YELLOW}This will remove:${NC}"
echo "• Docker containers"
echo "• Docker images"
echo "• Configuration files"
echo "• Trading data"
echo ""
read -p "Are you sure? [y/N]: " confirm

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 0
fi

# Stop and remove containers
if [ -n "$DOCKER_COMPOSE" ]; then
    echo -e "${YELLOW}Stopping containers...${NC}"
    $DOCKER_COMPOSE --profile nginx down --volumes --remove-orphans 2>/dev/null || true
    $DOCKER_COMPOSE down --volumes --remove-orphans 2>/dev/null || true
fi

# Remove images
echo -e "${YELLOW}Removing images...${NC}"
docker rmi $(docker images -q "*aster*" 2>/dev/null) 2>/dev/null || true

# Remove files
echo -e "${YELLOW}Removing files...${NC}"
rm -rf config data

echo ""
echo -e "${GREEN}✅ Cleanup complete${NC}"