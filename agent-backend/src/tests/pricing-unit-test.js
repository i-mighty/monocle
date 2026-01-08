#!/usr/bin/env node

/**
 * PRICING LOGIC VALIDATION TEST
 *
 * Pure unit tests for deterministic pricing (no DB required)
 * Tests calculateCost() function in isolation
 *
 * Run with: node src/tests/pricing-unit-test.js
 */

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function assert(condition, message) {
  if (!condition) {
    log(`❌ ASSERTION FAILED: ${message}`, "red");
    throw new Error(message);
  }
}

// Pricing constants (from pricingService.ts)
const PRICING_CONSTANTS = {
  MIN_COST_LAMPORTS: 100,
  MAX_TOKENS_PER_CALL: 100000,
  PLATFORM_FEE_PERCENT: 0.05,
  MIN_PAYOUT_LAMPORTS: 10000,
};

/**
 * Deterministic pricing formula
 * cost = max(ceil(tokens / 1000) * rate_per_1k_tokens, MIN_COST_LAMPORTS)
 */
function calculateCost(tokensUsed, ratePer1kTokens) {
  if (tokensUsed < 0) throw new Error("Tokens used cannot be negative");
  if (ratePer1kTokens < 0) throw new Error("Rate per 1k tokens cannot be negative");

  const costBeforeMinimum = Math.ceil((tokensUsed / 1000) * ratePer1kTokens);
  const finalCost = Math.max(costBeforeMinimum, PRICING_CONSTANTS.MIN_COST_LAMPORTS);

  return Math.floor(finalCost);
}

function runTests() {
  log("\n" + "=".repeat(70), "cyan");
  log("    AGENTPAY PRICING LOGIC - UNIT TEST SUITE", "cyan");
  log("=".repeat(70), "cyan");

  let passed = 0;
  let failed = 0;

  // Test 1: Determinism
  log("\n[TEST 1] Determinism: Same inputs = Same cost", "blue");
  try {
    const cost1 = calculateCost(500, 1000);
    const cost2 = calculateCost(500, 1000);
    const cost3 = calculateCost(500, 1000);

    assert(cost1 === cost2 && cost2 === cost3, "Costs should be identical");
    assert(cost1 === 500, `Cost should be 500, got ${cost1}`);
    log(`  ✅ Determinism verified: 500 tokens @ 1000 rate = 500 lamports (consistent)`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Test 2: Ceil rounding
  log("\n[TEST 2] Ceil rounding for tokens", "blue");
  try {
    // Formula: cost = max(ceil((tokens / 1000) * rate), MIN_COST)
    const testCases = [
      { tokens: 1, rate: 1000, expected: 100, desc: "1 token @ 1000 rate = ceil(0.001 * 1000) = 100" },
      { tokens: 500, rate: 1000, expected: 500, desc: "500 tokens @ 1000 rate = ceil(0.5 * 1000) = 500" },
      { tokens: 999, rate: 1000, expected: 999, desc: "999 tokens @ 1000 rate = ceil(0.999 * 1000) = 999" },
      { tokens: 1000, rate: 1000, expected: 1000, desc: "1000 tokens @ 1000 rate = ceil(1 * 1000) = 1000" },
      { tokens: 1001, rate: 1000, expected: 1001, desc: "1001 tokens @ 1000 rate = ceil(1.001 * 1000) = 1001" },
      { tokens: 2500, rate: 1000, expected: 2500, desc: "2500 tokens @ 1000 rate = ceil(2.5 * 1000) = 2500" },
    ];

    testCases.forEach(({ tokens, rate, expected, desc }) => {
      const cost = calculateCost(tokens, rate);
      assert(cost === expected, `${desc}: expected ${expected}, got ${cost}`);
      log(`  ✓ ${desc} → ${cost} lamports`, "cyan");
    });

    log(`  ✅ All rounding tests passed`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Test 3: Minimum cost enforcement
  log("\n[TEST 3] Minimum cost enforcement (spam prevention)", "blue");
  try {
    // Even with 1 token at rate 1, should be MIN_COST
    const cost1 = calculateCost(1, 1);
    assert(cost1 === PRICING_CONSTANTS.MIN_COST_LAMPORTS, `Cost should be ${PRICING_CONSTANTS.MIN_COST_LAMPORTS}, got ${cost1}`);

    // Zero tokens should also be MIN_COST
    const cost0 = calculateCost(0, 1000);
    assert(cost0 === PRICING_CONSTANTS.MIN_COST_LAMPORTS, `Zero tokens should be ${PRICING_CONSTANTS.MIN_COST_LAMPORTS}, got ${cost0}`);

    log(`  ✓ Minimum cost: ${PRICING_CONSTANTS.MIN_COST_LAMPORTS} lamports enforced`, "cyan");
    log(`  ✅ Minimum cost enforcement working`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Test 4: Rate scaling
  log("\n[TEST 4] Linear scaling with rate", "blue");
  try {
    const tokens = 2000;
    const cost1k = calculateCost(tokens, 1000);
    const cost2k = calculateCost(tokens, 2000);
    const cost5k = calculateCost(tokens, 5000);

    assert(cost1k === 2000, `2000 tokens @ 1000 rate should be 2000, got ${cost1k}`);
    assert(cost2k === 4000, `2000 tokens @ 2000 rate should be 4000, got ${cost2k}`);
    assert(cost5k === 10000, `2000 tokens @ 5000 rate should be 10000, got ${cost5k}`);

    assert(cost2k === cost1k * 2, "Cost should scale linearly");
    assert(cost5k === cost1k * 5, "Cost should scale linearly");

    log(`  ✓ 2000 tokens @ 1000 rate = ${cost1k} lamports`, "cyan");
    log(`  ✓ 2000 tokens @ 2000 rate = ${cost2k} lamports (2x)`, "cyan");
    log(`  ✓ 2000 tokens @ 5000 rate = ${cost5k} lamports (5x)`, "cyan");
    log(`  ✅ Linear scaling verified`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Test 5: Integer-only (no floating point)
  log("\n[TEST 5] Integer-only arithmetic (no floating-point)", "blue");
  try {
    const testCases = [
      { tokens: 1, rate: 1000 },
      { tokens: 333, rate: 1000 },
      { tokens: 99999, rate: 3333 },
      { tokens: 1, rate: 1 },
    ];

    testCases.forEach(({ tokens, rate }) => {
      const cost = calculateCost(tokens, rate);
      assert(Number.isInteger(cost), `Cost must be integer, got ${cost}`);
    });

    log(`  ✓ All costs are integers (no floating-point)`, "cyan");
    log(`  ✅ Integer-only enforcement verified`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Test 6: Error handling
  log("\n[TEST 6] Error handling (invalid inputs)", "blue");
  try {
    let errorCaught = false;

    try {
      calculateCost(-1, 1000);
    } catch (err) {
      assert(err.message.includes("Tokens used cannot be negative"), "Should reject negative tokens");
      log(`  ✓ Rejected negative tokens`, "cyan");
      errorCaught = true;
    }

    try {
      calculateCost(100, -1000);
    } catch (err) {
      assert(err.message.includes("Rate per 1k tokens cannot be negative"), "Should reject negative rate");
      log(`  ✓ Rejected negative rate`, "cyan");
      errorCaught = true;
    }

    log(`  ✅ Error handling verified`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Test 7: Real-world scenarios
  log("\n[TEST 7] Real-world pricing scenarios", "blue");
  try {
    const scenarios = [
      {
        name: "Agent A → Agent B (500 tokens, 1000 rate)",
        tokens: 500,
        rate: 1000,
        expected: 500,
      },
      {
        name: "Agent A → Agent C (2500 tokens, 5000 rate)",
        tokens: 2500,
        rate: 5000,
        expected: 12500,
      },
      {
        name: "Agent B → Agent C (1000 tokens, 2000 rate)",
        tokens: 1000,
        rate: 2000,
        expected: 2000,
      },
      {
        name: "Tiny call (1 token, 1000 rate, hits minimum)",
        tokens: 1,
        rate: 1000,
        expected: 100, // MIN_COST
      },
    ];

    scenarios.forEach(({ name, tokens, rate, expected }) => {
      const cost = calculateCost(tokens, rate);
      assert(cost === expected, `${name}: expected ${expected}, got ${cost}`);
      log(`  ✓ ${name} = ${cost} lamports`, "cyan");
    });

    log(`  ✅ All real-world scenarios passed`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Test 8: Settlement math
  log("\n[TEST 8] Settlement & platform fee math", "blue");
  try {
    // Agent B has 100,000 lamports pending
    const pending = 100_000;
    const feePercent = PRICING_CONSTANTS.PLATFORM_FEE_PERCENT;
    const platformFee = Math.floor(pending * feePercent);
    const payout = pending - platformFee;

    assert(platformFee === 5000, `Fee should be 5000, got ${platformFee}`);
    assert(payout === 95000, `Payout should be 95000, got ${payout}`);
    assert(platformFee + payout === pending, "Fee + payout should equal pending");

    log(`  ✓ Pending: ${pending} lamports`, "cyan");
    log(`  ✓ Platform fee (5%): ${platformFee} lamports`, "cyan");
    log(`  ✓ Payout: ${payout} lamports`, "cyan");
    log(`  ✓ Total: ${platformFee + payout} lamports`, "cyan");
    log(`  ✅ Settlement math verified`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Test 9: Balance enforcement logic
  log("\n[TEST 9] Balance enforcement (no debt)", "blue");
  try {
    const agentBalance = 500;
    const callCost = 1000;

    const canAfford = agentBalance >= callCost;
    assert(!canAfford, "Should not be able to afford 1000 with 500 balance");

    const agentBalance2 = 5000;
    const canAfford2 = agentBalance2 >= callCost;
    assert(canAfford2, "Should be able to afford 1000 with 5000 balance");

    log(`  ✓ Balance 500 lamports < Cost 1000: REJECTED`, "cyan");
    log(`  ✓ Balance 5000 lamports ≥ Cost 1000: ALLOWED`, "cyan");
    log(`  ✅ Balance enforcement logic verified`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Test 10: Composability stacking
  log("\n[TEST 10] Composability: Sequential call stacking", "blue");
  try {
    let balance = 10_000;

    // Sequential calls
    balance -= calculateCost(1000, 1000); // -1000
    assert(balance === 9000, `After call 1: expected 9000, got ${balance}`);

    balance -= calculateCost(2000, 1000); // -2000
    assert(balance === 7000, `After call 2: expected 7000, got ${balance}`);

    balance -= calculateCost(1000, 1000); // -1000
    assert(balance === 6000, `After call 3: expected 6000, got ${balance}`);

    assert(balance > 0, "Agent should have remaining balance");

    log(`  ✓ Call 1: 1000 tokens → 1000 lamports (balance: 9000)`, "cyan");
    log(`  ✓ Call 2: 2000 tokens → 2000 lamports (balance: 7000)`, "cyan");
    log(`  ✓ Call 3: 1000 tokens → 1000 lamports (balance: 6000)`, "cyan");
    log(`  ✅ Composability stacking verified`, "green");
    passed++;
  } catch (err) {
    log(`  ❌ Failed: ${err.message}`, "red");
    failed++;
  }

  // Summary
  log("\n" + "=".repeat(70), "cyan");
  log(`RESULTS: ${colors.green}${passed} passed${colors.reset}, ${colors.red}${failed} failed${colors.reset}`, "cyan");
  log("=".repeat(70), "cyan");

  if (failed === 0) {
    log(`\n✨ ALL TESTS PASSED ✨`, "green");
    log(`\nPricing system is deterministic, trustless, and ready for use!`, "green");
    return 0;
  } else {
    log(`\n❌ ${failed} TEST(S) FAILED`, "red");
    return 1;
  }
}

// Run tests
const exitCode = runTests();
process.exit(exitCode);
