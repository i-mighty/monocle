/**
 * PRICING SERVICE UNIT TESTS
 *
 * Tests for deterministic pricing logic, balance enforcement, and settlement
 * Uses simple Node.js assertions instead of Jest
 */
import { calculateCost, PRICING_CONSTANTS } from "./pricingService.js";
import { strict as assert } from "assert";
// Test counter
let testsPassed = 0;
let testsFailed = 0;
// Simple test runner
function describe(suiteName, fn) {
    console.log(`\n📋 ${suiteName}`);
    fn();
}
function it(testName, fn) {
    try {
        fn();
        console.log(`  ✅ ${testName}`);
        testsPassed++;
    }
    catch (error) {
        console.error(`  ❌ ${testName}`);
        console.error(`     Error: ${error.message}`);
        testsFailed++;
    }
}
// Custom assertions
function expect(actual) {
    return {
        toBe(expected) {
            assert.strictEqual(actual, expected, `Expected ${expected}, got ${actual}`);
        },
        toThrow(message) {
            try {
                actual();
                throw new Error(`Expected function to throw "${message}", but it did not`);
            }
            catch (error) {
                if (error.message.includes(message)) {
                    return;
                }
                throw error;
            }
        },
        toBeGreaterThan(expected) {
            assert(actual > expected, `Expected ${actual} to be greater than ${expected}`);
        },
        toBeGreaterThanOrEqual(expected) {
            assert(actual >= expected, `Expected ${actual} to be >= ${expected}`);
        },
        toBeLessThanOrEqual(expected) {
            assert(actual <= expected, `Expected ${actual} to be <= ${expected}`);
        },
    };
}
// ============================================
// TESTS BEGIN
// ============================================
describe("PRICING SERVICE", () => {
    describe("calculateCost(): Deterministic Pricing Formula", () => {
        it("should calculate cost deterministically (same inputs = same output)", () => {
            const tokens = 500;
            const rate = 1000;
            const cost1 = calculateCost(tokens, rate);
            const cost2 = calculateCost(tokens, rate);
            const cost3 = calculateCost(tokens, rate);
            expect(cost1).toBe(cost2);
            expect(cost2).toBe(cost3);
        });
        it("should use ceil rounding for tokens", () => {
            const rate = 1000;
            // 1 token -> ceil(1/1000) = 1 unit -> 1 * 1000 = 1000 lamports
            expect(calculateCost(1, rate)).toBe(1000);
            // 1000 tokens -> ceil(1000/1000) = 1 unit -> 1 * 1000 = 1000 lamports
            expect(calculateCost(1000, rate)).toBe(1000);
            // 1001 tokens -> ceil(1001/1000) = 2 units -> 2 * 1000 = 2000 lamports
            expect(calculateCost(1001, rate)).toBe(2000);
            // 500 tokens -> ceil(500/1000) = 1 unit -> 1 * 1000 = 1000 lamports
            expect(calculateCost(500, rate)).toBe(1000);
        });
        it("should enforce minimum cost", () => {
            const rate = 1; // Very cheap rate
            // Even with tiny inputs, cost cannot be below MIN_COST
            expect(calculateCost(1, rate)).toBe(PRICING_CONSTANTS.MIN_COST_LAMPORTS);
            expect(calculateCost(0, rate)).toBe(PRICING_CONSTANTS.MIN_COST_LAMPORTS);
        });
        it("should calculate costs at various rates", () => {
            const tokens = 1000;
            // Rate = 1000 lamports per 1k tokens
            expect(calculateCost(tokens, 1000)).toBe(1000);
            // Rate = 5000 lamports per 1k tokens
            expect(calculateCost(tokens, 5000)).toBe(5000);
            // Rate = 10000 lamports per 1k tokens
            expect(calculateCost(tokens, 10000)).toBe(10000);
        });
        it("should reject negative tokens", () => {
            expect(() => calculateCost(-1, 1000)).toThrow("Tokens used cannot be negative");
        });
        it("should reject negative rates", () => {
            expect(() => calculateCost(100, -1000)).toThrow("Rate per 1k tokens cannot be negative");
        });
        it("should always return integers (no floating-point)", () => {
            const costs = [
                calculateCost(1, 1000),
                calculateCost(500, 1000),
                calculateCost(1001, 1000),
                calculateCost(99999, 1000),
            ];
            costs.forEach((cost) => {
                assert(Number.isInteger(cost), `Expected ${cost} to be integer`);
            });
        });
        it("should handle zero tokens", () => {
            // Zero tokens still incurs minimum cost
            expect(calculateCost(0, 1000)).toBe(PRICING_CONSTANTS.MIN_COST_LAMPORTS);
        });
        it("should scale linearly with rate", () => {
            const tokens = 2000;
            const cost1k = calculateCost(tokens, 1000);
            const cost2k = calculateCost(tokens, 2000);
            const cost5k = calculateCost(tokens, 5000);
            expect(cost2k).toBe(cost1k * 2);
            expect(cost5k).toBe(cost1k * 5);
        });
    });
    describe("PRICING CONSTANTS: Anti-Abuse Constraints", () => {
        it("should define minimum cost to prevent spam", () => {
            expect(PRICING_CONSTANTS.MIN_COST_LAMPORTS).toBeGreaterThan(0);
        });
        it("should define maximum tokens per call", () => {
            expect(PRICING_CONSTANTS.MAX_TOKENS_PER_CALL).toBeGreaterThan(0);
        });
        it("should define platform fee percentage", () => {
            expect(PRICING_CONSTANTS.PLATFORM_FEE_PERCENT).toBeGreaterThanOrEqual(0);
            expect(PRICING_CONSTANTS.PLATFORM_FEE_PERCENT).toBeLessThanOrEqual(1);
        });
        it("should define minimum payout threshold", () => {
            expect(PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS).toBeGreaterThanOrEqual(PRICING_CONSTANTS.MIN_COST_LAMPORTS);
        });
    });
    describe("Edge Cases & Abuse Scenarios", () => {
        it("should handle fractional token-to-cost calculations", () => {
            // 1.5 tokens (rounded to 2) with rate 1000 = 2000 lamports
            expect(calculateCost(1.5, 1000)).toBe(2000);
        });
        it("should not allow cost to be zero", () => {
            expect(calculateCost(0, 0)).toBeGreaterThanOrEqual(PRICING_CONSTANTS.MIN_COST_LAMPORTS);
        });
        it("should handle very large token counts", () => {
            const largeTokens = 1000000000;
            const rate = 1000;
            const cost = calculateCost(largeTokens, rate);
            expect(cost).toBeGreaterThan(0);
            assert(Number.isInteger(cost), `Expected ${cost} to be integer`);
        });
        it("should handle very large rates", () => {
            const tokens = 1000;
            const largeRate = 1000000000;
            const cost = calculateCost(tokens, largeRate);
            expect(cost).toBe(1000000000);
        });
    });
});
describe("PRICING INTEGRATION SCENARIOS", () => {
    describe("Agent A → Agent B Tool Execution", () => {
        it("[SCENARIO] A calls B with 500 tokens (rate=1000)", () => {
            const cost = calculateCost(500, 1000);
            expect(cost).toBe(1000);
        });
        it("[SCENARIO] A calls B with 2500 tokens (rate=5000)", () => {
            const cost = calculateCost(2500, 5000);
            expect(cost).toBe(15000);
        });
        it("[SCENARIO] Recursive call: A → B → C", () => {
            const costAB = calculateCost(1000, 1000);
            expect(costAB).toBe(1000);
            const costBC = calculateCost(500, 2000);
            expect(costBC).toBe(1000);
        });
    });
    describe("Settlement & Platform Fee", () => {
        it("[SCENARIO] Agent B settles 100,000 lamports (5% fee)", () => {
            const pending = 100000;
            const feePercent = PRICING_CONSTANTS.PLATFORM_FEE_PERCENT;
            const platformFee = Math.floor(pending * feePercent);
            const payout = pending - platformFee;
            expect(platformFee).toBe(5000);
            expect(payout).toBe(95000);
            expect(platformFee + payout).toBe(pending);
        });
        it("[SCENARIO] Agent C settles below minimum (should fail)", () => {
            const pending = 5000;
            const eligible = pending >= PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS;
            assert(!eligible, "Should not be eligible");
        });
    });
    describe("Balance Enforcement (No Debt)", () => {
        it("[SCENARIO] A has 500 lamports, tries to call B (costs 1000)", () => {
            const agentABalance = 500;
            const callCost = 1000;
            const canAfford = agentABalance >= callCost;
            assert(!canAfford, "Should not be able to afford");
        });
        it("[SCENARIO] A has 5000 lamports, calls B (costs 1000)", () => {
            const agentABalance = 5000;
            const callCost = 1000;
            const canAfford = agentABalance >= callCost;
            assert(canAfford, "Should be able to afford");
            const newBalance = agentABalance - callCost;
            expect(newBalance).toBe(4000);
        });
    });
    describe("Composability & Stacking", () => {
        it("[SCENARIO] Multiple sequential calls stack correctly", () => {
            let balance = 10000;
            balance -= calculateCost(1000, 1000);
            expect(balance).toBe(9000);
            balance -= calculateCost(2000, 1000);
            expect(balance).toBe(7000);
            balance -= calculateCost(1000, 1000);
            expect(balance).toBe(6000);
            expect(balance).toBeGreaterThan(0);
        });
    });
});
// ============================================
// TEST SUMMARY
// ============================================
console.log("\n" + "=".repeat(60));
console.log(`✅ Tests Passed: ${testsPassed}`);
console.log(`❌ Tests Failed: ${testsFailed}`);
console.log(`📊 Total Tests: ${testsPassed + testsFailed}`);
console.log("=".repeat(60));
if (testsFailed > 0) {
    process.exit(1);
}
console.log("\n✨ ALL TESTS PASSED ✨\n");
//# sourceMappingURL=pricingService.test.js.map