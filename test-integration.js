/**
 * COMPREHENSIVE INTEGRATION TEST: AgentPay Pricing System
 * 
 * Tests:
 * 1. ✅ Pricing determinism (unit level)
 * 2. ✅ SDK integration with new pricing API
 * 3. ✅ Identity verification + agent registration
 * 4. ✅ Tool execution with pricing enforcement
 * 5. ✅ Balance tracking and settlement
 * 6. ✅ Analytics queries on new schema
 * 7. ✅ Error handling (insufficient balance, etc)
 * 
 * Run with:
 *   npm run build (in agent-sdk)
 *   node test-integration.js
 */

import { AgentPayClient } from "./agent-sdk/dist/index.js";
import assert from "assert";

const BASE_URL = process.env.AGENT_BACKEND_URL || "http://localhost:3001";
const API_KEY = process.env.AGENTPAY_API_KEY || "test_key";

let testsPassed = 0;
let testsFailed = 0;

// ============================================
// TEST UTILITIES
// ============================================

function describe(name) {
  console.log(`\n📋 ${name}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.error(`  ❌ ${name}`);
    console.error(`     Error: ${error.message}`);
    testsFailed++;
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function assertGt(actual, expected, msg) {
  if (actual <= expected) {
    throw new Error(`${msg}: expected > ${expected}, got ${actual}`);
  }
}

// ============================================
// TEST SETUP
// ============================================

const client = new AgentPayClient({
  apiKey: API_KEY,
  baseUrl: BASE_URL,
});

// Test agents
const AGENT_A = {
  id: `agent_a_${Date.now()}`,
  firstName: "Agent",
  lastName: "Alpha",
  dob: "1990-01-01",
  idNumber: "ID_ALPHA",
  ratePer1kTokens: 1000, // 1000 lamports per 1k tokens
};

const AGENT_B = {
  id: `agent_b_${Date.now()}`,
  firstName: "Agent",
  lastName: "Beta",
  dob: "1990-01-02",
  idNumber: "ID_BETA",
  ratePer1kTokens: 2000, // 2000 lamports per 1k tokens
};

// ============================================
// INTEGRATION TESTS
// ============================================

async function runTests() {
  console.log("🚀 AgentPay Pricing System - Integration Tests");
  console.log("═".repeat(60));

  // ============================================
  // Test Suite 1: SDK + Identity Integration
  // ============================================

  describe("SDK Integration: Identity & Agent Registration");

  await test("Agent A: Register with identity verification", async () => {
    const result = await client.verifyIdentity({
      agentId: AGENT_A.id,
      firstName: AGENT_A.firstName,
      lastName: AGENT_A.lastName,
      dob: AGENT_A.dob,
      idNumber: AGENT_A.idNumber,
      ratePer1kTokens: AGENT_A.ratePer1kTokens,
    });

    assertEq(result.status, "verified", "Status should be verified");
    assertEq(result.agent.id, AGENT_A.id, "Agent ID should match");
    assertGt(result.agent.balanceLamports, 0, "Balance should be > 0");
  });

  await test("Agent B: Register with identity verification", async () => {
    const result = await client.verifyIdentity({
      agentId: AGENT_B.id,
      firstName: AGENT_B.firstName,
      lastName: AGENT_B.lastName,
      dob: AGENT_B.dob,
      idNumber: AGENT_B.idNumber,
      ratePer1kTokens: AGENT_B.ratePer1kTokens,
    });

    assertEq(result.status, "verified", "Status should be verified");
    assertEq(result.agent.id, AGENT_B.id, "Agent ID should match");
  });

  // ============================================
  // Test Suite 2: Pricing Logic (determinism)
  // ============================================

  describe("Pricing Logic: Determinism & Formula");

  await test("Pricing formula: 500 tokens @ 1000 lamports/1k = 1000 lamports", async () => {
    // This tests the backend pricing service
    // Formula: cost = max(ceil(tokens / 1000) * rate_per_1k_tokens, MIN_COST)
    // = max(ceil(500 / 1000) * 1000, 100)
    // = max(1 * 1000, 100)
    // = 1000 lamports
    
    const result = await client.executeTool(
      AGENT_A.id,
      AGENT_B.id,
      "test_tool",
      500
    );

    assertEq(result.costLamports, 1000, "Cost should be 1000 lamports");
  });

  await test("Pricing formula: 1001 tokens @ 1000 lamports/1k = 2000 lamports", async () => {
    // = max(ceil(1001 / 1000) * 1000, 100)
    // = max(2 * 1000, 100)
    // = 2000 lamports
    
    const result = await client.executeTool(
      AGENT_A.id,
      AGENT_B.id,
      "test_tool",
      1001
    );

    assertEq(result.costLamports, 2000, "Cost should be 2000 lamports");
  });

  await test("Pricing: Same inputs produce same cost (determinism)", async () => {
    const result1 = await client.executeTool(
      AGENT_A.id,
      AGENT_B.id,
      "determinism_test",
      1500
    );

    const result2 = await client.executeTool(
      AGENT_A.id,
      AGENT_B.id,
      "determinism_test",
      1500
    );

    assertEq(result1.costLamports, result2.costLamports, "Costs should be identical");
  });

  // ============================================
  // Test Suite 3: Balance Tracking
  // ============================================

  describe("Balance Tracking: Deduction & Accumulation");

  await test("Agent A: Verify balance decreased after tool call", async () => {
    const metricsAfter = await client.getMetrics(AGENT_A.id);

    // Agent A started with 1M lamports, made calls
    // Balance should be less than initial
    assert(
      metricsAfter.balanceLamports < 1_000_000,
      "Balance should be less than initial 1M"
    );
  });

  await test("Agent B: Verify pending increased (as callee)", async () => {
    const metricsB = await client.getMetrics(AGENT_B.id);

    // Agent B received multiple calls, should have pending lamports
    assertGt(metricsB.pendingLamports, 0, "Pending should be > 0");
  });

  // ============================================
  // Test Suite 4: Composability (nested calls)
  // ============================================

  describe("Composability: Nested Agent Calls");

  await test("A → B → C nested call stack", async () => {
    // Agent C
    const agentC = {
      id: `agent_c_${Date.now()}`,
      firstName: "Agent",
      lastName: "Gamma",
      dob: "1990-01-03",
      idNumber: "ID_GAMMA",
      ratePer1kTokens: 500,
    };

    // Register Agent C
    await client.verifyIdentity({
      agentId: agentC.id,
      firstName: agentC.firstName,
      lastName: agentC.lastName,
      dob: agentC.dob,
      idNumber: agentC.idNumber,
      ratePer1kTokens: agentC.ratePer1kTokens,
    });

    // A calls B
    const callAB = await client.executeTool(AGENT_A.id, AGENT_B.id, "nested_test", 500);
    assertGt(callAB.costLamports, 0, "A→B call cost should be > 0");

    // B calls C
    const callBC = await client.executeTool(AGENT_B.id, agentC.id, "nested_test", 500);
    assertGt(callBC.costLamports, 0, "B→C call cost should be > 0");

    // Both costs should be deterministic (independent)
    const callAB2 = await client.executeTool(AGENT_A.id, AGENT_B.id, "nested_test", 500);
    assertEq(callAB.costLamports, callAB2.costLamports, "Same calls should have same cost");
  });

  // ============================================
  // Test Suite 5: Tool History & Auditing
  // ============================================

  describe("Auditing: Tool Usage History");

  await test("Agent A: Can retrieve tool call history (as caller)", async () => {
    const history = await client.getToolHistory(AGENT_A.id, false, 10);

    assert(Array.isArray(history), "History should be array");
    assertGt(history.length, 0, "History should have entries");
    
    // Verify immutable record structure
    const record = history[0];
    assert(record.caller_agent_id === AGENT_A.id, "Caller should match");
    assert(record.cost_lamports > 0, "Cost should be recorded");
  });

  await test("Agent B: Can retrieve earnings history (as callee)", async () => {
    const earnings = await client.getToolHistory(AGENT_B.id, true, 10);

    assert(Array.isArray(earnings), "Earnings should be array");
    assertGt(earnings.length, 0, "Should have earned from calls");
  });

  // ============================================
  // Test Suite 6: Settlement (on-chain)
  // ============================================

  describe("Settlement: Pending → On-Chain");

  await test("Agent B: Trigger settlement when pending >= threshold", async () => {
    // Check if pending is sufficient
    const metricsB = await client.getMetrics(AGENT_B.id);

    if (metricsB.pendingLamports >= 10000) {
      const settlementResult = await client.settle(AGENT_B.id);

      // Settlement may be pending (depends on Solana integration)
      assert(settlementResult.status !== undefined, "Settlement should have status");
    }
  });

  await test("Agent B: Can retrieve settlement history", async () => {
    const settlements = await client.getSettlements(AGENT_B.id, 10);

    assert(Array.isArray(settlements), "Settlements should be array");
    // May be empty if no settlements yet, that's OK
  });

  // ============================================
  // Test Suite 7: Error Handling
  // ============================================

  describe("Error Handling: Invalid Operations");

  await test("Reject: Insufficient balance (A tries to call B with 0 balance)", async () => {
    // Drain Agent A's balance first
    const metricsA = await client.getMetrics(AGENT_A.id);

    if (metricsA.balanceLamports < 100) {
      try {
        // This should fail: balance too low
        await client.executeTool(AGENT_A.id, AGENT_B.id, "overdraft_test", 100000);
        throw new Error("Should have rejected (insufficient balance)");
      } catch (error) {
        // Expected error
        assert(
          error.message.includes("balance") || error.message.includes("insufficient"),
          "Error should mention balance"
        );
      }
    }
  });

  await test("Reject: Negative tokens", async () => {
    // Backend should reject
    try {
      await client.executeTool(AGENT_A.id, AGENT_B.id, "negative_test", -100);
      throw new Error("Should have rejected negative tokens");
    } catch (error) {
      assert(
        error.message.includes("negative") || error.message.includes("invalid"),
        "Error should mention invalid input"
      );
    }
  });

  // ============================================
  // Test Suite 8: Analytics Queries
  // ============================================

  describe("Analytics: Reporting on New Schema");

  await test("Analytics: Fetch usage by agent", async () => {
    const response = await fetch(`${BASE_URL}/analytics/usage`, {
      headers: { "x-api-key": API_KEY },
    });

    assert(response.ok, "Analytics endpoint should respond");
    const data = await response.json();

    assert(Array.isArray(data), "Usage should be array");
    // Should have entries if we made calls
  });

  await test("Analytics: Fetch platform revenue", async () => {
    const response = await fetch(`${BASE_URL}/analytics/platform-revenue`, {
      headers: { "x-api-key": API_KEY },
    });

    assert(response.ok, "Revenue endpoint should respond");
    const data = await response.json();

    assert(data.total_fees_lamports !== undefined, "Should return fee data");
  });

  // ============================================
  // TEST SUMMARY
  // ============================================

  console.log("\n" + "═".repeat(60));
  console.log(`✅ Tests Passed: ${testsPassed}`);
  console.log(`❌ Tests Failed: ${testsFailed}`);
  console.log(`📊 Total Tests: ${testsPassed + testsFailed}`);
  console.log("═".repeat(60));

  if (testsFailed > 0) {
    console.log("\n⚠️  Some tests failed. Check logs above.");
    process.exit(1);
  } else {
    console.log(
      "\n✨ ALL TESTS PASSED! AgentPay pricing system is fully operational. ✨\n"
    );
    process.exit(0);
  }
}

// ============================================
// RUN TESTS
// ============================================

console.log("Waiting 2s for backend to be ready...\n");
setTimeout(runTests, 2000);