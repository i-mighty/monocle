/**
 * Pre-Authorization Service
 *
 * Reserve balance before execution to prevent partial execution
 * with insufficient funds. Uses a reserve-capture-release pattern:
 *
 * 1. reserve(callerId, estimatedCost) - Creates a hold on funds
 * 2. capture(reservationId, actualCost) - Completes the transaction
 * 3. release(reservationId) - Releases the hold on failure
 *
 * This ensures atomic execution - either the full call succeeds
 * with payment, or nothing happens.
 */

import { eq, and, lt, sql } from "drizzle-orm";
import { db, pool, agents, balanceReservations } from "../db/client";
import type { BalanceReservation } from "../db/client";
import { calculateCost, getToolPricing } from "./pricingService";

// =============================================================================
// CONSTANTS
// =============================================================================

const RESERVATION_CONSTANTS = {
  /** Default reservation timeout (5 minutes) */
  DEFAULT_TIMEOUT_MS: 5 * 60 * 1000,

  /** Maximum reservation timeout (30 minutes) */
  MAX_TIMEOUT_MS: 30 * 60 * 1000,

  /** Buffer multiplier for estimated cost (add 10% safety margin) */
  SAFETY_MARGIN: 1.1,

  /** Cleanup expired reservations older than this */
  CLEANUP_THRESHOLD_HOURS: 24,
};

// =============================================================================
// TYPES
// =============================================================================

export interface ReservationRequest {
  callerId: string;
  calleeId: string;
  toolName: string;
  estimatedTokens: number;
  timeoutMs?: number;
}

export interface ReservationResult {
  reservationId: string;
  reservedLamports: number;
  estimatedCost: number;
  expiresAt: Date;
  availableBalance: number;
}

export interface CaptureResult {
  reservationId: string;
  actualCost: number;
  refundedLamports: number;
  capturedAt: Date;
}

// =============================================================================
// RESERVATION FUNCTIONS
// =============================================================================

/**
 * Reserve balance before execution
 *
 * Creates a hold on the caller's balance for the estimated cost.
 * The reserved amount is moved from available balance to a hold,
 * preventing it from being used for other calls.
 *
 * @param request - Reservation request details
 * @returns Reservation result with ID and details
 * @throws Error if insufficient balance
 */
export async function reserve(request: ReservationRequest): Promise<ReservationResult> {
  if (!db || !pool) throw new Error("Database not connected");

  const {
    callerId,
    calleeId,
    toolName,
    estimatedTokens,
    timeoutMs = RESERVATION_CONSTANTS.DEFAULT_TIMEOUT_MS,
  } = request;

  // Get tool pricing
  const { ratePer1kTokens } = await getToolPricing(calleeId, toolName);

  // Calculate estimated cost with safety margin
  const estimatedCost = calculateCost(estimatedTokens, ratePer1kTokens);
  const reservedAmount = Math.ceil(estimatedCost * RESERVATION_CONSTANTS.SAFETY_MARGIN);

  // Calculate expiration
  const effectiveTimeout = Math.min(timeoutMs, RESERVATION_CONSTANTS.MAX_TIMEOUT_MS);
  const expiresAt = new Date(Date.now() + effectiveTimeout);

  // Atomic transaction: check balance and create reservation
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check available balance (balance minus any active reservations)
    const balanceResult = await client.query(
      `SELECT 
        a.balance_lamports,
        COALESCE(SUM(r.reserved_lamports), 0) as reserved_total
      FROM agents a
      LEFT JOIN balance_reservations r ON r.caller_agent_id = a.id 
        AND r.status = 'active' 
        AND r.expires_at > NOW()
      WHERE a.id = $1
      GROUP BY a.id`,
      [callerId]
    );

    if (balanceResult.rows.length === 0) {
      throw new Error(`Agent not found: ${callerId}`);
    }

    const balanceLamports = Number(balanceResult.rows[0].balance_lamports);
    const reservedTotal = Number(balanceResult.rows[0].reserved_total);
    const availableBalance = balanceLamports - reservedTotal;

    if (availableBalance < reservedAmount) {
      throw new Error(
        `Insufficient available balance: ${callerId} has ${availableBalance} lamports available ` +
        `(${balanceLamports} total, ${reservedTotal} reserved), but reservation requires ${reservedAmount} lamports`
      );
    }

    // Create reservation
    const insertResult = await client.query(
      `INSERT INTO balance_reservations 
        (caller_agent_id, callee_agent_id, tool_name, estimated_tokens, reserved_lamports, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [callerId, calleeId, toolName, estimatedTokens, reservedAmount, expiresAt]
    );

    const reservationId = insertResult.rows[0].id;

    await client.query("COMMIT");

    return {
      reservationId,
      reservedLamports: reservedAmount,
      estimatedCost,
      expiresAt,
      availableBalance: availableBalance - reservedAmount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Capture a reservation (complete the payment)
 *
 * Called after successful tool execution to finalize the payment.
 * The actual cost is deducted, and any excess reserved amount is released.
 *
 * @param reservationId - ID of the reservation to capture
 * @param actualTokens - Actual tokens used in execution
 * @returns Capture result with details
 */
export async function capture(
  reservationId: string,
  actualTokens: number
): Promise<CaptureResult> {
  if (!db || !pool) throw new Error("Database not connected");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get and lock the reservation
    const reservationResult = await client.query(
      `SELECT * FROM balance_reservations 
       WHERE id = $1 AND status = 'active' 
       FOR UPDATE`,
      [reservationId]
    );

    if (reservationResult.rows.length === 0) {
      throw new Error(`Reservation not found or not active: ${reservationId}`);
    }

    const reservation = reservationResult.rows[0];

    // Check if expired
    if (new Date(reservation.expires_at) < new Date()) {
      // Mark as expired and release
      await client.query(
        `UPDATE balance_reservations SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [reservationId]
      );
      throw new Error(`Reservation expired: ${reservationId}`);
    }

    // Get tool pricing to calculate actual cost
    const { ratePer1kTokens } = await getToolPricing(
      reservation.callee_agent_id,
      reservation.tool_name
    );

    const actualCost = calculateCost(actualTokens, ratePer1kTokens);
    const reservedAmount = Number(reservation.reserved_lamports);
    const refundedLamports = Math.max(0, reservedAmount - actualCost);

    // If actual cost exceeds reservation, check if caller has enough
    if (actualCost > reservedAmount) {
      const balanceResult = await client.query(
        `SELECT balance_lamports FROM agents WHERE id = $1`,
        [reservation.caller_agent_id]
      );
      const currentBalance = Number(balanceResult.rows[0].balance_lamports);
      const additionalNeeded = actualCost - reservedAmount;

      if (currentBalance < additionalNeeded) {
        throw new Error(
          `Actual cost (${actualCost}) exceeds reservation (${reservedAmount}) and ` +
          `available balance (${currentBalance}). Additional ${additionalNeeded} lamports needed.`
        );
      }
    }

    // Update reservation to captured
    const now = new Date();
    await client.query(
      `UPDATE balance_reservations 
       SET status = 'captured', 
           actual_tokens = $1, 
           actual_cost_lamports = $2, 
           captured_at = $3,
           updated_at = $3
       WHERE id = $4`,
      [actualTokens, actualCost, now, reservationId]
    );

    // Deduct from caller's balance
    await client.query(
      `UPDATE agents SET balance_lamports = balance_lamports - $1 WHERE id = $2`,
      [actualCost, reservation.caller_agent_id]
    );

    // Credit to callee's pending balance
    await client.query(
      `UPDATE agents SET pending_lamports = pending_lamports + $1 WHERE id = $2`,
      [actualCost, reservation.callee_agent_id]
    );

    // Insert tool usage record
    await client.query(
      `INSERT INTO tool_usage 
       (caller_agent_id, callee_agent_id, tool_name, tokens_used, rate_per_1k_tokens, cost_lamports)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        reservation.caller_agent_id,
        reservation.callee_agent_id,
        reservation.tool_name,
        actualTokens,
        ratePer1kTokens,
        actualCost,
      ]
    );

    await client.query("COMMIT");

    return {
      reservationId,
      actualCost,
      refundedLamports,
      capturedAt: now,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Release a reservation (cancel without capturing)
 *
 * Called when tool execution fails or is cancelled.
 * The reserved amount is released back to available balance.
 *
 * @param reservationId - ID of the reservation to release
 * @param reason - Optional reason for release
 */
export async function release(
  reservationId: string,
  reason?: string
): Promise<{ released: boolean; reservedLamports: number }> {
  if (!db || !pool) throw new Error("Database not connected");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get and lock the reservation
    const reservationResult = await client.query(
      `SELECT * FROM balance_reservations 
       WHERE id = $1 AND status = 'active' 
       FOR UPDATE`,
      [reservationId]
    );

    if (reservationResult.rows.length === 0) {
      // Already released or captured
      await client.query("ROLLBACK");
      return { released: false, reservedLamports: 0 };
    }

    const reservation = reservationResult.rows[0];
    const reservedAmount = Number(reservation.reserved_lamports);

    // Update reservation to released
    await client.query(
      `UPDATE balance_reservations 
       SET status = 'released', updated_at = NOW()
       WHERE id = $1`,
      [reservationId]
    );

    await client.query("COMMIT");

    return { released: true, reservedLamports: reservedAmount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get active reservations for an agent
 */
export async function getActiveReservations(
  agentId: string
): Promise<BalanceReservation[]> {
  if (!db) throw new Error("Database not connected");

  const now = new Date();

  return db
    .select()
    .from(balanceReservations)
    .where(
      and(
        eq(balanceReservations.callerAgentId, agentId),
        eq(balanceReservations.status, "active"),
        sql`${balanceReservations.expiresAt} > ${now}`
      )
    );
}

/**
 * Get total reserved amount for an agent
 */
export async function getTotalReserved(agentId: string): Promise<number> {
  if (!db) throw new Error("Database not connected");

  const now = new Date();

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(${balanceReservations.reservedLamports}), 0)`,
    })
    .from(balanceReservations)
    .where(
      and(
        eq(balanceReservations.callerAgentId, agentId),
        eq(balanceReservations.status, "active"),
        sql`${balanceReservations.expiresAt} > ${now}`
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * Get available balance (total balance minus reservations)
 */
export async function getAvailableBalance(agentId: string): Promise<{
  totalBalance: number;
  reservedBalance: number;
  availableBalance: number;
}> {
  if (!db) throw new Error("Database not connected");

  const agentResult = await db
    .select({ balanceLamports: agents.balanceLamports })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (agentResult.length === 0) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const totalBalance = agentResult[0].balanceLamports;
  const reservedBalance = await getTotalReserved(agentId);

  return {
    totalBalance,
    reservedBalance,
    availableBalance: totalBalance - reservedBalance,
  };
}

// =============================================================================
// MAINTENANCE
// =============================================================================

/**
 * Expire old reservations
 *
 * Should be called periodically to clean up expired reservations.
 */
export async function expireOldReservations(): Promise<number> {
  if (!db) throw new Error("Database not connected");

  const now = new Date();

  const result = await db
    .update(balanceReservations)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(balanceReservations.status, "active"),
        lt(balanceReservations.expiresAt, now)
      )
    )
    .returning({ id: balanceReservations.id });

  return result.length;
}

/**
 * Get reservation statistics for an agent
 */
export async function getReservationStats(agentId: string): Promise<{
  activeCount: number;
  totalReserved: number;
  avgReservationDurationMs: number;
  captureRate: number;
}> {
  if (!db) throw new Error("Database not connected");

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const now = new Date();

  // Get active reservations
  const activeResult = await db
    .select({
      count: sql<number>`COUNT(*)`,
      totalReserved: sql<number>`COALESCE(SUM(${balanceReservations.reservedLamports}), 0)`,
    })
    .from(balanceReservations)
    .where(
      and(
        eq(balanceReservations.callerAgentId, agentId),
        eq(balanceReservations.status, "active"),
        sql`${balanceReservations.expiresAt} > ${now}`
      )
    );

  // Get capture rate from recent reservations
  const statsResult = await db
    .select({
      total: sql<number>`COUNT(*)`,
      captured: sql<number>`SUM(CASE WHEN ${balanceReservations.status} = 'captured' THEN 1 ELSE 0 END)`,
      avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (COALESCE(${balanceReservations.capturedAt}, ${balanceReservations.updatedAt}) - ${balanceReservations.createdAt})) * 1000)`,
    })
    .from(balanceReservations)
    .where(
      and(
        eq(balanceReservations.callerAgentId, agentId),
        sql`${balanceReservations.createdAt} > ${oneDayAgo}`
      )
    );

  const total = Number(statsResult[0]?.total || 0);
  const captured = Number(statsResult[0]?.captured || 0);

  return {
    activeCount: Number(activeResult[0]?.count || 0),
    totalReserved: Number(activeResult[0]?.totalReserved || 0),
    avgReservationDurationMs: Number(statsResult[0]?.avgDuration || 0),
    captureRate: total > 0 ? captured / total : 0,
  };
}

// =============================================================================
// INTEGRATED EXECUTION FLOW
// =============================================================================

/**
 * Execute a tool call with pre-authorization
 *
 * This is the recommended way to execute tool calls.
 * It handles the full reserve -> execute -> capture/release flow.
 *
 * @param params - Execution parameters
 * @param executor - The function that actually executes the tool
 * @returns Execution result
 */
export async function executeWithPreAuth<T>(
  params: {
    callerId: string;
    calleeId: string;
    toolName: string;
    estimatedTokens: number;
  },
  executor: () => Promise<{ result: T; actualTokens: number }>
): Promise<{
  result: T;
  reservation: ReservationResult;
  capture: CaptureResult;
}> {
  // Step 1: Reserve
  const reservation = await reserve({
    callerId: params.callerId,
    calleeId: params.calleeId,
    toolName: params.toolName,
    estimatedTokens: params.estimatedTokens,
  });

  try {
    // Step 2: Execute
    const { result, actualTokens } = await executor();

    // Step 3: Capture
    const captureResult = await capture(reservation.reservationId, actualTokens);

    return {
      result,
      reservation,
      capture: captureResult,
    };
  } catch (error) {
    // Step 3 (alternate): Release on failure
    await release(reservation.reservationId, (error as Error).message);
    throw error;
  }
}
