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

# Check if config.user.json exists, if not create from default
if [ ! -f /app/config.user.json ] && [ ! -f /app/config.json ]; then
  echo "⚠️  No user configuration found, creating from default..."
  if [ -f /app/config.default.json ]; then
    cp /app/config.default.json /app/config.user.json
    echo "✅ Created config.user.json from defaults"
  fi
  echo "⚠️  Please configure your API keys via the dashboard at http://localhost:3000/config"
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
