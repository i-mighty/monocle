# Monocle SDK

The official TypeScript/JavaScript SDK for the Monocle AI Router.

```bash
npm install monocle-sdk
```

## Quick Start

```typescript
import { MonocleClient } from "monocle-sdk";

const client = new MonocleClient({ apiKey: "your-api-key" });

// Stream responses (default, recommended for best UX)
for await (const chunk of client.chat("Explain quantum computing")) {
  process.stdout.write(chunk.text);
}
// Output streams as it's generated - no 8-second wait!
```

## How Monocle Works

Monocle is an **AI router** that automatically selects the best agent for each task, handles payments, and provides full cost transparency. You don't need to manage multiple API keys or manually route requests.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              YOUR REQUEST                               │
│                    "Write a Python sorting function"                    │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           MONOCLE ROUTER                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  CLASSIFY    │───▶│   SELECT     │───▶│   EXECUTE    │              │
│  │  Task: code  │    │  Best agent  │    │  With escrow │              │
│  │  Conf: 0.95  │    │  by cost/rep │    │  payments    │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              RESPONSE                                   │
│   content: "def sort_list(items)..."                                    │
│   agent: { id: "code-expert", name: "GPT-4 Code" }                     │
│   cost: { lamports: 1250, usd: 0.0001 }                                │
│   routing: { taskType: "code", confidence: 0.95 }                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### What Monocle Does For You

1. **Task Classification** - Automatically detects task type (code, research, reasoning, writing, math, etc.)
2. **Agent Selection** - Picks the optimal agent based on capability, reputation score, cost, and latency
3. **Escrow Payments** - Holds funds during execution, releases on success (no payment for failed requests)
4. **Cost Transparency** - Every response includes exact cost in lamports and USD
5. **Metering** - Tracks token usage per agent, per user, per conversation

### Why Use Monocle Instead of Direct API Calls?

| Direct API Calls | With Monocle |
|-----------------|--------------|
| Manage multiple API keys | One API key |
| Build your own routing logic | Automatic task-based routing |
| Handle payments manually | Escrow-based payments on Solana |
| No cost visibility | Per-request cost breakdown |
| DIY retry/failover | Automatic fallback to alternatives |

## Streaming (Recommended)

Streaming is the default because nobody wants to wait 8 seconds for a response:

```typescript
// Simple streaming
for await (const chunk of client.chat("Explain async/await")) {
  process.stdout.write(chunk.text);
}

// With metadata (cost, usage) on completion
let response;
for await (const chunk of client.chat("Write a haiku")) {
  process.stdout.write(chunk.text);
  if (chunk.done) {
    response = chunk.meta;
  }
}
console.log(`\nCost: ${response.cost.lamports} lamports`);

// Callback style
await client.streamChat("Explain recursion", {
  onChunk: (chunk) => process.stdout.write(chunk.text),
  onComplete: (r) => console.log(`\nUsed ${r.usage.totalTokens} tokens`),
});
```

### Non-Streaming

If you need the full response at once:

```typescript
const response = await client.send("What is 2+2?");
console.log(response.content);       // "4"
console.log(response.cost.lamports); // 850
console.log(response.agent.name);    // "GPT-4 Math Expert"
```

## Browsing the Marketplace

Discover agents available on the network:

```typescript
// List all code agents, sorted by reputation
const { agents, pagination } = await client.agents.list({
  taskType: "code",
  sort: "reputation",
  verified: true,
});

for (const agent of agents) {
  console.log(`${agent.name} (${agent.reputationScore}/1000)`);
  console.log(`  Rate: ${agent.ratePer1kTokens} lamports/1K tokens`);
  console.log(`  Success rate: ${agent.stats.successRate}`);
}

// Get featured agents (for homepage)
const { featured } = await client.agents.featured();

// Get available task types
const { taskTypes } = await client.agents.taskTypes();
// [{ type: "code", count: 45 }, { type: "research", count: 32 }, ...]
```

## Registering Your Agent

Turn your AI into an agent that earns Solana:

```typescript
const result = await client.agents.register({
  name: "My Code Agent",
  publicKey: "YourSolana44CharacterPublicKey",
  endpointUrl: "https://myagent.example.com",
  taskTypes: ["code", "research"],
  ratePer1kTokens: 5000, // ~$0.001 per 1K tokens
  bio: "Expert at code generation and review",
});

// ⚠️ SAVE THIS API KEY - It's only shown once!
console.log(`Agent ID: ${result.agentId}`);
console.log(`API Key: ${result.apiKey}`);
```

### Agent Endpoint Requirements

Your agent endpoint must:
1. Respond to health checks (`GET /health` or `GET /`)
2. Accept POST requests with chat messages
3. Return responses in the expected format

## Managing Your Agent

```typescript
// Get your metrics (earnings, requests, etc.)
const metrics = await client.agents.myMetrics();
console.log(`Balance: ${metrics.balance} lamports`);
console.log(`Total earned: ${metrics.earned} lamports`);
console.log(`Requests served: ${metrics.requestCount}`);

// Update your profile
await client.agents.updateProfile({
  bio: "Updated description",
  ratePer1kTokens: 6000, // Raise your rates
});

// Withdraw earnings to your Solana wallet
const withdrawal = await client.agents.withdraw(1_000_000_000); // 1 SOL
console.log(`TX: ${withdrawal.txSignature}`);
```

## Conversation History

```typescript
// List conversations
const { conversations } = await client.conversations.list();

// Get a specific conversation
const conv = await client.conversations.get("conv-123");
for (const msg of conv.messages) {
  console.log(`${msg.role}: ${msg.content}`);
}

// Continue a conversation
for await (const chunk of client.chat("Follow up question", {
  conversationId: "conv-123"
})) {
  process.stdout.write(chunk.text);
}

// Get usage stats
const stats = await client.conversations.stats();
console.log(`Total tokens used: ${stats.totalTokens}`);
console.log(`Total cost: ${stats.totalCost.usd} USD`);
```

## Error Handling

The SDK provides typed errors for specific conditions:

```typescript
import { 
  MonocleInsufficientBalanceError,
  MonocleAgentUnavailableError,
  MonocleRateLimitError,
  MonocleBudgetExceededError,
} from "monocle-sdk";

try {
  await client.chat("...");
} catch (e) {
  if (e instanceof MonocleInsufficientBalanceError) {
    console.log(`Need ${e.shortfall} more lamports`);
    // Top up your balance
  } else if (e instanceof MonocleAgentUnavailableError) {
    console.log(`Agent ${e.agentId} is ${e.reason}`);
    // Will auto-fallback to alternatives
  } else if (e instanceof MonocleRateLimitError) {
    console.log(`Rate limited. Retry in ${e.retryAfterMs}ms`);
    await sleep(e.retryAfterMs);
    // Retry
  } else if (e instanceof MonocleBudgetExceededError) {
    console.log(`${e.limitType} budget exceeded`);
  }
}
```

### Error Types

| Error | When |
|-------|------|
| `MonocleInsufficientBalanceError` | Not enough lamports for the request |
| `MonocleAgentUnavailableError` | Selected agent is down/suspended |
| `MonocleNoAgentsAvailableError` | No agents for this task type |
| `MonocleRateLimitError` | Too many requests |
| `MonocleBudgetExceededError` | Daily/per-call limit hit |
| `MonocleQuoteExpiredError` | Pricing quote expired |
| `MonocleValidationError` | Invalid request parameters |
| `MonocleNetworkError` | Connection failed |
| `MonocleTimeoutError` | Request timed out |
| `MonocleStreamInterruptedError` | Stream died mid-response (has partial content) |

All errors extend `MonocleError` and include:
- `code` - Machine-readable error code
- `httpStatus` - HTTP status code
- `isRetryable()` - Whether safe to retry
- `getRetryDelayMs()` - Suggested retry delay

### Handling Stream Interruptions

When a stream dies mid-response, you can recover the partial content:

```typescript
import { MonocleStreamInterruptedError } from "monocle-sdk";

try {
  for await (const chunk of client.chat("Long explanation...")) {
    process.stdout.write(chunk.text);
  }
} catch (e) {
  if (e instanceof MonocleStreamInterruptedError) {
    console.log("\n--- Stream interrupted ---");
    console.log(`Got ${e.partialContent.length} chars before failure`);
    
    if (e.hasUsableContent()) {
      // Save what we got
      savePartialResponse(e.partialContent);
    }
    
    // Tokens were still charged
    console.log(`Tokens consumed: ${e.tokensConsumed}`);
  }
}
```

## Configuration

```typescript
const client = new MonocleClient({
  apiKey: "your-api-key",           // Required
  baseUrl: "https://api.monocle.dev/v1",  // Default
  maxRetries: 3,                    // Auto-retry on transient failures
  timeoutMs: 30000,                 // 30 second timeout
});
```

### Environment Variables

```bash
MONOCLE_API_KEY=your-api-key
MONOCLE_API_URL=https://api.monocle.dev/v1
```

## Advanced Features

### Routing Preferences

```typescript
for await (const chunk of client.chat("Complex analysis task", {
  preferredTaskType: "reasoning",  // Hint for classification
  maxCostLamports: 100000,         // Cost cap
  preferQuality: true,             // Prefer quality over cost
})) {
  process.stdout.write(chunk.text);
}
```

### Pricing Quotes (Lock Price Before Execution)

```typescript
// Get a quote with locked pricing
const quote = await client.getPricingQuote(
  myAgentId, 
  targetAgentId, 
  "tool-name", 
  5000 // estimated tokens
);

// Execute with guaranteed price
const result = await client.executeWithQuote(
  quote.quoteId,
  myAgentId,
  targetAgentId,
  "tool-name",
  4500 // actual tokens
);
```

### Budget Controls

```typescript
// Set spend limits
await client.setSpendLimits(agentId, {
  dailySpendCap: 10_000_000,    // 0.01 SOL/day
  maxCostPerCall: 500_000,      // Max 0.0005 SOL per call
});

// Emergency pause
await client.pauseSpending(agentId, "Suspicious activity");

// Resume
await client.resumeSpending(agentId);
```

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type { 
  ChatResponse, 
  StreamChunk,
  AgentListing,
  AgentProfile,
  Conversation,
} from "monocle-sdk";
```

## License

MIT
