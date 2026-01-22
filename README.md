# AgentPay - AI Agent Micropayment Infrastructure

A complete plug-and-play system for AI agents to verify identity, meter tool usage, and execute Solana micropayments. **Built on the x402 protocol for HTTP-native machine-to-machine payments.**

## 🔌 x402 Protocol Support

AgentPay implements the **x402 protocol** - an HTTP-native payment standard for AI agents:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          x402 Payment Flow                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   AI Agent                          AgentPay Server                     │
│      │                                    │                             │
│      │──── 1. Request protected ──────────▶│                             │
│      │         resource                   │                             │
│      │                                    │                             │
│      │◀─── 2. HTTP 402 + payment ─────────│                             │
│      │         requirements               │                             │
│      │                                    │                             │
│      │──── 3. Solana payment ─────────────▶│  ┌──────────┐              │
│      │                                    │  │ Solana   │              │
│      │                                    │──▶│ Network  │              │
│      │                                    │  └──────────┘              │
│      │──── 4. Retry with payment ─────────▶│                             │
│      │         proof headers              │                             │
│      │                                    │                             │
│      │◀─── 5. 200 OK + resource ──────────│                             │
│      │                                    │                             │
└─────────────────────────────────────────────────────────────────────────┘
```

### x402 Headers

**Request (Payment Proof):**
```
X-Payment-Signature: <solana_tx_signature>
X-Payment-Payer: <wallet_address>
X-Payment-Amount: <lamports>
X-Payment-Nonce: <server_nonce>
```

**Response (Payment Required):**
```
HTTP/1.1 402 Payment Required
X-Payment-Required: true
X-Payment-Amount: 2000
X-Payment-Recipient: <wallet_address>
X-Payment-Network: solana-devnet
X-Payment-Expires: 2026-01-22T12:00:00Z
X-Payment-Nonce: abc123
```

### Try x402

```bash
# Get x402 protocol info
curl http://localhost:3001/x402/info

# Simulate x402 payment flow
curl -X POST http://localhost:3001/x402/simulate \
  -H "Content-Type: application/json" \
  -d '{"tokens": 1500}'

# Request a quote (returns 402)
curl -X POST http://localhost:3001/x402/quote \
  -H "Content-Type: application/json" \
  -d '{"agentId":"agent_1","toolName":"summarize","estimatedTokens":1000}'
```

---

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

### Identity & Metering
- `POST /verify-identity` - Verify agent identity
- `POST /meter/log` - Log tool usage
- `GET /meter/logs` - Get usage logs
- `POST /pay` - Execute Solana micropayment
- `GET /pay` - Get payment history

### x402 Protocol
- `GET /x402/info` - Protocol information & capabilities
- `GET /x402/pricing` - Current pricing model
- `POST /x402/quote` - Get payment quote (returns 402)
- `POST /x402/execute` - Execute with x402 payment
- `POST /x402/verify` - Verify payment signature
- `POST /x402/simulate` - Simulate payment flow
- `GET /x402/demo-resource` - Demo protected resource

### Agents & Pricing
- `POST /agents/register` - Register agent
- `GET /agents/:id` - Get agent details
- `PATCH /agents/:id/pricing` - Update pricing rate
- `GET /agents/:id/metrics` - Agent metrics
- `POST /agents/quote` - Price quote
- `GET /pricing/constants` - Pricing constants
- `POST /pricing/calculate` - Calculate cost

All endpoints require `x-api-key` header (except /x402/info).

---

## 📚 SDK Usage

```typescript
import { AgentPayClient, X402Client, createX402Client } from "agent-sdk";
import { Keypair } from "@solana/web3.js";

// Standard client
const client = new AgentPayClient({
  apiKey: process.env.AGENTPAY_API_KEY!,
  baseUrl: process.env.AGENT_BACKEND_URL!,
});

// Verify identity
await client.verifyIdentity({
  firstName: "John",
  lastName: "Doe",
  dob: "1990-01-01",
  idNumber: "ID123",
});

// Log tool usage
await client.logToolCall("agent_123", "summary", 42);

// Get x402 info
const info = await client.getX402Info();
```

### x402 Client (Auto-Payment)

```typescript
import { X402Client } from "agent-sdk";
import { Keypair, Connection } from "@solana/web3.js";

// Create x402 client with your Solana keypair
const x402 = new X402Client({
  keypair: Keypair.fromSecretKey(yourSecretKey),
  connection: new Connection("https://api.devnet.solana.com"),
  maxPaymentPerRequest: 100_000, // Max 100k lamports per request
  autoPayEnabled: true,          // Auto-pay 402 responses
});

// Make request - automatically handles 402 + payment + retry
const result = await x402.post(
  "http://localhost:3001/x402/execute",
  {
    callerId: "my-agent",
    calleeId: "tool-provider",
    toolName: "summarize",
    tokensUsed: 1500,
  }
);

if (result.success) {
  console.log("Execution succeeded:", result.data);
  console.log("Payment made:", result.payment);
} else if (result.paymentRequired) {
  console.log("Payment required:", result.paymentRequired);
}
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
