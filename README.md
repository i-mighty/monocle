# AgentPay 💳

**A plug-and-play micropayment infrastructure for AI agents operating on-chain.**

AgentPay solves three critical problems for AI agents:

1. **Trust** - Verify user identity before any transactions
2. **Metering** - Log every tool usage and track costs accurately
3. **Payments** - Execute instant Solana-based micropayments automatically

```
AI Agent → SDK → Backend → Solana Blockchain
                ↓
             PostgreSQL (metering logs)
                ↓
             Dashboard (monitoring)
```

## 🎯 Features

✅ **Identity Verification (KYC-lite)** - Verify users before enabling payments  
✅ **Tool Usage Metering** - Log every AI tool call with token counts and costs  
✅ **Solana Micropayments** - Send instant, cheap payments to agents  
✅ **Dashboard** - Monitor agent activity and payment history  
✅ **TypeScript SDK** - Type-safe client library for agents  
✅ **Mock Mode** - Works without database/Solana for development  
✅ **Error Resilient** - Automatic retries and graceful fallbacks  

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm 9+

### Installation

```bash
# Clone this repository (you're already in it)

# Option 1: Automated setup (Unix/Mac)
bash setup.sh

# Option 2: Automated setup (Windows)
setup.bat

# Option 3: Manual setup
cd agent-backend && npm install
cd ../agent-sdk && npm install && npm run build
cd ../agent-dashboard && npm install
```

### Configuration

1. Create environment files:
   ```bash
   cp agent-backend/env.sample agent-backend/.env
   cp agent-sdk/env.sample agent-sdk/.env
   cp agent-dashboard/env.sample agent-dashboard/.env.local
   ```

2. Edit `agent-backend/.env` with your settings:
   ```
   DATABASE_URL=postgres://postgres:password@localhost:5432/agentpay
   SOLANA_RPC=https://api.devnet.solana.com
   SOLANA_PAYER_SECRET=[your_keypair_array]
   AGENTPAY_API_KEY=test_key_12345
   ```

3. Create PostgreSQL database:
   ```bash
   psql -U postgres -c "CREATE DATABASE agentpay;"
   psql -U postgres -d agentpay -f agent-backend/src/db/schema.sql
   ```

### Run

Open three terminal windows:

**Terminal 1 - Backend:**
```bash
cd agent-backend
npm run dev
```

**Terminal 2 - Dashboard:**
```bash
cd agent-dashboard
npm run dev
```

**Terminal 3 - Test:**
```bash
node test.js
```

### Access

- **Dashboard**: http://localhost:3000
- **API**: http://localhost:3001
- **Test Output**: Shows in terminal

## 📚 Documentation

- **[SETUP.md](./SETUP.md)** - Complete setup and configuration guide
- **[IMPLEMENTATION.md](./IMPLEMENTATION.md)** - Implementation checklist
- **[API Reference](#api-reference)** - REST endpoints below

## 🔌 Using the SDK

```typescript
import { AgentPayClient } from "./agent-sdk/dist/index.js";

const client = new AgentPayClient({
  apiKey: "test_key_12345",
  baseUrl: "http://localhost:3001"
});

// 1. Verify user identity
await client.verifyIdentity({
  firstName: "John",
  lastName: "Doe",
  dob: "1990-01-01",
  idNumber: "ID123"
});

// 2. Log tool usage
await client.logToolCall("agent_id", "summarize", 150, {
  text: "Hello world"
});

// 3. Send micropayment
const { signature } = await client.payAgent(
  "SENDER_PUBKEY",
  "RECEIVER_PUBKEY",
  10000 // lamports
);
```

## 📡 API Reference

### Identity Verification
```bash
POST /verify-identity
x-api-key: test_key_12345

{
  "firstName": "John",
  "lastName": "Doe",
  "dob": "1990-01-01",
  "idNumber": "ID123"
}
```

### Log Tool Usage
```bash
POST /meter/log
x-api-key: test_key_12345

{
  "agentId": "agent_123",
  "toolName": "summarize",
  "tokensUsed": 150,
  "payload": { "text": "..." }
}
```

### Send Payment
```bash
POST /pay
x-api-key: test_key_12345

{
  "sender": "SENDER_PUBKEY",
  "receiver": "RECEIVER_PUBKEY",
  "lamports": 10000
}
```

### Get Logs
```bash
GET /meter/logs
x-api-key: test_key_12345
```

### Get Receipts
```bash
GET /pay
x-api-key: test_key_12345
```

### Get Usage Stats
```bash
GET /dashboard/usage
x-api-key: test_key_12345
```

## 🏗️ Project Structure

```
monocle/
├── agent-backend/        # Node.js + Express + Solana
├── agent-sdk/           # TypeScript client library
├── agent-dashboard/     # Next.js + React UI
├── test.js             # End-to-end test
├── SETUP.md            # Detailed setup guide
├── IMPLEMENTATION.md   # What's been built
├── setup.sh            # Linux/Mac setup
└── setup.bat           # Windows setup
```

## 🧪 Testing

**End-to-end test** (after all components are running):
```bash
node test.js
```

Expected output:
```
✅ Identity verified
✅ Meter logged
⚠️  Payment endpoint responded (error expected with invalid keys)
✨ All tests completed!
```

## 🚨 Troubleshooting

**Backend won't start:**
```bash
# Check if port 3001 is in use
lsof -i :3001

# Clear build and reinstall
rm -rf dist node_modules
npm install
npm run build
```

**Dashboard not loading:**
```bash
# Clear Next.js cache
rm -rf .next

# Restart
npm run dev
```

**Database connection error:**
```bash
# Verify PostgreSQL is running
psql -U postgres -c "SELECT 1;"

# Check DATABASE_URL in .env
# Format: postgres://user:password@localhost:5432/dbname
```

See **[SETUP.md](./SETUP.md)** for more troubleshooting tips.

## 🔐 Security Notes

⚠️ **Development Only**: The current implementation is for development. For production:

- Use environment variables instead of .env files
- Enable HTTPS (use reverse proxy)
- Configure CORS properly
- Use managed Solana RPC endpoints
- Implement proper authentication (OAuth, JWT)
- Audit smart contract interactions
- Rate limit API endpoints
- Monitor database performance

## 📦 What's Included

✅ Complete REST API  
✅ TypeScript SDK with retry logic  
✅ React dashboard with real-time updates  
✅ PostgreSQL schema with indexes  
✅ Solana integration  
✅ Error handling and logging  
✅ Docker-ready (can be added)  
✅ 100% TypeScript compilation  

## 🤝 Contributing

1. Make changes
2. Test locally with `npm run dev` + `node test.js`
3. Verify no TypeScript errors: `npm run build`
4. Commit with clear messages

## 📄 License

MIT

## 🚀 What's Next

- [ ] Implement JWT-based authentication
- [ ] Add database migrations system
- [ ] Create Solana program for advanced transactions
- [ ] Add Docker support
- [ ] Create Kubernetes manifests
- [ ] Add unit tests with Jest
- [ ] Add API rate limiting
- [ ] Implement caching with Redis
- [ ] Create admin panel

---

**Built with ❤️ for AI agents**

Questions? Check [SETUP.md](./SETUP.md) or [IMPLEMENTATION.md](./IMPLEMENTATION.md)
