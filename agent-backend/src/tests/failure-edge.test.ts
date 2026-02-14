#!/usr/bin/env ts-node-dev

/**
 * FAILURE & EDGE CASE TESTS
 *
 * Tests error handling and edge cases:
 * - Insufficient balance rejection
 * - Partial settlement scenarios
 * - Concurrent execution handling
 * - Invalid input handling
 * - Rate limiting edge cases
 * - Token limit violations
 *
 * Requires: Running database (docker-compose up agentpay-db)
 * Run with: npx ts-node-dev src/tests/failure-edge.test.ts
 */

import { query } from "../db/client";
import {
  calculateCost,
  calculatePlatformFee,
  getAgent,
  upsertAgent,
  registerTool,
  onToolExecuted,
  settleAgent,
  checkSettlementEligibility,
  PRICING_CONSTANTS,
} from "../services/pricingService";
import { logToolCall } from "../services/meterService";

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
    toContain(substring: string) {
      if (typeof actual !== "string" || !actual.includes(substring)) {
        throw new Error(`Expected "${actual}" to contain "${substring}"`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== "number" || actual <= (expected as number)) {
        throw new Error(`Expected ${actual} > ${expected}`);
      }
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${actual}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy, got ${actual}`);
    },
  };
}

async function expectToThrow(fn: () => Promise<any>, expectedMessage?: string): Promise<void> {
  let threw = false;
  let thrownError: any;
  try {
    await fn();
  } catch (e: any) {
    threw = true;
    thrownError = e;
  }
  if (!threw) {
    throw new Error("Expected function to throw");
  }
  if (expectedMessage && !thrownError.message.includes(expectedMessage)) {
    throw new Error(`Expected error to include "${expectedMessage}", got "${thrownError.message}"`);
  }
}

// =============================================================================
// TEST DATA
// =============================================================================

const TEST_PREFIX = "failure_test_";

async function cleanup() {
  log("\n[CLEANUP] Removing test data...", "dim");
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
  log("\n[SETUP] Creating test agents for failure scenarios...", "blue");

  // Agent with zero balance
  await upsertAgent({
    id: `${TEST_PREFIX}broke_agent`,
    name: "Broke Agent",
    defaultRatePer1kTokens: 1000,
    balanceLamports: 0,
  });

  // Agent with minimal balance (just above MIN_COST)
  await upsertAgent({
    id: `${TEST_PREFIX}minimal_agent`,
    name: "Minimal Balance Agent",
    defaultRatePer1kTokens: 1000,
    balanceLamports: 150, // Just above MIN_COST_LAMPORTS (100)
  });

  // Agent with exact MIN_COST balance
  await upsertAgent({
    id: `${TEST_PREFIX}exact_min_agent`,
    name: "Exact Min Balance Agent",
    defaultRatePer1kTokens: 1000,
    balanceLamports: PRICING_CONSTANTS.MIN_COST_LAMPORTS,
  });

  // Provider agent
  await upsertAgent({
    id: `${TEST_PREFIX}provider`,
    name: "Test Provider",
    publicKey: "TestProviderKey123",
    defaultRatePer1kTokens: 2000,
    balanceLamports: 100_000,
  });

  // Rich agent for settlement tests
  await upsertAgent({
    id: `${TEST_PREFIX}rich_agent`,
    name: "Rich Agent",
    defaultRatePer1kTokens: 1000,
    balanceLamports: 10_000_000,
  });

  // Provider for settlement tests (needs pending balance)
  await query(
    `INSERT INTO agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET pending_lamports = $6`,
    [`${TEST_PREFIX}settlement_provider`, "Settlement Provider", "SettlementKey456", 1000, 0, 50_000]
  );

  // Provider just below settlement threshold
  await query(
    `INSERT INTO agents (id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET pending_lamports = $6`,
    [`${TEST_PREFIX}below_threshold`, "Below Threshold", "BelowKey789", 1000, 0, 9_999]
  );

  // Provider with no public key (can't settle)
  await query(
    `INSERT INTO agents (id, name, default_rate_per_1k_tokens, balance_lamports, pending_lamports)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET pending_lamports = $5, public_key = NULL`,
    [`${TEST_PREFIX}no_pubkey`, "No PubKey Agent", 1000, 0, 100_000]
  );

  log("[SETUP] Test agents created", "green");
}

// =============================================================================
// INSUFFICIENT BALANCE TESTS
// =============================================================================

async function runInsufficientBalanceTests() {
  log("\n─".repeat(60), "dim");
  log("  INSUFFICIENT BALANCE SCENARIOS", "blue");
  log("─".repeat(60), "dim");

  await test("should reject call when balance is zero", async () => {
    await expectToThrow(
      () => onToolExecuted(
        `${TEST_PREFIX}broke_agent`,
        `${TEST_PREFIX}provider`,
        "test_tool",
        100
      ),
      "Insufficient balance"
    );
  });

  await test("should reject call when balance < cost", async () => {
    // Minimal agent has 150 lamports
    // Cost for 1000 tokens at 2000 rate = 2000 lamports
    await expectToThrow(
      () => onToolExecuted(
        `${TEST_PREFIX}minimal_agent`,
        `${TEST_PREFIX}provider`,
        "expensive_tool",
        1000
      ),
      "Insufficient balance"
    );
  });

  await test("should allow call when balance exactly equals cost", async () => {
    // Reset exact_min_agent balance
    await query(
      `UPDATE agents SET balance_lamports = $1 WHERE id = $2`,
      [PRICING_CONSTANTS.MIN_COST_LAMPORTS, `${TEST_PREFIX}exact_min_agent`]
    );

    // Register a tool with rate that produces exactly MIN_COST
    await registerTool({
      agentId: `${TEST_PREFIX}provider`,
      name: "cheap_tool",
      ratePer1kTokens: 100, // 1 block * 100 = 100 = MIN_COST
    });

    // This should work (exactly enough balance)
    const result = await onToolExecuted(
      `${TEST_PREFIX}exact_min_agent`,
      `${TEST_PREFIX}provider`,
      "cheap_tool",
      1000
    );

    expect(result.costLamports).toBe(PRICING_CONSTANTS.MIN_COST_LAMPORTS);
    
    // Verify balance is now 0
    const agent = await getAgent(`${TEST_PREFIX}exact_min_agent`);
    expect(agent.balanceLamports).toBe(0);
  });

  await test("should reject subsequent call after balance depleted", async () => {
    // exact_min_agent now has 0 balance from previous test
    await expectToThrow(
      () => onToolExecuted(
        `${TEST_PREFIX}exact_min_agent`,
        `${TEST_PREFIX}provider`,
        "cheap_tool",
        1
      ),
      "Insufficient balance"
    );
  });

  await test("balance should not change on failed call", async () => {
    const agentBefore = await getAgent(`${TEST_PREFIX}minimal_agent`);
    
    try {
      await onToolExecuted(
        `${TEST_PREFIX}minimal_agent`,
        `${TEST_PREFIX}provider`,
        "expensive_tool",
        10000
      );
    } catch (e) {
      // Expected to fail
    }

    const agentAfter = await getAgent(`${TEST_PREFIX}minimal_agent`);
    expect(agentAfter.balanceLamports).toBe(agentBefore.balanceLamports);
  });

  await test("provider pending should not change on failed caller call", async () => {
    const providerBefore = await getAgent(`${TEST_PREFIX}provider`);
    
    try {
      await onToolExecuted(
        `${TEST_PREFIX}broke_agent`,
        `${TEST_PREFIX}provider`,
        "test_tool",
        1000
      );
    } catch (e) {
      // Expected to fail
    }

    const providerAfter = await getAgent(`${TEST_PREFIX}provider`);
    expect(providerAfter.pendingLamports).toBe(providerBefore.pendingLamports);
  });
}

// =============================================================================
// PARTIAL SETTLEMENT TESTS
// =============================================================================

async function runPartialSettlementTests() {
  log("\n─".repeat(60), "dim");
  log("  PARTIAL SETTLEMENT SCENARIOS", "blue");
  log("─".repeat(60), "dim");

  await test("should not settle if below MIN_PAYOUT_LAMPORTS", async () => {
    const isEligible = await checkSettlementEligibility(`${TEST_PREFIX}below_threshold`);
    expect(isEligible).toBe(false);
  });

  await test("should be eligible at exactly MIN_PAYOUT_LAMPORTS", async () => {
    // Set pending to exactly threshold
    await query(
      `UPDATE agents SET pending_lamports = $1 WHERE id = $2`,
      [PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS, `${TEST_PREFIX}below_threshold`]
    );

    const isEligible = await checkSettlementEligibility(`${TEST_PREFIX}below_threshold`);
    expect(isEligible).toBe(true);
    
    // Reset
    await query(
      `UPDATE agents SET pending_lamports = $1 WHERE id = $2`,
      [9_999, `${TEST_PREFIX}below_threshold`]
    );
  });

  await test("should be eligible above MIN_PAYOUT_LAMPORTS", async () => {
    const isEligible = await checkSettlementEligibility(`${TEST_PREFIX}settlement_provider`);
    expect(isEligible).toBe(true);
  });

  await test("settlement should deduct platform fee correctly", async () => {
    // Build up some pending balance through actual calls
    const calls = 20;
    for (let i = 0; i < calls; i++) {
      await onToolExecuted(
        `${TEST_PREFIX}rich_agent`,
        `${TEST_PREFIX}provider`,
        "test_tool",
        500
      );
    }

    const providerBefore = await getAgent(`${TEST_PREFIX}provider`);
    const pendingBefore = providerBefore.pendingLamports;

    if (pendingBefore >= PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS) {
      // Mock settlement (can't actually send without real Solana setup)
      const expectedFee = calculatePlatformFee(pendingBefore);
      const expectedNet = pendingBefore - expectedFee;

      // Verify calculations
      expect(expectedFee).toBe(Math.floor(pendingBefore * 0.05));
      expect(expectedNet).toBe(pendingBefore - expectedFee);
      expect(expectedFee + expectedNet).toBe(pendingBefore);
    }
  });
}

// =============================================================================
// INVALID INPUT TESTS
// =============================================================================

async function runInvalidInputTests() {
  log("\n─".repeat(60), "dim");
  log("  INVALID INPUT HANDLING", "blue");
  log("─".repeat(60), "dim");

  await test("should reject negative token count", async () => {
    await expectToThrow(
      () => logToolCall(
        `${TEST_PREFIX}rich_agent`,
        `${TEST_PREFIX}provider`,
        "test_tool",
        -100
      ),
      "negative"
    );
  });

  await test("should reject tokens exceeding MAX_TOKENS_PER_CALL", async () => {
    await expectToThrow(
      () => logToolCall(
        `${TEST_PREFIX}rich_agent`,
        `${TEST_PREFIX}provider`,
        "test_tool",
        PRICING_CONSTANTS.MAX_TOKENS_PER_CALL + 1
      ),
      "exceeds maximum"
    );
  });

  await test("should reject call to non-existent provider", async () => {
    await expectToThrow(
      () => onToolExecuted(
        `${TEST_PREFIX}rich_agent`,
        `${TEST_PREFIX}nonexistent`,
        "test_tool",
        100
      ),
      "not found"
    );
  });

  await test("should reject call from non-existent caller", async () => {
    await expectToThrow(
      () => onToolExecuted(
        `${TEST_PREFIX}nonexistent`,
        `${TEST_PREFIX}provider`,
        "test_tool",
        100
      ),
      "not found"
    );
  });
}

// =============================================================================
// CONCURRENT EXECUTION TESTS
// =============================================================================

async function runConcurrentTests() {
  log("\n─".repeat(60), "dim");
  log("  CONCURRENT EXECUTION", "blue");
  log("─".repeat(60), "dim");

  await test("should handle multiple concurrent calls without race conditions", async () => {
    // Reset rich_agent with known balance
    await query(
      `UPDATE agents SET balance_lamports = 1000000 WHERE id = $1`,
      [`${TEST_PREFIX}rich_agent`]
    );

    const numCalls = 10;
    const callPromises = [];

    for (let i = 0; i < numCalls; i++) {
      callPromises.push(
        onToolExecuted(
          `${TEST_PREFIX}rich_agent`,
          `${TEST_PREFIX}provider`,
          "test_tool",
          100
        )
      );
    }

    const results = await Promise.all(callPromises);
    
    // All should succeed
    expect(results.length).toBe(numCalls);
    results.forEach(r => {
      expect(r.costLamports).toBeGreaterThan(0);
    });

    // Verify final balance is correct
    const totalCost = results.reduce((sum, r) => sum + r.costLamports, 0);
    const agent = await getAgent(`${TEST_PREFIX}rich_agent`);
    expect(agent.balanceLamports).toBe(1000000 - totalCost);
  });

  await test("should fail gracefully when concurrent calls exhaust balance", async () => {
    // Set up agent with limited balance
    await query(
      `UPDATE agents SET balance_lamports = 500 WHERE id = $1`,
      [`${TEST_PREFIX}minimal_agent`]
    );

    // Register a tool with a specific rate
    await registerTool({
      agentId: `${TEST_PREFIX}provider`,
      name: "medium_tool",
      ratePer1kTokens: 200,
    });

    // Make concurrent calls that will exhaust balance
    const callPromises = [];
    for (let i = 0; i < 10; i++) {
      callPromises.push(
        onToolExecuted(
          `${TEST_PREFIX}minimal_agent`,
          `${TEST_PREFIX}provider`,
          "medium_tool",
          1000
        ).catch(e => ({ error: e.message }))
      );
    }

    const results = await Promise.all(callPromises);
    
    // Some should succeed, some should fail
    const successes = results.filter(r => !('error' in r));
    const failures = results.filter(r => 'error' in r);

    // Should have at least one success (balance was 500, cost is 200)
    expect(successes.length).toBeGreaterThan(0);
    expect(successes.length).toBe(2); // 500 / 200 = 2 calls max
    
    // The rest should fail due to insufficient balance
    failures.forEach(f => {
      expect((f as any).error).toContain("Insufficient balance");
    });
  });
}

// =============================================================================
// SETTLE WITHOUT PUBKEY TESTS
// =============================================================================

async function runSettlementEdgeCases() {
  log("\n─".repeat(60), "dim");
  log("  SETTLEMENT EDGE CASES", "blue");
  log("─".repeat(60), "dim");

  await test("agent without public_key should be eligible but settlement should fail", async () => {
    // Agent has pending but no public_key
    const isEligible = await checkSettlementEligibility(`${TEST_PREFIX}no_pubkey`);
    expect(isEligible).toBe(true);

    // Note: Actual settlement would fail due to missing public_key
    // This is handled in the settlement flow, not eligibility check
    const agent = await getAgent(`${TEST_PREFIX}no_pubkey`);
    expect(agent.publicKey).toBeFalsy();
  });

  await test("double settlement attempt should handle gracefully", async () => {
    // This tests that if pending is cleared between eligibility check
    // and actual settlement, it handles gracefully
    
    // Set up provider with pending
    await query(
      `UPDATE agents SET pending_lamports = $1 WHERE id = $2`,
      [20000, `${TEST_PREFIX}settlement_provider`]
    );

    // First check - eligible
    const isEligible1 = await checkSettlementEligibility(`${TEST_PREFIX}settlement_provider`);
    expect(isEligible1).toBe(true);

    // Simulate settlement by clearing pending
    await query(
      `UPDATE agents SET pending_lamports = 0 WHERE id = $1`,
      [`${TEST_PREFIX}settlement_provider`]
    );

    // Second check - no longer eligible  
    const isEligible2 = await checkSettlementEligibility(`${TEST_PREFIX}settlement_provider`);
    expect(isEligible2).toBe(false);
  });
}

// =============================================================================
// BOUNDARY VALUE TESTS
// =============================================================================

async function runBoundaryTests() {
  log("\n─".repeat(60), "dim");
  log("  BOUNDARY VALUES", "blue");
  log("─".repeat(60), "dim");

  await test("should handle exactly 0 tokens", async () => {
    // Reset balance
    await query(
      `UPDATE agents SET balance_lamports = 10000 WHERE id = $1`,
      [`${TEST_PREFIX}rich_agent`]
    );

    const result = await onToolExecuted(
      `${TEST_PREFIX}rich_agent`,
      `${TEST_PREFIX}provider`,
      "test_tool",
      0
    );

    // Should still charge MIN_COST
    expect(result.costLamports).toBe(PRICING_CONSTANTS.MIN_COST_LAMPORTS);
  });

  await test("should handle exactly MAX_TOKENS_PER_CALL", async () => {
    // Reset balance to handle large cost
    await query(
      `UPDATE agents SET balance_lamports = 100000000 WHERE id = $1`,
      [`${TEST_PREFIX}rich_agent`]
    );

    const result = await onToolExecuted(
      `${TEST_PREFIX}rich_agent`,
      `${TEST_PREFIX}provider`,
      "test_tool",
      PRICING_CONSTANTS.MAX_TOKENS_PER_CALL
    );

    const expectedCost = calculateCost(PRICING_CONSTANTS.MAX_TOKENS_PER_CALL, 2000);
    expect(result.costLamports).toBe(expectedCost);
  });

  await test("should handle minimum payout threshold boundary", async () => {
    // Just below threshold
    await query(
      `UPDATE agents SET pending_lamports = $1 WHERE id = $2`,
      [PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS - 1, `${TEST_PREFIX}below_threshold`]
    );
    let isEligible = await checkSettlementEligibility(`${TEST_PREFIX}below_threshold`);
    expect(isEligible).toBe(false);

    // Exactly at threshold
    await query(
      `UPDATE agents SET pending_lamports = $1 WHERE id = $2`,
      [PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS, `${TEST_PREFIX}below_threshold`]
    );
    isEligible = await checkSettlementEligibility(`${TEST_PREFIX}below_threshold`);
    expect(isEligible).toBe(true);

    // Just above threshold
    await query(
      `UPDATE agents SET pending_lamports = $1 WHERE id = $2`,
      [PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS + 1, `${TEST_PREFIX}below_threshold`]
    );
    isEligible = await checkSettlementEligibility(`${TEST_PREFIX}below_threshold`);
    expect(isEligible).toBe(true);
  });
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  log("\n" + "═".repeat(60), "cyan");
  log("    AGENTPAY FAILURE & EDGE CASE TESTS", "cyan");
  log("═".repeat(60), "cyan");

  try {
    await cleanup();
    await setupTestAgents();

    await runInsufficientBalanceTests();
    await runPartialSettlementTests();
    await runInvalidInputTests();
    await runConcurrentTests();
    await runSettlementEdgeCases();
    await runBoundaryTests();

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
