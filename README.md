# AgentPay - AI Agent Micropayment Infrastructure

A complete plug-and-play system for AI agents to verify identity, meter tool usage, and execute Solana micropayments.

## 🚀 One-Button Setup (Docker)

**Start everything with a single command:**

```bash
docker-compose up
```

That's it! This will:
- ✅ Start PostgreSQL database
- ✅ Initialize database schema automatically
- ✅ Start backend API on port 3001
- ✅ Start dashboard on port 3000
- ✅ Wire everything together

### First Time Setup

1. **Optional: Set environment variables** (or use defaults):
   ```bash
   cp .env.example .env
   # Edit .env with your Solana payer secret if needed
   ```

2. **Start the stack:**
   ```bash
   docker-compose up
   ```

3. **Access the services:**
   - Dashboard: http://localhost:3000
   - Backend API: http://localhost:3001
   - Database: localhost:5432

### Stop Everything

```bash
docker-compose down
```

### View Logs

```bash
docker-compose logs -f
```

### Reset Everything (Fresh Start)

```bash
docker-compose down -v  # Removes volumes (database data)
docker-compose up
```

---

## 📦 Manual Setup (Without Docker)

If you prefer to run services manually:

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Docker (optional, for containerized setup)

### Backend Setup

```bash
cd agent-backend
npm install
cp env.sample .env
# Edit .env with your values
npm run dev
```

### Dashboard Setup

```bash
cd agent-dashboard
npm install
cp env.sample .env
npm run dev
```

### Database Setup

```bash
psql $DATABASE_URL -f agent-backend/src/db/schema.sql
```

---

## 🧪 Testing

### Quick Test (After Docker Setup)

```bash
# Test identity verification
curl -X POST http://localhost:3001/verify-identity \
  -H "Content-Type: application/json" \
  -H "x-api-key: test_dev_key_123" \
  -d '{"firstName":"John","lastName":"Doe","dob":"1990-01-01","idNumber":"ID123"}'

# Test meter logging
curl -X POST http://localhost:3001/meter/log \
  -H "Content-Type: application/json" \
  -H "x-api-key: test_dev_key_123" \
  -d '{"agentId":"agent_123","toolName":"summary","tokensUsed":42}'
```

### SDK Test

```bash
cd agent-sdk
npm install && npm run build
cd ..
node test.js
```

---

## 📁 Project Structure

```
monocle/
├── agent-backend/     # Express API + Postgres + Solana
├── agent-sdk/         # TypeScript SDK for developers
├── agent-dashboard/   # Next.js dashboard
├── docker-compose.yml # One-button orchestration
└── test.js           # End-to-end test harness
```

---

## 🔑 Environment Variables

### Backend (.env)
- `PORT` - API port (default: 3001)
- `DATABASE_URL` - Postgres connection string
- `SOLANA_RPC` - Solana RPC endpoint
- `SOLANA_PAYER_SECRET` - JSON array of payer keypair
- `JWT_SECRET` - JWT signing secret
- `AGENTPAY_API_KEY` - API key for authentication

### Dashboard (.env)
- `NEXT_PUBLIC_BACKEND_URL` - Backend API URL

### SDK (.env)
- `AGENT_BACKEND_URL` - Backend API URL
- `AGENTPAY_API_KEY` - Your API key

---

## 🎯 API Endpoints

- `POST /verify-identity` - Verify agent identity
- `POST /meter/log` - Log tool usage
- `GET /meter/logs` - Get usage logs
- `POST /pay` - Execute Solana micropayment
- `GET /pay` - Get payment history

All endpoints require `x-api-key` header.

---

## 📚 SDK Usage

```typescript
import { AgentPayClient } from "agent-sdk";

const client = new AgentPayClient({
  apiKey: process.env.AGENTPAY_API_KEY!,
  baseUrl: process.env.AGENT_BACKEND_URL!
});

// Verify identity
await client.verifyIdentity({
  firstName: "John",
  lastName: "Doe",
  dob: "1990-01-01",
  idNumber: "ID123"
});

// Log tool usage
await client.logToolCall("agent_123", "summary", 42);

// Send payment
await client.payAgent(senderWallet, receiverWallet, 10000);
```

---

## 🐳 Docker Details

The `docker-compose.yml` orchestrates:
- **postgres**: Database with auto-initialized schema
- **backend**: Node.js API server
- **dashboard**: Next.js frontend

All services are networked together and start in the correct order.

---

## 🛠️ Development

### Rebuild After Code Changes

```bash
docker-compose up --build
```

### Run Individual Services

```bash
docker-compose up postgres backend  # Just DB + API
docker-compose up dashboard         # Just dashboard
```

---

## 📝 License

MIT
