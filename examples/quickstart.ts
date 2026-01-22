/**
 * AgentPay Quickstart Example
 * 
 * This script demonstrates the complete payment flow:
 * 1. Register a payer agent (has balance)
 * 2. Register a provider agent (earns from tool calls)
 * 3. Execute a paid tool call
 * 4. Verify the transaction and balances
 * 
 * Run: npx ts-node examples/quickstart.ts
 * (Requires backend running on localhost:3001)
 */

const API_URL = process.env.API_URL || "http://localhost:3001";

interface Agent {
  id: string;
  name: string;
  publicKey: string;
  apiKey: string;
}

interface ToolCallResult {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensUsed: number;
  costLamports: number;
}

// Helper to make API calls
async function apiCall<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error (${res.status}): ${error}`);
  }
  
  return res.json();
}

async function main() {
  console.log("🚀 AgentPay Quickstart\n");
  console.log("=".repeat(50));

  // Step 1: Register Payer Agent
  console.log("\n📝 Step 1: Register Payer Agent");
  const payer = await apiCall<Agent>("/agents/register", {
    method: "POST",
    body: JSON.stringify({
      name: "demo-payer",
      publicKey: "DemoPayerPubKey123456789012345678901234567890",
      description: "Demo payer agent for quickstart",
    }),
  });
  console.log(`   ✅ Created: ${payer.name} (${payer.id})`);

  // Step 2: Register Provider Agent  
  console.log("\n📝 Step 2: Register Provider Agent");
  const provider = await apiCall<Agent>("/agents/register", {
    method: "POST",
    body: JSON.stringify({
      name: "demo-provider",
      publicKey: "DemoProviderPubKey12345678901234567890123456",
      description: "Demo tool provider for quickstart",
    }),
  });
  console.log(`   ✅ Created: ${provider.name} (${provider.id})`);

  // Step 3: Add balance to payer (in real system, this comes from deposits)
  console.log("\n💰 Step 3: Fund Payer Account");
  await apiCall("/agents/fund", {
    method: "POST",
    body: JSON.stringify({
      agentId: payer.id,
      amount: 100000, // 100,000 lamports = 0.0001 SOL
    }),
  });
  console.log(`   ✅ Funded ${payer.name} with 100,000 lamports`);

  // Step 4: Check initial balances
  console.log("\n📊 Step 4: Check Initial Balances");
  const payerBefore = await apiCall<{ balance: number }>(`/agents/${payer.id}/balance`);
  const providerBefore = await apiCall<{ pendingBalance: number }>(`/agents/${provider.id}/pending`);
  console.log(`   Payer balance:    ${payerBefore.balance.toLocaleString()} lamports`);
  console.log(`   Provider pending: ${providerBefore.pendingBalance.toLocaleString()} lamports`);

  // Step 5: Get pricing quote
  console.log("\n💵 Step 5: Get Pricing Quote");
  const tokensToUse = 5000; // 5000 tokens
  const quote = await apiCall<{ cost: number; breakdown: any }>("/pricing/quote", {
    method: "POST",
    body: JSON.stringify({
      toolName: "gpt-4-completion",
      estimatedTokens: tokensToUse,
    }),
  });
  console.log(`   Tool: gpt-4-completion`);
  console.log(`   Tokens: ${tokensToUse.toLocaleString()}`);
  console.log(`   Cost: ${quote.cost.toLocaleString()} lamports`);
  console.log(`   Formula: ceil(${tokensToUse}/1000) × ${quote.breakdown.ratePerThousand} = ${quote.cost}`);

  // Step 6: Execute paid tool call
  console.log("\n⚡ Step 6: Execute Paid Tool Call");
  const toolCall = await apiCall<ToolCallResult>("/meter/log", {
    method: "POST",
    headers: {
      "x-api-key": payer.apiKey,
    },
    body: JSON.stringify({
      callerId: payer.id,
      calleeId: provider.id,
      toolName: "gpt-4-completion",
      tokensUsed: tokensToUse,
    }),
  });
  console.log(`   ✅ Tool call executed!`);
  console.log(`   Cost charged: ${toolCall.costLamports.toLocaleString()} lamports`);

  // Step 7: Check final balances
  console.log("\n📊 Step 7: Check Final Balances");
  const payerAfter = await apiCall<{ balance: number }>(`/agents/${payer.id}/balance`);
  const providerAfter = await apiCall<{ pendingBalance: number }>(`/agents/${provider.id}/pending`);
  console.log(`   Payer balance:    ${payerAfter.balance.toLocaleString()} lamports (was ${payerBefore.balance.toLocaleString()})`);
  console.log(`   Provider pending: ${providerAfter.pendingBalance.toLocaleString()} lamports (was ${providerBefore.pendingBalance.toLocaleString()})`);
  
  // Verify the math
  const payerDiff = payerBefore.balance - payerAfter.balance;
  const providerDiff = providerAfter.pendingBalance - providerBefore.pendingBalance;
  console.log(`\n   Payer spent: ${payerDiff.toLocaleString()} lamports`);
  console.log(`   Provider earned: ${providerDiff.toLocaleString()} lamports`);

  // Step 8: Show settlement info
  console.log("\n🏦 Step 8: Settlement Info");
  const MIN_PAYOUT = 10000; // lamports
  const PLATFORM_FEE = 0.05; // 5%
  const currentPending = providerAfter.pendingBalance;
  const needsMore = MIN_PAYOUT - currentPending;
  
  if (currentPending >= MIN_PAYOUT) {
    console.log(`   ✅ Provider eligible for auto-settlement!`);
    const payout = Math.floor(currentPending * (1 - PLATFORM_FEE));
    const fee = currentPending - payout;
    console.log(`   Payout: ${payout.toLocaleString()} lamports`);
    console.log(`   Platform fee (5%): ${fee.toLocaleString()} lamports`);
  } else {
    console.log(`   ⏳ Provider needs ${needsMore.toLocaleString()} more lamports for auto-settlement`);
    console.log(`   (Threshold: ${MIN_PAYOUT.toLocaleString()} lamports)`);
  }

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("✅ Quickstart Complete!");
  console.log("\nKey Takeaways:");
  console.log("• Pricing is deterministic: ceil(tokens/1000) × rate");
  console.log("• Platform takes 5% fee on settlement");
  console.log("• Auto-settlement triggers at 10,000 lamports pending");
  console.log("• All balances are tracked in integer lamports (no floats)");
  console.log("\nNext Steps:");
  console.log("• Try the x402 flow: GET /x402/demo-resource");
  console.log("• Check analytics: GET /analytics/revenue");
  console.log("• See full docs: README.md");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
