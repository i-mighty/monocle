/**
 * Reputation & Network Routes
 *
 * Public and authenticated endpoints for:
 * - Verifiable Performance Metrics
 * - Agent Compatibility Graph
 * - Incident Transparency Log
 */

import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import {
  getPerformanceMetrics,
  getCompatibilityGraph,
  getRecommendedIntegrations,
  getIncidentHistory,
  createIncident,
  updateIncident,
  recordExecutionResult,
  getPlatformIncidentSummary,
} from "../services/reputationService";

const router = Router();

// =============================================================================
// VERIFIABLE PERFORMANCE METRICS
// =============================================================================

/**
 * GET /reputation/metrics/:agentId
 *
 * Get verifiable performance metrics for an agent.
 * PUBLIC endpoint - transparency builds trust.
 *
 * Returns:
 * - Success rate
 * - Latency (avg, p50, p95, p99)
 * - Cost efficiency score
 * - Uptime (24h, 7d, 30d)
 * - Failure categories
 * - Trends (improving/stable/declining)
 * - Portable reputation hash
 */
router.get("/metrics/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const metrics = await getPerformanceMetrics(agentId);

    res.json({
      success: true,
      data: metrics,
    });
  } catch (error: any) {
    console.error("Error fetching performance metrics:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch performance metrics",
    });
  }
});

/**
 * GET /reputation/metrics/:agentId/badge
 *
 * Get a compact reputation badge (embeddable)
 */
router.get("/metrics/:agentId/badge", async (req, res) => {
  try {
    const { agentId } = req.params;
    const metrics = await getPerformanceMetrics(agentId);

    // Compact badge format
    res.json({
      agentId,
      badge: {
        successRate: metrics.overall.successRate,
        avgLatencyMs: metrics.latency.avgMs,
        costEfficiency: metrics.costEfficiency.costEfficiencyScore,
        uptime7d: metrics.uptime.last7d,
        totalCalls: metrics.overall.totalCalls,
        trend: metrics.trends.successRateTrend,
      },
      verificationHash: metrics.reputationHash,
      generatedAt: metrics.calculatedAt,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to generate badge",
    });
  }
});

// =============================================================================
// AGENT COMPATIBILITY GRAPH
// =============================================================================

/**
 * GET /reputation/compatibility/:agentId
 *
 * Get the compatibility graph for an agent.
 * Shows which agents work well together.
 *
 * Returns:
 * - Top callers (who calls this agent successfully)
 * - Top providers (who this agent calls successfully)
 * - Recommended integrations
 * - Common pipelines
 */
router.get("/compatibility/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const graph = await getCompatibilityGraph(agentId);

    res.json({
      success: true,
      data: graph,
    });
  } catch (error: any) {
    console.error("Error fetching compatibility graph:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch compatibility graph",
    });
  }
});

/**
 * GET /reputation/compatibility/:agentId/recommendations
 *
 * Get recommended agents to integrate with based on network analysis.
 */
router.get("/compatibility/:agentId/recommendations", async (req, res) => {
  try {
    const { agentId } = req.params;
    const result = await getRecommendedIntegrations(agentId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Error fetching recommendations:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch recommendations",
    });
  }
});

// =============================================================================
// INCIDENT TRANSPARENCY LOG
// =============================================================================

/**
 * GET /reputation/incidents/:agentId
 *
 * PUBLIC incident history for an agent.
 * Transparency builds trust - every failure is recorded.
 *
 * Returns for each incident:
 * - Failure type
 * - Severity
 * - Recovery behavior
 * - Refund issued?
 * - Time to resolution
 */
router.get("/incidents/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const incidents = await getIncidentHistory(agentId, limit);

    res.json({
      success: true,
      count: incidents.length,
      data: incidents,
    });
  } catch (error: any) {
    console.error("Error fetching incident history:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch incident history",
    });
  }
});

/**
 * POST /reputation/incidents
 *
 * Create a new incident report (self-reported or detected).
 * Agents should report their own issues for transparency.
 */
router.post("/incidents", apiKeyAuth, async (req, res) => {
  try {
    const {
      calleeAgentId,
      callerAgentId,
      incidentType,
      severity,
      toolName,
      title,
      description,
    } = req.body;

    if (!calleeAgentId || !incidentType || !severity || !title) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: calleeAgentId, incidentType, severity, title",
      });
    }

    const incident = await createIncident({
      calleeAgentId,
      callerAgentId,
      incidentType,
      severity,
      toolName,
      title,
      description,
    });

    res.status(201).json({
      success: true,
      data: incident,
      message: "Incident reported. Transparency builds trust.",
    });
  } catch (error: any) {
    console.error("Error creating incident:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create incident",
    });
  }
});

/**
 * PATCH /reputation/incidents/:incidentId
 *
 * Update incident status/resolution.
 */
router.patch("/incidents/:incidentId", apiKeyAuth, async (req, res) => {
  try {
    const { incidentId } = req.params;
    const { status, rootCause, resolutionNotes, refundsIssued, totalRefundLamports } = req.body;

    const incident = await updateIncident(incidentId, {
      status,
      rootCause,
      resolutionNotes,
      refundsIssued,
      totalRefundLamports,
    });

    res.json({
      success: true,
      data: incident,
    });
  } catch (error: any) {
    console.error("Error updating incident:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update incident",
    });
  }
});

/**
 * GET /reputation/incidents/platform/summary
 *
 * Platform-wide incident summary (admin view)
 */
router.get("/incidents/platform/summary", apiKeyAuth, async (req, res) => {
  try {
    const summary = await getPlatformIncidentSummary();

    res.json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    console.error("Error fetching platform summary:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch platform incident summary",
    });
  }
});

// =============================================================================
// EXECUTION RESULT RECORDING
// =============================================================================

/**
 * POST /reputation/execution
 *
 * Record the result of a tool execution.
 * Should be called after every tool invocation to track performance.
 */
router.post("/execution", apiKeyAuth, async (req, res) => {
  try {
    const {
      toolUsageId,
      status,
      latencyMs,
      errorCode,
      errorMessage,
      retryCount,
      recoveryAction,
      refundIssued,
      refundAmountLamports,
    } = req.body;

    if (!toolUsageId || !status) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: toolUsageId, status",
      });
    }

    if (!["success", "failure", "timeout", "error"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status. Must be one of: success, failure, timeout, error",
      });
    }

    const result = await recordExecutionResult({
      toolUsageId,
      status,
      latencyMs,
      errorCode,
      errorMessage,
      retryCount,
      recoveryAction,
      refundIssued,
      refundAmountLamports,
    });

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Error recording execution result:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to record execution result",
    });
  }
});

// =============================================================================
// DISCOVERY ENDPOINTS
// =============================================================================

/**
 * GET /reputation/leaderboard
 *
 * Top agents by reputation score
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    // This would query aggregated metrics in production
    // For now, return a structure that shows what's available
    res.json({
      success: true,
      data: {
        message: "Leaderboard coming soon - aggregates performance metrics across all agents",
        criteria: [
          "Success rate (40%)",
          "Cost efficiency (25%)",
          "Latency score (20%)",
          "Uptime (15%)",
        ],
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch leaderboard",
    });
  }
});

/**
 * GET /reputation/network/stats
 *
 * Network-wide statistics
 */
router.get("/network/stats", async (req, res) => {
  try {
    const summary = await getPlatformIncidentSummary();

    res.json({
      success: true,
      data: {
        incidents: summary,
        // Would add more network stats here
        message: "Network statistics - visibility into platform health",
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch network stats",
    });
  }
});

export default router;
