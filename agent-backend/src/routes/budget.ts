/**
 * Budget Authorization Routes
 *
 * Enterprise-grade spend authorization and budget management APIs.
 *
 * Key endpoints:
 * - POST /budget/authorize - Pre-authorize a spend before execution
 * - GET /budget/status/:agentId - Get comprehensive budget status
 * - POST /budget/forecast - Forecast if a spend would be allowed
 * - POST /budget/limits/:agentId - Set spend limits
 * - POST /budget/pause/:agentId - Emergency pause spending
 * - POST /budget/resume/:agentId - Resume spending
 */

import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import {
  authorizeSpend,
  getBudgetStatus,
  forecastSpend,
  setSpendLimits,
  pauseSpending,
  resumeSpending,
} from "../services/budgetService";

const router = Router();

/**
 * POST /budget/authorize
 *
 * Pre-authorize a spend before execution.
 * Performs comprehensive budget and limit checks.
 *
 * Request:
 *   {
 *     agentId: string,                // Required: Agent to authorize
 *     estimatedSpendLamports?: number,// Direct spend amount (OR use calls)
 *     calls?: [{                      // Individual calls to authorize
 *       calleeId: string,
 *       toolName: string,
 *       estimatedTokens: number
 *     }],
 *     createReservation?: boolean,    // Create balance hold (default: false)
 *     reservationTimeoutMs?: number,  // Reservation timeout (default: 5min)
 *     purpose?: string                // Audit trail description
 *   }
 *
 * Response:
 *   {
 *     authorized: boolean,
 *     authorizationId?: string,       // If reservation created
 *     requestedSpend: { totalLamports, callCount, breakdown? },
 *     budgetStatus: { currentBalance, availableBalance, ... },
 *     limitChecks: { balanceSufficient, withinDailyCap, ... },
 *     warnings: string[],
 *     violations: string[],           // Why authorization failed
 *     reservation?: { reservationId, reservedLamports, expiresAt }
 *   }
 */
router.post("/authorize", apiKeyAuth, async (req, res) => {
  try {
    const {
      agentId,
      estimatedSpendLamports,
      calls,
      createReservation,
      reservationTimeoutMs,
      purpose,
    } = req.body;

    if (!agentId) {
      return res.status(400).json({
        error: "Missing required field: agentId",
      });
    }

    if (!estimatedSpendLamports && (!calls || calls.length === 0)) {
      return res.status(400).json({
        error: "Must provide either estimatedSpendLamports or calls array",
      });
    }

    // Validate calls if provided
    if (calls && Array.isArray(calls)) {
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        if (!call.calleeId || !call.toolName || call.estimatedTokens === undefined) {
          return res.status(400).json({
            error: `Invalid call at index ${i}: requires calleeId, toolName, estimatedTokens`,
          });
        }
      }
    }

    const result = await authorizeSpend({
      agentId,
      estimatedSpendLamports: estimatedSpendLamports ? Number(estimatedSpendLamports) : undefined,
      calls,
      createReservation: createReservation === true,
      reservationTimeoutMs: reservationTimeoutMs ? Number(reservationTimeoutMs) : undefined,
      purpose,
    });

    // Return appropriate status code based on authorization
    const statusCode = result.authorized ? 200 : 403;

    res.status(statusCode).json(result);
  } catch (error: any) {
    console.error("Error authorizing spend:", error);
    const statusCode = error.message?.includes("not found") ? 404 : 500;
    res.status(statusCode).json({
      authorized: false,
      error: error.message || "Authorization failed",
    });
  }
});

/**
 * GET /budget/status/:agentId
 *
 * Get comprehensive budget status for an agent.
 * Includes balance, limits, spending history, and health indicators.
 *
 * Response:
 *   {
 *     agentId: string,
 *     balance: { total, available, reserved, pending },
 *     limits: { maxCostPerCall, dailySpendCap, isPaused, allowedCallees },
 *     spending: {
 *       today: { used, remaining, percentUsed, transactionCount },
 *       thisMonth: { used, transactionCount },
 *       allTime: { totalSpent, totalTransactions }
 *     },
 *     activeReservations: [...],
 *     health: { status, warnings, recommendations }
 *   }
 */
router.get("/status/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    const status = await getBudgetStatus(agentId);

    res.json(status);
  } catch (error: any) {
    console.error("Error fetching budget status:", error);
    const statusCode = error.message?.includes("not found") ? 404 : 500;
    res.status(statusCode).json({
      error: error.message || "Failed to fetch budget status",
    });
  }
});

/**
 * POST /budget/forecast
 *
 * Forecast if a spend would be allowed (lighter than authorize).
 * Does NOT create reservations.
 *
 * Request:
 *   {
 *     agentId: string,
 *     calls: [{
 *       calleeId: string,
 *       toolName: string,
 *       estimatedTokens: number
 *     }]
 *   }
 *
 * Response:
 *   {
 *     canExecute: boolean,
 *     estimatedCost: number,
 *     balanceAfter: number,
 *     dailySpendAfter: number,
 *     violations: string[],
 *     warnings: string[]
 *   }
 */
router.post("/forecast", apiKeyAuth, async (req, res) => {
  try {
    const { agentId, calls } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: "Missing required field: agentId" });
    }

    if (!calls || !Array.isArray(calls) || calls.length === 0) {
      return res.status(400).json({ error: "Missing or empty calls array" });
    }

    const forecast = await forecastSpend(agentId, calls);

    res.json(forecast);
  } catch (error: any) {
    console.error("Error forecasting spend:", error);
    const statusCode = error.message?.includes("not found") ? 404 : 500;
    res.status(statusCode).json({
      canExecute: false,
      error: error.message || "Forecast failed",
    });
  }
});

/**
 * PUT /budget/limits/:agentId
 *
 * Set or update spend limits for an agent.
 *
 * Request:
 *   {
 *     maxCostPerCall?: number | null,
 *     dailySpendCap?: number | null,
 *     allowedCallees?: string[] | null
 *   }
 */
router.put("/limits/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { maxCostPerCall, dailySpendCap, allowedCallees } = req.body;

    // Validate inputs
    if (maxCostPerCall !== undefined && maxCostPerCall !== null) {
      if (typeof maxCostPerCall !== "number" || maxCostPerCall < 0) {
        return res.status(400).json({
          error: "maxCostPerCall must be a non-negative number or null",
        });
      }
    }

    if (dailySpendCap !== undefined && dailySpendCap !== null) {
      if (typeof dailySpendCap !== "number" || dailySpendCap < 0) {
        return res.status(400).json({
          error: "dailySpendCap must be a non-negative number or null",
        });
      }
    }

    if (allowedCallees !== undefined && allowedCallees !== null) {
      if (!Array.isArray(allowedCallees)) {
        return res.status(400).json({
          error: "allowedCallees must be an array of agent IDs or null",
        });
      }
    }

    await setSpendLimits(agentId, {
      maxCostPerCall,
      dailySpendCap,
      allowedCallees,
    });

    // Return updated status
    const status = await getBudgetStatus(agentId);

    res.json({
      success: true,
      message: "Spend limits updated",
      limits: status.limits,
    });
  } catch (error: any) {
    console.error("Error setting spend limits:", error);
    const statusCode = error.message?.includes("not found") ? 404 : 500;
    res.status(statusCode).json({
      error: error.message || "Failed to set spend limits",
    });
  }
});

/**
 * POST /budget/pause/:agentId
 *
 * Emergency pause all spending for an agent.
 * Use for risk mitigation when suspicious activity is detected.
 *
 * Request:
 *   { reason?: string }  // Optional audit reason
 */
router.post("/pause/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { reason } = req.body;

    await pauseSpending(agentId, reason);

    res.json({
      success: true,
      agentId,
      isPaused: true,
      message: "Agent spending paused immediately. No outgoing payments will process.",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error pausing agent:", error);
    const statusCode = error.message?.includes("not found") ? 404 : 500;
    res.status(statusCode).json({
      error: error.message || "Failed to pause agent",
    });
  }
});

/**
 * POST /budget/resume/:agentId
 *
 * Resume spending for a paused agent.
 */
router.post("/resume/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    await resumeSpending(agentId);

    res.json({
      success: true,
      agentId,
      isPaused: false,
      message: "Agent spending resumed.",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error resuming agent:", error);
    const statusCode = error.message?.includes("not found") ? 404 : 500;
    res.status(statusCode).json({
      error: error.message || "Failed to resume agent",
    });
  }
});

/**
 * GET /budget/history/:agentId
 *
 * Get recent spending history for an agent.
 */
router.get("/history/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const days = Math.min(Number(req.query.days) || 7, 90);

    const { db, toolUsage } = await import("../db/client");
    const { desc, eq, gte } = await import("drizzle-orm");

    if (!db) {
      return res.status(500).json({ error: "Database not connected" });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const history = await db
      .select()
      .from(toolUsage)
      .where(
        eq(toolUsage.callerAgentId, agentId)
      )
      .orderBy(desc(toolUsage.createdAt))
      .limit(limit);

    res.json({
      agentId,
      period: `last ${days} days`,
      transactions: history.map((tx) => ({
        id: tx.id,
        calleeId: tx.calleeAgentId,
        toolName: tx.toolName,
        tokensUsed: tx.tokensUsed,
        costLamports: tx.costLamports,
        ratePer1kTokens: tx.ratePer1kTokens,
        quoteId: tx.quoteId,
        createdAt: tx.createdAt?.toISOString(),
      })),
      count: history.length,
    });
  } catch (error: any) {
    console.error("Error fetching spend history:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch spending history",
    });
  }
});

/**
 * GET /budget/docs
 *
 * Usage documentation for budget APIs.
 */
router.get("/docs", (_req, res) => {
  res.json({
    name: "Budget Authorization APIs",
    description: "Enterprise-grade pre-authorization and spend management",
    version: "1.0.0",
    endpoints: {
      "POST /budget/authorize": {
        description: "Pre-authorize a spend before execution",
        useCase: "Validate spending is allowed before running expensive workflows",
        request: {
          agentId: "string (required)",
          estimatedSpendLamports: "number (optional - direct amount)",
          calls: "[{calleeId, toolName, estimatedTokens}] (optional - itemized)",
          createReservation: "boolean (default: false)",
          reservationTimeoutMs: "number (default: 300000 = 5min)",
          purpose: "string (optional - audit trail)",
        },
        response: {
          authorized: "boolean",
          authorizationId: "string (if reservation created)",
          requestedSpend: "{ totalLamports, callCount, breakdown }",
          budgetStatus: "{ currentBalance, availableBalance, ... }",
          limitChecks: "{ balanceSufficient, withinDailyCap, ... }",
          warnings: "string[]",
          violations: "string[] (why authorization failed)",
        },
      },
      "GET /budget/status/:agentId": {
        description: "Get comprehensive budget status",
        response: {
          balance: "{ total, available, reserved, pending }",
          limits: "{ maxCostPerCall, dailySpendCap, isPaused, ... }",
          spending: "{ today, thisMonth, allTime }",
          activeReservations: "[...]",
          health: "{ status, warnings, recommendations }",
        },
      },
      "POST /budget/forecast": {
        description: "Forecast if a spend would be allowed (no reservation)",
        request: {
          agentId: "string",
          calls: "[{calleeId, toolName, estimatedTokens}]",
        },
        response: {
          canExecute: "boolean",
          estimatedCost: "number",
          balanceAfter: "number",
          violations: "string[]",
          warnings: "string[]",
        },
      },
      "PUT /budget/limits/:agentId": {
        description: "Set or update spend limits",
        request: {
          maxCostPerCall: "number | null",
          dailySpendCap: "number | null",
          allowedCallees: "string[] | null",
        },
      },
      "POST /budget/pause/:agentId": {
        description: "Emergency pause all spending",
        useCase: "Immediately halt spending when suspicious activity detected",
        request: { reason: "string (optional)" },
      },
      "POST /budget/resume/:agentId": {
        description: "Resume spending for a paused agent",
      },
      "GET /budget/history/:agentId": {
        description: "Get recent spending history",
        queryParams: {
          limit: "number (default: 50, max: 500)",
          days: "number (default: 7, max: 90)",
        },
      },
    },
    enterpriseFeatures: [
      "Pre-execution authorization prevents cost accrual failures",
      "Multi-call workflow authorization in single request",
      "Balance reservations with automatic expiration",
      "Comprehensive health monitoring with recommendations",
      "Emergency pause capability for risk mitigation",
      "Full audit trail with purpose tracking",
    ],
    example: {
      authorization: {
        request: {
          method: "POST",
          url: "/budget/authorize",
          body: {
            agentId: "my-agent-123",
            calls: [
              { calleeId: "gpt-provider", toolName: "gpt-4", estimatedTokens: 8000 },
              { calleeId: "dalle-provider", toolName: "dalle-3", estimatedTokens: 1000 },
            ],
            createReservation: true,
            purpose: "Image generation workflow",
          },
        },
        response: {
          authorized: true,
          authorizationId: "auth-uuid-123",
          requestedSpend: { totalLamports: 12000, callCount: 2 },
          limitChecks: { balanceSufficient: true, withinDailyCap: true },
          warnings: [],
          violations: [],
        },
      },
    },
  });
});

export default router;
