/**
 * Pricing Service (Drizzle ORM + Per-Tool Pricing)
 *
 * This service handles:
 * - Deterministic cost calculation
 * - Per-tool pricing (each tool can have its own rate)
 * - Balance enforcement (no debt)
 * - Atomic transactions
 * - Settlement with platform fees
 */

import { eq, and, desc, sql, sum, count } from "drizzle-orm";
import { db, pool, agents, tools, toolUsage, settlements, platformRevenue } from "../db/client";
import type { Agent, Tool, ToolUsage, Settlement } from "../db/client";

// =============================================================================
// CONSTANTS
// =============================================================================
export const PRICING_CONSTANTS = {
  /** Default rate per 1,000 tokens (lamports) */
  DEFAULT_RATE_PER_1K_TOKENS: 1000,

  /** Minimum cost per call (prevents spam/DoS) */
  MIN_COST_LAMPORTS: 100,

  /** Maximum tokens per single call (prevents runaway execution) */
  MAX_TOKENS_PER_CALL: 100_000,

  /** Platform fee percentage (0.0 to 1.0) */
  PLATFORM_FEE_PERCENT: 0.05, // 5%

  /** Minimum payout threshold before settlement is triggered */
  MIN_PAYOUT_LAMPORTS: 10_000,
} as const;

// =============================================================================
// PURE FUNCTIONS (No DB, testable in isolation)
// =============================================================================

/**
 * calculateCost: Deterministic pricing formula
 *
 * Formula:
 *   cost = max(ceil(tokens / 1000) * rate_per_1k_tokens, MIN_COST_LAMPORTS)
 *
 * @param tokensUsed - Number of tokens consumed by the call
 * @param ratePer1kTokens - Tool's rate per 1,000 tokens (in lamports)
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

  const tokenBlocks = Math.ceil(tokensUsed / 1000);
  const costBeforeMinimum = tokenBlocks * ratePer1kTokens;
  const finalCost = Math.max(costBeforeMinimum, PRICING_CONSTANTS.MIN_COST_LAMPORTS);

  return Math.floor(finalCost);
}

/**
 * calculatePlatformFee: Deterministic fee calculation
 */
export function calculatePlatformFee(grossLamports: number): number {
  return Math.floor(grossLamports * PRICING_CONSTANTS.PLATFORM_FEE_PERCENT);
}

// =============================================================================
// AGENT OPERATIONS
// =============================================================================

/**
 * Get agent by ID
 */
export async function getAgent(agentId: string): Promise<Agent> {
  if (!db) throw new Error("Database not connected");

  const result = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (result.length === 0) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  return result[0];
}

/**
 * Create or update an agent
 */
export async function upsertAgent(agent: {
  id: string;
  name?: string;
  publicKey?: string;
  defaultRatePer1kTokens?: number;
  balanceLamports?: number;
}): Promise<Agent> {
  if (!db) throw new Error("Database not connected");

  const result = await db
    .insert(agents)
    .values({
      id: agent.id,
      name: agent.name,
      publicKey: agent.publicKey,
      defaultRatePer1kTokens: agent.defaultRatePer1kTokens ?? PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS,
      balanceLamports: agent.balanceLamports ?? 0,
      pendingLamports: 0,
    })
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: agent.name,
        defaultRatePer1kTokens: agent.defaultRatePer1kTokens,
      },
    })
    .returning();

  return result[0];
}

// =============================================================================
// TOOL OPERATIONS (Per-Tool Pricing)
// =============================================================================

/**
 * Register a tool with its pricing
 */
export async function registerTool(tool: {
  agentId: string;
  name: string;
  description?: string;
  ratePer1kTokens: number;
}): Promise<Tool> {
  if (!db) throw new Error("Database not connected");

  // Verify agent exists
  await getAgent(tool.agentId);

  const result = await db
    .insert(tools)
    .values({
      agentId: tool.agentId,
      name: tool.name,
      description: tool.description,
      ratePer1kTokens: tool.ratePer1kTokens,
    })
    .onConflictDoUpdate({
      target: [tools.agentId, tools.name],
      set: {
        description: tool.description,
        ratePer1kTokens: tool.ratePer1kTokens,
        updatedAt: new Date(),
      },
    })
    .returning();

  return result[0];
}

/**
 * Get tool pricing for a specific tool
 *
 * Falls back to agent's default rate if tool not found
 */
export async function getToolPricing(
  agentId: string,
  toolName: string
): Promise<{ toolId: string | null; ratePer1kTokens: number }> {
  if (!db) throw new Error("Database not connected");

  // Try to find specific tool pricing
  const toolResult = await db
    .select()
    .from(tools)
    .where(and(eq(tools.agentId, agentId), eq(tools.name, toolName)))
    .limit(1);

  if (toolResult.length > 0) {
    return {
      toolId: toolResult[0].id,
      ratePer1kTokens: toolResult[0].ratePer1kTokens,
    };
  }

  // Fall back to agent's default rate
  const agent = await getAgent(agentId);
  return {
    toolId: null,
    ratePer1kTokens: agent.defaultRatePer1kTokens,
  };
}

/**
 * List all tools for an agent
 */
export async function listAgentTools(agentId: string): Promise<Tool[]> {
  if (!db) throw new Error("Database not connected");

  return db
    .select()
    .from(tools)
    .where(eq(tools.agentId, agentId))
    .orderBy(tools.name);
}

/**
 * Update tool pricing
 */
export async function updateToolPricing(
  agentId: string,
  toolName: string,
  ratePer1kTokens: number
): Promise<Tool> {
  if (!db) throw new Error("Database not connected");

  const result = await db
    .update(tools)
    .set({ ratePer1kTokens, updatedAt: new Date() })
    .where(and(eq(tools.agentId, agentId), eq(tools.name, toolName)))
    .returning();

  if (result.length === 0) {
    throw new Error(`Tool not found: ${agentId}/${toolName}`);
  }

  return result[0];
}

// =============================================================================
// EXECUTION & PRICING
// =============================================================================

/**
 * onToolExecuted: Core pricing logic with per-tool pricing
 *
 * Workflow:
 *   1. Get tool-specific pricing (or agent default)
 *   2. Calculate cost deterministically
 *   3. Enforce balance constraint (no debt allowed)
 *   4. Deduct from caller, credit to callee (atomic transaction)
 *   5. Record immutable ledger entry
 *
 * @param callerId - Agent ID making the call
 * @param calleeId - Agent ID being called
 * @param toolName - Name of the tool executed
 * @param tokensUsed - Number of tokens consumed
 * @returns Execution result with cost details
 */
export async function onToolExecuted(
  callerId: string,
  calleeId: string,
  toolName: string,
  tokensUsed: number
): Promise<{
  costLamports: number;
  ratePer1kTokens: number;
  toolId: string | null;
  tokensUsed: number;
}> {
  if (!db || !pool) throw new Error("Database not connected");

  // Validate inputs
  if (tokensUsed > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
    throw new Error(
      `Tokens used (${tokensUsed}) exceeds maximum (${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL})`
    );
  }

  // Get tool-specific pricing (or agent default)
  const { toolId, ratePer1kTokens } = await getToolPricing(calleeId, toolName);

  // Calculate cost deterministically
  const cost = calculateCost(tokensUsed, ratePer1kTokens);

  // Fetch caller to check balance
  const caller = await getAgent(callerId);

  // CONSTRAINT: No debt
  if (caller.balanceLamports < cost) {
    throw new Error(
      `Insufficient balance: ${callerId} has ${caller.balanceLamports} lamports, ` +
      `but call costs ${cost} lamports`
    );
  }

  // ATOMIC TRANSACTION using raw SQL for transaction control
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Insert tool usage record
    await client.query(
      `INSERT INTO tool_usage 
       (caller_agent_id, callee_agent_id, tool_id, tool_name, tokens_used, rate_per_1k_tokens, cost_lamports)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [callerId, calleeId, toolId, toolName, tokensUsed, ratePer1kTokens, cost]
    );

    // 2. Deduct from caller's balance
    await client.query(
      "UPDATE agents SET balance_lamports = balance_lamports - $1 WHERE id = $2",
      [cost, callerId]
    );

    // 3. Credit to callee's pending balance
    await client.query(
      "UPDATE agents SET pending_lamports = pending_lamports + $1 WHERE id = $2",
      [cost, calleeId]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`Transaction failed: ${(error as Error).message}`);
  } finally {
    client.release();
  }

  return {
    costLamports: cost,
    ratePer1kTokens,
    toolId,
    tokensUsed,
  };
}

// =============================================================================
// SETTLEMENT
// =============================================================================

/**
 * settleAgent: Execute on-chain settlement
 */
export async function settleAgent(
  agentId: string,
  sendTransaction: (recipientId: string, lamports: number) => Promise<string>
): Promise<{
  settlementId: string;
  agentId: string;
  grossLamports: number;
  platformFeeLamports: number;
  netLamports: number;
  txSignature: string;
  status: string;
}> {
  if (!db || !pool) throw new Error("Database not connected");

  const agent = await getAgent(agentId);
  const pending = agent.pendingLamports;

  if (pending < PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS) {
    throw new Error(
      `Pending balance (${pending}) below minimum payout (${PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS})`
    );
  }

  // Calculate fee
  const fee = calculatePlatformFee(pending);
  const payout = pending - fee;

  // Create settlement record
  const [settlement] = await db
    .insert(settlements)
    .values({
      fromAgentId: agentId,
      toAgentId: agentId,
      grossLamports: pending,
      platformFeeLamports: fee,
      netLamports: payout,
      status: "pending",
    })
    .returning();

  // Send on-chain transaction
  let txSignature: string;
  try {
    txSignature = await sendTransaction(agentId, payout);
  } catch (error) {
    // Mark settlement as failed
    await db
      .update(settlements)
      .set({ status: "failed" })
      .where(eq(settlements.id, settlement.id));
    throw new Error(`On-chain settlement failed: ${(error as Error).message}`);
  }

  // Finalize settlement (atomic)
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Update settlement to confirmed
    await client.query(
      "UPDATE settlements SET tx_signature = $1, status = 'confirmed' WHERE id = $2",
      [txSignature, settlement.id]
    );

    // Clear pending balance
    await client.query(
      "UPDATE agents SET pending_lamports = 0 WHERE id = $1",
      [agentId]
    );

    // Record platform revenue
    await client.query(
      "INSERT INTO platform_revenue (settlement_id, fee_lamports) VALUES ($1, $2)",
      [settlement.id, fee]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`Settlement confirmation failed: ${(error as Error).message}`);
  } finally {
    client.release();
  }

  return {
    settlementId: settlement.id,
    agentId,
    grossLamports: pending,
    platformFeeLamports: fee,
    netLamports: payout,
    txSignature,
    status: "confirmed",
  };
}

/**
 * Check if agent is eligible for settlement
 */
export async function checkSettlementEligibility(agentId: string): Promise<boolean> {
  const agent = await getAgent(agentId);
  return agent.pendingLamports >= PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS;
}

// =============================================================================
// METRICS & ANALYTICS
// =============================================================================

/**
 * Get agent metrics including per-tool breakdown
 */
export async function getAgentMetrics(agentId: string) {
  if (!db) throw new Error("Database not connected");

  const agent = await getAgent(agentId);

  // Get agent's tools with their pricing
  const agentTools = await listAgentTools(agentId);

  // Usage as caller (spending)
  const spendingResult = await db
    .select({
      callCount: count(),
      totalSpend: sum(toolUsage.costLamports),
    })
    .from(toolUsage)
    .where(eq(toolUsage.callerAgentId, agentId));

  // Usage as callee (earnings)
  const earningsResult = await db
    .select({
      callCount: count(),
      totalEarned: sum(toolUsage.costLamports),
    })
    .from(toolUsage)
    .where(eq(toolUsage.calleeAgentId, agentId));

  // Per-tool earnings breakdown
  const toolBreakdown = await db
    .select({
      toolName: toolUsage.toolName,
      callCount: count(),
      totalEarned: sum(toolUsage.costLamports),
      avgTokens: sql<number>`avg(${toolUsage.tokensUsed})::int`,
    })
    .from(toolUsage)
    .where(eq(toolUsage.calleeAgentId, agentId))
    .groupBy(toolUsage.toolName)
    .orderBy(desc(sql`sum(${toolUsage.costLamports})`));

  return {
    agentId,
    defaultRatePer1kTokens: agent.defaultRatePer1kTokens,
    balanceLamports: agent.balanceLamports,
    pendingLamports: agent.pendingLamports,
    tools: agentTools.map((t) => ({
      name: t.name,
      ratePer1kTokens: t.ratePer1kTokens,
      description: t.description,
    })),
    usage: {
      callCount: Number(spendingResult[0]?.callCount || 0),
      totalSpend: Number(spendingResult[0]?.totalSpend || 0),
    },
    earnings: {
      callCount: Number(earningsResult[0]?.callCount || 0),
      totalEarned: Number(earningsResult[0]?.totalEarned || 0),
      byTool: toolBreakdown.map((t) => ({
        toolName: t.toolName,
        callCount: Number(t.callCount),
        totalEarned: Number(t.totalEarned || 0),
        avgTokens: t.avgTokens || 0,
      })),
    },
  };
}

/**
 * Get tool execution history
 */
export async function getToolUsageHistory(
  agentId: string,
  limit: number = 100,
  asCallee: boolean = false
): Promise<ToolUsage[]> {
  if (!db) throw new Error("Database not connected");

  const column = asCallee ? toolUsage.calleeAgentId : toolUsage.callerAgentId;

  return db
    .select()
    .from(toolUsage)
    .where(eq(column, agentId))
    .orderBy(desc(toolUsage.createdAt))
    .limit(limit);
}

/**
 * Get settlement history
 */
export async function getSettlementHistory(
  agentId: string,
  limit: number = 50
): Promise<Settlement[]> {
  if (!db) throw new Error("Database not connected");

  return db
    .select()
    .from(settlements)
    .where(eq(settlements.toAgentId, agentId))
    .orderBy(desc(settlements.createdAt))
    .limit(limit);
}

