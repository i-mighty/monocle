/**
 * AgentPay Pricing Test Suite
 *
 * Tests the complete pricing flow:
 *   1. Register agents with pricing
 *   2. Top up caller balance
 *   3. Execute tool calls with cost calculation
 *   4. Verify balance deductions and credits
 *   5. Check settlement eligibility
 */

const BASE_URL = process.env.AGENTPAY_BASE_URL || "http://localhost:3001";
const API_KEY = process.env.AGENTPAY_API_KEY || "test_key_12345";

const headers = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
};

async function runTests() {
  console.log("🧪 AgentPay Pricing Test Suite\n");
  console.log(`📍 Base URL: ${BASE_URL}`);
  console.log(`🔑 API Key: ${API_KEY.substring(0, 10)}...\n`);

  let passed = 0;
  let failed = 0;

  // Test 1: Fetch pricing constants
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 1: Fetch pricing constants");
  try {
    const res = await fetch(`${BASE_URL}/pricing/constants`);
    const data = await res.json();
    console.log("  Constants:", JSON.stringify(data, null, 2));
    if (data.minCostLamports && data.maxTokensPerCall) {
      console.log("  ✅ PASSED");
      passed++;
    } else {
      throw new Error("Missing expected fields");
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 2: Calculate cost (pure calculation)
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 2: Calculate cost (1500 tokens @ 1000 lamports/1K)");
  try {
    const res = await fetch(`${BASE_URL}/pricing/calculate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tokensUsed: 1500,
        ratePer1kTokens: 1000,
      }),
    });
    const data = await res.json();
    console.log("  Result:", JSON.stringify(data, null, 2));
    // Expected: ceil(1500/1000) * 1000 = 2 * 1000 = 2000 lamports
    if (data.costLamports === 2000) {
      console.log("  ✅ PASSED (cost = 2000 lamports)");
      passed++;
    } else {
      throw new Error(`Expected 2000, got ${data.costLamports}`);
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 3: Register caller agent
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 3: Register caller agent");
  const callerAgentId = `test-caller-${Date.now()}`;
  try {
    const res = await fetch(`${BASE_URL}/agents/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentId: callerAgentId,
        name: "Test Caller Agent",
        ratePer1kTokens: 500,
      }),
    });
    const data = await res.json();
    console.log("  Registered:", JSON.stringify(data, null, 2));
    if (data.agentId === callerAgentId && data.balanceLamports === 0) {
      console.log("  ✅ PASSED");
      passed++;
    } else {
      throw new Error("Unexpected response");
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 4: Register callee agent with pricing
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 4: Register callee agent (2000 lamports/1K tokens)");
  const calleeAgentId = `test-callee-${Date.now()}`;
  try {
    const res = await fetch(`${BASE_URL}/agents/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentId: calleeAgentId,
        name: "Test Callee Agent",
        ratePer1kTokens: 2000,
      }),
    });
    const data = await res.json();
    console.log("  Registered:", JSON.stringify(data, null, 2));
    if (data.agentId === calleeAgentId && data.ratePer1kTokens === 2000) {
      console.log("  ✅ PASSED");
      passed++;
    } else {
      throw new Error("Unexpected response");
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 5: Get quote before execution
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 5: Get quote (1500 tokens to callee)");
  try {
    const res = await fetch(`${BASE_URL}/agents/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        calleeId: calleeAgentId,
        tokensUsed: 1500,
      }),
    });
    const data = await res.json();
    console.log("  Quote:", JSON.stringify(data, null, 2));
    // ceil(1500/1000) * 2000 = 2 * 2000 = 4000 lamports
    if (data.costLamports === 4000) {
      console.log("  ✅ PASSED (quoted cost = 4000 lamports)");
      passed++;
    } else {
      throw new Error(`Expected 4000, got ${data.costLamports}`);
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 6: Top up caller balance
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 6: Top up caller balance (50000 lamports)");
  try {
    const res = await fetch(`${BASE_URL}/pay/topup`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentId: callerAgentId,
        amountLamports: 50000,
      }),
    });
    const data = await res.json();
    console.log("  Topup result:", JSON.stringify(data, null, 2));
    if (data.newBalance === 50000) {
      console.log("  ✅ PASSED");
      passed++;
    } else {
      throw new Error(`Expected balance 50000, got ${data.newBalance}`);
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 7: Execute tool call
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 7: Execute tool call (1500 tokens)");
  try {
    const res = await fetch(`${BASE_URL}/meter/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        callerId: callerAgentId,
        calleeId: calleeAgentId,
        toolName: "test-tool",
        tokensUsed: 1500,
      }),
    });
    const data = await res.json();
    console.log("  Execution result:", JSON.stringify(data, null, 2));
    if (data.costLamports === 4000) {
      console.log("  ✅ PASSED (charged 4000 lamports)");
      passed++;
    } else {
      throw new Error(`Expected cost 4000, got ${data.costLamports}`);
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 8: Verify caller balance deducted
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 8: Verify caller balance deducted");
  try {
    const res = await fetch(`${BASE_URL}/agents/${callerAgentId}`, { headers });
    const data = await res.json();
    console.log("  Caller state:", JSON.stringify(data, null, 2));
    // 50000 - 4000 = 46000
    if (data.balanceLamports === 46000) {
      console.log("  ✅ PASSED (balance = 46000 lamports)");
      passed++;
    } else {
      throw new Error(`Expected 46000, got ${data.balanceLamports}`);
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 9: Verify callee pending credited
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 9: Verify callee pending credited");
  try {
    const res = await fetch(`${BASE_URL}/agents/${calleeAgentId}`, { headers });
    const data = await res.json();
    console.log("  Callee state:", JSON.stringify(data, null, 2));
    if (data.pendingLamports === 4000) {
      console.log("  ✅ PASSED (pending = 4000 lamports)");
      passed++;
    } else {
      throw new Error(`Expected 4000, got ${data.pendingLamports}`);
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 10: Check tool usage ledger
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 10: Check immutable tool usage ledger");
  try {
    const res = await fetch(`${BASE_URL}/meter/history/${callerAgentId}`, { headers });
    const data = await res.json();
    console.log("  Ledger entries:", JSON.stringify(data, null, 2));
    const entry = data.find((e) => e.tool_name === "test-tool");
    if (entry && entry.cost_lamports === 4000 && entry.rate_per_1k_tokens === 2000) {
      console.log("  ✅ PASSED (rate frozen at execution time)");
      passed++;
    } else {
      throw new Error("Ledger entry missing or incorrect");
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 11: Insufficient balance rejection
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 11: Insufficient balance rejection");
  try {
    // Try to spend more than available
    const res = await fetch(`${BASE_URL}/meter/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        callerId: callerAgentId,
        calleeId: calleeAgentId,
        toolName: "expensive-tool",
        tokensUsed: 100000, // Would cost 200000 lamports
      }),
    });
    const data = await res.json();
    console.log("  Response:", JSON.stringify(data, null, 2));
    if (res.status === 402 && data.error.includes("Insufficient balance")) {
      console.log("  ✅ PASSED (correctly rejected with 402)");
      passed++;
    } else {
      throw new Error("Should have been rejected");
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 12: Minimum cost enforcement
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 12: Minimum cost enforcement (1 token)");
  try {
    const res = await fetch(`${BASE_URL}/pricing/calculate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tokensUsed: 1,
        ratePer1kTokens: 1, // Would give ceil(1/1000)*1 = 1, but minimum is 100
      }),
    });
    const data = await res.json();
    console.log("  Result:", JSON.stringify(data, null, 2));
    if (data.costLamports === 100 && data.breakdown.minimumApplied === true) {
      console.log("  ✅ PASSED (minimum 100 lamports enforced)");
      passed++;
    } else {
      throw new Error("Minimum cost not enforced");
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 13: Estimate settlement
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 13: Estimate settlement (10000 lamports)");
  try {
    const res = await fetch(`${BASE_URL}/pricing/estimate-settlement`, {
      method: "POST",
      headers,
      body: JSON.stringify({ grossLamports: 10000 }),
    });
    const data = await res.json();
    console.log("  Estimate:", JSON.stringify(data, null, 2));
    // 5% fee: 10000 * 0.05 = 500
    if (data.platformFeeLamports === 500 && data.netPayoutLamports === 9500) {
      console.log("  ✅ PASSED (5% platform fee = 500 lamports)");
      passed++;
    } else {
      throw new Error("Settlement estimate incorrect");
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Test 14: Agent metrics
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 14: Agent metrics");
  try {
    const res = await fetch(`${BASE_URL}/agents/${callerAgentId}/metrics`, { headers });
    const data = await res.json();
    console.log("  Metrics:", JSON.stringify(data, null, 2));
    if (data.usage && data.usage.totalSpend === 4000) {
      console.log("  ✅ PASSED");
      passed++;
    } else {
      throw new Error("Metrics incorrect");
    }
  } catch (err) {
    console.log("  ❌ FAILED:", err?.message || err);
    failed++;
  }

  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📊 Total:  ${passed + failed}`);
  console.log("");

  if (failed === 0) {
    console.log("🎉 All pricing tests passed!");
  } else {
    console.log("⚠️  Some tests failed. Check logs above.");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test suite crashed:", err);
  process.exit(1);
});
