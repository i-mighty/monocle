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
 * Quote info for execution with frozen pricing
 */
export interface QuoteInfo {
  quoteId: string;
  quotedAt: Date;
  quoteExpiresAt: Date;
  frozenRate: number;
  frozenCost: number;
}

/**
 * onToolExecuted: Core pricing logic with per-tool pricing and budget guardrails
 *
 * Workflow:
 *   1. Get tool-specific pricing (or use frozen quote price if provided)
 *   2. Calculate cost deterministically
 *   3. Enforce budget guardrails (kill switch, max per call, daily cap, allowlist)
 *   4. Enforce balance constraint (no debt allowed)
 *   5. Deduct from caller, credit to callee (atomic transaction)
 *   6. Record immutable ledger entry with quote reference
 *
 * @param callerId - Agent ID making the call
 * @param calleeId - Agent ID being called
 * @param toolName - Name of the tool executed
 * @param tokensUsed - Number of tokens consumed
 * @param quoteInfo - Optional quote info for frozen pricing
 * @returns Execution result with cost details
 */
export async function onToolExecuted(
  callerId: string,
  calleeId: string,
  toolName: string,
  tokensUsed: number,
  quoteInfo?: QuoteInfo
): Promise<{
  costLamports: number;
  ratePer1kTokens: number;
  toolId: string | null;
  tokensUsed: number;
  usageId: string;
  quoteId?: string;
}> {
  if (!db || !pool) throw new Error("Database not connected");

  // Validate inputs
  if (tokensUsed > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
    throw new Error(
      `Tokens used (${tokensUsed}) exceeds maximum (${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL})`
    );
  }

  // Get tool-specific pricing (or use frozen quote pricing if provided)
  const { toolId, ratePer1kTokens: currentRate } = await getToolPricing(calleeId, toolName);
  
  // Use quote pricing if provided, otherwise use current pricing
  const ratePer1kTokens = quoteInfo ? quoteInfo.frozenRate : currentRate;
  const cost = quoteInfo ? quoteInfo.frozenCost : calculateCost(tokensUsed, ratePer1kTokens);

  // Fetch caller to check balance and budget limits
  const caller = await getAgent(callerId);

  // ==========================================================================
  // BUDGET GUARDRAILS ENFORCEMENT
  // ==========================================================================

  // Get daily spend for cap checking
  const dailySpend = await getAgentDailySpend(callerId);

  // Check all budget constraints
  const budgetCheck = checkBudgetConstraints(caller, calleeId, cost, dailySpend);
  
  if (!budgetCheck.allowed) {
    throw new Error(
      `Budget guardrail violation: ${budgetCheck.violations.join("; ")}`
    );
  }

  // ==========================================================================
  // END BUDGET GUARDRAILS
  // ==========================================================================

  // CONSTRAINT: No debt
  if (caller.balanceLamports < cost) {
    throw new Error(
      `Insufficient balance: ${callerId} has ${caller.balanceLamports} lamports, ` +
      `but call costs ${cost} lamports`
    );
  }

  // ATOMIC TRANSACTION using raw SQL for transaction control
  const client = await pool.connect();
  let usageId: string;
  try {
    await client.query("BEGIN");

    // 1. Insert tool usage record with quote reference if available
    const usageResult = await client.query(
      `INSERT INTO tool_usage 
       (caller_agent_id, callee_agent_id, tool_id, tool_name, tokens_used, rate_per_1k_tokens, cost_lamports, quote_id, quoted_at, quote_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        callerId, 
        calleeId, 
        toolId, 
        toolName, 
        tokensUsed, 
        ratePer1kTokens, 
        cost,
        quoteInfo?.quoteId || null,
        quoteInfo?.quotedAt || null,
        quoteInfo?.quoteExpiresAt || null
      ]
    );
    usageId = usageResult.rows[0].id;

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
    usageId,
    quoteId: quoteInfo?.quoteId,
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

// =============================================================================
// BUDGET GUARDRAILS: Trust & Safety for Autonomous Spending
// =============================================================================

/**
 * Get agent's daily spending (last 24 hours)
 */
export async function getAgentDailySpend(agentId: string): Promise<number> {
  if (!db) throw new Error("Database not connected");

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db
    .select({ totalSpend: sum(toolUsage.costLamports) })
    .from(toolUsage)
    .where(
      and(
        eq(toolUsage.callerAgentId, agentId),
        sql`${toolUsage.createdAt} >= ${oneDayAgo}`
      )
    );

  return Number(result[0]?.totalSpend || 0);
}

/**
 * Get full budget status for an agent
 */
export async function getAgentBudgetStatus(agentId: string): Promise<{
  agentId: string;
  balance: number;
  limits: {
    maxCostPerCall: number | null;
    dailySpendCap: number | null;
    isPaused: boolean;
    allowedCallees: string[] | null;
  };
  dailySpend: {
    used: number;
    remaining: number | null;
    percentUsed: number | null;
  };
  warnings: string[];
}> {
  if (!db) throw new Error("Database not connected");

  const agent = await getAgent(agentId);
  const dailySpend = await getAgentDailySpend(agentId);

  const isPaused = agent.isPaused === "true";
  const dailySpendCap = agent.dailySpendCap;
  const maxCostPerCall = agent.maxCostPerCall;
  const allowedCallees = agent.allowedCallees 
    ? JSON.parse(agent.allowedCallees) as string[]
    : null;

  const warnings: string[] = [];

  // Check for warning conditions
  if (isPaused) {
    warnings.push("Agent spending is PAUSED - no outgoing payments will be processed");
  }

  if (agent.balanceLamports < PRICING_CONSTANTS.MIN_COST_LAMPORTS) {
    warnings.push(`Balance (${agent.balanceLamports}) below minimum call cost (${PRICING_CONSTANTS.MIN_COST_LAMPORTS})`);
  }

  if (dailySpendCap !== null && dailySpend >= dailySpendCap * 0.9) {
    const percentUsed = Math.round((dailySpend / dailySpendCap) * 100);
    warnings.push(`Daily spend at ${percentUsed}% of cap (${dailySpend}/${dailySpendCap} lamports)`);
  }

  return {
    agentId,
    balance: agent.balanceLamports,
    limits: {
      maxCostPerCall: maxCostPerCall ?? null,
      dailySpendCap: dailySpendCap ?? null,
      isPaused,
      allowedCallees,
    },
    dailySpend: {
      used: dailySpend,
      remaining: dailySpendCap !== null ? Math.max(0, dailySpendCap - dailySpend) : null,
      percentUsed: dailySpendCap !== null ? Math.round((dailySpend / dailySpendCap) * 100) : null,
    },
    warnings,
  };
}

/**
 * Update agent budget guardrails
 */
export async function updateAgentBudget(
  agentId: string,
  config: {
    maxCostPerCall?: number | null;
    dailySpendCap?: number | null;
    isPaused?: boolean;
    allowedCallees?: string[] | null;
  }
): Promise<Agent> {
  if (!db) throw new Error("Database not connected");

  // Verify agent exists
  await getAgent(agentId);

  const updateData: Record<string, any> = {};

  if (config.maxCostPerCall !== undefined) {
    updateData.maxCostPerCall = config.maxCostPerCall;
  }

  if (config.dailySpendCap !== undefined) {
    updateData.dailySpendCap = config.dailySpendCap;
  }

  if (config.isPaused !== undefined) {
    updateData.isPaused = config.isPaused ? "true" : "false";
  }

  if (config.allowedCallees !== undefined) {
    updateData.allowedCallees = config.allowedCallees 
      ? JSON.stringify(config.allowedCallees)
      : null;
  }

  if (Object.keys(updateData).length === 0) {
    return getAgent(agentId);
  }

  const result = await db
    .update(agents)
    .set(updateData)
    .where(eq(agents.id, agentId))
    .returning();

  return result[0];
}

/**
 * Check if a call would violate budget guardrails
 */
export function checkBudgetConstraints(
  agent: Agent,
  calleeId: string,
  costLamports: number,
  dailySpendSoFar: number
): { allowed: boolean; violations: string[] } {
  const violations: string[] = [];

  // Kill switch check
  if (agent.isPaused === "true") {
    violations.push("Agent spending is PAUSED");
  }

  // Max cost per call check
  if (agent.maxCostPerCall !== null && costLamports > agent.maxCostPerCall) {
    violations.push(
      `Cost (${costLamports}) exceeds max per call limit (${agent.maxCostPerCall})`
    );
  }

  // Daily spend cap check
  if (agent.dailySpendCap !== null) {
    const projectedDaily = dailySpendSoFar + costLamports;
    if (projectedDaily > agent.dailySpendCap) {
      violations.push(
        `Would exceed daily cap: ${projectedDaily} > ${agent.dailySpendCap} (already spent: ${dailySpendSoFar})`
      );
    }
  }

  // Allowlist check
  if (agent.allowedCallees !== null) {
    const allowedList = JSON.parse(agent.allowedCallees) as string[];
    if (!allowedList.includes(calleeId)) {
      violations.push(`Callee "${calleeId}" not in allowlist: [${allowedList.join(", ")}]`);
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

// =============================================================================
// DETERMINISTIC COST PREVIEW API
// =============================================================================

/**
 * previewToolCall: Simulate a call and return exact cost + budget status
 * 
 * This is the core of the Cost Preview API - it returns everything an agent
 * needs to make an informed decision before executing a call:
 * - Exact cost
 * - Whether it can execute
 * - Budget status and warnings
 * - Full breakdown for transparency
 */
export async function previewToolCall(
  callerId: string,
  calleeId: string,
  toolName: string,
  tokensEstimate: number
): Promise<{
  canExecute: boolean;
  costLamports: number;
  breakdown: {
    tokensEstimate: number;
    tokenBlocks: number;
    ratePer1kTokens: number;
    toolId: string | null;
    rawCost: number;
    minimumApplied: boolean;
    platformFee: number;
    netToCallee: number;
  };
  budgetStatus: {
    callerBalance: number;
    balanceAfter: number;
    dailySpendBefore: number;
    dailySpendAfter: number;
    dailyCapRemaining: number | null;
    isPaused: boolean;
  };
  warnings: string[];
  violations: string[];
}> {
  if (!db) throw new Error("Database not connected");

  // Get caller and validate
  const caller = await getAgent(callerId);
  
  // Get tool pricing
  const { toolId, ratePer1kTokens } = await getToolPricing(calleeId, toolName);
  
  // Calculate cost
  const tokenBlocks = Math.ceil(tokensEstimate / 1000);
  const rawCost = tokenBlocks * ratePer1kTokens;
  const costLamports = calculateCost(tokensEstimate, ratePer1kTokens);
  const platformFee = calculatePlatformFee(costLamports);
  const netToCallee = costLamports - platformFee;

  // Get daily spend
  const dailySpend = await getAgentDailySpend(callerId);

  // Check budget constraints
  const budgetCheck = checkBudgetConstraints(caller, calleeId, costLamports, dailySpend);

  // Collect warnings
  const warnings: string[] = [];

  // Balance warning
  if (caller.balanceLamports < costLamports) {
    warnings.push(
      `Insufficient balance: ${caller.balanceLamports} < ${costLamports} lamports needed`
    );
  }

  // Near daily cap warning (if applicable)
  if (caller.dailySpendCap !== null) {
    const projectedDaily = dailySpend + costLamports;
    const percentOfCap = Math.round((projectedDaily / caller.dailySpendCap) * 100);
    if (percentOfCap >= 80 && budgetCheck.allowed) {
      warnings.push(`This call would use ${percentOfCap}% of daily cap`);
    }
  }

  // Near max per call warning
  if (caller.maxCostPerCall !== null) {
    const percentOfMax = Math.round((costLamports / caller.maxCostPerCall) * 100);
    if (percentOfMax >= 80 && budgetCheck.allowed) {
      warnings.push(`Cost is ${percentOfMax}% of max-per-call limit`);
    }
  }

  // Determine if execution is possible
  const hasBalance = caller.balanceLamports >= costLamports;
  const canExecute = hasBalance && budgetCheck.allowed;

  return {
    canExecute,
    costLamports,
    breakdown: {
      tokensEstimate,
      tokenBlocks,
      ratePer1kTokens,
      toolId,
      rawCost,
      minimumApplied: rawCost < PRICING_CONSTANTS.MIN_COST_LAMPORTS,
      platformFee,
      netToCallee,
    },
    budgetStatus: {
      callerBalance: caller.balanceLamports,
      balanceAfter: caller.balanceLamports - costLamports,
      dailySpendBefore: dailySpend,
      dailySpendAfter: dailySpend + costLamports,
      dailyCapRemaining: caller.dailySpendCap !== null 
        ? Math.max(0, caller.dailySpendCap - dailySpend - costLamports)
        : null,
      isPaused: caller.isPaused === "true",
    },
    warnings,
    violations: budgetCheck.violations,
  };
}