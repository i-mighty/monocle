import { onToolExecuted, PRICING_CONSTANTS } from "./pricingService.js";
import { query } from "../db/client.js";
/**
 * logToolCall: Execute tool with pricing enforcement
 *
 * This is the **new** metering function that integrates AgentPay pricing.
 * It replaces the old mock cost system with deterministic, trustless pricing.
 *
 * Workflow:
 *   1. Call onToolExecuted (enforces balance, calculates cost, records ledger)
 *   2. Returns actual cost in lamports
 *   3. Fails atomically if balance insufficient
 *
 * @param callerId - Agent making the call
 * @param calleeId - Agent being called
 * @param toolName - Name of the tool
 * @param tokensUsed - Tokens consumed
 * @returns { callerId, calleeId, toolName, tokensUsed, costLamports }
 * @throws Error if balance insufficient or transaction fails
 */
export async function logToolCall(callerId, calleeId, toolName, tokensUsed) {
    try {
        // Validate token count
        if (tokensUsed > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
            throw new Error(`Tokens used (${tokensUsed}) exceeds maximum (${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL})`);
        }
        // Execute pricing logic (atomic deduct/credit)
        const costLamports = await onToolExecuted(callerId, calleeId, toolName, tokensUsed);
        return {
            callerId,
            calleeId,
            toolName,
            tokensUsed,
            costLamports,
        };
    }
    catch (err) {
        console.error(`❌ Tool execution failed for ${callerId} → ${calleeId}: ${err.message}`);
        throw err;
    }
}
/**
 * Legacy compatibility: getToolCallHistory
 * Fetches execution ledger for auditing
 */
export async function getToolCallHistory(agentId, limit = 100, asCallee = false) {
    try {
        const column = asCallee ? "callee_agent_id" : "caller_agent_id";
        const { rows } = await query(`select caller_agent_id, callee_agent_id, tool_name, tokens_used, cost_lamports, created_at
       from tool_usage
       where ${column} = $1
       order by created_at desc
       limit $2`, [agentId, limit]);
        return rows || [];
    }
    catch (err) {
        console.warn("⚠️  Tool history fetch failed:", err.message);
        return [];
    }
}
//# sourceMappingURL=meterService.js.map