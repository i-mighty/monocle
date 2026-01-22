import { query } from "../db/client";

/**
 * CONSTANTS: Non-negotiable system-wide constraints
 */
export const PRICING_CONSTANTS = {
  // Minimum cost per call (prevents spam/DoS)
  MIN_COST_LAMPORTS: 100,

  // Maximum tokens per single call (prevents runaway execution)
  MAX_TOKENS_PER_CALL: 100000,

  // Platform fee percentage (0.0 to 1.0)
  PLATFORM_FEE_PERCENT: 0.05, // 5%

  // Minimum payout threshold before settlement is triggered
  MIN_PAYOUT_LAMPORTS: 10000,
} as const;

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
export function calculateCost(
  tokensUsed: number,
  ratePer1kTokens: number
): number {
  if (tokensUsed < 0) {
    throw new Error("Tokens used cannot be negative");
  }
  if (ratePer1kTokens < 0) {
    throw new Error("Rate per 1k tokens cannot be negative");
  }

  // Formula: ceil(tokens / 1000) * rate_per_1k_tokens
  // Ceil first (token blocks), then multiply by rate
  const tokenBlocks = Math.ceil(tokensUsed / 1000);
  const costBeforeMinimum = tokenBlocks * ratePer1kTokens;
  const finalCost = Math.max(costBeforeMinimum, PRICING_CONSTANTS.MIN_COST_LAMPORTS);

  return Math.floor(finalCost); // Ensure integer
}

/**
 * getAgent: Fetch agent pricing & balance data
 */
async function getAgent(agentId: string) {
  const result = await query(
    "select id, rate_per_1k_tokens, balance_lamports, pending_lamports from agents where id = $1",
    [agentId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  return result.rows[0] as {
    id: string;
    rate_per_1k_tokens: number;
    balance_lamports: number;
    pending_lamports: number;
  };
}

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
export async function onToolExecuted(
  callerId: string,
  calleeId: string,
  toolName: string,
  tokensUsed: number
): Promise<number> {
  // Validate inputs
  if (tokensUsed > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
    throw new Error(
      `Tokens used (${tokensUsed}) exceeds maximum (${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL})`
    );
  }

  // Fetch both agents (throws if missing)
  const caller = await getAgent(callerId);
  const callee = await getAgent(calleeId);

  // Calculate cost deterministically
  const cost = calculateCost(tokensUsed, callee.rate_per_1k_tokens);

  // CONSTRAINT: No debt. Reject if caller cannot afford the call.
  if (caller.balance_lamports < cost) {
    throw new Error(
      `Insufficient balance: ${callerId} has ${caller.balance_lamports} lamports, ` +
      `but call costs ${cost} lamports`
    );
  }

  // ATOMIC TRANSACTION: Deduct + Credit + Log
  try {
    await query("BEGIN");

    // Record immutable execution (append-only)
    await query(
      `insert into tool_usage (caller_agent_id, callee_agent_id, tool_name, tokens_used, rate_per_1k_tokens, cost_lamports)
       values ($1, $2, $3, $4, $5, $6)`,
      [callerId, calleeId, toolName, tokensUsed, callee.rate_per_1k_tokens, cost]
    );

    // Deduct from caller's balance
    await query(
      "update agents set balance_lamports = balance_lamports - $1 where id = $2",
      [cost, callerId]
    );

    // Credit to callee's pending balance
    await query(
      "update agents set pending_lamports = pending_lamports + $1 where id = $2",
      [cost, calleeId]
    );

    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    throw new Error(`Transaction failed: ${(error as Error).message}`);
  }

  return cost;
}

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
export async function settleAgent(
  agentId: string,
  sendTransaction: (recipientId: string, lamports: number) => Promise<string>
) {
  const agent = await getAgent(agentId);

  const pending = agent.pending_lamports;
  if (pending < PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS) {
    throw new Error(
      `Pending balance (${pending}) below minimum payout (${PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS})`
    );
  }

  // Calculate fee
  const platformFee = Math.floor(pending * PRICING_CONSTANTS.PLATFORM_FEE_PERCENT);
  const payout = pending - platformFee;

  // Create settlement record (status = pending)
  const settlementResult = await query(
    `insert into settlements (from_agent_id, to_agent_id, gross_lamports, platform_fee_lamports, net_lamports, status)
     values ($1, $1, $2, $3, $4, 'pending')
     returning id, from_agent_id, to_agent_id, gross_lamports, platform_fee_lamports, net_lamports, status`,
    [agentId, pending, platformFee, payout]
  );

  if (settlementResult.rows.length === 0) {
    throw new Error("Failed to create settlement record");
  }

  const settlement = settlementResult.rows[0] as {
    id: string;
    from_agent_id: string;
    to_agent_id: string;
    gross_lamports: number;
    platform_fee_lamports: number;
    net_lamports: number;
    status: string;
  };

  // Send on-chain transaction
  let txSignature: string;
  try {
    txSignature = await sendTransaction(agentId, payout);
  } catch (error) {
    // Mark settlement as failed
    await query(
      "update settlements set status = 'failed' where id = $1",
      [settlement.id]
    );
    throw new Error(`On-chain settlement failed: ${(error as Error).message}`);
  }

  // On confirmation, clear pending and record platform fee (atomic)
  try {
    await query("BEGIN");

    // Update settlement to confirmed
    await query(
      "update settlements set tx_signature = $1, status = 'confirmed' where id = $2",
      [txSignature, settlement.id]
    );

    // Clear pending balance
    await query(
      "update agents set pending_lamports = 0 where id = $1",
      [agentId]
    );

    // Record platform revenue
    await query(
      "insert into platform_revenue (settlement_id, fee_lamports) values ($1, $2)",
      [settlement.id, platformFee]
    );

    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    throw new Error(`Settlement confirmation failed: ${(error as Error).message}`);
  }

  return {
    settlementId: settlement.id,
    agentId,
    pending,
    platformFee,
    payout,
    txSignature,
    status: "confirmed",
  };
}

/**
 * checkSettlementEligibility: Check if agent should be settled
 */
export async function checkSettlementEligibility(agentId: string): Promise<boolean> {
  const agent = await getAgent(agentId);
  return agent.pending_lamports >= PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS;
}

/**
 * getAgentMetrics: Fetch agent's current economic state
 */
export async function getAgentMetrics(agentId: string) {
  const agent = await getAgent(agentId);

  const usageResult = await query(
    `select count(*) as call_count, sum(cost_lamports) as total_spend
     from tool_usage where caller_agent_id = $1`,
    [agentId]
  );

  const earningsResult = await query(
    `select count(*) as call_count, sum(cost_lamports) as total_earned
     from tool_usage where callee_agent_id = $1`,
    [agentId]
  );

  return {
    agentId,
    ratePer1kTokens: agent.rate_per_1k_tokens,
    balanceLamports: agent.balance_lamports,
    pendingLamports: agent.pending_lamports,
    usage: {
      callCount: parseInt(usageResult.rows[0]?.call_count || 0),
      totalSpend: parseInt(usageResult.rows[0]?.total_spend || 0),
    },
    earnings: {
      callCount: parseInt(earningsResult.rows[0]?.call_count || 0),
      totalEarned: parseInt(earningsResult.rows[0]?.total_earned || 0),
    },
  };
}
