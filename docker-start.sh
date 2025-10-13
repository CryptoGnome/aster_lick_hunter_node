#!/bin/bash

# Aster Lick Hunter Node - Docker Quick Start Script
# This script helps you quickly set up and run the bot in Docker

set -e

echo "🚀 Aster Lick Hunter Node - Docker Setup"
echo "=========================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed!"
    echo "Please install Docker Desktop from: https://www.docker.com/products/docker-desktop"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed!"
    echo "Please install Docker Compose or use Docker Desktop which includes it."
    exit 1
fi

echo "✅ Docker is installed"
echo ""

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "📝 Creating .env.local from template..."
    if [ -f .env.example ]; then
        cp .env.example .env.local
        echo "✅ Created .env.local"
        echo ""
        echo "⚠️  IMPORTANT: Please edit .env.local and set your NEXTAUTH_SECRET"
        echo "   You can generate a secret with: openssl rand -base64 32"
        echo ""
    else
        echo "❌ .env.example not found!"
        exit 1
    fi
else
    echo "✅ .env.local already exists"
    echo ""
fi

# Check if config.user.json exists
if [ ! -f config.user.json ]; then
    echo "⚠️  config.user.json not found"
    echo "   You can configure the bot via the web UI after starting"
    echo ""
fi

# Ask user what to do
echo "What would you like to do?"
echo "1) Build and start containers (first time setup)"
echo "2) Start existing containers"
echo "3) Stop containers"
echo "4) View logs"
echo "5) Rebuild from scratch"
echo "6) Exit"
echo ""
read -p "Enter your choice (1-6): " choice

case $choice in
    1)
        echo ""
        echo "🔨 Building Docker image..."
        docker-compose build
        echo ""
        echo "🚀 Starting containers..."
        docker-compose up -d
        echo ""
        echo "✅ Containers started successfully!"
        echo ""
        echo "📊 Dashboard: http://localhost:3000"
        echo "🔌 WebSocket: ws://localhost:8080"
        echo ""
        echo "View logs with: docker-compose logs -f"
        ;;
    2)
        echo ""
        echo "🚀 Starting containers..."
        docker-compose up -d
        echo ""
        echo "✅ Containers started!"
        echo ""
        echo "📊 Dashboard: http://localhost:3000"
        echo "View logs with: docker-compose logs -f"
        ;;
    3)
        echo ""
        echo "🛑 Stopping containers..."
        docker-compose down
        echo ""
        echo "✅ Containers stopped!"
        ;;
    4)
        echo ""
        echo "📋 Viewing logs (Ctrl+C to exit)..."
        docker-compose logs -f
        ;;
    5)
        echo ""
        echo "🧹 Cleaning up old containers and images..."
        docker-compose down -v
        echo ""
        echo "🔨 Rebuilding from scratch..."
        docker-compose build --no-cache
        echo ""
        echo "🚀 Starting containers..."
        docker-compose up -d
        echo ""
        echo "✅ Rebuild complete!"
        echo ""
        echo "📊 Dashboard: http://localhost:3000"
        ;;
    6)
        echo "👋 Goodbye!"
        exit 0
        ;;
    *)
        echo "❌ Invalid choice!"
        exit 1
        ;;
esac

echo ""
echo "Need help? Check docs/DOCKER.md for detailed documentation"
echo ""
