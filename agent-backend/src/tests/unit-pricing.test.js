#!/usr/bin/env node

/**
 * COMPREHENSIVE UNIT TESTS - PRICING & COST MATH
 *
 * Pure unit tests for all deterministic pricing functions (no DB required)
 * Tests cost calculation, fee calculation, and edge cases
 *
 * Run with: node src/tests/unit-pricing.test.js
 */

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
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

let totalPassed = 0;
let totalFailed = 0;
let currentSuite = "";

function describe(name, fn) {
  currentSuite = name;
  log(`\n${"─".repeat(70)}`, "dim");
  log(`  ${name}`, "blue");
  log(`${"─".repeat(70)}`, "dim");
  fn();
}

function it(name, fn) {
  try {
    fn();
    log(`    ✓ ${name}`, "green");
    totalPassed++;
  } catch (err) {
    log(`    ✗ ${name}`, "red");
    log(`      Error: ${err.message}`, "red");
    totalFailed++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected) {
      if (!(actual > expected)) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected) {
      if (!(actual >= expected)) {
        throw new Error(`Expected ${actual} to be >= ${expected}`);
      }
    },
    toBeLessThan(expected) {
      if (!(actual < expected)) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
    toBeLessThanOrEqual(expected) {
      if (!(actual <= expected)) {
        throw new Error(`Expected ${actual} to be <= ${expected}`);
      }
    },
    toThrow(expectedMessage) {
      let threw = false;
      let thrownError;
      try {
        actual();
      } catch (e) {
        threw = true;
        thrownError = e;
      }
      if (!threw) {
        throw new Error(`Expected function to throw`);
      }
      if (expectedMessage && !thrownError.message.includes(expectedMessage)) {
        throw new Error(`Expected error to include "${expectedMessage}", got "${thrownError.message}"`);
      }
    },
    not: {
      toBe(expected) {
        if (actual === expected) {
          throw new Error(`Expected ${actual} not to be ${expected}`);
        }
      },
      toThrow() {
        let threw = false;
        try {
          actual();
        } catch (e) {
          threw = true;
        }
        if (threw) {
          throw new Error(`Expected function not to throw`);
        }
      },
    },
  };
}

// =============================================================================
// PRICING CONSTANTS (from pricingService.ts)
// =============================================================================

const PRICING_CONSTANTS = {
  DEFAULT_RATE_PER_1K_TOKENS: 1000,
  MIN_COST_LAMPORTS: 100,
  MAX_TOKENS_PER_CALL: 100_000,
  PLATFORM_FEE_PERCENT: 0.05, // 5%
  MIN_PAYOUT_LAMPORTS: 10_000,
};

// =============================================================================
// FUNCTIONS UNDER TEST (copied from pricingService.ts for isolation)
// =============================================================================

/**
 * calculateCost: Deterministic pricing formula
 * cost = max(ceil(tokens / 1000) * rate_per_1k_tokens, MIN_COST_LAMPORTS)
 */
function calculateCost(tokensUsed, ratePer1kTokens) {
  if (tokensUsed < 0) {
    throw new Error("Tokens used cannot be negative");
  }
  if (ratePer1kTokens < 0) {
    throw new Error("Rate per 1k tokens cannot be negative");
  }

  const tokenBlocks = Math.ceil(tokensUsed / 1000);
  const costBeforeMinimum = tokenBlocks * ratePer1kTokens;
  const finalCost = Math.max(costBeforeMinimum, PRICING_CONSTANTS.MIN_COST_LAMPORTS);

  return Math.floor(finalCost);
}

/**
 * calculatePlatformFee: Deterministic fee calculation
 */
function calculatePlatformFee(grossLamports) {
  return Math.floor(grossLamports * PRICING_CONSTANTS.PLATFORM_FEE_PERCENT);
}

/**
 * calculateNetPayout: Amount after platform fee
 */
function calculateNetPayout(grossLamports) {
  const fee = calculatePlatformFee(grossLamports);
  return grossLamports - fee;
}

/**
 * Calculate settlement amounts
 */
function calculateSettlement(pendingLamports) {
  const platformFee = calculatePlatformFee(pendingLamports);
  const netPayout = pendingLamports - platformFee;
  return { grossLamports: pendingLamports, platformFee, netPayout };
}

/**
 * Check if amount meets minimum payout threshold
 */
function meetsPayoutThreshold(pendingLamports) {
  return pendingLamports >= PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS;
}

// =============================================================================
// TESTS
// =============================================================================

function runTests() {
  log("\n" + "═".repeat(70), "cyan");
  log("       AGENTPAY UNIT TESTS - PRICING & COST MATH", "cyan");
  log("═".repeat(70), "cyan");

  // ─────────────────────────────────────────────────────────────────────────
  // COST CALCULATION TESTS
  // ─────────────────────────────────────────────────────────────────────────

  describe("calculateCost() - Basic Cases", () => {
    it("should return correct cost for exact 1000 token blocks", () => {
      expect(calculateCost(1000, 1000)).toBe(1000);
      expect(calculateCost(2000, 1000)).toBe(2000);
      expect(calculateCost(5000, 1000)).toBe(5000);
    });

    it("should round up to next token block (ceiling)", () => {
      expect(calculateCost(1, 1000)).toBe(1000);    // 1 token = 1 block
      expect(calculateCost(500, 1000)).toBe(1000);  // 500 tokens = 1 block
      expect(calculateCost(999, 1000)).toBe(1000);  // 999 tokens = 1 block
      expect(calculateCost(1001, 1000)).toBe(2000); // 1001 tokens = 2 blocks
    });

    it("should apply different rates correctly", () => {
      expect(calculateCost(1000, 500)).toBe(500);   // Lower rate
      expect(calculateCost(1000, 2000)).toBe(2000); // Higher rate
      expect(calculateCost(1000, 5000)).toBe(5000); // Premium rate
    });

    it("should be deterministic (same input = same output)", () => {
      for (let i = 0; i < 10; i++) {
        expect(calculateCost(1234, 1000)).toBe(2000);
      }
    });
  });

  describe("calculateCost() - Minimum Cost Enforcement", () => {
    it("should enforce MIN_COST_LAMPORTS for very small calls", () => {
      // 1 token at low rate would be below minimum
      expect(calculateCost(1, 10)).toBe(100);  // Would be 10, enforced to 100
      expect(calculateCost(10, 5)).toBe(100);  // Would be 5, enforced to 100
    });

    it("should not apply minimum when cost exceeds it", () => {
      expect(calculateCost(1000, 200)).toBe(200);  // Above minimum, keep as-is
      expect(calculateCost(1000, 1000)).toBe(1000);
    });

    it("should return exactly MIN_COST_LAMPORTS at threshold", () => {
      // 100 tokens at rate 1000 = 1 block * 1000 = 1000 (above min)
      // Need rate where 1 block = exactly 100
      expect(calculateCost(1000, 100)).toBe(100);  // Exactly at minimum
    });
  });

  describe("calculateCost() - Edge Cases", () => {
    it("should handle zero tokens", () => {
      expect(calculateCost(0, 1000)).toBe(100);  // Enforced minimum
    });

    it("should throw for negative tokens", () => {
      expect(() => calculateCost(-1, 1000)).toThrow("negative");
      expect(() => calculateCost(-100, 1000)).toThrow("negative");
    });

    it("should throw for negative rate", () => {
      expect(() => calculateCost(100, -1)).toThrow("negative");
    });

    it("should handle very large token counts", () => {
      const cost = calculateCost(100_000, 1000);
      expect(cost).toBe(100_000);  // 100 blocks * 1000 = 100,000
    });

    it("should handle very large rates", () => {
      const cost = calculateCost(1000, 1_000_000);
      expect(cost).toBe(1_000_000);
    });

    it("should handle zero rate (enforced minimum)", () => {
      expect(calculateCost(1000, 0)).toBe(100);  // Enforced minimum
    });

    it("should always return integers (no floating point)", () => {
      const costs = [
        calculateCost(333, 1000),
        calculateCost(777, 999),
        calculateCost(1, 1),
        calculateCost(12345, 6789),
      ];
      costs.forEach(cost => {
        expect(Number.isInteger(cost)).toBe(true);
      });
    });
  });

  describe("calculateCost() - Precision & Overflow", () => {
    it("should not lose precision with large numbers", () => {
      // Max safe integer is 2^53 - 1 = 9,007,199,254,740,991
      // Our max tokens is 100,000, max reasonable rate is ~1,000,000
      // Max cost = 100 blocks * 1,000,000 = 100,000,000 (safe)
      const cost = calculateCost(100_000, 1_000_000);
      expect(cost).toBe(100_000_000);
    });

    it("should handle fractional block calculations correctly", () => {
      // 1500 tokens = 2 blocks (ceil(1.5) = 2)
      expect(calculateCost(1500, 1000)).toBe(2000);
      
      // 2999 tokens = 3 blocks (ceil(2.999) = 3)  
      expect(calculateCost(2999, 1000)).toBe(3000);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PLATFORM FEE TESTS
  // ─────────────────────────────────────────────────────────────────────────

  describe("calculatePlatformFee() - Basic Cases", () => {
    it("should calculate 5% fee correctly", () => {
      expect(calculatePlatformFee(1000)).toBe(50);     // 5% of 1000
      expect(calculatePlatformFee(10000)).toBe(500);   // 5% of 10000
      expect(calculatePlatformFee(100000)).toBe(5000); // 5% of 100000
    });

    it("should floor the result (no fractional lamports)", () => {
      expect(calculatePlatformFee(1)).toBe(0);   // 0.05 -> 0
      expect(calculatePlatformFee(19)).toBe(0);  // 0.95 -> 0
      expect(calculatePlatformFee(20)).toBe(1);  // 1.0 -> 1
      expect(calculatePlatformFee(21)).toBe(1);  // 1.05 -> 1
    });

    it("should handle zero amount", () => {
      expect(calculatePlatformFee(0)).toBe(0);
    });
  });

  describe("calculatePlatformFee() - Edge Cases", () => {
    it("should handle large amounts", () => {
      expect(calculatePlatformFee(1_000_000_000)).toBe(50_000_000);
    });

    it("should always return integers", () => {
      const fees = [
        calculatePlatformFee(1),
        calculatePlatformFee(33),
        calculatePlatformFee(777),
        calculatePlatformFee(12345),
      ];
      fees.forEach(fee => {
        expect(Number.isInteger(fee)).toBe(true);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // NET PAYOUT TESTS
  // ─────────────────────────────────────────────────────────────────────────

  describe("calculateNetPayout() - Basic Cases", () => {
    it("should return gross minus platform fee", () => {
      expect(calculateNetPayout(1000)).toBe(950);   // 1000 - 50
      expect(calculateNetPayout(10000)).toBe(9500); // 10000 - 500
    });

    it("should be consistent with calculatePlatformFee", () => {
      const gross = 12345;
      const fee = calculatePlatformFee(gross);
      const net = calculateNetPayout(gross);
      expect(gross - fee).toBe(net);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SETTLEMENT CALCULATION TESTS
  // ─────────────────────────────────────────────────────────────────────────

  describe("calculateSettlement() - Settlement Breakdown", () => {
    it("should return correct settlement breakdown", () => {
      const result = calculateSettlement(10000);
      expect(result.grossLamports).toBe(10000);
      expect(result.platformFee).toBe(500);
      expect(result.netPayout).toBe(9500);
    });

    it("should maintain equation: gross = fee + net", () => {
      const testAmounts = [100, 1000, 12345, 99999, 1000000];
      testAmounts.forEach(amount => {
        const result = calculateSettlement(amount);
        expect(result.grossLamports).toBe(result.platformFee + result.netPayout);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // PAYOUT THRESHOLD TESTS
  // ─────────────────────────────────────────────────────────────────────────

  describe("meetsPayoutThreshold() - Eligibility Check", () => {
    it("should return false below threshold", () => {
      expect(meetsPayoutThreshold(0)).toBe(false);
      expect(meetsPayoutThreshold(9999)).toBe(false);
    });

    it("should return true at exact threshold", () => {
      expect(meetsPayoutThreshold(10000)).toBe(true);
    });

    it("should return true above threshold", () => {
      expect(meetsPayoutThreshold(10001)).toBe(true);
      expect(meetsPayoutThreshold(100000)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MATHEMATICAL PROPERTIES TESTS
  // ─────────────────────────────────────────────────────────────────────────

  describe("Mathematical Properties", () => {
    it("cost should be monotonic with token count", () => {
      const rate = 1000;
      let prevCost = 0;
      for (let tokens = 0; tokens <= 5000; tokens += 100) {
        const cost = calculateCost(tokens, rate);
        expect(cost).toBeGreaterThanOrEqual(prevCost);
        prevCost = cost;
      }
    });

    it("cost should be monotonic with rate", () => {
      const tokens = 1000;
      let prevCost = 0;
      for (let rate = 0; rate <= 5000; rate += 100) {
        const cost = calculateCost(tokens, rate);
        expect(cost).toBeGreaterThanOrEqual(prevCost);
        prevCost = cost;
      }
    });

    it("fee should always be less than gross", () => {
      const testAmounts = [100, 1000, 10000, 100000, 1000000];
      testAmounts.forEach(gross => {
        const fee = calculatePlatformFee(gross);
        expect(fee).toBeLessThan(gross);
      });
    });

    it("net payout should always be positive for positive gross", () => {
      const testAmounts = [1, 100, 1000, 10000];
      testAmounts.forEach(gross => {
        const net = calculateNetPayout(gross);
        expect(net).toBeGreaterThan(0);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // REAL-WORLD SCENARIOS
  // ─────────────────────────────────────────────────────────────────────────

  describe("Real-World Scenarios", () => {
    it("should handle typical GPT-4 call (2000 tokens at premium rate)", () => {
      // GPT-4 style call: 2000 tokens at 5000 lamports per 1k
      const cost = calculateCost(2000, 5000);
      expect(cost).toBe(10000); // 2 blocks * 5000 = 10,000 lamports
    });

    it("should handle small utility call (100 tokens at standard rate)", () => {
      const cost = calculateCost(100, 1000);
      expect(cost).toBe(1000); // 1 block * 1000 = 1000 (above min)
    });

    it("should handle chat message (50 tokens at low rate)", () => {
      const cost = calculateCost(50, 500);
      expect(cost).toBe(500); // 1 block * 500 = 500 (above min)
    });

    it("should calculate day of agent activity correctly", () => {
      // Simulate 100 calls averaging 500 tokens each at 1000 rate
      let totalCost = 0;
      for (let i = 0; i < 100; i++) {
        totalCost += calculateCost(500, 1000);
      }
      expect(totalCost).toBe(100000); // 100 * 1000 = 100,000 lamports
    });

    it("should calculate settlement for typical provider", () => {
      // Provider earned 50,000 lamports in pending
      const settlement = calculateSettlement(50000);
      expect(settlement.platformFee).toBe(2500);  // 5%
      expect(settlement.netPayout).toBe(47500);   // 95%
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BOUNDARY TESTS
  // ─────────────────────────────────────────────────────────────────────────

  describe("Boundary Tests", () => {
    it("should handle MAX_TOKENS_PER_CALL", () => {
      const cost = calculateCost(PRICING_CONSTANTS.MAX_TOKENS_PER_CALL, 1000);
      expect(cost).toBe(100000); // 100 blocks * 1000
    });

    it("should handle MIN_COST_LAMPORTS exactly", () => {
      // Find a case that produces exactly MIN_COST_LAMPORTS
      expect(calculateCost(1000, 100)).toBe(100);  // Exactly at minimum
    });

    it("rate at boundary where cost equals minimum", () => {
      // At rate 100, 1 block = 100 lamports = MIN_COST_LAMPORTS
      expect(calculateCost(1000, 99)).toBe(100);  // Below min, enforced
      expect(calculateCost(1000, 100)).toBe(100); // Exactly at min
      expect(calculateCost(1000, 101)).toBe(101); // Above min, use actual
    });
  });

  // Print summary
  log("\n" + "═".repeat(70), "cyan");
  log(`  RESULTS: ${totalPassed} passed, ${totalFailed} failed`, totalFailed > 0 ? "red" : "green");
  log("═".repeat(70), "cyan");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests();
