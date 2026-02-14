/**
 * Reputation & Network Service
 *
 * Provides verifiable, portable reputation primitives for agents:
 * - Performance Metrics (success rate, latency, uptime, cost efficiency)
 * - Agent Compatibility Graph (who works well together)
 * - Incident Transparency Log (public failure records)
 */

import { eq, and, desc, asc, sql, sum, count, avg, gte, lte, or } from "drizzle-orm";
import {
  db,
  pool,
  agents,
  toolUsage,
  executionResults,
  incidents,
  agentCompatibility,
} from "../db/client";
import type {
  ExecutionResult,
  Incident,
  AgentCompatibility,
} from "../db/client";

// =============================================================================
// TYPES
// =============================================================================

export interface PerformanceMetrics {
  agentId: string;
  calculatedAt: Date;
  overall: {
    successRate: number;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
  };
  latency: {
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  };
  costEfficiency: {
    avgCostPerCall: number;
    avgCostPer1kTokens: number;
    costEfficiencyScore: number; // 0-100, compared to market
  };
  uptime: {
    last24h: number;
    last7d: number;
    last30d: number;
  };
  failureCategories: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  trends: {
    successRateTrend: "improving" | "stable" | "declining";
    latencyTrend: "improving" | "stable" | "declining";
  };
  // Portable reputation primitive
  reputationHash?: string;
}

export interface CompatibilityEdge {
  callerId: string;
  calleeId: string;
  score: number;
  totalCalls: number;
  successRate: number;
  avgLatencyMs: number;
  topTools: string[];
  lastInteraction: Date | null;
}

export interface CompatibilityGraph {
  agentId: string;
  asProvider: {
    topCallers: CompatibilityEdge[];
    recommendedCallers: CompatibilityEdge[];
  };
  asConsumer: {
    topProviders: CompatibilityEdge[];
    recommendedProviders: CompatibilityEdge[];
  };
  commonPipelines: Array<{
    agents: string[];
    callCount: number;
    avgLatency: number;
  }>;
}

export interface IncidentReport {
  id: string;
  agentId: string;
  incidentType: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  affectedCallCount: number;
  detectedAt: Date;
  resolvedAt: Date | null;
  timeToResolution: number | null; // hours
  refundsIssued: number;
  totalRefundLamports: number;
  recoveryBehavior: string | null;
}

// =============================================================================
// EXECUTION RESULT RECORDING
// =============================================================================

/**
 * Record the result of a tool execution (success or failure)
 */
export async function recordExecutionResult(params: {
  toolUsageId: string;
  status: "success" | "failure" | "timeout" | "error";
  latencyMs?: number;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;
  recoveryAction?: "none" | "retry" | "fallback" | "refund";
  refundIssued?: boolean;
  refundAmountLamports?: number;
}): Promise<ExecutionResult> {
  if (!db) throw new Error("Database not connected");

  const [result] = await db
    .insert(executionResults)
    .values({
      toolUsageId: params.toolUsageId,
      status: params.status,
      latencyMs: params.latencyMs,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
      retryCount: params.retryCount ?? 0,
      recoveryAction: params.recoveryAction ?? "none",
      refundIssued: params.refundIssued ? "true" : "false",
      refundAmountLamports: params.refundAmountLamports,
    })
    .returning();

  // Update compatibility stats
  const usage = await db
    .select()
    .from(toolUsage)
    .where(eq(toolUsage.id, params.toolUsageId))
    .limit(1);

  if (usage.length > 0) {
    await updateCompatibilityStats(
      usage[0].callerAgentId,
      usage[0].calleeAgentId,
      params.status === "success",
      params.latencyMs ?? 0,
      usage[0].costLamports,
      usage[0].toolName
    );

    // Auto-create incident for failures
    if (params.status !== "success") {
      await checkAndCreateIncident(
        usage[0].calleeAgentId,
        usage[0].callerAgentId,
        usage[0].toolName,
        params.status,
        params.errorCode,
        params.errorMessage
      );
    }
  }

  return result;
}

// =============================================================================
// VERIFIABLE PERFORMANCE METRICS
// =============================================================================

/**
 * Calculate comprehensive performance metrics for an agent
 */
export async function getPerformanceMetrics(agentId: string): Promise<PerformanceMetrics> {
  if (!db) throw new Error("Database not connected");

  // Get all executions where this agent was the callee (provider)
  const executionsResult = await db
    .select({
      status: executionResults.status,
      latencyMs: executionResults.latencyMs,
      errorCode: executionResults.errorCode,
      createdAt: executionResults.createdAt,
    })
    .from(executionResults)
    .innerJoin(toolUsage, eq(executionResults.toolUsageId, toolUsage.id))
    .where(eq(toolUsage.calleeAgentId, agentId));

  const executions = executionsResult;
  const totalCalls = executions.length;
  const successfulCalls = executions.filter((e) => e.status === "success").length;
  const failedCalls = totalCalls - successfulCalls;
  const successRate = totalCalls > 0 ? (successfulCalls / totalCalls) * 100 : 100;

  // Calculate latency metrics
  const latencies = executions
    .filter((e) => e.latencyMs !== null)
    .map((e) => e.latencyMs!)
    .sort((a, b) => a - b);

  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
  const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;
  const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0;

  // Calculate cost efficiency
  const costResult = await db
    .select({
      avgCost: sql<number>`avg(${toolUsage.costLamports})::int`,
      avgRate: sql<number>`avg(${toolUsage.ratePer1kTokens})::int`,
    })
    .from(toolUsage)
    .where(eq(toolUsage.calleeAgentId, agentId));

  const avgCostPerCall = Number(costResult[0]?.avgCost || 0);
  const avgCostPer1kTokens = Number(costResult[0]?.avgRate || 1000);

  // Get market average for comparison
  const marketAvgResult = await db
    .select({
      avgRate: sql<number>`avg(${toolUsage.ratePer1kTokens})::int`,
    })
    .from(toolUsage);

  const marketAvgRate = Number(marketAvgResult[0]?.avgRate || 1000);
  const costEfficiencyScore = Math.max(0, Math.min(100,
    100 - ((avgCostPer1kTokens - marketAvgRate) / marketAvgRate) * 50
  ));

  // Calculate uptime (based on success rate over time periods)
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const calculateUptime = (since: Date) => {
    const periodExecs = executions.filter(
      (e) => e.createdAt && new Date(e.createdAt) >= since
    );
    if (periodExecs.length === 0) return 100;
    const successes = periodExecs.filter((e) => e.status === "success").length;
    return (successes / periodExecs.length) * 100;
  };

  // Failure categories
  const failureCounts = new Map<string, number>();
  executions
    .filter((e) => e.status !== "success")
    .forEach((e) => {
      const category = e.errorCode || e.status;
      failureCounts.set(category, (failureCounts.get(category) || 0) + 1);
    });

  const failureCategories = Array.from(failureCounts.entries())
    .map(([category, count]) => ({
      category,
      count,
      percentage: failedCalls > 0 ? (count / failedCalls) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Trend analysis (compare last 7 days to previous 7 days)
  const recentExecs = executions.filter(
    (e) => e.createdAt && new Date(e.createdAt) >= sevenDaysAgo
  );
  const previousExecs = executions.filter(
    (e) =>
      e.createdAt &&
      new Date(e.createdAt) >= new Date(sevenDaysAgo.getTime() - 7 * 24 * 60 * 60 * 1000) &&
      new Date(e.createdAt) < sevenDaysAgo
  );

  const recentSuccessRate = recentExecs.length > 0
    ? recentExecs.filter((e) => e.status === "success").length / recentExecs.length
    : 1;
  const previousSuccessRate = previousExecs.length > 0
    ? previousExecs.filter((e) => e.status === "success").length / previousExecs.length
    : 1;

  const successRateTrend: "improving" | "stable" | "declining" =
    recentSuccessRate > previousSuccessRate + 0.05
      ? "improving"
      : recentSuccessRate < previousSuccessRate - 0.05
        ? "declining"
        : "stable";

  const recentLatencies = recentExecs
    .filter((e) => e.latencyMs !== null)
    .map((e) => e.latencyMs!);
  const previousLatencies = previousExecs
    .filter((e) => e.latencyMs !== null)
    .map((e) => e.latencyMs!);

  const recentAvgLatency = recentLatencies.length > 0
    ? recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length
    : 0;
  const previousAvgLatency = previousLatencies.length > 0
    ? previousLatencies.reduce((a, b) => a + b, 0) / previousLatencies.length
    : 0;

  const latencyTrend: "improving" | "stable" | "declining" =
    recentAvgLatency < previousAvgLatency * 0.9
      ? "improving"
      : recentAvgLatency > previousAvgLatency * 1.1
        ? "declining"
        : "stable";

  // Generate portable reputation hash
  const reputationData = {
    agentId,
    successRate: Math.round(successRate * 100) / 100,
    avgLatency: Math.round(avgLatency),
    costEfficiency: Math.round(costEfficiencyScore),
    totalCalls,
    timestamp: now.toISOString(),
  };
  const reputationHash = Buffer.from(JSON.stringify(reputationData)).toString("base64");

  return {
    agentId,
    calculatedAt: now,
    overall: {
      successRate: Math.round(successRate * 100) / 100,
      totalCalls,
      successfulCalls,
      failedCalls,
    },
    latency: {
      avgMs: Math.round(avgLatency),
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
    },
    costEfficiency: {
      avgCostPerCall,
      avgCostPer1kTokens,
      costEfficiencyScore: Math.round(costEfficiencyScore),
    },
    uptime: {
      last24h: Math.round(calculateUptime(oneDayAgo) * 100) / 100,
      last7d: Math.round(calculateUptime(sevenDaysAgo) * 100) / 100,
      last30d: Math.round(calculateUptime(thirtyDaysAgo) * 100) / 100,
    },
    failureCategories,
    trends: {
      successRateTrend,
      latencyTrend,
    },
    reputationHash,
  };
}

// =============================================================================
// AGENT COMPATIBILITY GRAPH
// =============================================================================

/**
 * Update compatibility statistics for an agent pair
 */
async function updateCompatibilityStats(
  callerId: string,
  calleeId: string,
  success: boolean,
  latencyMs: number,
  costLamports: number,
  toolName: string
): Promise<void> {
  if (!db || !pool) return;

  // Upsert compatibility record
  await pool.query(
    `INSERT INTO agent_compatibility 
     (caller_agent_id, callee_agent_id, total_calls, successful_calls, failed_calls, 
      avg_latency_ms, total_spent_lamports, first_interaction, last_interaction, top_tools)
     VALUES ($1, $2, 1, $3, $4, $5, $6, NOW(), NOW(), $7)
     ON CONFLICT (caller_agent_id, callee_agent_id) DO UPDATE SET
       total_calls = agent_compatibility.total_calls + 1,
       successful_calls = agent_compatibility.successful_calls + $3,
       failed_calls = agent_compatibility.failed_calls + $4,
       avg_latency_ms = (agent_compatibility.avg_latency_ms * agent_compatibility.total_calls + $5) / (agent_compatibility.total_calls + 1),
       total_spent_lamports = agent_compatibility.total_spent_lamports + $6,
       last_interaction = NOW(),
       updated_at = NOW()`,
    [
      callerId,
      calleeId,
      success ? 1 : 0,
      success ? 0 : 1,
      latencyMs,
      costLamports,
      JSON.stringify([toolName]),
    ]
  );

  // Update compatibility score
  const result = await pool.query(
    `SELECT total_calls, successful_calls, avg_latency_ms 
     FROM agent_compatibility 
     WHERE caller_agent_id = $1 AND callee_agent_id = $2`,
    [callerId, calleeId]
  );

  if (result.rows.length > 0) {
    const { total_calls, successful_calls, avg_latency_ms } = result.rows[0];
    const successRate = successful_calls / total_calls;
    
    // Compatibility score: 70% success rate + 30% latency score
    const latencyScore = Math.max(0, 100 - (avg_latency_ms / 10)); // Penalty per 10ms
    const score = Math.round(successRate * 70 + (latencyScore / 100) * 30);

    await pool.query(
      `UPDATE agent_compatibility 
       SET compatibility_score = $1, avg_cost_per_call = total_spent_lamports / total_calls
       WHERE caller_agent_id = $2 AND callee_agent_id = $3`,
      [Math.min(100, Math.max(0, score)), callerId, calleeId]
    );
  }
}

/**
 * Get compatibility graph for an agent
 */
export async function getCompatibilityGraph(agentId: string): Promise<CompatibilityGraph> {
  if (!db) throw new Error("Database not connected");

  // Top callers (agents that call this agent the most, successfully)
  const callersResult = await db
    .select()
    .from(agentCompatibility)
    .where(eq(agentCompatibility.calleeAgentId, agentId))
    .orderBy(desc(agentCompatibility.compatibilityScore))
    .limit(10);

  const topCallers = callersResult.map((c) => ({
    callerId: c.callerAgentId,
    calleeId: c.calleeAgentId,
    score: c.compatibilityScore ?? 0,
    totalCalls: c.totalCalls,
    successRate: c.totalCalls > 0 ? (c.successfulCalls / c.totalCalls) * 100 : 0,
    avgLatencyMs: c.avgLatencyMs ?? 0,
    topTools: c.topTools ? JSON.parse(c.topTools) : [],
    lastInteraction: c.lastInteraction,
  }));

  // Top providers (agents this agent calls the most)
  const providersResult = await db
    .select()
    .from(agentCompatibility)
    .where(eq(agentCompatibility.callerAgentId, agentId))
    .orderBy(desc(agentCompatibility.compatibilityScore))
    .limit(10);

  const topProviders = providersResult.map((p) => ({
    callerId: p.callerAgentId,
    calleeId: p.calleeAgentId,
    score: p.compatibilityScore ?? 0,
    totalCalls: p.totalCalls,
    successRate: p.totalCalls > 0 ? (p.successfulCalls / p.totalCalls) * 100 : 0,
    avgLatencyMs: p.avgLatencyMs ?? 0,
    topTools: p.topTools ? JSON.parse(p.topTools) : [],
    lastInteraction: p.lastInteraction,
  }));

  // Recommended integrations (high compatibility, not yet heavily used)
  const recommendedCallersResult = await db
    .select()
    .from(agentCompatibility)
    .where(
      and(
        eq(agentCompatibility.calleeAgentId, agentId),
        gte(agentCompatibility.compatibilityScore, 70),
        lte(agentCompatibility.totalCalls, 10)
      )
    )
    .orderBy(desc(agentCompatibility.compatibilityScore))
    .limit(5);

  const recommendedProviderResult = await db
    .select()
    .from(agentCompatibility)
    .where(
      and(
        eq(agentCompatibility.callerAgentId, agentId),
        gte(agentCompatibility.compatibilityScore, 70),
        lte(agentCompatibility.totalCalls, 10)
      )
    )
    .orderBy(desc(agentCompatibility.compatibilityScore))
    .limit(5);

  // Find common pipelines (sequences of agents that often work together)
  // This is a simplified version - in production would use graph algorithms
  const commonPipelines: Array<{ agents: string[]; callCount: number; avgLatency: number }> = [];

  // Find other agents that call our top providers
  for (const provider of topProviders.slice(0, 3)) {
    const sharedCallers = await db
      .select({
        callerId: agentCompatibility.callerAgentId,
        totalCalls: agentCompatibility.totalCalls,
        avgLatency: agentCompatibility.avgLatencyMs,
      })
      .from(agentCompatibility)
      .where(
        and(
          eq(agentCompatibility.calleeAgentId, provider.calleeId),
          sql`${agentCompatibility.callerAgentId} != ${agentId}`
        )
      )
      .orderBy(desc(agentCompatibility.totalCalls))
      .limit(3);

    for (const caller of sharedCallers) {
      commonPipelines.push({
        agents: [caller.callerId, agentId, provider.calleeId],
        callCount: Math.min(caller.totalCalls, provider.totalCalls),
        avgLatency: Math.round(((caller.avgLatency ?? 0) + (provider.avgLatencyMs ?? 0)) / 2),
      });
    }
  }

  return {
    agentId,
    asProvider: {
      topCallers,
      recommendedCallers: recommendedCallersResult.map((c) => ({
        callerId: c.callerAgentId,
        calleeId: c.calleeAgentId,
        score: c.compatibilityScore ?? 0,
        totalCalls: c.totalCalls,
        successRate: c.totalCalls > 0 ? (c.successfulCalls / c.totalCalls) * 100 : 0,
        avgLatencyMs: c.avgLatencyMs ?? 0,
        topTools: c.topTools ? JSON.parse(c.topTools) : [],
        lastInteraction: c.lastInteraction,
      })),
    },
    asConsumer: {
      topProviders,
      recommendedProviders: recommendedProviderResult.map((p) => ({
        callerId: p.callerAgentId,
        calleeId: p.calleeAgentId,
        score: p.compatibilityScore ?? 0,
        totalCalls: p.totalCalls,
        successRate: p.totalCalls > 0 ? (p.successfulCalls / p.totalCalls) * 100 : 0,
        avgLatencyMs: p.avgLatencyMs ?? 0,
        topTools: p.topTools ? JSON.parse(p.topTools) : [],
        lastInteraction: p.lastInteraction,
      })),
    },
    commonPipelines: commonPipelines.slice(0, 5),
  };
}

/**
 * Get recommended integrations for an agent based on network effects
 */
export async function getRecommendedIntegrations(agentId: string): Promise<{
  recommendations: Array<{
    agentId: string;
    reason: string;
    confidence: number;
    potentialBenefit: string;
  }>;
}> {
  if (!db) throw new Error("Database not connected");

  const recommendations: Array<{
    agentId: string;
    reason: string;
    confidence: number;
    potentialBenefit: string;
  }> = [];

  // Find agents that are frequently called by agents we also call
  const ourProviders = await db
    .select({ calleeId: agentCompatibility.calleeAgentId })
    .from(agentCompatibility)
    .where(eq(agentCompatibility.callerAgentId, agentId));

  const providerIds = ourProviders.map((p) => p.calleeId);

  if (providerIds.length > 0) {
    // Find other agents that call the same providers
    const similarCallers = await db
      .select({
        callerId: agentCompatibility.callerAgentId,
        count: count(),
      })
      .from(agentCompatibility)
      .where(
        and(
          sql`${agentCompatibility.calleeAgentId} = ANY(${providerIds})`,
          sql`${agentCompatibility.callerAgentId} != ${agentId}`
        )
      )
      .groupBy(agentCompatibility.callerAgentId)
      .orderBy(desc(count()))
      .limit(5);

    for (const caller of similarCallers) {
      // Check if we already interact with this agent
      const existingRelation = await db
        .select()
        .from(agentCompatibility)
        .where(
          or(
            and(
              eq(agentCompatibility.callerAgentId, agentId),
              eq(agentCompatibility.calleeAgentId, caller.callerId)
            ),
            and(
              eq(agentCompatibility.callerAgentId, caller.callerId),
              eq(agentCompatibility.calleeAgentId, agentId)
            )
          )
        )
        .limit(1);

      if (existingRelation.length === 0) {
        recommendations.push({
          agentId: caller.callerId,
          reason: `Uses ${caller.count} of the same providers as you`,
          confidence: Math.min(95, Number(caller.count) * 15),
          potentialBenefit: "May have complementary capabilities for pipeline composition",
        });
      }
    }
  }

  return { recommendations };
}

// =============================================================================
// INCIDENT TRANSPARENCY LOG
// =============================================================================

/**
 * Check if we should create an incident based on failure patterns
 */
async function checkAndCreateIncident(
  calleeAgentId: string,
  callerAgentId: string | null,
  toolName: string,
  status: string,
  errorCode?: string,
  errorMessage?: string
): Promise<void> {
  if (!db || !pool) return;

  // Check for recent similar failures
  const recentFailures = await pool.query(
    `SELECT COUNT(*) as count FROM execution_results er
     JOIN tool_usage tu ON er.tool_usage_id = tu.id
     WHERE tu.callee_agent_id = $1
       AND er.status != 'success'
       AND er.created_at > NOW() - INTERVAL '5 minutes'`,
    [calleeAgentId]
  );

  const failureCount = Number(recentFailures.rows[0]?.count || 0);

  // Create incident if we see multiple failures
  if (failureCount >= 3) {
    // Check if there's already an open incident
    const existingIncident = await pool.query(
      `SELECT id FROM incidents 
       WHERE callee_agent_id = $1 
         AND status IN ('open', 'investigating')
         AND created_at > NOW() - INTERVAL '1 hour'
       LIMIT 1`,
      [calleeAgentId]
    );

    if (existingIncident.rows.length === 0) {
      const severity = failureCount >= 10 ? "high" : failureCount >= 5 ? "medium" : "low";

      await pool.query(
        `INSERT INTO incidents 
         (callee_agent_id, caller_agent_id, incident_type, severity, tool_name,
          affected_call_count, title, description, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')`,
        [
          calleeAgentId,
          callerAgentId,
          status === "timeout" ? "timeout" : "error",
          severity,
          toolName,
          failureCount,
          `${status.charAt(0).toUpperCase() + status.slice(1)} errors detected`,
          errorMessage || `Multiple ${status} errors in the last 5 minutes`,
        ]
      );
    } else {
      // Update existing incident
      await pool.query(
        `UPDATE incidents 
         SET affected_call_count = affected_call_count + 1, updated_at = NOW()
         WHERE id = $1`,
        [existingIncident.rows[0].id]
      );
    }
  }
}

/**
 * Create a manual incident report
 */
export async function createIncident(params: {
  calleeAgentId: string;
  callerAgentId?: string;
  incidentType: "timeout" | "error" | "degraded" | "outage" | "security";
  severity: "low" | "medium" | "high" | "critical";
  toolName?: string;
  title: string;
  description?: string;
}): Promise<Incident> {
  if (!db) throw new Error("Database not connected");

  const [incident] = await db
    .insert(incidents)
    .values({
      calleeAgentId: params.calleeAgentId,
      callerAgentId: params.callerAgentId,
      incidentType: params.incidentType,
      severity: params.severity,
      toolName: params.toolName,
      title: params.title,
      description: params.description,
      affectedCallCount: 1,
    })
    .returning();

  return incident;
}

/**
 * Update incident status/resolution
 */
export async function updateIncident(
  incidentId: string,
  update: {
    status?: "open" | "investigating" | "resolved" | "closed";
    rootCause?: string;
    resolutionNotes?: string;
    refundsIssued?: number;
    totalRefundLamports?: number;
  }
): Promise<Incident> {
  if (!db) throw new Error("Database not connected");

  const updateData: Record<string, any> = {
    updatedAt: new Date(),
  };

  if (update.status) updateData.status = update.status;
  if (update.rootCause) updateData.rootCause = update.rootCause;
  if (update.resolutionNotes) updateData.resolutionNotes = update.resolutionNotes;
  if (update.refundsIssued !== undefined) updateData.refundsIssued = update.refundsIssued;
  if (update.totalRefundLamports !== undefined) updateData.totalRefundLamports = update.totalRefundLamports;

  if (update.status === "resolved" || update.status === "closed") {
    updateData.resolvedAt = new Date();
  }

  const [incident] = await db
    .update(incidents)
    .set(updateData)
    .where(eq(incidents.id, incidentId))
    .returning();

  return incident;
}

/**
 * Get incident history for an agent (public transparency log)
 */
export async function getIncidentHistory(
  agentId: string,
  limit: number = 50
): Promise<IncidentReport[]> {
  if (!db) throw new Error("Database not connected");

  const incidentRows = await db
    .select()
    .from(incidents)
    .where(eq(incidents.calleeAgentId, agentId))
    .orderBy(desc(incidents.createdAt))
    .limit(limit);

  return incidentRows.map((i) => ({
    id: i.id,
    agentId: i.calleeAgentId,
    incidentType: i.incidentType,
    severity: i.severity,
    title: i.title,
    description: i.description,
    status: i.status,
    affectedCallCount: i.affectedCallCount,
    detectedAt: i.detectedAt || i.createdAt!,
    resolvedAt: i.resolvedAt,
    timeToResolution: i.resolvedAt && i.detectedAt
      ? Math.round((new Date(i.resolvedAt).getTime() - new Date(i.detectedAt).getTime()) / (1000 * 60 * 60))
      : null,
    refundsIssued: i.refundsIssued,
    totalRefundLamports: Number(i.totalRefundLamports || 0),
    recoveryBehavior: i.resolutionNotes,
  }));
}

/**
 * Get platform-wide incident summary
 */
export async function getPlatformIncidentSummary(): Promise<{
  openIncidents: number;
  resolvedLast24h: number;
  avgTimeToResolution: number;
  incidentsByType: Array<{ type: string; count: number }>;
  incidentsBySeverity: Array<{ severity: string; count: number }>;
}> {
  if (!db) throw new Error("Database not connected");

  const openCount = await db
    .select({ count: count() })
    .from(incidents)
    .where(or(eq(incidents.status, "open"), eq(incidents.status, "investigating")));

  const resolvedLast24h = await db
    .select({ count: count() })
    .from(incidents)
    .where(
      and(
        or(eq(incidents.status, "resolved"), eq(incidents.status, "closed")),
        gte(incidents.resolvedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    );

  const avgTTR = await db
    .select({
      avgHours: sql<number>`AVG(EXTRACT(EPOCH FROM (resolved_at - detected_at)) / 3600)::int`,
    })
    .from(incidents)
    .where(sql`resolved_at IS NOT NULL`);

  const byType = await db
    .select({
      type: incidents.incidentType,
      count: count(),
    })
    .from(incidents)
    .groupBy(incidents.incidentType)
    .orderBy(desc(count()));

  const bySeverity = await db
    .select({
      severity: incidents.severity,
      count: count(),
    })
    .from(incidents)
    .groupBy(incidents.severity)
    .orderBy(desc(count()));

  return {
    openIncidents: Number(openCount[0]?.count || 0),
    resolvedLast24h: Number(resolvedLast24h[0]?.count || 0),
    avgTimeToResolution: Number(avgTTR[0]?.avgHours || 0),
    incidentsByType: byType.map((t) => ({ type: t.type, count: Number(t.count) })),
    incidentsBySeverity: bySeverity.map((s) => ({ severity: s.severity, count: Number(s.count) })),
  };
}
