#!/bin/bash
# Quick setup script for AgentPay

set -e

echo "🚀 AgentPay Quick Setup"
echo "======================"

# Step 1: Install dependencies
echo ""
echo "📦 Installing dependencies..."
cd agent-backend && npm install && cd ..
cd agent-sdk && npm install && npm run build && cd ..
cd agent-dashboard && npm install && cd ..

# Step 2: Create .env files if they don't exist
echo ""
echo "📝 Creating .env files..."

if [ ! -f agent-backend/.env ]; then
  cp agent-backend/env.sample agent-backend/.env
  echo "✅ Created agent-backend/.env - please edit with your settings"
fi

if [ ! -f agent-sdk/.env ]; then
  cp agent-sdk/env.sample agent-sdk/.env
  echo "✅ Created agent-sdk/.env"
fi

if [ ! -f agent-dashboard/.env.local ]; then
  cp agent-dashboard/env.sample agent-dashboard/.env.local
  echo "✅ Created agent-dashboard/.env.local"
fi

echo ""
echo "✨ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit agent-backend/.env with your database URL and Solana settings"
echo "2. Create PostgreSQL database: psql -U postgres -c \"CREATE DATABASE agentpay;\""
echo "3. Initialize schema: psql -U postgres -d agentpay -f agent-backend/src/db/schema.sql"
echo ""
echo "Then run (in separate terminals):"
echo "  Terminal 1: cd agent-backend && npm run dev"
echo "  Terminal 2: cd agent-dashboard && npm run dev"
echo "  Terminal 3: node test.js"
echo ""
echo "Open http://localhost:3000 to see the dashboard"
