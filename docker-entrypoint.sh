#!/bin/bash
set -e

echo "🚀 Starting Aster Lick Hunter Node..."

# Create data directory if it doesn't exist
mkdir -p /app/data

# Check if .env.local exists, if not create from environment variables
if [ ! -f /app/.env.local ]; then
  echo "📝 Creating .env.local from environment variables..."
  cat > /app/.env.local <<EOF
NEXTAUTH_SECRET=${NEXTAUTH_SECRET:-change-this-secret-in-production}
NEXT_PUBLIC_WS_HOST=${NEXT_PUBLIC_WS_HOST:-localhost}
EOF
fi

# Check if config.user.json exists, if not use config.default.json
if [ ! -f /app/config.user.json ] && [ ! -f /app/config.json ]; then
  echo "⚠️  No user configuration found, using default configuration..."
  echo "⚠️  Please mount your config.user.json or set it up via the dashboard"
fi

# Run any setup scripts if needed
if [ ! -f /app/data/.initialized ]; then
  echo "🔧 First time setup..."
  node scripts/setup-config.js || true
  touch /app/data/.initialized
fi

echo "✅ Initialization complete!"
echo "📊 Dashboard will be available on port 3000"
echo "🔌 WebSocket will be available on port 8080"

# Execute the main command
exec "$@"
