/**
 * Analytics Service
 * 
 * Comprehensive analytics for AgentPay platform:
 * - Cost analytics over time
 * - Spend per agent
 * - Revenue reports
 * - Performance metrics (latency, errors)
 * - Failure rates
 */

import { query } from "../db/client";

// ==================== TYPES ====================

export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

export interface CostAnalytics {
  period: string;
  totalCostLamports: number;
  totalCalls: number;
  totalTokens: number;
  avgCostPerCall: number;
  avgTokensPerCall: number;
  timeSeries: TimeSeriesPoint[];
}

export interface AgentSpendReport {
  agentId: string;
  name: string | null;
  totalSpentLamports: number;
  totalCalls: number;
  totalTokens: number;
  avgCostPerCall: number;
  uniqueCallees: number;
  firstCall: string | null;
  lastCall: string | null;
}

export interface AgentRevenueReport {
  agentId: string;
  name: string | null;
  totalEarnedLamports: number;
  totalSettledLamports: number;
  pendingLamports: number;
  totalCalls: number;
  uniqueCallers: number;
  avgRevenuePerCall: number;
  settlementCount: number;
}

export interface PerformanceMetrics {
  period: string;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  errorRate: number;
  timeSeries: {
    timestamp: string;
    avgLatencyMs: number;
    errorRate: number;
    callCount: number;
  }[];
}

export interface FailureAnalytics {
  period: string;
  totalFailures: number;
  failureRate: number;
  failuresByType: Record<string, number>;
  failuresByAgent: {
    agentId: string;
    failureCount: number;
    failureRate: number;
  }[];
  recentFailures: {
    timestamp: string;
    agentId: string;
    errorType: string;
    errorMessage: string;
  }[];
}

export interface PlatformOverview {
  totalAgents: number;
  activeAgents24h: number;
  totalCallsAllTime: number;
  totalCalls24h: number;
  totalVolumeLamports: number;
  volume24hLamports: number;
  platformRevenueLamports: number;
  avgCallsPerAgent: number;
}

export interface TrustMetrics {
  agentId: string;
  reliabilityScore: number;
  avgResponseTimeMs: number;
  successRate: number;
  totalInteractions: number;
  disputeCount: number;
  refundRate: number;
  trustTier: "new" | "basic" | "verified" | "trusted" | "elite";
}

// ==================== COST ANALYTICS ====================

export async function getCostAnalytics(
  period: "hour" | "day" | "week" | "month" = "day",
  agentId?: string
): Promise<CostAnalytics> {
  const intervalMap = {
    hour: "1 hour",
    day: "24 hours",
    week: "7 days",
    month: "30 days",
  };
  const truncMap = {
    hour: "minute",
    day: "hour",
    week: "day",
    month: "day",
  };

  const interval = intervalMap[period];
  const trunc = truncMap[period];
  const agentFilter = agentId ? "AND caller_agent_id = $2" : "";
  const params = agentId ? [interval, agentId] : [interval];

  // Aggregate totals
  const totalsQuery = `
    SELECT 
      COALESCE(SUM(cost_lamports), 0) as total_cost,
      COUNT(*) as total_calls,
      COALESCE(SUM(tokens_used), 0) as total_tokens
    FROM tool_usage
    WHERE created_at >= NOW() - $1::interval ${agentFilter}
  `;
  const totalsResult = await query(totalsQuery, params);
  const totals = totalsResult.rows[0] || { total_cost: 0, total_calls: 0, total_tokens: 0 };

  // Time series
  const timeSeriesQuery = `
    SELECT 
      DATE_TRUNC('${trunc}', created_at) as timestamp,
      SUM(cost_lamports) as value
    FROM tool_usage
    WHERE created_at >= NOW() - $1::interval ${agentFilter}
    GROUP BY DATE_TRUNC('${trunc}', created_at)
    ORDER BY timestamp
  `;
  const timeSeriesResult = await query(timeSeriesQuery, params);

  const totalCalls = Number(totals.total_calls) || 0;
  const totalCost = Number(totals.total_cost) || 0;
  const totalTokens = Number(totals.total_tokens) || 0;

  return {
    period,
    totalCostLamports: totalCost,
    totalCalls,
    totalTokens,
    avgCostPerCall: totalCalls > 0 ? Math.round(totalCost / totalCalls) : 0,
    avgTokensPerCall: totalCalls > 0 ? Math.round(totalTokens / totalCalls) : 0,
    timeSeries: (timeSeriesResult.rows || []).map((r: any) => ({
      timestamp: r.timestamp,
      value: Number(r.value) || 0,
    })),
  };
}

// ==================== SPEND PER AGENT ====================

export async function getAgentSpendReports(
  limit: number = 50,
  period: "day" | "week" | "month" | "all" = "all"
): Promise<AgentSpendReport[]> {
  const intervalClause = period === "all" 
    ? "" 
    : `AND tu.created_at >= NOW() - INTERVAL '${period === "day" ? "1 day" : period === "week" ? "7 days" : "30 days"}'`;

  const sql = `
    SELECT 
      tu.caller_agent_id as agent_id,
      a.name,
      COALESCE(SUM(tu.cost_lamports), 0) as total_spent,
      COUNT(*) as total_calls,
      COALESCE(SUM(tu.tokens_used), 0) as total_tokens,
      COUNT(DISTINCT tu.callee_agent_id) as unique_callees,
      MIN(tu.created_at) as first_call,
      MAX(tu.created_at) as last_call
    FROM tool_usage tu
    LEFT JOIN agents a ON tu.caller_agent_id = a.id
    WHERE 1=1 ${intervalClause}
    GROUP BY tu.caller_agent_id, a.name
    ORDER BY total_spent DESC
    LIMIT $1
  `;

  const result = await query(sql, [limit]);
  
  return (result.rows || []).map((r: any) => ({
    agentId: r.agent_id,
    name: r.name,
    totalSpentLamports: Number(r.total_spent) || 0,
    totalCalls: Number(r.total_calls) || 0,
    totalTokens: Number(r.total_tokens) || 0,
    avgCostPerCall: r.total_calls > 0 
      ? Math.round(Number(r.total_spent) / Number(r.total_calls)) 
      : 0,
    uniqueCallees: Number(r.unique_callees) || 0,
    firstCall: r.first_call,
    lastCall: r.last_call,
  }));
}

export async function getAgentSpendTimeSeries(
  agentId: string,
  period: "day" | "week" | "month" = "week"
): Promise<TimeSeriesPoint[]> {
  const intervalMap = {
    day: { interval: "24 hours", trunc: "hour" },
    week: { interval: "7 days", trunc: "day" },
    month: { interval: "30 days", trunc: "day" },
  };

  const { interval, trunc } = intervalMap[period];

  const sql = `
    SELECT 
      DATE_TRUNC('${trunc}', created_at) as timestamp,
      SUM(cost_lamports) as value
    FROM tool_usage
    WHERE caller_agent_id = $1 AND created_at >= NOW() - $2::interval
    GROUP BY DATE_TRUNC('${trunc}', created_at)
    ORDER BY timestamp
  `;

  const result = await query(sql, [agentId, interval]);
  
  return (result.rows || []).map((r: any) => ({
    timestamp: r.timestamp,
    value: Number(r.value) || 0,
  }));
}

// ==================== REVENUE REPORTS ====================

export async function getAgentRevenueReports(
  limit: number = 50,
  period: "day" | "week" | "month" | "all" = "all"
): Promise<AgentRevenueReport[]> {
  const intervalClause = period === "all" 
    ? "" 
    : `AND tu.created_at >= NOW() - INTERVAL '${period === "day" ? "1 day" : period === "week" ? "7 days" : "30 days"}'`;

  // Get earnings from tool usage (as callee)
  const earningsQuery = `
    SELECT 
      tu.callee_agent_id as agent_id,
      a.name,
      COALESCE(SUM(tu.cost_lamports), 0) as total_earned,
      COUNT(*) as total_calls,
      COUNT(DISTINCT tu.caller_agent_id) as unique_callers
    FROM tool_usage tu
    LEFT JOIN agents a ON tu.callee_agent_id = a.id
    WHERE 1=1 ${intervalClause}
    GROUP BY tu.callee_agent_id, a.name
    ORDER BY total_earned DESC
    LIMIT $1
  `;
  const earningsResult = await query(earningsQuery, [limit]);
  const earningsMap = new Map<string, any>();
  (earningsResult.rows || []).forEach((r: any) => {
    earningsMap.set(r.agent_id, r);
  });

  // Get settlement data
  const settlementsQuery = `
    SELECT 
      to_agent_id as agent_id,
      COALESCE(SUM(net_lamports), 0) as total_settled,
      COUNT(*) as settlement_count
    FROM settlements
    WHERE status = 'confirmed'
    GROUP BY to_agent_id
  `;
  const settlementsResult = await query(settlementsQuery, []);
  const settlementsMap = new Map<string, any>();
  (settlementsResult.rows || []).forEach((r: any) => {
    settlementsMap.set(r.agent_id, r);
  });

  // Get pending balances
  const pendingQuery = `
    SELECT id, pending_lamports FROM agents WHERE pending_lamports > 0
  `;
  const pendingResult = await query(pendingQuery, []);
  const pendingMap = new Map<string, number>();
  (pendingResult.rows || []).forEach((r: any) => {
    pendingMap.set(r.id, Number(r.pending_lamports) || 0);
  });

  // Combine data
  const agentIds = new Set([
    ...earningsMap.keys(),
    ...settlementsMap.keys(),
  ]);

  const reports: AgentRevenueReport[] = [];
  for (const agentId of agentIds) {
    const earnings = earningsMap.get(agentId) || {};
    const settlements = settlementsMap.get(agentId) || {};
    const pending = pendingMap.get(agentId) || 0;

    const totalEarned = Number(earnings.total_earned) || 0;
    const totalCalls = Number(earnings.total_calls) || 0;

    reports.push({
      agentId,
      name: earnings.name || null,
      totalEarnedLamports: totalEarned,
      totalSettledLamports: Number(settlements.total_settled) || 0,
      pendingLamports: pending,
      totalCalls,
      uniqueCallers: Number(earnings.unique_callers) || 0,
      avgRevenuePerCall: totalCalls > 0 ? Math.round(totalEarned / totalCalls) : 0,
      settlementCount: Number(settlements.settlement_count) || 0,
    });
  }

  // Sort by total earned and limit
  return reports
    .sort((a, b) => b.totalEarnedLamports - a.totalEarnedLamports)
    .slice(0, limit);
}

export async function getRevenueTimeSeries(
  agentId: string,
  period: "day" | "week" | "month" = "week"
): Promise<TimeSeriesPoint[]> {
  const intervalMap = {
    day: { interval: "24 hours", trunc: "hour" },
    week: { interval: "7 days", trunc: "day" },
    month: { interval: "30 days", trunc: "day" },
  };

  const { interval, trunc } = intervalMap[period];

  const sql = `
    SELECT 
      DATE_TRUNC('${trunc}', created_at) as timestamp,
      SUM(cost_lamports) as value
    FROM tool_usage
    WHERE callee_agent_id = $1 AND created_at >= NOW() - $2::interval
    GROUP BY DATE_TRUNC('${trunc}', created_at)
    ORDER BY timestamp
  `;

  const result = await query(sql, [agentId, interval]);
  
  return (result.rows || []).map((r: any) => ({
    timestamp: r.timestamp,
    value: Number(r.value) || 0,
  }));
}

// ==================== PERFORMANCE METRICS ====================

export async function getPerformanceMetrics(
  period: "hour" | "day" | "week" = "day",
  agentId?: string
): Promise<PerformanceMetrics> {
  const intervalMap = {
    hour: { interval: "1 hour", trunc: "minute" },
    day: { interval: "24 hours", trunc: "hour" },
    week: { interval: "7 days", trunc: "day" },
  };

  const { interval, trunc } = intervalMap[period];
  const agentFilter = agentId ? "AND agent_id = $2" : "";
  const params = agentId ? [interval, agentId] : [interval];

  // Get latency percentiles from activity logs
  const latencyQuery = `
    SELECT 
      COUNT(*) as total_calls,
      AVG(duration_ms) as avg_latency,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) as p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms) as p99,
      SUM(CASE WHEN severity = 'error' THEN 1 ELSE 0 END) as errors
    FROM activity_logs
    WHERE created_at >= NOW() - $1::interval
      AND event_type = 'tool_executed'
      AND duration_ms IS NOT NULL
      ${agentFilter}
  `;

  let latencyResult;
  try {
    latencyResult = await query(latencyQuery, params);
  } catch {
    // Fallback if activity_logs doesn't have duration_ms or percentile functions
    latencyResult = { rows: [{ total_calls: 0, avg_latency: 0, p50: 0, p95: 0, p99: 0, errors: 0 }] };
  }

  const latency = latencyResult.rows[0] || {};
  const totalCalls = Number(latency.total_calls) || 0;
  const errors = Number(latency.errors) || 0;

  // Time series for performance
  const timeSeriesQuery = `
    SELECT 
      DATE_TRUNC('${trunc}', created_at) as timestamp,
      AVG(duration_ms) as avg_latency,
      COUNT(*) as call_count,
      SUM(CASE WHEN severity = 'error' THEN 1 ELSE 0 END)::float / 
        NULLIF(COUNT(*), 0) * 100 as error_rate
    FROM activity_logs
    WHERE created_at >= NOW() - $1::interval
      AND event_type = 'tool_executed'
      ${agentFilter}
    GROUP BY DATE_TRUNC('${trunc}', created_at)
    ORDER BY timestamp
  `;

  let timeSeriesResult;
  try {
    timeSeriesResult = await query(timeSeriesQuery, params);
  } catch {
    timeSeriesResult = { rows: [] };
  }

  return {
    period,
    avgLatencyMs: Math.round(Number(latency.avg_latency) || 0),
    p50LatencyMs: Math.round(Number(latency.p50) || 0),
    p95LatencyMs: Math.round(Number(latency.p95) || 0),
    p99LatencyMs: Math.round(Number(latency.p99) || 0),
    totalCalls,
    successfulCalls: totalCalls - errors,
    failedCalls: errors,
    errorRate: totalCalls > 0 ? (errors / totalCalls) * 100 : 0,
    timeSeries: (timeSeriesResult.rows || []).map((r: any) => ({
      timestamp: r.timestamp,
      avgLatencyMs: Math.round(Number(r.avg_latency) || 0),
      errorRate: Number(r.error_rate) || 0,
      callCount: Number(r.call_count) || 0,
    })),
  };
}

// ==================== FAILURE ANALYTICS ====================

export async function getFailureAnalytics(
  period: "hour" | "day" | "week" = "day"
): Promise<FailureAnalytics> {
  const intervalMap = {
    hour: "1 hour",
    day: "24 hours",
    week: "7 days",
  };
  const interval = intervalMap[period];

  // Total failures
  const failuresQuery = `
    SELECT 
      COUNT(*) as total_failures,
      COUNT(*) FILTER (WHERE event_type = 'error_occurred') as error_events
    FROM activity_logs
    WHERE created_at >= NOW() - $1::interval
      AND severity = 'error'
  `;

  let failuresResult;
  try {
    failuresResult = await query(failuresQuery, [interval]);
  } catch {
    failuresResult = { rows: [{ total_failures: 0, error_events: 0 }] };
  }

  // Total calls for failure rate calculation
  const totalCallsQuery = `
    SELECT COUNT(*) as total_calls
    FROM activity_logs
    WHERE created_at >= NOW() - $1::interval
      AND event_type = 'tool_executed'
  `;

  let totalCallsResult;
  try {
    totalCallsResult = await query(totalCallsQuery, [interval]);
  } catch {
    totalCallsResult = { rows: [{ total_calls: 0 }] };
  }

  const totalFailures = Number(failuresResult.rows[0]?.total_failures) || 0;
  const totalCalls = Number(totalCallsResult.rows[0]?.total_calls) || 0;

  // Failures by type (from metadata)
  const byTypeQuery = `
    SELECT 
      COALESCE(metadata->>'errorType', 'unknown') as error_type,
      COUNT(*) as count
    FROM activity_logs
    WHERE created_at >= NOW() - $1::interval
      AND severity = 'error'
    GROUP BY COALESCE(metadata->>'errorType', 'unknown')
    ORDER BY count DESC
    LIMIT 10
  `;

  let byTypeResult;
  try {
    byTypeResult = await query(byTypeQuery, [interval]);
  } catch {
    byTypeResult = { rows: [] };
  }

  const failuresByType: Record<string, number> = {};
  (byTypeResult.rows || []).forEach((r: any) => {
    failuresByType[r.error_type] = Number(r.count) || 0;
  });

  // Failures by agent
  const byAgentQuery = `
    SELECT 
      agent_id,
      COUNT(*) as failure_count,
      COUNT(*)::float / NULLIF(
        (SELECT COUNT(*) FROM activity_logs 
         WHERE agent_id = al.agent_id 
           AND created_at >= NOW() - $1::interval
           AND event_type = 'tool_executed'), 0
      ) * 100 as failure_rate
    FROM activity_logs al
    WHERE created_at >= NOW() - $1::interval
      AND severity = 'error'
      AND agent_id IS NOT NULL
    GROUP BY agent_id
    ORDER BY failure_count DESC
    LIMIT 10
  `;

  let byAgentResult;
  try {
    byAgentResult = await query(byAgentQuery, [interval]);
  } catch {
    byAgentResult = { rows: [] };
  }

  // Recent failures
  const recentQuery = `
    SELECT 
      created_at as timestamp,
      agent_id,
      COALESCE(metadata->>'errorType', 'unknown') as error_type,
      description as error_message
    FROM activity_logs
    WHERE created_at >= NOW() - $1::interval
      AND severity = 'error'
    ORDER BY created_at DESC
    LIMIT 20
  `;

  let recentResult;
  try {
    recentResult = await query(recentQuery, [interval]);
  } catch {
    recentResult = { rows: [] };
  }

  return {
    period,
    totalFailures,
    failureRate: totalCalls > 0 ? (totalFailures / totalCalls) * 100 : 0,
    failuresByType,
    failuresByAgent: (byAgentResult.rows || []).map((r: any) => ({
      agentId: r.agent_id,
      failureCount: Number(r.failure_count) || 0,
      failureRate: Number(r.failure_rate) || 0,
    })),
    recentFailures: (recentResult.rows || []).map((r: any) => ({
      timestamp: r.timestamp,
      agentId: r.agent_id || "unknown",
      errorType: r.error_type,
      errorMessage: r.error_message,
    })),
  };
}

// ==================== PLATFORM OVERVIEW ====================

export async function getPlatformOverview(): Promise<PlatformOverview> {
  // Total agents
  const agentsQuery = `
    SELECT 
      COUNT(*) as total_agents,
      COUNT(*) FILTER (WHERE id IN (
        SELECT DISTINCT caller_agent_id FROM tool_usage 
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        UNION
        SELECT DISTINCT callee_agent_id FROM tool_usage 
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      )) as active_agents_24h
    FROM agents
  `;

  let agentsResult;
  try {
    agentsResult = await query(agentsQuery, []);
  } catch {
    agentsResult = { rows: [{ total_agents: 0, active_agents_24h: 0 }] };
  }

  // Call volumes
  const volumeQuery = `
    SELECT 
      COUNT(*) as total_calls_all_time,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as total_calls_24h,
      COALESCE(SUM(cost_lamports), 0) as total_volume,
      COALESCE(SUM(cost_lamports) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'), 0) as volume_24h
    FROM tool_usage
  `;

  let volumeResult;
  try {
    volumeResult = await query(volumeQuery, []);
  } catch {
    volumeResult = { rows: [{ total_calls_all_time: 0, total_calls_24h: 0, total_volume: 0, volume_24h: 0 }] };
  }

  // Platform revenue
  const revenueQuery = `
    SELECT COALESCE(SUM(fee_lamports), 0) as platform_revenue
    FROM platform_revenue
  `;

  let revenueResult;
  try {
    revenueResult = await query(revenueQuery, []);
  } catch {
    revenueResult = { rows: [{ platform_revenue: 0 }] };
  }

  const totalAgents = Number(agentsResult.rows[0]?.total_agents) || 0;
  const totalCallsAllTime = Number(volumeResult.rows[0]?.total_calls_all_time) || 0;

  return {
    totalAgents,
    activeAgents24h: Number(agentsResult.rows[0]?.active_agents_24h) || 0,
    totalCallsAllTime,
    totalCalls24h: Number(volumeResult.rows[0]?.total_calls_24h) || 0,
    totalVolumeLamports: Number(volumeResult.rows[0]?.total_volume) || 0,
    volume24hLamports: Number(volumeResult.rows[0]?.volume_24h) || 0,
    platformRevenueLamports: Number(revenueResult.rows[0]?.platform_revenue) || 0,
    avgCallsPerAgent: totalAgents > 0 ? Math.round(totalCallsAllTime / totalAgents) : 0,
  };
}

// ==================== TRUST METRICS ====================

export async function getAgentTrustMetrics(agentId: string): Promise<TrustMetrics> {
  // Get performance data
  const perfQuery = `
    SELECT 
      COUNT(*) as total_calls,
      AVG(duration_ms) as avg_response_time,
      SUM(CASE WHEN severity = 'error' THEN 1 ELSE 0 END) as errors
    FROM activity_logs
    WHERE (agent_id = $1 OR actor_id = $1)
      AND event_type = 'tool_executed'
  `;

  let perfResult;
  try {
    perfResult = await query(perfQuery, [agentId]);
  } catch {
    perfResult = { rows: [{ total_calls: 0, avg_response_time: 0, errors: 0 }] };
  }

  const totalCalls = Number(perfResult.rows[0]?.total_calls) || 0;
  const errors = Number(perfResult.rows[0]?.errors) || 0;
  const avgResponseTime = Number(perfResult.rows[0]?.avg_response_time) || 0;
  const successRate = totalCalls > 0 ? ((totalCalls - errors) / totalCalls) * 100 : 100;

  // Calculate trust tier based on interactions and success rate
  let trustTier: TrustMetrics["trustTier"] = "new";
  if (totalCalls >= 1000 && successRate >= 99) {
    trustTier = "elite";
  } else if (totalCalls >= 500 && successRate >= 98) {
    trustTier = "trusted";
  } else if (totalCalls >= 100 && successRate >= 95) {
    trustTier = "verified";
  } else if (totalCalls >= 10) {
    trustTier = "basic";
  }

  // Calculate reliability score (0-100)
  const reliabilityScore = Math.min(100, Math.round(
    (successRate * 0.5) +
    (Math.min(totalCalls / 10, 30)) +
    (avgResponseTime < 100 ? 20 : avgResponseTime < 500 ? 10 : 0)
  ));

  return {
    agentId,
    reliabilityScore,
    avgResponseTimeMs: Math.round(avgResponseTime),
    successRate: Math.round(successRate * 100) / 100,
    totalInteractions: totalCalls,
    disputeCount: 0, // TODO: Implement dispute tracking
    refundRate: 0, // TODO: Implement refund tracking
    trustTier,
  };
}

// ==================== LEADERBOARD ====================

export async function getTopSpenders(limit: number = 10): Promise<AgentSpendReport[]> {
  return getAgentSpendReports(limit, "week");
}

export async function getTopEarners(limit: number = 10): Promise<AgentRevenueReport[]> {
  return getAgentRevenueReports(limit, "week");
}

export async function getMostActiveAgents(limit: number = 10): Promise<{
  agentId: string;
  name: string | null;
  totalCalls: number;
  asCallerCount: number;
  asCalleeCount: number;
}[]> {
  const sql = `
    SELECT 
      a.id as agent_id,
      a.name,
      COALESCE(caller.calls, 0) + COALESCE(callee.calls, 0) as total_calls,
      COALESCE(caller.calls, 0) as as_caller_count,
      COALESCE(callee.calls, 0) as as_callee_count
    FROM agents a
    LEFT JOIN (
      SELECT caller_agent_id, COUNT(*) as calls
      FROM tool_usage
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY caller_agent_id
    ) caller ON a.id = caller.caller_agent_id
    LEFT JOIN (
      SELECT callee_agent_id, COUNT(*) as calls
      FROM tool_usage
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY callee_agent_id
    ) callee ON a.id = callee.callee_agent_id
    WHERE COALESCE(caller.calls, 0) + COALESCE(callee.calls, 0) > 0
    ORDER BY total_calls DESC
    LIMIT $1
  `;

  const result = await query(sql, [limit]);
  
  return (result.rows || []).map((r: any) => ({
    agentId: r.agent_id,
    name: r.name,
    totalCalls: Number(r.total_calls) || 0,
    asCallerCount: Number(r.as_caller_count) || 0,
    asCalleeCount: Number(r.as_callee_count) || 0,
  }));
}
