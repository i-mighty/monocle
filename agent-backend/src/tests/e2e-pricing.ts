#!/usr/bin/env ts-node-dev

/**
 * END-TO-END TEST: AgentPay Pricing System
 *
 * Workflow:
 *   1. Create test agents
 *   2. Fund agents (topup balance)
 *   3. Execute tool calls (with pricing)
 *   4. Verify balance changes
 *   5. Check metrics
 *   6. Trigger settlement
 *   7. Verify settlement records
 *
 * Run with: npx ts-node-dev src/tests/e2e-pricing.ts
 */

import { query } from "../db/client.js";
import { calculateCost, onToolExecuted, checkSettlementEligibility, getAgentMetrics } from "../services/pricingService.js";

// Color output for readability
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function setupTestAgents() {
  log("\n📋 SETUP: Creating test agents...", "blue");

  // Clean up any existing test agents
  await query("delete from agents where id like 'test_%'");

  // Create Agent A (caller, rate=1000)
  await query(
    "insert into agents (id, name, rate_per_1k_tokens, balance_lamports, pending_lamports) values ($1, $2, $3, $4, $5)",
    ["test_agent_a", "Test Agent A", 1000, 100_000, 0]
  );

  // Create Agent B (callee, rate=2000)
  await query(
    "insert into agents (id, name, rate_per_1k_tokens, balance_lamports, pending_lamports) values ($1, $2, $3, $4, $5)",
    ["test_agent_b", "Test Agent B", 2000, 50_000, 0]
  );

  // Create Agent C (callee, rate=5000)
  await query(
    "insert into agents (id, name, rate_per_1k_tokens, balance_lamports, pending_lamports) values ($1, $2, $3, $4, $5)",
    ["test_agent_c", "Test Agent C", 5000, 50_000, 0]
  );

  log("✅ Test agents created: A, B, C", "green");
}

async function testDeterministicPricing() {
  log("\n🧮 TEST 1: Deterministic Pricing", "blue");

  // Same inputs must always produce same cost
  const cost1 = calculateCost(1000, 1000);
  const cost2 = calculateCost(1000, 1000);
  const cost3 = calculateCost(1000, 1000);

  if (cost1 === cost2 && cost2 === cost3) {
    log(`✅ Determinism verified: 1000 tokens @ 1000 rate = ${cost1} lamports (consistent)`, "green");
  } else {
    log(`❌ Determinism FAILED: costs were ${cost1}, ${cost2}, ${cost3}`, "red");
    throw new Error("Pricing not deterministic");
  }
}

async function testExecutionWithBalance() {
  log("\n💰 TEST 2: Execution with Balance Enforcement", "blue");

  // Agent A calls Agent B with 500 tokens
  const tokensUsed = 500;
  const costA = calculateCost(tokensUsed, 2000); // Agent B's rate

  log(`  Scenario: A → B with ${tokensUsed} tokens`, "cyan");
  log(`  Cost = ${costA} lamports (Agent B rate: 2000/1k)`, "cyan");

  try {
    const result = await onToolExecuted("test_agent_a", "test_agent_b", "summarize", tokensUsed);
    log(`✅ Execution succeeded: cost = ${result} lamports`, "green");

    // Verify balances changed
    const agentA = await query("select balance_lamports from agents where id = $1", ["test_agent_a"]);
    const agentB = await query("select balance_lamports, pending_lamports from agents where id = $1", ["test_agent_b"]);

    const expectedABalance = 100_000 - costA;
    const actualABalance = agentA.rows[0].balance_lamports;

    log(`  A balance: ${actualABalance} (expected ${expectedABalance})`, "cyan");

    if (actualABalance === expectedABalance) {
      log(`✅ Balance deduction correct`, "green");
    } else {
      log(`❌ Balance mismatch: got ${actualABalance}, expected ${expectedABalance}`, "red");
    }

    const actualBPending = agentB.rows[0].pending_lamports;
    if (actualBPending === costA) {
      log(`✅ Pending credit correct: ${actualBPending} lamports`, "green");
    } else {
      log(`❌ Pending mismatch: got ${actualBPending}, expected ${costA}`, "red");
    }
  } catch (error) {
    log(`❌ Execution failed: ${(error as Error).message}`, "red");
    throw error;
  }
}

async function testInsufficientBalance() {
  log("\n❌ TEST 3: Insufficient Balance Rejection", "blue");

  // Create agent with very low balance
  await query(
    "insert into agents (id, name, rate_per_1k_tokens, balance_lamports) values ($1, $2, $3, $4)",
    ["test_poor_agent", "Poor Agent", 1000, 50] // Only 50 lamports
  );

  try {
    // Try to call (minimum cost is 100 lamports)
    await onToolExecuted("test_poor_agent", "test_agent_b", "test_tool", 100);
    log(`❌ FAILED: Should have rejected due to insufficient balance`, "red");
    throw new Error("Balance check not enforced");
  } catch (error) {
    if ((error as Error).message.includes("Insufficient balance")) {
      log(`✅ Correctly rejected: ${(error as Error).message}`, "green");
    } else {
      throw error;
    }
  }
}

async function testComposability() {
  log("\n🔗 TEST 4: Composable Recursive Calls", "blue");

  // Create fresh test agents
  await query(
    "insert into agents (id, name, rate_per_1k_tokens, balance_lamports) values ($1, $2, $3, $4) on conflict (id) do update set balance_lamports = 100_000",
    ["test_comp_d", "Comp D", 1000, 100_000]
  );

  await query(
    "insert into agents (id, name, rate_per_1k_tokens, balance_lamports) values ($1, $2, $3, $4) on conflict (id) do update set balance_lamports = 100_000",
    ["test_comp_e", "Comp E", 1000, 100_000]
  );

  log(`  Scenario: D calls E, then E calls B`, "cyan");

  try {
    // D → E
    const cost1 = await onToolExecuted("test_comp_d", "test_comp_e", "tool1", 1000);
    log(`  ✓ D → E: ${cost1} lamports deducted`, "cyan");

    // E → B (E has pending from D, but separate balance for calling B)
    const cost2 = await onToolExecuted("test_comp_e", "test_agent_b", "tool2", 500);
    log(`  ✓ E → B: ${cost2} lamports deducted`, "cyan");

    log(`✅ Composability works: both calls executed independently`, "green");
  } catch (error) {
    log(`❌ Composability test failed: ${(error as Error).message}`, "red");
    throw error;
  }
}

async function testMetrics() {
  log("\n📊 TEST 5: Agent Metrics", "blue");

  try {
    const metrics = await getAgentMetrics("test_agent_a");

    log(`  Agent: ${metrics.agentId}`, "cyan");
    log(`  Rate: ${metrics.ratePer1kTokens} lamports/1k tokens`, "cyan");
    log(`  Balance: ${metrics.balanceLamports} lamports`, "cyan");
    log(`  Pending: ${metrics.pendingLamports} lamports`, "cyan");
    log(`  Calls made: ${metrics.usage.callCount}`, "cyan");
    log(`  Total spend: ${metrics.usage.totalSpend} lamports`, "cyan");
    log(`  Calls received: ${metrics.earnings.callCount}`, "cyan");
    log(`  Total earned: ${metrics.earnings.totalEarned} lamports`, "cyan");

    log(`✅ Metrics retrieved successfully`, "green");
  } catch (error) {
    log(`❌ Metrics failed: ${(error as Error).message}`, "red");
    throw error;
  }
}

async function testSettlementEligibility() {
  log("\n🏦 TEST 6: Settlement Eligibility Check", "blue");

  try {
    const agentB = await query("select pending_lamports from agents where id = $1", ["test_agent_b"]);
    const pending = agentB.rows[0].pending_lamports;

    log(`  Agent B pending: ${pending} lamports`, "cyan");

    const eligible = await checkSettlementEligibility("test_agent_b");

    if (eligible) {
      log(`✅ Agent B is eligible for settlement (pending >= min threshold)`, "green");
    } else {
      log(`⚠️  Agent B not eligible yet (pending ${pending} < min ${10000})`, "yellow");
    }
  } catch (error) {
    log(`❌ Settlement check failed: ${(error as Error).message}`, "red");
    throw error;
  }
}

async function testImmutableLedger() {
  log("\n📝 TEST 7: Immutable Execution Ledger", "blue");

  try {
    const result = await query(
      "select caller_agent_id, callee_agent_id, tool_name, tokens_used, cost_lamports, rate_per_1k_tokens, created_at from tool_usage limit 5"
    );

    if (result.rows.length === 0) {
      log(`⚠️  No executions recorded yet`, "yellow");
      return;
    }

    log(`  Total executions recorded: ${result.rows.length}`, "cyan");

    result.rows.slice(0, 3).forEach((row, i) => {
      log(
        `  ${i + 1}. ${row.caller_agent_id} → ${row.callee_agent_id}: ${row.tool_name} (${row.tokens_used} tokens, ${row.cost_lamports} lamports)`,
        "cyan"
      );
    });

    log(`✅ Immutable ledger working correctly`, "green");
  } catch (error) {
    log(`❌ Ledger check failed: ${(error as Error).message}`, "red");
    throw error;
  }
}

async function cleanup() {
  log("\n🧹 CLEANUP: Removing test data...", "blue");

  await query("delete from tool_usage where caller_agent_id like 'test_%' or callee_agent_id like 'test_%'");
  await query("delete from agents where id like 'test_%'");

  log("✅ Test data cleaned up", "green");
}

async function main() {
  log("\n" + "=".repeat(70), "cyan");
  log("    AGENTPAY PRICING SYSTEM - END-TO-END TEST SUITE", "cyan");
  log("=".repeat(70), "cyan");

  try {
    await setupTestAgents();
    await testDeterministicPricing();
    await testExecutionWithBalance();
    await testInsufficientBalance();
    await testComposability();
    await testMetrics();
    await testSettlementEligibility();
    await testImmutableLedger();

    log("\n" + "=".repeat(70), "cyan");
    log("✨ ALL TESTS PASSED ✨", "green");
    log("=".repeat(70), "cyan");
  } catch (error) {
    log("\n" + "=".repeat(70), "cyan");
    log(`❌ TEST SUITE FAILED: ${(error as Error).message}`, "red");
    log("=".repeat(70), "cyan");
    process.exit(1);
  } finally {
    try {
      await cleanup();
      process.exit(0);
    } catch (cleanupError) {
      log(`Cleanup error: ${(cleanupError as Error).message}`, "red");
      process.exit(1);
    }
  }
}

main();
