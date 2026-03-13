/**
 * Request Logger - End-to-End Observability
 *
 * Captures structured logs for every AI request including:
 * - Classification method (LLM vs keyword)
 * - Agent selection with scores
 * - Fallback behavior
 * - Token usage, cost, latency
 * - Success/failure status
 *
 * This data enables:
 * - Debugging routing decisions
 * - Tuning selection weights
 * - Identifying high-failure agents
 * - Cost analysis per user/task type
 *
 * IMPORTANT: Schema must be created via migrations, not at runtime.
 * Run schema.sql before starting the application.
 */

import { query } from "../db/client";
import { TaskType, RoutingDecision, ChatResponse } from "./routerService";
import { hashUserId, truncateForPreview } from "../middleware/adminAuth";

// =============================================================================
// TYPES
// =============================================================================

export interface RequestLogEntry {
  userId: string;
  hashedUserId?: string;           // Privacy-safe user identifier
  conversationId?: string;
  taskType: TaskType;
  classificationMethod: "llm" | "keyword";
  classificationConfidence: number;
  selectedAgentId: string;
  selectedAgentScore?: number;
  alternativeAgents?: string[];    // Agent IDs considered
  fallbackUsed: boolean;
  failedAgents: number;
  tokensUsed: number;
  costLamports: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
  // Extended fields for deeper analysis
  messageLength?: number;
  messagePreview?: string;         // First 200 chars for debugging
  escrowHoldId?: string;
  truncationApplied?: boolean;
}

export interface RequestLogQueryOptions {
  userId?: string;
  taskType?: TaskType;
  agentId?: string;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

export interface AgentStats {
  agentId: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number;
  avgTokensUsed: number;
  totalCostLamports: number;
  fallbackToCount: number;  // Times this agent was used as fallback
}

// =============================================================================
// CORE LOGGING
// =============================================================================

/**
 * Log a completed request with all observability data
 * 
 * NOTE: Assumes request_logs table exists (created via schema.sql migration).
 * Do NOT auto-create tables at runtime - it causes race conditions.
 */
export async function logRequest(entry: RequestLogEntry): Promise<string> {
  const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  // Generate hashed user ID if not provided
  const hashedUserId = entry.hashedUserId || hashUserId(entry.userId);
  
  try {
    await query(`
      INSERT INTO request_logs (
        id, user_id, hashed_user_id, conversation_id, task_type, 
        classification_method, classification_confidence,
        selected_agent_id, selected_agent_score, alternative_agents,
        fallback_used, failed_agents, tokens_used, cost_lamports,
        latency_ms, success, error_message, message_length, message_preview,
        escrow_hold_id, truncation_applied
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      )
    `, [
      logId,
      entry.userId,
      hashedUserId,
      entry.conversationId || null,
      entry.taskType,
      entry.classificationMethod,
      entry.classificationConfidence,
      entry.selectedAgentId,
      entry.selectedAgentScore || null,
      JSON.stringify(entry.alternativeAgents || []),
      entry.fallbackUsed,
      entry.failedAgents,
      entry.tokensUsed,
      entry.costLamports,
      entry.latencyMs,
      entry.success,
      entry.errorMessage || null,
      entry.messageLength || null,
      entry.messagePreview || null,
      entry.escrowHoldId || null,
      entry.truncationApplied || false
    ]);

    // Structured console log for immediate visibility
    console.log(`[Request] ${logId}`, {
      task: entry.taskType,
      method: entry.classificationMethod,
      agent: entry.selectedAgentId,
      fallback: entry.fallbackUsed,
      tokens: entry.tokensUsed,
      cost: entry.costLamports,
      latency: entry.latencyMs,
      success: entry.success
    });

    return logId;
  } catch (error: any) {
    // Log error but don't fail the request
    console.error("[RequestLogger] Failed to log:", error.message);
    return logId;
  }
}

/**
 * Create log entry from routing decision and chat response
 * Helper to build the entry from existing types
 */
export function buildLogEntry(
  userId: string,
  message: string,
  routingDecision: RoutingDecision & { classificationMethod?: "llm" | "keyword" },
  chatResponse: ChatResponse | null,
  error?: Error
): RequestLogEntry {
  return {
    userId,
    hashedUserId: hashUserId(userId),
    conversationId: chatResponse?.conversationId,
    taskType: routingDecision.taskType,
    classificationMethod: routingDecision.classificationMethod || "keyword",
    classificationConfidence: routingDecision.confidence,
    selectedAgentId: chatResponse?.agentUsed?.agentId || routingDecision.selectedAgent.agentId,
    selectedAgentScore: routingDecision.confidence,
    alternativeAgents: routingDecision.alternativeAgents?.map(a => a.agentId),
    fallbackUsed: chatResponse?.fallbackUsed || false,
    failedAgents: chatResponse?.failedAgents || 0,
    tokensUsed: chatResponse?.usage?.totalTokens || 0,
    costLamports: chatResponse?.cost?.totalLamports || 0,
    latencyMs: chatResponse?.latencyMs || 0,
    success: !error && !!chatResponse,
    errorMessage: error?.message,
    messageLength: message.length,
    messagePreview: truncateForPreview(message, 200)
  };
}

// =============================================================================
// ANALYTICS QUERIES
// =============================================================================

/**
 * Get agent performance statistics
 */
export async function getAgentStats(
  agentId?: string,
  days: number = 7
): Promise<AgentStats[]> {
  try {
    const whereClause = agentId ? `AND selected_agent_id = $2` : "";
    const params = agentId ? [days, agentId] : [days];
    
    const result = await query(`
      SELECT 
        selected_agent_id as agent_id,
        COUNT(*) as total_requests,
        SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failure_count,
        AVG(latency_ms) as avg_latency_ms,
        AVG(tokens_used) as avg_tokens_used,
        SUM(cost_lamports) as total_cost_lamports,
        SUM(CASE WHEN fallback_used THEN 1 ELSE 0 END) as fallback_to_count
      FROM request_logs
      WHERE created_at > NOW() - INTERVAL '${days} days'
      ${whereClause}
      GROUP BY selected_agent_id
      ORDER BY total_requests DESC
    `, params);

    return result.rows.map(row => ({
      agentId: row.agent_id,
      totalRequests: parseInt(row.total_requests),
      successCount: parseInt(row.success_count),
      failureCount: parseInt(row.failure_count),
      successRate: parseInt(row.success_count) / parseInt(row.total_requests),
      avgLatencyMs: Math.round(parseFloat(row.avg_latency_ms)),
      avgTokensUsed: Math.round(parseFloat(row.avg_tokens_used)),
      totalCostLamports: parseInt(row.total_cost_lamports),
      fallbackToCount: parseInt(row.fallback_to_count)
    }));
  } catch (error) {
    console.error("[RequestLogger] Failed to get agent stats:", error);
    return [];
  }
}

/**
 * Get classification method breakdown
 */
export async function getClassificationStats(days: number = 7): Promise<{
  llmCount: number;
  keywordCount: number;
  llmSuccessRate: number;
  keywordSuccessRate: number;
  avgLlmLatencyMs: number;
  avgKeywordLatencyMs: number;
}> {
  try {
    const result = await query(`
      SELECT 
        classification_method,
        COUNT(*) as count,
        SUM(CASE WHEN success THEN 1 ELSE 0 END) as success_count,
        AVG(latency_ms) as avg_latency
      FROM request_logs
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY classification_method
    `);

    const llm = result.rows.find(r => r.classification_method === "llm") || { count: 0, success_count: 0, avg_latency: 0 };
    const keyword = result.rows.find(r => r.classification_method === "keyword") || { count: 0, success_count: 0, avg_latency: 0 };

    return {
      llmCount: parseInt(llm.count) || 0,
      keywordCount: parseInt(keyword.count) || 0,
      llmSuccessRate: llm.count > 0 ? parseInt(llm.success_count) / parseInt(llm.count) : 0,
      keywordSuccessRate: keyword.count > 0 ? parseInt(keyword.success_count) / parseInt(keyword.count) : 0,
      avgLlmLatencyMs: Math.round(parseFloat(llm.avg_latency)) || 0,
      avgKeywordLatencyMs: Math.round(parseFloat(keyword.avg_latency)) || 0
    };
  } catch (error) {
    console.error("[RequestLogger] Failed to get classification stats:", error);
    return {
      llmCount: 0, keywordCount: 0,
      llmSuccessRate: 0, keywordSuccessRate: 0,
      avgLlmLatencyMs: 0, avgKeywordLatencyMs: 0
    };
  }
}

/**
 * Get task type distribution
 */
export async function getTaskTypeStats(days: number = 7): Promise<Array<{
  taskType: TaskType;
  count: number;
  avgCostLamports: number;
  avgLatencyMs: number;
}>> {
  try {
    const result = await query(`
      SELECT 
        task_type,
        COUNT(*) as count,
        AVG(cost_lamports) as avg_cost,
        AVG(latency_ms) as avg_latency
      FROM request_logs
      WHERE created_at > NOW() - INTERVAL '${days} days'
      GROUP BY task_type
      ORDER BY count DESC
    `);

    return result.rows.map(row => ({
      taskType: row.task_type as TaskType,
      count: parseInt(row.count),
      avgCostLamports: Math.round(parseFloat(row.avg_cost)),
      avgLatencyMs: Math.round(parseFloat(row.avg_latency))
    }));
  } catch (error) {
    console.error("[RequestLogger] Failed to get task type stats:", error);
    return [];
  }
}

/**
 * Get recent failures for debugging
 */
export async function getRecentFailures(limit: number = 10): Promise<Array<{
  logId: string;
  userId: string;
  taskType: TaskType;
  agentId: string;
  errorMessage: string;
  createdAt: Date;
}>> {
  try {
    const result = await query(`
      SELECT id, user_id, task_type, selected_agent_id, error_message, created_at
      FROM request_logs
      WHERE success = FALSE
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows.map(row => ({
      logId: row.id,
      userId: row.user_id,
      taskType: row.task_type as TaskType,
      agentId: row.selected_agent_id,
      errorMessage: row.error_message,
      createdAt: row.created_at
    }));
  } catch (error) {
    console.error("[RequestLogger] Failed to get recent failures:", error);
    return [];
  }
}

/**
 * Detailed routing explanation for debugging
 */
export interface RoutingExplanation {
  logId: string;
  createdAt: string;
  
  // What was asked
  messagePreview: string | null;
  messageLength: number;
  
  // Classification
  taskType: string;
  classificationMethod: "llm" | "keyword";
  classificationConfidence: number;
  
  // Agent selection
  selectedAgent: {
    id: string;
    score: number | null;
  };
  alternativeAgents: string[];
  
  // Execution
  fallbackUsed: boolean;
  failedAgentCount: number;
  
  // Result
  success: boolean;
  errorMessage: string | null;
  tokensUsed: number;
  costLamports: number;
  latencyMs: number;
  
  // Debug summary
  summary: string;
}

/**
 * Answer: "Why did the router pick agent X for this request?"
 * Returns structured data for rich UI rendering
 */
export async function explainRoutingDecision(logId: string): Promise<RoutingExplanation | null> {
  try {
    const result = await query(`
      SELECT * FROM request_logs WHERE id = $1
    `, [logId]);

    if (!result.rows[0]) return null;

    const log = result.rows[0];
    const alternatives: string[] = JSON.parse(log.alternative_agents || "[]");
    
    // Build human-readable summary
    const summaryParts: string[] = [];
    
    // Classification insight
    if (log.classification_method === "llm") {
      summaryParts.push(
        `LLM router classified this as a "${log.task_type}" task with ${Math.round(log.classification_confidence * 100)}% confidence.`
      );
    } else {
      summaryParts.push(
        `Keyword matching identified this as a "${log.task_type}" task (LLM router unavailable or skipped).`
      );
    }
    
    // Selection insight
    if (log.selected_agent_score) {
      summaryParts.push(
        `Agent "${log.selected_agent_id}" was selected with score ${log.selected_agent_score.toFixed(2)} — ` +
        (alternatives.length > 0 
          ? `chosen over ${alternatives.length} alternative(s): ${alternatives.join(", ")}.`
          : `no alternatives were available for this task type.`)
      );
    } else {
      summaryParts.push(
        `Agent "${log.selected_agent_id}" was assigned (no scoring data available).`
      );
    }
    
    // Fallback insight
    if (log.fallback_used) {
      summaryParts.push(
        `⚠️ FALLBACK: ${log.failed_agents} agent(s) failed before this one succeeded. ` +
        `This indicates reliability issues with higher-ranked agents.`
      );
    }
    
    // Result insight
    if (log.success) {
      summaryParts.push(
        `✓ Completed successfully in ${log.latency_ms}ms using ${log.tokens_used} tokens ` +
        `(${log.cost_lamports} lamports).`
      );
    } else {
      summaryParts.push(
        `✗ FAILED: ${log.error_message || "Unknown error"}. ` +
        `Latency before failure: ${log.latency_ms}ms.`
      );
    }

    return {
      logId,
      createdAt: log.created_at,
      messagePreview: log.message_preview,
      messageLength: log.message_length || 0,
      taskType: log.task_type,
      classificationMethod: log.classification_method,
      classificationConfidence: log.classification_confidence || 0,
      selectedAgent: {
        id: log.selected_agent_id,
        score: log.selected_agent_score
      },
      alternativeAgents: alternatives,
      fallbackUsed: log.fallback_used,
      failedAgentCount: log.failed_agents || 0,
      success: log.success,
      errorMessage: log.error_message,
      tokensUsed: log.tokens_used || 0,
      costLamports: log.cost_lamports || 0,
      latencyMs: log.latency_ms || 0,
      summary: summaryParts.join("\n\n")
    };
  } catch (error) {
    console.error("[RequestLogger] Failed to explain routing:", error);
    return null;
  }
}
