.PHONY: help build up down restart logs shell clean backup restore health

# Default target
help:
	@echo "Aster Lick Hunter Node - Docker Commands"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  build      - Build Docker image"
	@echo "  up         - Start containers in detached mode"
	@echo "  down       - Stop and remove containers"
	@echo "  restart    - Restart containers"
	@echo "  logs       - View container logs (follow mode)"
	@echo "  shell      - Access container shell"
	@echo "  clean      - Remove containers, volumes, and images"
	@echo "  backup     - Backup database"
	@echo "  restore    - Restore database from backup"
	@echo "  health     - Check container health"
	@echo "  rebuild    - Clean build and start"
	@echo "  dev        - Start in development mode"
	@echo "  prod       - Start in production mode"

# Build the Docker image
build:
	@echo "🔨 Building Docker image..."
	docker-compose build

# Start containers
up:
	@echo "🚀 Starting containers..."
	docker-compose up -d
	@echo "✅ Containers started!"
	@echo "📊 Dashboard: http://localhost:3000"
	@echo "🔌 WebSocket: ws://localhost:8080"

# Stop containers
down:
	@echo "🛑 Stopping containers..."
	docker-compose down

# Restart containers
restart:
	@echo "🔄 Restarting containers..."
	docker-compose restart

# View logs
logs:
	@echo "📋 Viewing logs (Ctrl+C to exit)..."
	docker-compose logs -f

# Access shell
shell:
	@echo "🐚 Accessing container shell..."
	docker-compose exec aster-bot sh

# Clean everything
clean:
	@echo "🧹 Cleaning up..."
	docker-compose down -v
	docker system prune -f
	@echo "✅ Cleanup complete!"

# Backup database
backup:
	@echo "💾 Creating backup..."
	@mkdir -p backups
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S) && \
	docker-compose exec -T aster-bot cat /app/data/trading.db > "backups/trading_$$TIMESTAMP.db" && \
	echo "✅ Backup created: backups/trading_$$TIMESTAMP.db"

# Restore database (usage: make restore FILE=backups/trading_20250113_120000.db)
restore:
	@if [ -z "$(FILE)" ]; then \
		echo "❌ Error: Please specify backup file"; \
		echo "Usage: make restore FILE=backups/trading_20250113_120000.db"; \
		exit 1; \
	fi
	@echo "🔄 Restoring from $(FILE)..."
	@docker-compose down
	@cp "$(FILE)" ./data/trading.db
	@docker-compose up -d
	@echo "✅ Restore complete!"

# Check health
health:
	@echo "🏥 Checking container health..."
	@docker-compose ps
	@echo ""
	@echo "API Health Check:"
	@curl -s http://localhost:3000/api/health | jq . || echo "❌ Health check failed"

# Rebuild from scratch
rebuild:
	@echo "🔨 Rebuilding from scratch..."
	docker-compose down -v
	docker-compose build --no-cache
	docker-compose up -d
	@echo "✅ Rebuild complete!"

# Development mode
dev:
	@echo "🔧 Starting in development mode..."
	@if [ ! -f .env.local ]; then cp .env.example .env.local; fi
	docker-compose -f docker-compose.yml up

# Production mode
prod:
	@echo "🚀 Starting in production mode..."
	@if [ ! -f .env.local ]; then \
		echo "❌ Error: .env.local not found"; \
		echo "Please create .env.local from .env.example"; \
		exit 1; \
	fi
	docker-compose up -d
	@echo "✅ Production containers started!"

# View resource usage
stats:
	@echo "📊 Container resource usage:"
	docker stats aster-lick-hunter --no-stream

# Update and restart
update:
	@echo "🔄 Updating application..."
	git pull
	docker-compose down
	docker-compose build --no-cache
	docker-compose up -d
	@echo "✅ Update complete!"
