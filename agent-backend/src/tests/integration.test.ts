#!/usr/bin/env ts-node-dev

/**
 * INTEGRATION TESTS - DATABASE + PAYMENTS FLOW
 *
 * Tests the full integration between:
 * - Database operations (agents, tools, usage)
 * - Balance enforcement
 * - Payment flows
 * - Settlement processing
 *
 * Requires: Running database (docker-compose up agentpay-db)
 * Run with: npx ts-node-dev src/tests/integration.test.ts
 */

import { query, db, agents, tools, toolUsage, settlements, platformRevenue } from "../db/client";
import {
  calculateCost,
  calculatePlatformFee,
  getAgent,
  upsertAgent,
  registerTool,
  getToolPricing,
  onToolExecuted,
  settleAgent,
  checkSettlementEligibility,
  getAgentMetrics,
  PRICING_CONSTANTS,
} from "../services/pricingService";
import { logToolCall } from "../services/meterService";
import { eq } from "drizzle-orm";

// =============================================================================
// TEST FRAMEWORK
// =============================================================================

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(msg: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

let passed = 0;
let failed = 0;
const errors: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    log(`  ✓ ${name}`, "green");
    passed++;
  } catch (err: any) {
    log(`  ✗ ${name}`, "red");
    log(`    Error: ${err.message}`, "red");
    errors.push(`${name}: ${err.message}`);
    failed++;
  }
}

function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected: T) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== "number" || actual <= (expected as number)) {
        throw new Error(`Expected ${actual} > ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (typeof actual !== "number" || actual < (expected as number)) {
        throw new Error(`Expected ${actual} >= ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (typeof actual !== "number" || actual >= (expected as number)) {
        throw new Error(`Expected ${actual} < ${expected}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy, got ${actual}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy, got ${actual}`);
      }
    },
    toBeDefined() {
      if (actual === undefined || actual === null) {
        throw new Error(`Expected defined, got ${actual}`);
      }
    },
  };
}

// =============================================================================
// TEST DATA SETUP
// =============================================================================

const TEST_PREFIX = "int_test_";

async function cleanup() {
  log("\n[CLEANUP] Removing test data...", "dim");
  
  // Delete in correct order (foreign key constraints)
  await query(`DELETE FROM platform_revenue WHERE settlement_id IN (
    SELECT id FROM settlements WHERE from_agent_id LIKE $1 OR to_agent_id LIKE $1
  )`, [`${TEST_PREFIX}%`]);
  await query(`DELETE FROM settlements WHERE from_agent_id LIKE $1 OR to_agent_id LIKE $1`, [`${TEST_PREFIX}%`]);
  await query(`DELETE FROM tool_usage WHERE caller_agent_id LIKE $1 OR callee_agent_id LIKE $1`, [`${TEST_PREFIX}%`]);
  await query(`DELETE FROM tools WHERE agent_id LIKE $1`, [`${TEST_PREFIX}%`]);
  await query(`DELETE FROM agents WHERE id LIKE $1`, [`${TEST_PREFIX}%`]);
  
  log("[CLEANUP] Done", "dim");
}

async function setupTestAgents() {
  log("\n[SETUP] Creating test agents...", "blue");
  
  // Agent A: Caller with good balance
  await upsertAgent({
    id: `${TEST_PREFIX}agent_a`,
    name: "Integration Test Agent A",
    defaultRatePer1kTokens: 1000,
    balanceLamports: 1_000_000, // 1M lamports
  });

  // Agent B: Provider with tools
  await upsertAgent({
    id: `${TEST_PREFIX}agent_b`,
    name: "Integration Test Agent B",
    publicKey: "TestPublicKeyB123",
    defaultRatePer1kTokens: 2000,
    balanceLamports: 500_000,
  });

  // Agent C: Provider with premium tools
  await upsertAgent({
    id: `${TEST_PREFIX}agent_c`,
    name: "Integration Test Agent C",
    publicKey: "TestPublicKeyC456",
    defaultRatePer1kTokens: 5000,
    balanceLamports: 100_000,
  });

  // Agent D: Agent with low balance (for failure tests)
  await upsertAgent({
    id: `${TEST_PREFIX}agent_d`,
    name: "Low Balance Agent D",
    defaultRatePer1kTokens: 1000,
    balanceLamports: 50, // Very low balance
  });

  log("[SETUP] Test agents created", "green");
}

async function setupTestTools() {
  log("[SETUP] Creating test tools...", "blue");

  // Tools for Agent B
  await registerTool({
    agentId: `${TEST_PREFIX}agent_b`,
    name: "summarize",
    description: "Summarize text",
    ratePer1kTokens: 1500, // Override default rate
  });

  await registerTool({
    agentId: `${TEST_PREFIX}agent_b`,
    name: "translate",
    description: "Translate text",
    ratePer1kTokens: 2500,
  });

  // Tools for Agent C (premium)
  await registerTool({
    agentId: `${TEST_PREFIX}agent_c`,
    name: "analyze",
    description: "Deep analysis",
    ratePer1kTokens: 10000, // Premium tool
  });

  log("[SETUP] Test tools created", "green");
}

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

async function runAgentCrudTests() {
  log("\n─".repeat(60), "dim");
  log("  AGENT CRUD OPERATIONS", "blue");
  log("─".repeat(60), "dim");

  await test("should create agent with correct defaults", async () => {
    const agent = await getAgent(`${TEST_PREFIX}agent_a`);
    expect(agent.id).toBe(`${TEST_PREFIX}agent_a`);
    expect(agent.balanceLamports).toBe(1_000_000);
    expect(agent.pendingLamports).toBe(0);
  });

  await test("should update agent on upsert", async () => {
    await upsertAgent({
      id: `${TEST_PREFIX}agent_a`,
      name: "Updated Name",
      defaultRatePer1kTokens: 1500,
    });
    const agent = await getAgent(`${TEST_PREFIX}agent_a`);
    expect(agent.name).toBe("Updated Name");
    expect(agent.defaultRatePer1kTokens).toBe(1500);
    // Balance should remain unchanged
    expect(agent.balanceLamports).toBe(1_000_000);
    
    // Reset for other tests
    await upsertAgent({
      id: `${TEST_PREFIX}agent_a`,
      name: "Integration Test Agent A",
      defaultRatePer1kTokens: 1000,
    });
  });

  await test("should throw for non-existent agent", async () => {
    let thrown = false;
    try {
      await getAgent(`${TEST_PREFIX}nonexistent`);
    } catch (e) {
      thrown = true;
    }
    expect(thrown).toBe(true);
  });
}

async function runToolPricingTests() {
  log("\n─".repeat(60), "dim");
  log("  TOOL PRICING", "blue");
  log("─".repeat(60), "dim");

  await test("should get tool-specific pricing", async () => {
    const pricing = await getToolPricing(`${TEST_PREFIX}agent_b`, "summarize");
    expect(pricing.ratePer1kTokens).toBe(1500);
    expect(pricing.toolId).toBeDefined();
  });

  await test("should fall back to agent default for unknown tool", async () => {
    const pricing = await getToolPricing(`${TEST_PREFIX}agent_b`, "unknown_tool");
    expect(pricing.ratePer1kTokens).toBe(2000); // Agent B's default
    expect(pricing.toolId).toBe(null);
  });

  await test("should update tool pricing on re-register", async () => {
    await registerTool({
      agentId: `${TEST_PREFIX}agent_b`,
      name: "summarize",
      description: "Updated summarization",
      ratePer1kTokens: 1800,
    });
    
    const pricing = await getToolPricing(`${TEST_PREFIX}agent_b`, "summarize");
    expect(pricing.ratePer1kTokens).toBe(1800);
    
    // Reset
    await registerTool({
      agentId: `${TEST_PREFIX}agent_b`,
      name: "summarize",
      description: "Summarize text",
      ratePer1kTokens: 1500,
    });
  });
}

async function runExecutionTests() {
  log("\n─".repeat(60), "dim");
  log("  TOOL EXECUTION & BALANCE ENFORCEMENT", "blue");
  log("─".repeat(60), "dim");

  await test("should execute tool call and deduct balance", async () => {
    const agentBefore = await getAgent(`${TEST_PREFIX}agent_a`);
    const balanceBefore = agentBefore.balanceLamports;

    const result = await onToolExecuted(
      `${TEST_PREFIX}agent_a`,
      `${TEST_PREFIX}agent_b`,
      "summarize",
      1000
    );

    const agentAfter = await getAgent(`${TEST_PREFIX}agent_a`);
    const expectedCost = calculateCost(1000, 1500); // summarize tool rate
    
    expect(agentAfter.balanceLamports).toBe(balanceBefore - expectedCost);
    expect(result.costLamports).toBe(expectedCost);
  });

  await test("should credit pending to callee", async () => {
    const calleeBefore = await getAgent(`${TEST_PREFIX}agent_b`);
    const pendingBefore = calleeBefore.pendingLamports;

    await onToolExecuted(
      `${TEST_PREFIX}agent_a`,
      `${TEST_PREFIX}agent_b`,
      "translate",
      500
    );

    const calleeAfter = await getAgent(`${TEST_PREFIX}agent_b`);
    const expectedCost = calculateCost(500, 2500); // translate tool rate
    
    expect(calleeAfter.pendingLamports).toBe(pendingBefore + expectedCost);
  });

  await test("should record tool usage in ledger", async () => {
    const beforeCount = await query(
      `SELECT COUNT(*) as count FROM tool_usage WHERE caller_agent_id = $1`,
      [`${TEST_PREFIX}agent_a`]
    );

    await onToolExecuted(
      `${TEST_PREFIX}agent_a`,
      `${TEST_PREFIX}agent_c`,
      "analyze",
      100
    );

    const afterCount = await query(
      `SELECT COUNT(*) as count FROM tool_usage WHERE caller_agent_id = $1`,
      [`${TEST_PREFIX}agent_a`]
    );

    expect(Number(afterCount.rows[0].count)).toBeGreaterThan(Number(beforeCount.rows[0].count));
  });

  await test("should use frozen price from tool's rate", async () => {
    // Get current tool rate
    const pricing = await getToolPricing(`${TEST_PREFIX}agent_c`, "analyze");
    const frozenRate = pricing.ratePer1kTokens;

    const result = await onToolExecuted(
      `${TEST_PREFIX}agent_a`,
      `${TEST_PREFIX}agent_c`,
      "analyze",
      2000
    );

    expect(result.ratePer1kTokens).toBe(frozenRate);
    expect(result.costLamports).toBe(calculateCost(2000, frozenRate));
  });
}

async function runMeterServiceTests() {
  log("\n─".repeat(60), "dim");
  log("  METER SERVICE INTEGRATION", "blue");
  log("─".repeat(60), "dim");

  await test("should log tool call through meter service", async () => {
    const result = await logToolCall(
      `${TEST_PREFIX}agent_a`,
      `${TEST_PREFIX}agent_b`,
      "summarize",
      500
    );

    expect(result.callerId).toBe(`${TEST_PREFIX}agent_a`);
    expect(result.calleeId).toBe(`${TEST_PREFIX}agent_b`);
    expect(result.toolName).toBe("summarize");
    expect(result.tokensUsed).toBe(500);
    expect(result.costLamports).toBeGreaterThan(0);
    expect(result.pricingSource).toBe("live");
  });

  await test("should return correct pricing source", async () => {
    const result = await logToolCall(
      `${TEST_PREFIX}agent_a`,
      `${TEST_PREFIX}agent_b`,
      "translate",
      100
    );

    expect(result.pricingSource).toBe("live");
  });
}

async function runMetricsTests() {
  log("\n─".repeat(60), "dim");
  log("  AGENT METRICS", "blue");
  log("─".repeat(60), "dim");

  await test("should return correct agent metrics", async () => {
    const metrics = await getAgentMetrics(`${TEST_PREFIX}agent_a`);
    
    expect(metrics.agentId).toBe(`${TEST_PREFIX}agent_a`);
    expect(metrics.usage.callCount).toBeGreaterThan(0);
    expect(metrics.usage.totalSpend).toBeGreaterThan(0);
  });

  await test("should track earnings for providers", async () => {
    const metrics = await getAgentMetrics(`${TEST_PREFIX}agent_b`);
    
    expect(metrics.earnings.callCount).toBeGreaterThan(0);
    expect(metrics.earnings.totalEarned).toBeGreaterThan(0);
    expect(metrics.pendingLamports).toBeGreaterThan(0);
  });

  await test("should list registered tools", async () => {
    const metrics = await getAgentMetrics(`${TEST_PREFIX}agent_b`);
    
    expect(metrics.tools.length).toBeGreaterThanOrEqual(2);
    const toolNames = metrics.tools.map(t => t.name);
    expect(toolNames.includes("summarize")).toBe(true);
    expect(toolNames.includes("translate")).toBe(true);
  });
}

async function runSettlementEligibilityTests() {
  log("\n─".repeat(60), "dim");
  log("  SETTLEMENT ELIGIBILITY", "blue");
  log("─".repeat(60), "dim");

  await test("should check settlement eligibility correctly", async () => {
    // Agent B should have pending balance from earlier tests
    const agent = await getAgent(`${TEST_PREFIX}agent_b`);
    const isEligible = await checkSettlementEligibility(`${TEST_PREFIX}agent_b`);
    
    if (agent.pendingLamports >= PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS) {
      expect(isEligible).toBe(true);
    } else {
      expect(isEligible).toBe(false);
    }
  });

  await test("should return false for agent with no pending", async () => {
    // Agent D has low balance and shouldn't have pending
    const isEligible = await checkSettlementEligibility(`${TEST_PREFIX}agent_d`);
    expect(isEligible).toBe(false);
  });
}

async function runAtomicityTests() {
  log("\n─".repeat(60), "dim");
  log("  ATOMICITY & CONSISTENCY", "blue");
  log("─".repeat(60), "dim");

  await test("balances should remain consistent after multiple calls", async () => {
    const callerBefore = await getAgent(`${TEST_PREFIX}agent_a`);
    const calleeBefore = await getAgent(`${TEST_PREFIX}agent_b`);

    // Make several calls
    let totalCost = 0;
    for (let i = 0; i < 5; i++) {
      const result = await onToolExecuted(
        `${TEST_PREFIX}agent_a`,
        `${TEST_PREFIX}agent_b`,
        "summarize",
        100
      );
      totalCost += result.costLamports;
    }

    const callerAfter = await getAgent(`${TEST_PREFIX}agent_a`);
    const calleeAfter = await getAgent(`${TEST_PREFIX}agent_b`);

    expect(callerAfter.balanceLamports).toBe(callerBefore.balanceLamports - totalCost);
    expect(calleeAfter.pendingLamports).toBe(calleeBefore.pendingLamports + totalCost);
  });

  await test("tool usage count should match actual calls", async () => {
    // Count existing usage
    const countBefore = await query(
      `SELECT COUNT(*) as count FROM tool_usage 
       WHERE caller_agent_id = $1 AND callee_agent_id = $2`,
      [`${TEST_PREFIX}agent_a`, `${TEST_PREFIX}agent_c`]
    );

    // Make 3 calls
    for (let i = 0; i < 3; i++) {
      await onToolExecuted(
        `${TEST_PREFIX}agent_a`,
        `${TEST_PREFIX}agent_c`,
        "analyze",
        50
      );
    }

    const countAfter = await query(
      `SELECT COUNT(*) as count FROM tool_usage 
       WHERE caller_agent_id = $1 AND callee_agent_id = $2`,
      [`${TEST_PREFIX}agent_a`, `${TEST_PREFIX}agent_c`]
    );

    expect(Number(countAfter.rows[0].count)).toBe(Number(countBefore.rows[0].count) + 3);
  });
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  log("\n" + "═".repeat(60), "cyan");
  log("    AGENTPAY INTEGRATION TESTS", "cyan");
  log("═".repeat(60), "cyan");

  try {
    await cleanup();
    await setupTestAgents();
    await setupTestTools();

    await runAgentCrudTests();
    await runToolPricingTests();
    await runExecutionTests();
    await runMeterServiceTests();
    await runMetricsTests();
    await runSettlementEligibilityTests();
    await runAtomicityTests();

    await cleanup();

    // Summary
    log("\n" + "═".repeat(60), "cyan");
    log(`  RESULTS: ${passed} passed, ${failed} failed`, failed > 0 ? "red" : "green");
    log("═".repeat(60), "cyan");

    if (errors.length > 0) {
      log("\nFailed tests:", "red");
      errors.forEach((e) => log(`  • ${e}`, "red"));
    }

    process.exit(failed > 0 ? 1 : 0);
  } catch (err: any) {
    log(`\n[FATAL] Test suite crashed: ${err.message}`, "red");
    console.error(err);
    process.exit(1);
  }
}

main();
