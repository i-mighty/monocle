@echo off
REM Quick setup script for AgentPay (Windows)

echo.
echo 🚀 AgentPay Quick Setup
echo =====================

echo.
echo 📦 Installing dependencies...
cd agent-backend
call npm install
cd ..

cd agent-sdk
call npm install
call npm run build
cd ..

cd agent-dashboard
call npm install
cd ..

echo.
echo 📝 Creating .env files...

if not exist agent-backend\.env (
  copy agent-backend\env.sample agent-backend\.env
  echo ✅ Created agent-backend\.env - please edit with your settings
)

if not exist agent-sdk\.env (
  copy agent-sdk\env.sample agent-sdk\.env
  echo ✅ Created agent-sdk\.env
)

if not exist agent-dashboard\.env.local (
  copy agent-dashboard\env.sample agent-dashboard\.env.local
  echo ✅ Created agent-dashboard\.env.local
)

echo.
echo ✨ Setup complete!
echo.
echo Next steps:
echo 1. Edit agent-backend\.env with your database URL and Solana settings
echo 2. Create PostgreSQL database: psql -U postgres -c "CREATE DATABASE agentpay;"
echo 3. Initialize schema: psql -U postgres -d agentpay -f agent-backend\src\db\schema.sql
echo.
echo Then run (in separate terminals):
echo   Terminal 1: cd agent-backend ^&^& npm run dev
echo   Terminal 2: cd agent-dashboard ^&^& npm run dev
echo   Terminal 3: node test.js
echo.
echo Open http://localhost:3000 to see the dashboard
echo.
pause
