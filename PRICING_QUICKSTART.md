# AgentPay Pricing System - Developer Quick Start

---

## What Is AgentPay?

AgentPay is a **deterministic micropayment system** for autonomous AI agents. Agents pay each other per execution using measurable compute units (tokens) and on-chain settlement.

**Key Innovation:** No trust required. No invoices. Costs are calculated deterministically, balances are enforced immediately, and settlement is automatic.

---

## Core Concepts

### 1. Pricing Formula

```
cost_lamports = max(ceil((tokens_used / 1000) × agent_rate), MIN_COST)
```

**Example:**
- Agent B has rate = 1000 lamports per 1k tokens
- Agent A calls B with 500 tokens
- Cost = max(ceil(0.5 × 1000), 100) = **500 lamports**

### 2. Payment Flow

```
Agent A                    Agent B
  │                          │
  ├─ Cost calculated ────────┤
  │  (deterministic)         │
  │                          │
  ├─ Balance checked ────────┤
  │  (no debt allowed)       │
  │                          │
  ├─ A.balance -= cost ─────┤
  │  B.pending += cost       │
  │  (atomic transaction)    │
  │                          │
  ├─ Immutable record ──────┤
  │  (tool_usage ledger)     │
  │                          │
  └─ Settlement triggered ──┤
     (when B.pending >= threshold)
```

### 3. Settlement

When an agent's pending balance exceeds the minimum threshold (10,000 lamports):

```
pending_lamports = 100,000
platform_fee = pending × 5% = 5,000
payout = pending - fee = 95,000

→ Solana transaction sent
→ On confirmation: pending_lamports = 0
→ Platform fee recorded
```

---

## API Endpoints

### Meter (Tool Execution)

**Execute a tool call with pricing:**
```bash
POST /meter/execute
Content-Type: application/json

{
  "callerId": "agent_123",
  "calleeId": "agent_456",
  "toolName": "summarize",
  "tokensUsed": 500
}

Response:
{
  "callerId": "agent_123",
  "calleeId": "agent_456",
  "toolName": "summarize",
  "tokensUsed": 500,
  "costLamports": 500
}
```

**Get agent metrics:**
```bash
GET /meter/metrics/:agentId

Response:
{
  "agentId": "agent_123",
  "ratePer1kTokens": 1000,
  "balanceLamports": 50000,
  "pendingLamports": 10000,
  "usage": {
    "callCount": 5,
    "totalSpend": 3000
  },
  "earnings": {
    "callCount": 3,
    "totalEarned": 5000
  }
}
```

### Payments (Settlement & Settlement)

**Trigger settlement:**
```bash
POST /payments/settle/:agentId

Response:
{
  "settlementId": "uuid",
  "agentId": "agent_456",
  "pending": 100000,
  "platformFee": 5000,
  "payout": 95000,
  "txSignature": "solana_tx_signature",
  "status": "confirmed"
}
```

**Top up agent balance (development only):**
```bash
POST /payments/topup
Content-Type: application/json

{
  "agentId": "agent_123",
  "amountLamports": 100000
}

Response:
{
  "agentId": "agent_123",
  "amountAdded": 100000,
  "newBalance": 150000,
  "pendingBalance": 5000
}
```

---

## Running Tests

### Unit Tests (No DB Required)

```bash
cd agent-backend
node src/tests/pricing-unit-test.js
```

**Output:**
```
======================================================================
    AGENTPAY PRICING LOGIC - UNIT TEST SUITE
======================================================================

[TEST 1] Determinism: Same inputs = Same cost
  ✅ Determinism verified: 500 tokens @ 1000 rate = 500 lamports

[TEST 2] Ceil rounding for tokens
  ✅ All rounding tests passed

...

======================================================================
RESULTS: 10 passed, 0 failed
======================================================================

✨ ALL TESTS PASSED ✨
```

### E2E Tests (Requires Backend Running)

```bash
# Terminal 1: Start backend
cd agent-backend
npm run dev

# Terminal 2: Run e2e tests
npx ts-node-dev src/tests/e2e-pricing.ts
```

---

## Database Schema

### Agents Table

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT,
  rate_per_1k_tokens BIGINT,      -- Agent's fixed price
  balance_lamports BIGINT,         -- Available balance
  pending_lamports BIGINT,         -- Waiting for settlement
  created_at TIMESTAMPTZ
);
```

**Example:**
```sql
INSERT INTO agents (id, name, rate_per_1k_tokens, balance_lamports, pending_lamports)
VALUES (
  'agent_abc123',
  'My Summarizer Agent',
  1000,              -- 1000 lamports per 1k tokens
  100000,            -- 100k lamports available
  0                  -- 0 pending
);
```

### Tool Usage Ledger (Immutable)

```sql
CREATE TABLE tool_usage (
  id UUID PRIMARY KEY,
  caller_agent_id TEXT,
  callee_agent_id TEXT,
  tool_name TEXT,
  tokens_used INTEGER,
  rate_per_1k_tokens BIGINT,     -- Frozen at execution time
  cost_lamports BIGINT,          -- Final cost
  created_at TIMESTAMPTZ
);
```

---

## Anti-Abuse Constraints

| Constraint | Value | Purpose |
|-----------|-------|---------|
| `MIN_COST_LAMPORTS` | 100 | Prevents spam (every call costs at least 100 lamports) |
| `MAX_TOKENS_PER_CALL` | 100,000 | Prevents runaway execution |
| `PLATFORM_FEE_PERCENT` | 0.05 (5%) | Platform revenue |
| `MIN_PAYOUT_LAMPORTS` | 10,000 | Settlement threshold |

---

## Integration Example

### Step 1: Create an Agent

```typescript
import { query } from "./db/client.js";

await query(
  `INSERT INTO agents (id, name, rate_per_1k_tokens, balance_lamports, pending_lamports)
   VALUES ($1, $2, $3, $4, $5)`,
  ["agent_alice", "Alice's Agent", 1000, 100_000, 0]
);
```

### Step 2: Execute a Tool Call

```typescript
import { logToolCall } from "./services/meterService.js";

const result = await logToolCall(
  "agent_alice",      // caller
  "agent_bob",        // callee
  "summarize",        // tool name
  500                 // tokens used
);

console.log(`Cost: ${result.costLamports} lamports`);
// Output: Cost: 500 lamports
```

### Step 3: Check Agent Metrics

```typescript
import { getAgentMetrics } from "./services/pricingService.js";

const metrics = await getAgentMetrics("agent_alice");
console.log(metrics);
// {
//   agentId: "agent_alice",
//   ratePer1kTokens: 1000,
//   balanceLamports: 99500,    // 100k - 500
//   pendingLamports: 0,
//   usage: { callCount: 1, totalSpend: 500 },
//   earnings: { callCount: 0, totalEarned: 0 }
// }
```

### Step 4: Trigger Settlement

```typescript
import { settleAgent } from "./services/pricingService.js";
import { sendMicropayment } from "./services/solanaService.js";

const result = await settleAgent("agent_bob", sendMicropayment);
console.log(result);
// {
//   settlementId: "uuid",
//   agentId: "agent_bob",
//   pending: 500,
//   platformFee: 25,
//   payout: 475,
//   txSignature: "solana_signature",
//   status: "confirmed"
// }
```

---

## Troubleshooting

### Error: "Insufficient balance"
**Cause:** Agent tried to call another agent but didn't have enough lamports.
**Solution:** Top up agent balance via `/payments/topup`.

### Error: "Agent not found"
**Cause:** Agent ID doesn't exist in the database.
**Solution:** Create the agent first via SQL or identity service.

### Error: "Tokens used exceeds maximum"
**Cause:** Call exceeded `MAX_TOKENS_PER_CALL` (100,000).
**Solution:** Split large operations into multiple calls.

### Settlement not triggered
**Cause:** Pending balance is below `MIN_PAYOUT_LAMPORTS` (10,000).
**Solution:** Wait for more transactions to accumulate, or manually settle if needed.

---

## Key Files

| File | Purpose |
|------|---------|
| `agent-backend/src/services/pricingService.ts` | Core pricing logic |
| `agent-backend/src/services/meterService.ts` | Tool call integration |
| `agent-backend/src/routes/meter.ts` | Meter API endpoints |
| `agent-backend/src/routes/payments.ts` | Payment API endpoints |
| `agent-backend/src/db/schema.sql` | Database schema |
| `agent-backend/src/tests/pricing-unit-test.js` | Unit tests |
| `agent-backend/src/tests/e2e-pricing.ts` | E2E tests |

---

## Support

- **Questions?** Check the TEST_REPORT.md for detailed validation results
- **Issues?** Review the pricingService.ts comments for implementation details
- **Integration?** Use the API endpoints documented above

---

**Happy building!** 🚀
