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
export declare function logToolCall(callerId: string, calleeId: string, toolName: string, tokensUsed: number): Promise<{
    callerId: string;
    calleeId: string;
    toolName: string;
    tokensUsed: number;
    costLamports: number;
}>;
/**
 * Legacy compatibility: getToolCallHistory
 * Fetches execution ledger for auditing
 */
export declare function getToolCallHistory(agentId: string, limit?: number, asCallee?: boolean): Promise<any[]>;
//# sourceMappingURL=meterService.d.ts.map