import { 
  onToolExecuted, 
  calculateCost, 
  PRICING_CONSTANTS, 
  checkSettlementEligibility, 
  settleAgent,
  getAgent,
  getToolUsageHistory 
} from "./pricingService";
import { sendMicropayment } from "./solanaService";

/**
 * logToolCall: Execute tool with per-tool pricing enforcement
 *
 * This is the **new** metering function that integrates AgentPay pricing.
 * Now supports per-tool pricing - each tool can have its own rate.
 *
 * Workflow:
 *   1. Call onToolExecuted (gets tool-specific rate, enforces balance, records ledger)
 *   2. Returns actual cost in lamports + rate used
 *   3. Fails atomically if balance insufficient
 *
 * @param callerId - Agent making the call
 * @param calleeId - Agent being called
 * @param toolName - Name of the tool
 * @param tokensUsed - Tokens consumed
 * @returns { callerId, calleeId, toolName, tokensUsed, costLamports, ratePer1kTokens }
 * @throws Error if balance insufficient or transaction fails
 */
export async function logToolCall(
  callerId: string,
  calleeId: string,
  toolName: string,
  tokensUsed: number
) {
  try {
    // Validate token count
    if (tokensUsed > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
      throw new Error(
        `Tokens used (${tokensUsed}) exceeds maximum (${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL})`
      );
    }

    // Execute pricing logic (atomic deduct/credit) - now with per-tool pricing
    const result = await onToolExecuted(callerId, calleeId, toolName, tokensUsed);

    // AUTO-SETTLEMENT: Check if callee should be settled automatically
    // This runs async (fire-and-forget) to not block the response
    tryAutoSettle(calleeId).catch((err) => {
      console.warn(`Auto-settle check failed for ${calleeId}:`, err.message);
    });

    return {
      callerId,
      calleeId,
      toolName,
      tokensUsed,
      costLamports: result.costLamports,
      ratePer1kTokens: result.ratePer1kTokens,
      toolId: result.toolId,
    };
  } catch (err) {
    console.error(
      `❌ Tool execution failed for ${callerId} → ${calleeId}: ${(err as Error).message}`
    );
    throw err;
  }
}

/**
 * tryAutoSettle: Automatically settle agent if eligible
 * 
 * Called after each tool execution. If the callee's pending balance
 * exceeds MIN_PAYOUT_LAMPORTS, settlement is triggered automatically.
 * 
 * This ensures:
 * - No manual settlement triggers needed
 * - Agents get paid as soon as threshold is reached
 * - Fully autonomous payment flow
 */
async function tryAutoSettle(agentId: string): Promise<void> {
  try {
    const eligible = await checkSettlementEligibility(agentId);
    if (!eligible) return;

    // Get agent's public key for settlement
    const agent = await getAgent(agentId);
    
    if (!agent.publicKey) {
      console.warn(`Auto-settle skipped: ${agentId} has no public_key`);
      return;
    }

    const recipientPublicKey = agent.publicKey;

    console.log(`🔄 Auto-settling ${agentId}...`);
    
    const settlement = await settleAgent(agentId, async (_recipientId, lamports) => {
      return await sendMicropayment(
        process.env.SOLANA_PAYER_PUBLIC_KEY || "",
        recipientPublicKey,
        lamports
      );
    });

    console.log(`✅ Auto-settlement complete: ${agentId} received ${settlement.netLamports} lamports (tx: ${settlement.txSignature})`);
  } catch (err) {
    // Log but don't throw - auto-settle failure shouldn't break execution
    console.error(`Auto-settle failed for ${agentId}:`, (err as Error).message);
  }
}

/**
 * Legacy compatibility: getToolCallHistory
 * Fetches execution ledger for auditing
 */
export async function getToolCallHistory(
  agentId: string,
  limit: number = 100,
  asCallee: boolean = false
) {
  try {
    const history = await getToolUsageHistory(agentId, limit, asCallee);
    return history;
  } catch (err) {
    console.warn(
      "⚠️  Tool history fetch failed:",
      (err as Error).message
    );
    return [];
  }
}

