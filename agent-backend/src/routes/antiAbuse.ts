/**
 * Anti-Abuse Routes
 *
 * Endpoints for:
 * - Balance Pre-Authorization (reserve/capture/release)
 * - Anomaly Detection (alerts, profiles, resolution)
 *
 * Building money rails → abuse prevention is not optional.
 */

import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import {
  reserve,
  capture,
  release,
  getActiveReservations,
  getAvailableBalance,
  getReservationStats,
  expireOldReservations,
  executeWithPreAuth,
} from "../services/preAuthService";
import {
  detectAnomalies,
  getBehaviorProfile,
  getAlerts,
  resolveAlert,
  getPlatformAnomalySummary,
  detectSettlementFailureLoop,
} from "../services/anomalyService";

const router = Router();

// =============================================================================
// PRE-AUTHORIZATION ENDPOINTS
// =============================================================================

/**
 * POST /anti-abuse/reserve
 *
 * Create a balance reservation before execution.
 *
 * Body:
 * {
 *   "callerId": "my-agent",
 *   "calleeId": "provider-agent",
 *   "toolName": "code-review",
 *   "estimatedTokens": 5000,
 *   "timeoutMs": 300000  // optional, default 5 minutes
 * }
 */
router.post("/reserve", apiKeyAuth, async (req, res) => {
  try {
    const { callerId, calleeId, toolName, estimatedTokens, timeoutMs } = req.body;

    if (!callerId || !calleeId || !toolName || !estimatedTokens) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: callerId, calleeId, toolName, estimatedTokens",
      });
    }

    const result = await reserve({
      callerId,
      calleeId,
      toolName,
      estimatedTokens,
      timeoutMs,
    });

    res.status(201).json({
      success: true,
      data: result,
      message: "Balance reserved. Call capture or release when done.",
    });
  } catch (error: any) {
    console.error("Error creating reservation:", error);

    // Check for insufficient balance
    if (error.message?.includes("Insufficient")) {
      return res.status(402).json({
        success: false,
        error: error.message,
        code: "INSUFFICIENT_BALANCE",
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || "Failed to create reservation",
    });
  }
});

/**
 * POST /anti-abuse/capture/:reservationId
 *
 * Capture a reservation (complete the payment).
 *
 * Body:
 * {
 *   "actualTokens": 4500
 * }
 */
router.post("/capture/:reservationId", apiKeyAuth, async (req, res) => {
  try {
    const { reservationId } = req.params;
    const { actualTokens } = req.body;

    if (!actualTokens || typeof actualTokens !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid actualTokens",
      });
    }

    const result = await capture(reservationId, actualTokens);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Error capturing reservation:", error);

    if (error.message?.includes("not found") || error.message?.includes("not active")) {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }

    if (error.message?.includes("expired")) {
      return res.status(410).json({
        success: false,
        error: error.message,
        code: "RESERVATION_EXPIRED",
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || "Failed to capture reservation",
    });
  }
});

/**
 * POST /anti-abuse/release/:reservationId
 *
 * Release a reservation (cancel without capturing).
 *
 * Body (optional):
 * {
 *   "reason": "Execution failed"
 * }
 */
router.post("/release/:reservationId", apiKeyAuth, async (req, res) => {
  try {
    const { reservationId } = req.params;
    const { reason } = req.body;

    const result = await release(reservationId, reason);

    res.json({
      success: true,
      data: result,
      message: result.released
        ? "Reservation released successfully"
        : "Reservation was already released or captured",
    });
  } catch (error: any) {
    console.error("Error releasing reservation:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to release reservation",
    });
  }
});

/**
 * GET /anti-abuse/reservations/:agentId
 *
 * Get active reservations for an agent.
 */
router.get("/reservations/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    const reservations = await getActiveReservations(agentId);

    res.json({
      success: true,
      data: reservations,
    });
  } catch (error: any) {
    console.error("Error fetching reservations:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch reservations",
    });
  }
});

/**
 * GET /anti-abuse/balance/:agentId
 *
 * Get available balance (total minus reservations).
 */
router.get("/balance/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    const balance = await getAvailableBalance(agentId);

    res.json({
      success: true,
      data: balance,
    });
  } catch (error: any) {
    console.error("Error fetching balance:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch balance",
    });
  }
});

/**
 * GET /anti-abuse/reservations/:agentId/stats
 *
 * Get reservation statistics for an agent.
 */
router.get("/reservations/:agentId/stats", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    const stats = await getReservationStats(agentId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("Error fetching reservation stats:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch reservation stats",
    });
  }
});

// =============================================================================
// ANOMALY DETECTION ENDPOINTS
// =============================================================================

/**
 * GET /anti-abuse/alerts/:agentId
 *
 * Get anomaly alerts for an agent.
 */
router.get("/alerts/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { status, severity, limit } = req.query;

    const alerts = await getAlerts(agentId, {
      status: status as string,
      severity: severity as any,
      limit: limit ? parseInt(limit as string) : undefined,
    });

    res.json({
      success: true,
      data: alerts,
    });
  } catch (error: any) {
    console.error("Error fetching alerts:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch alerts",
    });
  }
});

/**
 * PATCH /anti-abuse/alerts/:alertId
 *
 * Resolve an anomaly alert.
 *
 * Body:
 * {
 *   "status": "resolved" | "false_positive",
 *   "notes": "Investigation complete - normal usage pattern"
 * }
 */
router.patch("/alerts/:alertId", apiKeyAuth, async (req, res) => {
  try {
    const { alertId } = req.params;
    const { status, notes } = req.body;

    if (!status || !["resolved", "false_positive"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "status must be 'resolved' or 'false_positive'",
      });
    }

    const alert = await resolveAlert(alertId, { status, notes });

    res.json({
      success: true,
      data: alert,
    });
  } catch (error: any) {
    console.error("Error resolving alert:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to resolve alert",
    });
  }
});

/**
 * GET /anti-abuse/profile/:agentId
 *
 * Get behavior profile for an agent.
 */
router.get("/profile/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    const profile = await getBehaviorProfile(agentId);

    res.json({
      success: true,
      data: profile,
    });
  } catch (error: any) {
    console.error("Error fetching behavior profile:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch behavior profile",
    });
  }
});

/**
 * POST /anti-abuse/scan/:agentId
 *
 * Manually trigger anomaly detection scan for an agent.
 * Useful for debugging and testing.
 *
 * Body:
 * {
 *   "callerId": "test-caller",
 *   "toolName": "test-tool",
 *   "tokensUsed": 5000,
 *   "ratePer1kTokens": 1000
 * }
 */
router.post("/scan/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { callerId, toolName, tokensUsed, ratePer1kTokens } = req.body;

    if (!callerId || !toolName || !tokensUsed || !ratePer1kTokens) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: callerId, toolName, tokensUsed, ratePer1kTokens",
      });
    }

    const result = await detectAnomalies(
      callerId,
      agentId,
      toolName,
      tokensUsed,
      ratePer1kTokens
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Error running anomaly scan:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to run anomaly scan",
    });
  }
});

/**
 * POST /anti-abuse/check-settlements/:agentId
 *
 * Check for settlement failure loops.
 */
router.post("/check-settlements/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    const alert = await detectSettlementFailureLoop(agentId);

    res.json({
      success: true,
      data: {
        alertDetected: alert !== null,
        alert,
      },
    });
  } catch (error: any) {
    console.error("Error checking settlements:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to check settlements",
    });
  }
});

/**
 * GET /anti-abuse/summary
 *
 * Get platform-wide anomaly summary (admin only).
 */
router.get("/summary", apiKeyAuth, async (req, res) => {
  try {
    const summary = await getPlatformAnomalySummary();

    res.json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    console.error("Error fetching platform summary:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch platform summary",
    });
  }
});

// =============================================================================
// MAINTENANCE ENDPOINTS
// =============================================================================

/**
 * POST /anti-abuse/maintenance/expire-reservations
 *
 * Expire old reservations. Should be called periodically.
 */
router.post("/maintenance/expire-reservations", apiKeyAuth, async (req, res) => {
  try {
    const expiredCount = await expireOldReservations();

    res.json({
      success: true,
      data: {
        expiredCount,
      },
    });
  } catch (error: any) {
    console.error("Error expiring reservations:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to expire reservations",
    });
  }
});

// =============================================================================
// USAGE DOCUMENTATION
// =============================================================================

/**
 * GET /anti-abuse/docs
 *
 * Get documentation for the anti-abuse system.
 */
router.get("/docs", async (req, res) => {
  res.json({
    success: true,
    data: {
      preAuthorization: {
        description: "Reserve balance before execution to prevent partial execution with insufficient funds",
        workflow: [
          "1. POST /anti-abuse/reserve - Create reservation before execution",
          "2. Execute your tool/computation",
          "3a. POST /anti-abuse/capture/:id - On success, capture the actual cost",
          "3b. POST /anti-abuse/release/:id - On failure, release the reservation",
        ],
        benefits: [
          "Atomic execution - either full success with payment, or nothing happens",
          "No partial execution with insufficient funds",
          "Automatic expiration of abandoned reservations",
        ],
      },
      anomalyDetection: {
        description: "Automatic detection of suspicious activity patterns",
        alertTypes: [
          {
            type: "token_spike",
            description: "Sudden increase in token usage (3x+ normal)",
            severity: "medium to critical",
          },
          {
            type: "unusual_caller",
            description: "Burst of new callers (potential coordinated attack)",
            severity: "high",
          },
          {
            type: "pricing_manipulation",
            description: "Unusual pricing patterns (50%+ deviation)",
            severity: "medium to high",
          },
          {
            type: "rapid_fire",
            description: "Too many calls in short window (DoS)",
            severity: "critical (auto-pause)",
          },
          {
            type: "settlement_loop",
            description: "Repeated settlement failures",
            severity: "high",
          },
        ],
        autoActions: [
          "Critical alerts automatically pause the agent",
          "Webhook notifications sent for all alerts",
        ],
      },
    },
  });
});

export default router;
