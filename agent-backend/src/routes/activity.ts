/**
 * Activity Logs & Audit Trail Routes
 *
 * Provides endpoints for:
 * - Querying activity logs
 * - Activity summaries
 * - Compliance exports
 */

import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import {
  queryActivityLogs,
  getActivitySummary,
  exportActivityLogs,
  ActivityEventType,
  ActivitySeverity,
} from "../services/activityService";
import { asyncHandler, sendSuccess, AppError, ErrorCodes } from "../errors";

const router = Router();

/**
 * GET /activity/logs
 *
 * Query activity logs with filters.
 *
 * Query params:
 *   - agentId: Filter by agent
 *   - eventType: Filter by event type
 *   - severity: Filter by severity (info, warning, error, critical)
 *   - actorType: Filter by actor type (agent, system, admin, api)
 *   - resourceType: Filter by resource type
 *   - startDate: Filter from date (ISO string)
 *   - endDate: Filter to date (ISO string)
 *   - limit: Max results (default 100, max 1000)
 *   - offset: Pagination offset
 */
router.get("/logs", apiKeyAuth, asyncHandler(async (req, res) => {
  const options = {
    agentId: req.query.agentId as string,
    eventType: req.query.eventType as ActivityEventType,
    severity: req.query.severity as ActivitySeverity,
    actorType: req.query.actorType as string,
    resourceType: req.query.resourceType as string,
    startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
    endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    limit: req.query.limit ? Math.min(Number(req.query.limit), 1000) : 100,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  };

  const result = await queryActivityLogs(options);

  sendSuccess(res, {
    logs: result.logs,
    pagination: {
      total: result.total,
      limit: options.limit,
      offset: options.offset,
      hasMore: options.offset + result.logs.length < result.total,
    },
  });
}));

/**
 * GET /activity/logs/:agentId
 *
 * Get activity logs for a specific agent.
 */
router.get("/logs/:agentId", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 1000) : 100;
  const offset = req.query.offset ? Number(req.query.offset) : 0;

  const result = await queryActivityLogs({
    agentId,
    eventType: req.query.eventType as ActivityEventType,
    severity: req.query.severity as ActivitySeverity,
    limit,
    offset,
  });

  sendSuccess(res, {
    agentId,
    logs: result.logs,
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + result.logs.length < result.total,
    },
  });
}));

/**
 * GET /activity/summary/:agentId
 *
 * Get activity summary for an agent.
 *
 * Query params:
 *   - days: Number of days to look back (default 30)
 */
router.get("/summary/:agentId", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const days = req.query.days ? Number(req.query.days) : 30;

  const summary = await getActivitySummary(agentId, days);

  sendSuccess(res, {
    agentId,
    period: {
      days,
      startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date().toISOString(),
    },
    ...summary,
  });
}));

/**
 * GET /activity/export
 *
 * Export activity logs for compliance.
 *
 * Query params:
 *   - format: Export format (json, csv) - default json
 *   - agentId: Filter by agent
 *   - eventType: Filter by event type
 *   - startDate: Filter from date
 *   - endDate: Filter to date
 */
router.get("/export", apiKeyAuth, asyncHandler(async (req, res) => {
  const format = (req.query.format as "json" | "csv") || "json";
  
  const options = {
    agentId: req.query.agentId as string,
    eventType: req.query.eventType as ActivityEventType,
    startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
    endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    format,
  };

  const data = await exportActivityLogs(options);

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="activity-logs-${Date.now()}.csv"`);
    res.send(data);
  } else {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="activity-logs-${Date.now()}.json"`);
    res.send(data);
  }
}));

/**
 * GET /activity/event-types
 *
 * Get list of available event types.
 */
router.get("/event-types", apiKeyAuth, asyncHandler(async (_req, res) => {
  const eventTypes = [
    { type: "identity_created", description: "Agent identity verification and registration" },
    { type: "pricing_changed", description: "Agent or tool pricing updates" },
    { type: "tool_executed", description: "Tool call execution with cost tracking" },
    { type: "payment_executed", description: "Balance topup or transfer" },
    { type: "settlement_completed", description: "On-chain settlement finalization" },
    { type: "agent_registered", description: "New agent registration" },
    { type: "agent_updated", description: "Agent profile or settings update" },
    { type: "tool_registered", description: "New tool registration" },
    { type: "budget_changed", description: "Budget guardrail changes" },
    { type: "verification_changed", description: "Agent verification status change" },
    { type: "capability_added", description: "Agent capability added" },
    { type: "capability_removed", description: "Agent capability removed" },
    { type: "audit_created", description: "Agent audit record created" },
    { type: "api_key_used", description: "API key authentication event" },
    { type: "error_occurred", description: "Error event for audit trail" },
  ];

  const severities = [
    { level: "info", description: "Normal operations" },
    { level: "warning", description: "Potentially concerning events" },
    { level: "error", description: "Operation failures" },
    { level: "critical", description: "Critical security or system events" },
  ];

  sendSuccess(res, { eventTypes, severities });
}));

/**
 * GET /activity/stats
 *
 * Get global activity statistics.
 *
 * Query params:
 *   - days: Number of days to look back (default 7)
 */
router.get("/stats", apiKeyAuth, asyncHandler(async (req, res) => {
  const days = req.query.days ? Number(req.query.days) : 7;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Import query directly
  const { query } = await import("../db/client");

  // Total events
  const totalResult = await query(
    `SELECT COUNT(*) as total FROM activity_logs WHERE created_at >= $1`,
    [startDate]
  );

  // By event type
  const byTypeResult = await query(
    `SELECT event_type, COUNT(*) as count
     FROM activity_logs
     WHERE created_at >= $1
     GROUP BY event_type
     ORDER BY count DESC`,
    [startDate]
  );

  // By severity
  const bySeverityResult = await query(
    `SELECT severity, COUNT(*) as count
     FROM activity_logs
     WHERE created_at >= $1
     GROUP BY severity`,
    [startDate]
  );

  // Events per day
  const perDayResult = await query(
    `SELECT DATE(created_at) as date, COUNT(*) as count
     FROM activity_logs
     WHERE created_at >= $1
     GROUP BY DATE(created_at)
     ORDER BY date`,
    [startDate]
  );

  // Most active agents
  const activeAgentsResult = await query(
    `SELECT agent_id, COUNT(*) as count
     FROM activity_logs
     WHERE created_at >= $1 AND agent_id IS NOT NULL
     GROUP BY agent_id
     ORDER BY count DESC
     LIMIT 10`,
    [startDate]
  );

  sendSuccess(res, {
    period: {
      days,
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString(),
    },
    totalEvents: parseInt(totalResult.rows[0]?.total || "0"),
    byEventType: byTypeResult.rows.reduce((acc: any, row: any) => {
      acc[row.event_type] = parseInt(row.count);
      return acc;
    }, {}),
    bySeverity: bySeverityResult.rows.reduce((acc: any, row: any) => {
      acc[row.severity] = parseInt(row.count);
      return acc;
    }, {}),
    eventsPerDay: perDayResult.rows.map((row: any) => ({
      date: row.date,
      count: parseInt(row.count),
    })),
    mostActiveAgents: activeAgentsResult.rows.map((row: any) => ({
      agentId: row.agent_id,
      eventCount: parseInt(row.count),
    })),
  });
}));

export default router;
