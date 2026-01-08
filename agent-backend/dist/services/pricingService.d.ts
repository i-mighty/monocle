/**
 * CONSTANTS: Non-negotiable system-wide constraints
 */
export declare const PRICING_CONSTANTS: {
    readonly MIN_COST_LAMPORTS: 100;
    readonly MAX_TOKENS_PER_CALL: 100000;
    readonly PLATFORM_FEE_PERCENT: 0.05;
    readonly MIN_PAYOUT_LAMPORTS: 10000;
};
/**
 * calculateCost: Deterministic pricing formula
 *
 * Formula:
 *   cost = max(ceil(tokens / 1000) * rate_per_1k_tokens, MIN_COST_LAMPORTS)
 *
 * This ensures:
 *   - Integer-only arithmetic (no floating-point disputes)
 *   - Same inputs → same cost (determinism)
 *   - Minimum charge prevents spam
 *
 * @param tokensUsed - Number of tokens consumed by the call
 * @param ratePer1kTokens - Agent's fixed rate per 1,000 tokens (in lamports)
 * @returns Cost in lamports (always integer)
 */
export declare function calculateCost(tokensUsed: number, ratePer1kTokens: number): number;
/**
 * onToolExecuted: Core pricing logic
 *
 * Workflow:
 *   1. Fetch agent pricing & balances
 *   2. Calculate cost deterministically
 *   3. Enforce balance constraint (no debt allowed)
 *   4. Deduct from caller, credit to callee (atomic transaction)
 *   5. Record immutable ledger entry
 *
 * This is the ATOMIC UNIT of AgentPay economics.
 *
 * @param callerId - Agent ID making the call
 * @param calleeId - Agent ID being called
 * @param toolName - Name of the tool executed
 * @param tokensUsed - Number of tokens consumed
 * @returns Cost in lamports
 * @throws Error if balance insufficient or agents missing
 */
export declare function onToolExecuted(callerId: string, calleeId: string, toolName: string, tokensUsed: number): Promise<number>;
/**
 * settleAgent: Execute on-chain settlement
 *
 * Workflow:
 *   1. Fetch agent's pending balance
 *   2. Calculate platform fee
 *   3. Create settlement record (pending)
 *   4. Send on-chain transaction
 *   5. On confirmation, clear pending and record platform fee
 *   6. On failure, mark failed (retry manually)
 *
 * @param agentId - Agent to settle
 * @param sendTransaction - Function to execute the on-chain transfer
 * @returns Settlement record
 */
export declare function settleAgent(agentId: string, sendTransaction: (recipientId: string, lamports: number) => Promise<string>): Promise<{
    settlementId: string;
    agentId: string;
    pending: number;
    platformFee: number;
    payout: number;
    txSignature: string;
    status: string;
}>;
/**
 * checkSettlementEligibility: Check if agent should be settled
 */
export declare function checkSettlementEligibility(agentId: string): Promise<boolean>;
/**
 * getAgentMetrics: Fetch agent's current economic state
 */
export declare function getAgentMetrics(agentId: string): Promise<{
    agentId: string;
    ratePer1kTokens: number;
    balanceLamports: number;
    pendingLamports: number;
    usage: {
        callCount: number;
        totalSpend: number;
    };
    earnings: {
        callCount: number;
        totalEarned: number;
    };
}>;
//# sourceMappingURL=pricingService.d.ts.map