/**
 * Escrow Service - Pre-Execution Payment Protection
 *
 * Implements a hold/release pattern for AI router payments:
 * 1. Before execution: Hold estimated cost from user's balance
 * 2. On success: Release held funds to agent
 * 3. On failure: Refund held funds to user
 *
 * This prevents:
 * - Execution without sufficient funds
 * - Payment disputes (funds are locked upfront)
 * - Partial payment scenarios
 */

import { query } from "../db/client";
import { issueQuote } from "./quoteService";
import { PRICING_CONSTANTS } from "./pricingService";

// =============================================================================
// CONSTANTS
// =============================================================================

export const ESCROW_CONSTANTS = {
  /** Hold validity period (10 minutes) */
  HOLD_VALIDITY_MS: 10 * 60 * 1000,
  
  /** Buffer multiplier for estimated costs (1.2 = 20% buffer) */
  COST_BUFFER_MULTIPLIER: 1.2,
  
  /** Minimum hold amount */
  MIN_HOLD_LAMPORTS: 1000,
} as const;

// =============================================================================
// TYPES
// =============================================================================

export interface EscrowHold {
  holdId: string;
  userId: string;
  agentId: string;
  estimatedCostLamports: number;
  holdAmountLamports: number; // With buffer
  quoteId?: string;
  status: "held" | "released" | "refunded" | "expired";
  createdAt: Date;
  expiresAt: Date;
  releasedAt?: Date;
  actualCostLamports?: number;
}

export interface CreateHoldParams {
  userId: string;
  agentId: string;
  estimatedTokens: number;
  ratePer1kTokens: number;
  toolName?: string;
}

export interface HoldResult {
  success: boolean;
  hold?: EscrowHold;
  error?: string;
  userBalance?: number;
}

export interface ReleaseResult {
  success: boolean;
  actualCost: number;
  refundAmount: number;
  error?: string;
}

// =============================================================================
// INIT - Create escrow_holds table if not exists
// =============================================================================

export async function initEscrowTable(): Promise<void> {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS escrow_holds (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        quote_id TEXT,
        estimated_cost_lamports INTEGER NOT NULL,
        hold_amount_lamports INTEGER NOT NULL,
        actual_cost_lamports INTEGER,
        status TEXT NOT NULL DEFAULT 'held',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        released_at TIMESTAMP,
        release_reason TEXT
      )
    `);
    console.log("[Escrow] Table initialized");
  } catch (error) {
    console.log("[Escrow] Table init skipped (may already exist)");
  }
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Create an escrow hold before execution
 *
 * This locks funds in the user's balance, preventing spending during execution.
 * The hold includes a buffer for token estimation variance.
 */
export async function createEscrowHold(params: CreateHoldParams): Promise<HoldResult> {
  const { userId, agentId, estimatedTokens, ratePer1kTokens, toolName } = params;

  // Calculate estimated cost with buffer
  const tokenBlocks = Math.ceil(estimatedTokens / 1000);
  const baseCost = tokenBlocks * ratePer1kTokens;
  const platformFee = Math.ceil(baseCost * PRICING_CONSTANTS.PLATFORM_FEE_PERCENT);
  const estimatedCost = baseCost + platformFee;
  
  // Add buffer for estimation variance
  const holdAmount = Math.max(
    Math.ceil(estimatedCost * ESCROW_CONSTANTS.COST_BUFFER_MULTIPLIER),
    ESCROW_CONSTANTS.MIN_HOLD_LAMPORTS
  );

  try {
    // Check user balance
    const balanceResult = await query(`
      SELECT balance_lamports FROM agents WHERE id = $1
    `, [userId]);

    if (!balanceResult.rows[0]) {
      return { success: false, error: "User not found" };
    }

    const userBalance = balanceResult.rows[0].balance_lamports;
    if (userBalance < holdAmount) {
      return {
        success: false,
        error: `Insufficient balance. Required: ${holdAmount} lamports, Available: ${userBalance} lamports`,
        userBalance
      };
    }

    // Create hold ID
    const holdId = `hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ESCROW_CONSTANTS.HOLD_VALIDITY_MS);

    // Deduct hold amount from user balance (atomic)
    await query(`
      UPDATE agents 
      SET balance_lamports = balance_lamports - $1
      WHERE id = $2 AND balance_lamports >= $1
    `, [holdAmount, userId]);

    // Record the hold
    try {
      await query(`
        INSERT INTO escrow_holds (id, user_id, agent_id, estimated_cost_lamports, hold_amount_lamports, status, expires_at)
        VALUES ($1, $2, $3, $4, $5, 'held', $6)
      `, [holdId, userId, agentId, estimatedCost, holdAmount, expiresAt]);
    } catch (err) {
      // Table might not exist, create it and retry
      await initEscrowTable();
      await query(`
        INSERT INTO escrow_holds (id, user_id, agent_id, estimated_cost_lamports, hold_amount_lamports, status, expires_at)
        VALUES ($1, $2, $3, $4, $5, 'held', $6)
      `, [holdId, userId, agentId, estimatedCost, holdAmount, expiresAt]);
    }

    console.log(`[Escrow] Hold created: ${holdId} for ${holdAmount} lamports`);

    return {
      success: true,
      hold: {
        holdId,
        userId,
        agentId,
        estimatedCostLamports: estimatedCost,
        holdAmountLamports: holdAmount,
        status: "held",
        createdAt,
        expiresAt
      }
    };
  } catch (error: any) {
    console.error("[Escrow] Failed to create hold:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Release escrow hold on successful execution
 *
 * Calculates actual cost, pays the agent, and refunds any excess to user.
 */
export async function releaseEscrowHold(
  holdId: string,
  actualTokens: number,
  ratePer1kTokens: number
): Promise<ReleaseResult> {
  try {
    // Get hold details
    const holdResult = await query(`
      SELECT * FROM escrow_holds WHERE id = $1 AND status = 'held'
    `, [holdId]);

    if (!holdResult.rows[0]) {
      return { success: false, actualCost: 0, refundAmount: 0, error: "Hold not found or already processed" };
    }

    const hold = holdResult.rows[0];
    const { user_id, agent_id, hold_amount_lamports } = hold;

    // Calculate actual cost (enforce MIN_COST)
    const tokenBlocks = Math.ceil(actualTokens / 1000);
    const baseCost = Math.max(tokenBlocks * ratePer1kTokens, PRICING_CONSTANTS.MIN_COST_LAMPORTS);
    const platformFee = Math.ceil(baseCost * PRICING_CONSTANTS.PLATFORM_FEE_PERCENT);
    const actualCost = baseCost + platformFee;
    
    // Calculate refund (any excess from buffer)
    const refundAmount = Math.max(0, hold_amount_lamports - actualCost);

    // Pay agent into pending_lamports (awaiting settlement, not spendable)
    const agentPayment = actualCost - platformFee;
    await query(`
      UPDATE agents 
      SET pending_lamports = pending_lamports + $1
      WHERE id = $2
    `, [agentPayment, agent_id]);

    // Refund excess to user
    if (refundAmount > 0) {
      await query(`
        UPDATE agents 
        SET balance_lamports = balance_lamports + $1
        WHERE id = $2
      `, [refundAmount, user_id]);
    }

    // Update hold status
    await query(`
      UPDATE escrow_holds 
      SET status = 'released', 
          actual_cost_lamports = $1, 
          released_at = CURRENT_TIMESTAMP,
          release_reason = 'success'
      WHERE id = $2
    `, [actualCost, holdId]);

    console.log(`[Escrow] Hold ${holdId} released: ${actualCost} to agent, ${refundAmount} refunded`);

    return {
      success: true,
      actualCost,
      refundAmount
    };
  } catch (error: any) {
    console.error("[Escrow] Failed to release hold:", error);
    return { success: false, actualCost: 0, refundAmount: 0, error: error.message };
  }
}

/**
 * Refund escrow hold on failed execution
 *
 * Returns full held amount to user.
 */
export async function refundEscrowHold(holdId: string, reason: string): Promise<ReleaseResult> {
  try {
    // Get hold details
    const holdResult = await query(`
      SELECT * FROM escrow_holds WHERE id = $1 AND status = 'held'
    `, [holdId]);

    if (!holdResult.rows[0]) {
      return { success: false, actualCost: 0, refundAmount: 0, error: "Hold not found or already processed" };
    }

    const hold = holdResult.rows[0];
    const { user_id, hold_amount_lamports } = hold;

    // Full refund to user
    await query(`
      UPDATE agents 
      SET balance_lamports = balance_lamports + $1
      WHERE id = $2
    `, [hold_amount_lamports, user_id]);

    // Update hold status
    await query(`
      UPDATE escrow_holds 
      SET status = 'refunded', 
          released_at = CURRENT_TIMESTAMP,
          release_reason = $1
      WHERE id = $2
    `, [reason, holdId]);

    console.log(`[Escrow] Hold ${holdId} refunded: ${hold_amount_lamports} lamports (${reason})`);

    return {
      success: true,
      actualCost: 0,
      refundAmount: hold_amount_lamports
    };
  } catch (error: any) {
    console.error("[Escrow] Failed to refund hold:", error);
    return { success: false, actualCost: 0, refundAmount: 0, error: error.message };
  }
}

/**
 * Get active holds for a user
 */
export async function getUserActiveHolds(userId: string): Promise<EscrowHold[]> {
  try {
    const result = await query(`
      SELECT * FROM escrow_holds 
      WHERE user_id = $1 AND status = 'held'
      ORDER BY created_at DESC
    `, [userId]);

    return result.rows.map(row => ({
      holdId: row.id,
      userId: row.user_id,
      agentId: row.agent_id,
      estimatedCostLamports: row.estimated_cost_lamports,
      holdAmountLamports: row.hold_amount_lamports,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    }));
  } catch (error) {
    return [];
  }
}

/**
 * Expire stale holds (called periodically)
 */
export async function expireStaleHolds(): Promise<number> {
  try {
    // Find and refund expired holds
    const expired = await query(`
      SELECT * FROM escrow_holds 
      WHERE status = 'held' AND expires_at < CURRENT_TIMESTAMP
    `);

    let refundedCount = 0;
    for (const hold of expired.rows) {
      await refundEscrowHold(hold.id, "expired");
      refundedCount++;
    }

    if (refundedCount > 0) {
      console.log(`[Escrow] Expired ${refundedCount} stale holds`);
    }

    return refundedCount;
  } catch (error) {
    console.error("[Escrow] Failed to expire holds:", error);
    return 0;
  }
}
