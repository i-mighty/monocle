import { Router } from "express";
import { query } from "../db/client";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import {
  getCostAnalytics,
  getAgentSpendReports,
  getAgentSpendTimeSeries,
  getAgentRevenueReports,
  getRevenueTimeSeries,
  getPerformanceMetrics,
  getFailureAnalytics,
  getPlatformOverview,
  getAgentTrustMetrics,
  getTopSpenders,
  getTopEarners,
  getMostActiveAgents,
} from "../services/analyticsService";

const router = Router();

// =============================================================================
// PLATFORM OVERVIEW
// =============================================================================

/**
 * GET /dashboard/overview
 * 
 * Get platform-wide overview metrics
 */
router.get("/overview", async (_req, res) => {
  try {
    const overview = await getPlatformOverview();
    res.json(overview);
  } catch (error) {
    console.error("Error fetching overview:", error);
    res.status(500).json({ error: "Failed to fetch platform overview" });
  }
});

// =============================================================================
// COST ANALYTICS
// =============================================================================

/**
 * GET /dashboard/costs
 * 
 * Get cost analytics over time
 * Query params:
 *   - period: hour | day | week | month (default: day)
 *   - agentId: filter by specific agent
 */
router.get("/costs", async (req, res) => {
  try {
    const period = (req.query.period as "hour" | "day" | "week" | "month") || "day";
    const agentId = req.query.agentId as string | undefined;
    const analytics = await getCostAnalytics(period, agentId);
    res.json(analytics);
  } catch (error) {
    console.error("Error fetching cost analytics:", error);
    res.status(500).json({ error: "Failed to fetch cost analytics" });
  }
});

/**
 * GET /dashboard/costs/:agentId/timeseries
 * 
 * Get cost time series for a specific agent
 */
router.get("/costs/:agentId/timeseries", async (req, res) => {
  try {
    const { agentId } = req.params;
    const period = (req.query.period as "day" | "week" | "month") || "week";
    const timeSeries = await getAgentSpendTimeSeries(agentId, period);
    res.json(timeSeries);
  } catch (error) {
    console.error("Error fetching cost time series:", error);
    res.status(500).json({ error: "Failed to fetch cost time series" });
  }
});

// =============================================================================
// SPEND PER AGENT
// =============================================================================

/**
 * GET /dashboard/spend
 * 
 * Get spend reports per agent
 * Query params:
 *   - period: day | week | month | all (default: all)
 *   - limit: number (default: 50)
 */
router.get("/spend", async (req, res) => {
  try {
    const period = (req.query.period as "day" | "week" | "month" | "all") || "all";
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const reports = await getAgentSpendReports(limit, period);
    res.json(reports);
  } catch (error) {
    console.error("Error fetching spend reports:", error);
    res.status(500).json({ error: "Failed to fetch spend reports" });
  }
});

/**
 * GET /dashboard/spend/:agentId
 * 
 * Get detailed spend data for a specific agent
 */
router.get("/spend/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const period = (req.query.period as "day" | "week" | "month") || "week";
    
    // Get summary and time series
    const reports = await getAgentSpendReports(1000, "all");
    const agentReport = reports.find(r => r.agentId === agentId);
    const timeSeries = await getAgentSpendTimeSeries(agentId, period);
    
    if (!agentReport) {
      return res.status(404).json({ error: "Agent not found or has no spend data" });
    }
    
    res.json({
      ...agentReport,
      timeSeries,
    });
  } catch (error) {
    console.error("Error fetching agent spend:", error);
    res.status(500).json({ error: "Failed to fetch agent spend data" });
  }
});

// =============================================================================
// AGENT REVENUE REPORTS
// =============================================================================

/**
 * GET /dashboard/revenue
 * 
 * Get revenue reports per agent
 * Query params:
 *   - period: day | week | month | all (default: all)
 *   - limit: number (default: 50)
 */
router.get("/revenue", async (req, res) => {
  try {
    const period = (req.query.period as "day" | "week" | "month" | "all") || "all";
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const reports = await getAgentRevenueReports(limit, period);
    res.json(reports);
  } catch (error) {
    console.error("Error fetching revenue reports:", error);
    res.status(500).json({ error: "Failed to fetch revenue reports" });
  }
});

/**
 * GET /dashboard/revenue/:agentId
 * 
 * Get detailed revenue data for a specific agent
 */
router.get("/revenue/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const period = (req.query.period as "day" | "week" | "month") || "week";
    
    // Get summary and time series
    const reports = await getAgentRevenueReports(1000, "all");
    const agentReport = reports.find(r => r.agentId === agentId);
    const timeSeries = await getRevenueTimeSeries(agentId, period);
    
    if (!agentReport) {
      return res.status(404).json({ error: "Agent not found or has no revenue data" });
    }
    
    res.json({
      ...agentReport,
      timeSeries,
    });
  } catch (error) {
    console.error("Error fetching agent revenue:", error);
    res.status(500).json({ error: "Failed to fetch agent revenue data" });
  }
});

// =============================================================================
// PERFORMANCE METRICS
// =============================================================================

/**
 * GET /dashboard/performance
 * 
 * Get performance metrics (latency, errors)
 * Query params:
 *   - period: hour | day | week (default: day)
 *   - agentId: filter by specific agent
 */
router.get("/performance", async (req, res) => {
  try {
    const period = (req.query.period as "hour" | "day" | "week") || "day";
    const agentId = req.query.agentId as string | undefined;
    const metrics = await getPerformanceMetrics(period, agentId);
    res.json(metrics);
  } catch (error) {
    console.error("Error fetching performance metrics:", error);
    res.status(500).json({ error: "Failed to fetch performance metrics" });
  }
});

/**
 * GET /dashboard/performance/:agentId
 * 
 * Get performance metrics for a specific agent
 */
router.get("/performance/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const period = (req.query.period as "hour" | "day" | "week") || "day";
    const metrics = await getPerformanceMetrics(period, agentId);
    res.json(metrics);
  } catch (error) {
    console.error("Error fetching agent performance:", error);
    res.status(500).json({ error: "Failed to fetch agent performance data" });
  }
});

// =============================================================================
// FAILURE ANALYTICS
// =============================================================================

/**
 * GET /dashboard/failures
 * 
 * Get failure analytics and error breakdown
 * Query params:
 *   - period: hour | day | week (default: day)
 */
router.get("/failures", async (req, res) => {
  try {
    const period = (req.query.period as "hour" | "day" | "week") || "day";
    const analytics = await getFailureAnalytics(period);
    res.json(analytics);
  } catch (error) {
    console.error("Error fetching failure analytics:", error);
    res.status(500).json({ error: "Failed to fetch failure analytics" });
  }
});

// =============================================================================
// TRUST METRICS
// =============================================================================

/**
 * GET /dashboard/trust/:agentId
 * 
 * Get trust metrics for a specific agent
 */
router.get("/trust/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;
    const metrics = await getAgentTrustMetrics(agentId);
    res.json(metrics);
  } catch (error) {
    console.error("Error fetching trust metrics:", error);
    res.status(500).json({ error: "Failed to fetch trust metrics" });
  }
});

// =============================================================================
// LEADERBOARDS
// =============================================================================

/**
 * GET /dashboard/leaderboard/spenders
 * 
 * Get top spenders
 */
router.get("/leaderboard/spenders", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const spenders = await getTopSpenders(limit);
    res.json(spenders);
  } catch (error) {
    console.error("Error fetching top spenders:", error);
    res.status(500).json({ error: "Failed to fetch top spenders" });
  }
});

/**
 * GET /dashboard/leaderboard/earners
 * 
 * Get top earners
 */
router.get("/leaderboard/earners", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const earners = await getTopEarners(limit);
    res.json(earners);
  } catch (error) {
    console.error("Error fetching top earners:", error);
    res.status(500).json({ error: "Failed to fetch top earners" });
  }
});

/**
 * GET /dashboard/leaderboard/active
 * 
 * Get most active agents
 */
router.get("/leaderboard/active", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const active = await getMostActiveAgents(limit);
    res.json(active);
  } catch (error) {
    console.error("Error fetching most active agents:", error);
    res.status(500).json({ error: "Failed to fetch most active agents" });
  }
});

// =============================================================================
// LEGACY ENDPOINTS (maintained for backward compatibility)
// =============================================================================

// Usage analytics: tokens used and costs by agent
router.get("/usage", async (_req, res) => {
  try {
    const { rows } = await query(
      `select 
        callee_agent_id as agent_id, 
        count(*) as calls, 
        sum(tokens_used) as total_tokens,
        sum(cost_lamports) as total_cost_lamports
       from tool_usage 
       group by callee_agent_id 
       order by total_cost_lamports desc 
       limit 50`
    );
    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching usage:", error);
    res.json([]);
  }
});

// Settlement receipts
router.get("/receipts", async (_req, res) => {
  try {
    const { rows } = await query(
      `select 
        id, 
        from_agent_id, 
        to_agent_id, 
        gross_lamports, 
        platform_fee_lamports, 
        net_lamports,
        tx_signature, 
        status, 
        created_at
       from settlements 
       order by created_at desc 
       limit 100`
    );
    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching receipts:", error);
    res.json([]);
  }
});

// Total platform revenue
router.get("/earnings", async (_req, res) => {
  try {
    const { rows } = await query(
      "select coalesce(sum(fee_lamports), 0) as total_fees_lamports from platform_revenue"
    );
    res.json(rows?.[0] || { total_fees_lamports: 0 });
  } catch (error) {
    console.error("Error fetching earnings:", error);
    res.status(500).json({ total_fees_lamports: 0, error: "Failed to fetch earnings" });
  }
});

// Agent earnings (as callee)
router.get("/earnings/by-agent", async (_req, res) => {
  try {
    const { rows } = await query(
      `select 
        to_agent_id as agent_id, 
        sum(net_lamports) as total_received_lamports, 
        count(*) as settlement_count 
       from settlements 
       where status = 'confirmed'
       group by to_agent_id 
       order by total_received_lamports desc 
       limit 50`
    );
    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching earnings by agent:", error);
    res.status(500).json([]);
  }
});

// Platform revenue by settlement
router.get("/platform-revenue", async (_req, res) => {
  try {
    const { rows } = await query(
      `select 
        coalesce(sum(fee_lamports), 0) as total_fees_lamports,
        count(*) as settlement_count
       from platform_revenue`
    );
    res.json(rows?.[0] || { total_fees_lamports: 0, settlement_count: 0 });
  } catch (error) {
    console.error("Error fetching platform revenue:", error);
    res.status(500).json({ total_fees_lamports: 0, settlement_count: 0 });
  }
});

export default router;
