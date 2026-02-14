/**
 * Budget Authorization Service
 *
 * Enterprise-grade pre-authorization for agent spending.
 * Ensures workflows are authorized BEFORE cost accrual.
 *
 * Key features:
 * - Pre-execution safety checks
 * - Automatic failure detection before execution
 * - Multi-call workflow authorization
 * - Spend limit enforcement
 * - Audit trail for compliance
 */

import { eq, and, desc, sql, gte } from "drizzle-orm";
import { db, pool, agents, toolUsage, balanceReservations } from "../db/client";
import type { Agent } from "../db/client";
import {
  calculateCost,
  getToolPricing,
  getAgent,
  getAgentDailySpend,
  checkBudgetConstraints,
  PRICING_CONSTANTS,
} from "./pricingService";

// =============================================================================
// TYPES
// =============================================================================

export interface AuthorizationRequest {
  agentId: string;
  /** Estimated spend amount in lamports (optional - will calculate if calls provided) */
  estimatedSpendLamports?: number;
  /** Individual calls to authorize (for multi-call workflows) */
  calls?: Array<{
    calleeId: string;
    toolName: string;
    estimatedTokens: number;
  }>;
  /** Whether to create a balance reservation (default: false, just check) */
  createReservation?: boolean;
  /** Optional reservation timeout in ms (default: 5 min) */
  reservationTimeoutMs?: number;
  /** Purpose/description for audit trail */
  purpose?: string;
}

export interface AuthorizationResult {
  authorized: boolean;
  authorizationId?: string;
  
  // Spend breakdown
  requestedSpend: {
    totalLamports: number;
    callCount: number;
    breakdown?: Array<{
      calleeId: string;
      toolName: string;
      estimatedTokens: number;
      estimatedCost: number;
      ratePer1kTokens: number;
    }>;
  };
  
  // Budget status at authorization time
  budgetStatus: {
    currentBalance: number;
    availableBalance: number;
    reservedBalance: number;
    dailySpendUsed: number;
    dailySpendRemaining: number | null;
  };
  
  // Limit checks
  limitChecks: {
    balanceSufficient: boolean;
    withinDailyCap: boolean;
    withinMaxPerCall: boolean;
    calleeAllowed: boolean;
    notPaused: boolean;
  };
  
  // Warnings and violations
  warnings: string[];
  violations: string[];
  
  // Reservation info (if created)
  reservation?: {
    reservationId: string;
    reservedLamports: number;
    expiresAt: string;
  };
  
  // Metadata
  timestamp: string;
  expiresAt?: string;
}

export interface BudgetStatus {
  agentId: string;
  
  // Balance information
  balance: {
    total: number;
    available: number;
    reserved: number;
    pending: number;
  };
  
  // Spending limits
  limits: {
    maxCostPerCall: number | null;
    dailySpendCap: number | null;
    monthlySpendCap: number | null;
    isPaused: boolean;
    allowedCallees: string[] | null;
  };
  
  // Current spending
  spending: {
    today: {
      used: number;
      remaining: number | null;
      percentUsed: number | null;
      transactionCount: number;
    };
    thisMonth: {
      used: number;
      transactionCount: number;
    };
    allTime: {
      totalSpent: number;
      totalTransactions: number;
    };
  };
  
  // Active reservations
  activeReservations: Array<{
    reservationId: string;
    calleeId: string;
    toolName: string;
    reservedLamports: number;
    expiresAt: string;
    status: string;
  }>;
  
  // Health indicators
  health: {
    status: "healthy" | "warning" | "critical" | "paused";
    warnings: string[];
    recommendations: string[];
  };
  
  // Metadata
  generatedAt: string;
}

export interface SpendForecast {
  canExecute: boolean;
  estimatedCost: number;
  balanceAfter: number;
  dailySpendAfter: number;
  violations: string[];
  warnings: string[];
}

// =============================================================================
// AUTHORIZATION FUNCTIONS
// =============================================================================

/**
 * Authorize a spend before execution
 *
 * Performs comprehensive pre-execution checks:
 * 1. Balance sufficiency (including active reservations)
 * 2. Budget guardrails (daily cap, max per call, allowlist)
 * 3. Kill switch status
 * 4. Optionally creates a balance reservation
 *
 * @param request - Authorization request
 * @returns Authorization result with detailed status
 */
export async function authorizeSpend(request: AuthorizationRequest): Promise<AuthorizationResult> {
  if (!db || !pool) throw new Error("Database not connected");

  const {
    agentId,
    estimatedSpendLamports,
    calls = [],
    createReservation = false,
    reservationTimeoutMs = 5 * 60 * 1000,
    purpose,
  } = request;

  const timestamp = new Date().toISOString();

  // Get agent
  const agent = await getAgent(agentId);

  // Calculate available balance (total minus active reservations)
  const availableBalance = await getAvailableBalance(agentId);
  const reservedBalance = agent.balanceLamports - availableBalance;

  // Get daily spend
  const dailySpendUsed = await getAgentDailySpend(agentId);
  const dailySpendRemaining = agent.dailySpendCap !== null
    ? Math.max(0, agent.dailySpendCap - dailySpendUsed)
    : null;

  // Calculate total requested spend
  let totalRequestedSpend = estimatedSpendLamports || 0;
  const breakdown: AuthorizationResult["requestedSpend"]["breakdown"] = [];

  // Process individual calls if provided
  for (const call of calls) {
    const { ratePer1kTokens } = await getToolPricing(call.calleeId, call.toolName);
    const estimatedCost = calculateCost(call.estimatedTokens, ratePer1kTokens);
    
    breakdown.push({
      calleeId: call.calleeId,
      toolName: call.toolName,
      estimatedTokens: call.estimatedTokens,
      estimatedCost,
      ratePer1kTokens,
    });
    
    totalRequestedSpend += estimatedCost;
  }

  // Initialize limit checks
  const limitChecks = {
    balanceSufficient: availableBalance >= totalRequestedSpend,
    withinDailyCap: true,
    withinMaxPerCall: true,
    calleeAllowed: true,
    notPaused: agent.isPaused !== "true",
  };

  const warnings: string[] = [];
  const violations: string[] = [];

  // Check paused status
  if (agent.isPaused === "true") {
    violations.push("Agent spending is PAUSED - all transactions blocked");
    limitChecks.notPaused = false;
  }

  // Check balance
  if (!limitChecks.balanceSufficient) {
    violations.push(
      `Insufficient balance: need ${totalRequestedSpend} lamports, ` +
      `have ${availableBalance} available (${reservedBalance} reserved)`
    );
  } else if (availableBalance < totalRequestedSpend * 1.2) {
    warnings.push(
      `Low balance: ${availableBalance} available, ` +
      `request is ${Math.round((totalRequestedSpend / availableBalance) * 100)}% of available`
    );
  }

  // Check daily cap
  if (agent.dailySpendCap !== null) {
    const projectedDaily = dailySpendUsed + totalRequestedSpend;
    if (projectedDaily > agent.dailySpendCap) {
      violations.push(
        `Would exceed daily cap: ${projectedDaily} > ${agent.dailySpendCap} ` +
        `(already spent ${dailySpendUsed} today)`
      );
      limitChecks.withinDailyCap = false;
    } else if (projectedDaily > agent.dailySpendCap * 0.9) {
      warnings.push(
        `High daily usage: would use ${Math.round((projectedDaily / agent.dailySpendCap) * 100)}% of daily cap`
      );
    }
  }

  // Check max per call for each call
  if (agent.maxCostPerCall !== null) {
    for (const call of breakdown) {
      if (call.estimatedCost > agent.maxCostPerCall) {
        violations.push(
          `Call to ${call.calleeId}/${call.toolName} (${call.estimatedCost} lamports) ` +
          `exceeds max per call limit (${agent.maxCostPerCall})`
        );
        limitChecks.withinMaxPerCall = false;
      }
    }
  }

  // Check callee allowlist
  if (agent.allowedCallees !== null) {
    const allowed = JSON.parse(agent.allowedCallees) as string[];
    for (const call of breakdown) {
      if (!allowed.includes(call.calleeId)) {
        violations.push(`Callee "${call.calleeId}" not in allowlist`);
        limitChecks.calleeAllowed = false;
      }
    }
  }

  // Determine if authorized
  const authorized = violations.length === 0;

  // Create reservation if requested and authorized
  let reservation: AuthorizationResult["reservation"];
  if (createReservation && authorized && calls.length > 0) {
    // Create a combined reservation for all calls
    const expiresAt = new Date(Date.now() + reservationTimeoutMs);
    
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Create master reservation (using first call as reference)
      const insertResult = await client.query(
        `INSERT INTO balance_reservations 
          (caller_agent_id, callee_agent_id, tool_name, estimated_tokens, reserved_lamports, expires_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          agentId,
          calls[0]?.calleeId || "multi-call",
          calls[0]?.toolName || "workflow",
          calls.reduce((sum, c) => sum + c.estimatedTokens, 0),
          totalRequestedSpend,
          expiresAt,
          JSON.stringify({ purpose, calls: breakdown }),
        ]
      );

      await client.query("COMMIT");

      reservation = {
        reservationId: insertResult.rows[0].id,
        reservedLamports: totalRequestedSpend,
        expiresAt: expiresAt.toISOString(),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    authorized,
    authorizationId: reservation?.reservationId,
    requestedSpend: {
      totalLamports: totalRequestedSpend,
      callCount: calls.length || 1,
      breakdown: breakdown.length > 0 ? breakdown : undefined,
    },
    budgetStatus: {
      currentBalance: agent.balanceLamports,
      availableBalance,
      reservedBalance,
      dailySpendUsed,
      dailySpendRemaining,
    },
    limitChecks,
    warnings,
    violations,
    reservation,
    timestamp,
    expiresAt: reservation?.expiresAt,
  };
}

/**
 * Get comprehensive budget status for an agent
 */
export async function getBudgetStatus(agentId: string): Promise<BudgetStatus> {
  if (!db || !pool) throw new Error("Database not connected");

  const agent = await getAgent(agentId);
  const availableBalance = await getAvailableBalance(agentId);
  const reservedBalance = agent.balanceLamports - availableBalance;

  // Get daily spend
  const dailySpend = await getAgentDailySpend(agentId);

  // Get monthly spend
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const monthlyResult = await db
    .select({
      totalSpend: sql<number>`COALESCE(SUM(cost_lamports), 0)::int`,
      txCount: sql<number>`COUNT(*)::int`,
    })
    .from(toolUsage)
    .where(
      and(
        eq(toolUsage.callerAgentId, agentId),
        gte(toolUsage.createdAt, monthStart)
      )
    );

  // Get all-time stats
  const allTimeResult = await db
    .select({
      totalSpend: sql<number>`COALESCE(SUM(cost_lamports), 0)::int`,
      txCount: sql<number>`COUNT(*)::int`,
    })
    .from(toolUsage)
    .where(eq(toolUsage.callerAgentId, agentId));

  // Get today's transaction count
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayResult = await db
    .select({
      txCount: sql<number>`COUNT(*)::int`,
    })
    .from(toolUsage)
    .where(
      and(
        eq(toolUsage.callerAgentId, agentId),
        gte(toolUsage.createdAt, today)
      )
    );

  // Get active reservations
  const activeReservations = await db
    .select()
    .from(balanceReservations)
    .where(
      and(
        eq(balanceReservations.callerAgentId, agentId),
        eq(balanceReservations.status, "active"),
        gte(balanceReservations.expiresAt, new Date())
      )
    )
    .orderBy(desc(balanceReservations.createdAt))
    .limit(20);

  // Parse agent config
  const isPaused = agent.isPaused === "true";
  const allowedCallees = agent.allowedCallees
    ? JSON.parse(agent.allowedCallees) as string[]
    : null;
  const dailySpendCap = agent.dailySpendCap;

  // Calculate health status
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let healthStatus: BudgetStatus["health"]["status"] = "healthy";

  if (isPaused) {
    healthStatus = "paused";
    warnings.push("Agent spending is PAUSED");
  } else {
    // Check balance health
    if (availableBalance < PRICING_CONSTANTS.MIN_COST_LAMPORTS) {
      healthStatus = "critical";
      warnings.push("Available balance below minimum call cost");
      recommendations.push("Top up balance to continue operations");
    } else if (availableBalance < 10000) {
      healthStatus = healthStatus === "healthy" ? "warning" : healthStatus;
      warnings.push("Low available balance");
      recommendations.push("Consider topping up balance soon");
    }

    // Check daily cap usage
    if (dailySpendCap !== null) {
      const dailyPercent = (dailySpend / dailySpendCap) * 100;
      if (dailyPercent >= 100) {
        healthStatus = "critical";
        warnings.push("Daily spend cap reached");
        recommendations.push("Wait for cap reset or increase daily limit");
      } else if (dailyPercent >= 90) {
        healthStatus = healthStatus === "healthy" ? "warning" : healthStatus;
        warnings.push(`Daily spend at ${Math.round(dailyPercent)}% of cap`);
      }
    }

    // Check active reservations
    if (activeReservations.length >= 10) {
      warnings.push("High number of active reservations");
      recommendations.push("Consider cleaning up stale reservations");
    }
  }

  return {
    agentId,
    balance: {
      total: agent.balanceLamports,
      available: availableBalance,
      reserved: reservedBalance,
      pending: agent.pendingLamports,
    },
    limits: {
      maxCostPerCall: agent.maxCostPerCall ?? null,
      dailySpendCap: dailySpendCap ?? null,
      monthlySpendCap: null, // Future feature
      isPaused,
      allowedCallees,
    },
    spending: {
      today: {
        used: dailySpend,
        remaining: dailySpendCap !== null ? Math.max(0, dailySpendCap - dailySpend) : null,
        percentUsed: dailySpendCap !== null ? Math.round((dailySpend / dailySpendCap) * 100) : null,
        transactionCount: Number(todayResult[0]?.txCount || 0),
      },
      thisMonth: {
        used: Number(monthlyResult[0]?.totalSpend || 0),
        transactionCount: Number(monthlyResult[0]?.txCount || 0),
      },
      allTime: {
        totalSpent: Number(allTimeResult[0]?.totalSpend || 0),
        totalTransactions: Number(allTimeResult[0]?.txCount || 0),
      },
    },
    activeReservations: activeReservations.map((r) => ({
      reservationId: r.id,
      calleeId: r.calleeAgentId,
      toolName: r.toolName,
      reservedLamports: r.reservedLamports,
      expiresAt: r.expiresAt.toISOString(),
      status: r.status,
    })),
    health: {
      status: healthStatus,
      warnings,
      recommendations,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Forecast a spend to see if it would be allowed
 *
 * Lighter-weight than authorizeSpend - doesn't create reservations
 */
export async function forecastSpend(
  agentId: string,
  calls: Array<{
    calleeId: string;
    toolName: string;
    estimatedTokens: number;
  }>
): Promise<SpendForecast> {
  const result = await authorizeSpend({
    agentId,
    calls,
    createReservation: false,
  });

  return {
    canExecute: result.authorized,
    estimatedCost: result.requestedSpend.totalLamports,
    balanceAfter: result.budgetStatus.availableBalance - result.requestedSpend.totalLamports,
    dailySpendAfter: result.budgetStatus.dailySpendUsed + result.requestedSpend.totalLamports,
    violations: result.violations,
    warnings: result.warnings,
  };
}

/**
 * Get available balance (total minus active reservations)
 */
async function getAvailableBalance(agentId: string): Promise<number> {
  if (!pool) throw new Error("Database not connected");

  const result = await pool.query(
    `SELECT 
      a.balance_lamports,
      COALESCE(SUM(r.reserved_lamports), 0) as reserved_total
    FROM agents a
    LEFT JOIN balance_reservations r ON r.caller_agent_id = a.id 
      AND r.status = 'active' 
      AND r.expires_at > NOW()
    WHERE a.id = $1
    GROUP BY a.id`,
    [agentId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const balance = Number(result.rows[0].balance_lamports);
  const reserved = Number(result.rows[0].reserved_total);

  return balance - reserved;
}

/**
 * Set spend limits for an agent
 */
export async function setSpendLimits(
  agentId: string,
  limits: {
    maxCostPerCall?: number | null;
    dailySpendCap?: number | null;
    allowedCallees?: string[] | null;
  }
): Promise<void> {
  if (!db) throw new Error("Database not connected");

  const updateData: Record<string, any> = {};

  if (limits.maxCostPerCall !== undefined) {
    updateData.maxCostPerCall = limits.maxCostPerCall;
  }

  if (limits.dailySpendCap !== undefined) {
    updateData.dailySpendCap = limits.dailySpendCap;
  }

  if (limits.allowedCallees !== undefined) {
    updateData.allowedCallees = limits.allowedCallees
      ? JSON.stringify(limits.allowedCallees)
      : null;
  }

  if (Object.keys(updateData).length > 0) {
    await db
      .update(agents)
      .set(updateData)
      .where(eq(agents.id, agentId));
  }
}

/**
 * Emergency pause agent spending
 */
export async function pauseSpending(agentId: string, reason?: string): Promise<void> {
  if (!db) throw new Error("Database not connected");

  await db
    .update(agents)
    .set({ isPaused: "true" })
    .where(eq(agents.id, agentId));

  // Could log reason to audit table here
  console.log(`[BUDGET] Paused spending for ${agentId}${reason ? `: ${reason}` : ""}`);
}

/**
 * Resume agent spending
 */
export async function resumeSpending(agentId: string): Promise<void> {
  if (!db) throw new Error("Database not connected");

  await db
    .update(agents)
    .set({ isPaused: "false" })
    .where(eq(agents.id, agentId));

  console.log(`[BUDGET] Resumed spending for ${agentId}`);
}
