# AgentPay - Complete Setup Guide

**AgentPay** is a plug-and-play micropayment infrastructure for AI agents. This guide will walk you through setting up the entire system.

## 🏗️ Architecture Overview

```
┌─────────────────┐
│  Agent SDK      │  (Node.js client)
│  TypeScript     │
└────────┬────────┘
         │ HTTP + API Key
         ▼
┌─────────────────────────────────────┐
│  Backend (Node.js + Express)        │
│  - Identity verification            │
│  - Tool usage metering              │
│  - Solana micropayments             │
└────────┬────────┬──────────┬────────┘
         │        │          │
         │        ▼          ▼
         │    PostgreSQL   Solana
         │
         ▼
┌─────────────────────────────────────┐
│  Dashboard (Next.js + React)        │
│  - View usage logs                  │
│  - View payment receipts            │
│  - Monitor agents                   │
└─────────────────────────────────────┘
```

## 📋 Prerequisites

### Docker Setup (Recommended)

- **Docker** 20.10+ and **Docker Compose** 2.0+
- **Git** for version control

### Manual Setup (Alternative)

- **Node.js** v18+ and npm v9+
- **PostgreSQL** 14+ running and accessible
- **Solana CLI** (optional, for generating keypairs)
- **Git** for version control

### Verify Installation

**Docker:**

```bash
docker --version
docker compose version
```

**Manual:**

```bash
node --version
npm --version
psql --version
```

## 🚀 Quick Start with Docker Compose (Recommended)

### Step 1: Create Environment Files

Each service uses its own `.env` file. Create them from the sample files:

**Backend** (`agent-backend/.env`):
```bash
cp agent-backend/env.sample agent-backend/.env
```

Edit `agent-backend/.env` and update:
- `SOLANA_PAYER_SECRET`: Your actual Solana keypair array
- `AGENTPAY_API_KEY`: Your API key
- `JWT_SECRET`: A random string (min 32 characters)
- `DATABASE_URL`: Leave as-is (will be overridden by docker-compose to use service name)

**Dashboard** (`agent-dashboard/.env`):
```bash
cp agent-dashboard/env.sample agent-dashboard/.env
```

Edit `agent-dashboard/.env`:
- `NEXT_PUBLIC_BACKEND_URL`: Should be `http://localhost:3001` (for browser access)

**Note:** Docker Compose will automatically override `DATABASE_URL` in the backend to use the `postgres` service name instead of `localhost`.

**Important:** Replace `SOLANA_PAYER_SECRET` with your actual Solana keypair array. Generate one with:

```bash
solana-keygen new --outfile payer.json
cat payer.json
```

### Step 2: Build and Start Services

```bash
docker compose up --build
```

This will:

- Start PostgreSQL database
- Initialize database schema automatically
- Build and start the backend API
- Build and start the dashboard

### Step 3: Access the Services

- **Backend API**: http://localhost:3001
- **Dashboard**: http://localhost:3000
- **PostgreSQL**: localhost:5432 (user: `postgres`, password: `password`, db: `agentpay`)

### Step 4: Build SDK (for local development)

If you're developing with the SDK locally:

```bash
cd agent-sdk
npm install
npm run build
```

### Step 5: Run Tests

```bash
node test.js
```

### Docker Commands

**Stop all services:**

```bash
docker compose down
```

**Stop and remove volumes (clears database):**

```bash
docker compose down -v
```

**View logs:**

```bash
docker compose logs -f
```

**View specific service logs:**

```bash
docker compose logs -f backend
docker compose logs -f dashboard
docker compose logs -f postgres
```

**Rebuild after code changes:**

```bash
docker compose up --build
```

## 🔧 Manual Setup (Alternative)

### Step 1: Install Dependencies

```bash
# Install backend
cd agent-backend
npm install

# Install SDK
cd ../agent-sdk
npm install

# Install dashboard
cd ../agent-dashboard
npm install
```

### Step 2: Create Environment Files

**Backend** (`agent-backend/.env`):

```bash
cp agent-backend/env.sample agent-backend/.env
```

Edit `agent-backend/.env`:

```
PORT=3001
DATABASE_URL=postgres://postgres:password@localhost:5432/agentpay
SOLANA_RPC=https://api.devnet.solana.com
SOLANA_PAYER_SECRET=[paste your keypair array here]
AGENTPAY_API_KEY=test_key_12345
JWT_SECRET=your_random_secret_string_here
```

**SDK** (`agent-sdk/.env`):

```bash
cp agent-sdk/env.sample agent-sdk/.env
```

Edit `agent-sdk/.env`:

```
AGENT_BACKEND_URL=http://localhost:3001
AGENTPAY_API_KEY=test_key_12345
```

**Dashboard** (`agent-dashboard/.env.local`):

```bash
cp agent-dashboard/env.sample agent-dashboard/.env.local
```

Edit `agent-dashboard/.env.local`:

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

### Step 3: Set Up PostgreSQL Database

**Create the database:**

```bash
psql -U postgres -c "CREATE DATABASE agentpay;"
```

**Initialize the schema:**

```bash
psql -U postgres -d agentpay -f agent-backend/src/db/schema.sql
```

Verify tables were created:

```bash
psql -U postgres -d agentpay -c "\dt"
```

You should see tables: `agents`, `api_keys`, `tool_calls`, `payments`, `developer_usage`

### Step 4: Generate Solana Keypair

```bash
solana-keygen new --outfile payer.json
cat payer.json
```

Copy the JSON array and paste it into `SOLANA_PAYER_SECRET` in your backend `.env` file.

**Note:** For development, use Solana Devnet. Fund your wallet at https://faucet.solana.com

### Step 5: Build the SDK

```bash
cd agent-sdk
npm run build
```

### Step 6: Run the System

**Terminal 1: Backend**

```bash
cd agent-backend
npm run dev
```

**Terminal 2: Dashboard**

```bash
cd agent-dashboard
npm run dev
```

**Terminal 3: Test**

```bash
node test.js
```

## 📡 API Endpoints

All endpoints require the `x-api-key` header with your API key.

### Identity Verification

```bash
curl -X POST http://localhost:3001/verify-identity \
  -H "x-api-key: test_key_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "dob": "1990-01-01",
    "idNumber": "ID123"
  }'
```

Response:

```json
{
  "status": "verified",
  "details": {
    "firstName": "John",
    "lastName": "Doe",
    "dob": "1990-01-01",
    "idNumber": "ID123",
    "verifiedAt": "2025-12-10T10:30:00.000Z"
  }
}
```

### Log Tool Call (Metering)

```bash
curl -X POST http://localhost:3001/meter/log \
  -H "x-api-key: test_key_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent_123",
    "toolName": "summarize",
    "tokensUsed": 150,
    "payload": {"text": "..."}
  }'
```

### Send Micropayment

```bash
curl -X POST http://localhost:3001/pay \
  -H "x-api-key: test_key_12345" \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "SENDER_PUBKEY",
    "receiver": "RECEIVER_PUBKEY",
    "lamports": 10000
  }'
```

### Get Tool Logs

```bash
curl http://localhost:3001/meter/logs \
  -H "x-api-key: test_key_12345"
```

### Get Dashboard Usage

```bash
curl http://localhost:3001/dashboard/usage \
  -H "x-api-key: test_key_12345"
```

### Get Payments

```bash
curl http://localhost:3001/pay \
  -H "x-api-key: test_key_12345"
```

## 🔧 Using the SDK

```typescript
import { AgentPayClient } from "./agent-sdk/dist/index.js";

const client = new AgentPayClient({
  apiKey: "test_key_12345",
  baseUrl: "http://localhost:3001",
});

// Verify identity
await client.verifyIdentity({
  firstName: "John",
  lastName: "Doe",
  dob: "1990-01-01",
  idNumber: "ID123",
});

// Log tool usage
await client.logToolCall("agent_id", "tool_name", 100, { extra: "data" });

// Send payment
const { signature } = await client.payAgent(
  "sender_pubkey",
  "receiver_pubkey",
  10000
);
```

## 📊 Dashboard Features

Visit http://localhost:3000 to see:

- **Usage Page** (`/usage`): Tool calls and spending per agent
- **Receipts Page** (`/receipts`): Micropayment transaction history
- **Login Page** (`/login`): Save API key (for future auth)

## 🧪 Testing

### Unit Tests

Run individual endpoints with curl (see API Endpoints section above).

### End-to-End Test

```bash
node test.js
```

This runs through all three major operations: identity, metering, and payments.

### Load Testing

You can create a simple load test script:

```javascript
// load-test.js
import { AgentPayClient } from "./agent-sdk/dist/index.js";

const client = new AgentPayClient({
  apiKey: "test_key_12345",
  baseUrl: "http://localhost:3001",
});

async function loadTest(concurrent = 10) {
  const promises = [];
  for (let i = 0; i < concurrent; i++) {
    promises.push(
      client.logToolCall(`agent_${i}`, `tool_${i}`, Math.random() * 500)
    );
  }
  await Promise.all(promises);
  console.log(`Completed ${concurrent} requests`);
}

loadTest(50);
```

## 📁 Project Structure

```
monocle/
├── agent-backend/           # Express server + Solana integration
│   ├── src/
│   │   ├── app.ts          # Main server
│   │   ├── db/
│   │   │   ├── client.ts   # PostgreSQL pool
│   │   │   └── schema.sql  # Database schema
│   │   ├── middleware/
│   │   │   └── apiKeyAuth.ts  # API key validation
│   │   ├── routes/
│   │   │   ├── identity.ts
│   │   │   ├── meter.ts
│   │   │   ├── payments.ts
│   │   │   └── analytics.ts
│   │   └── services/
│   │       ├── identityService.ts
│   │       ├── meterService.ts
│   │       └── solanaService.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── env.sample
│
├── agent-sdk/              # TypeScript client library
│   ├── src/
│   │   ├── client.ts       # Main AgentPayClient class
│   │   ├── types.ts
│   │   ├── identity.ts
│   │   ├── metering.ts
│   │   ├── payments.ts
│   │   └── index.ts
│   ├── dist/               # Compiled output
│   ├── package.json
│   ├── tsconfig.json
│   └── env.sample
│
├── agent-dashboard/        # Next.js dashboard
│   ├── pages/
│   │   ├── _app.tsx
│   │   ├── usage.tsx
│   │   ├── receipts.tsx
│   │   └── login.tsx
│   ├── lib/
│   │   └── api.ts
│   ├── components/
│   │   ├── Charts.tsx
│   │   └── Table.tsx
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   └── env.sample
│
├── test.js                 # End-to-end test harness
├── docker-compose.yml      # Docker Compose configuration
├── .env                    # Environment variables (create from samples)
└── README.md
```

## 🚨 Troubleshooting

### Docker Issues

**"Cannot connect to database"**

- Check postgres container is healthy: `docker compose ps`
- View postgres logs: `docker compose logs postgres`
- Verify database initialized: `docker compose exec postgres psql -U postgres -d agentpay -c "\dt"`

**"Backend container keeps restarting"**

- Check logs: `docker compose logs backend`
- Verify `.env` file exists in root directory
- Ensure `SOLANA_PAYER_SECRET` is set correctly in `.env`

**"Dashboard not loading"**

- Check dashboard logs: `docker compose logs dashboard`
- Verify backend is running: `docker compose ps`
- Try rebuilding: `docker compose up --build dashboard`

**"Port already in use"**

- Stop conflicting services or change ports in `docker-compose.yml`
- Check what's using the port: `lsof -i :3000` or `lsof -i :3001`

**"Changes not reflecting after rebuild"**

- Rebuild without cache: `docker compose build --no-cache`
- Restart services: `docker compose restart`

### Manual Setup Issues

**"Cannot find module 'pg'"**

```bash
cd agent-backend
npm install pg @types/pg
```

**"Cannot find module 'express'"**

```bash
cd agent-backend
npm install express @types/express
```

**"Cannot connect to PostgreSQL"**

- Verify PostgreSQL is running: `psql -U postgres -c "SELECT version();"`
- Check DATABASE_URL in `.env`: `postgres://user:password@localhost:5432/dbname`
- Ensure database exists: `psql -U postgres -l | grep agentpay`

**"SDK dist folder not found"**

```bash
cd agent-sdk
npm run build
```

**"Dashboard not loading at localhost:3000"**

- Check Next.js is running: `npm run dev` in `agent-dashboard`
- Clear Next.js cache: `rm -rf .next`
- Restart the dev server

**"API returns 401 Unauthorized"**

- Ensure `x-api-key` header is set in requests
- Verify header value matches `AGENTPAY_API_KEY` in backend `.env` or root `.env`
- Check request headers with curl: `curl -v http://localhost:3001/meter/logs`

**"Solana transaction fails"**

- Verify `SOLANA_PAYER_SECRET` is a valid keypair array
- Fund devnet wallet: https://faucet.solana.com
- Check RPC endpoint is reachable: `curl https://api.devnet.solana.com`

## 📚 Further Development

### Adding Custom Tools

1. Create a new service in `agent-backend/src/services/`
2. Add a route in `agent-backend/src/routes/`
3. Update SDK client in `agent-sdk/src/client.ts`
4. Add dashboard page in `agent-dashboard/pages/`

### Database Migrations

Add new SQL files in `agent-backend/src/db/migrations/` and run them:

```bash
psql -U postgres -d agentpay -f agent-backend/src/db/migrations/001_new_table.sql
```

### Production Deployment

- Use environment variables, not `.env` files
- Enable HTTPS (use reverse proxy like nginx)
- Configure CORS properly
- Use connection pooling for PostgreSQL
- Set up CI/CD with GitHub Actions
- Use managed Solana RPC (QuickNode, Alchemy, etc.)

## 💡 Key Design Principles

1. **Modular**: Each component (SDK, backend, dashboard) is independent
2. **Type-Safe**: Full TypeScript support throughout
3. **Error Resilient**: Automatic retries in SDK, error handling in routes
4. **Stateless**: Backend can scale horizontally
5. **Mock Mode**: Works without database/Solana for development

## 🤝 Contributing

1. Make changes to code
2. Test locally with `npm run dev` and `node test.js`
3. Ensure no TypeScript errors: each module has `npm run build`
4. Commit with clear messages

## 📄 License

MIT
