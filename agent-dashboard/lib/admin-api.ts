/**
 * Admin API Client
 *
 * Hits the analytics endpoints with admin authentication.
 * Requires ADMIN_API_KEY to be set in environment or passed directly.
 */

const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export interface AdminFetchOptions {
  adminKey?: string;
}

async function adminFetch(path: string, options: AdminFetchOptions = {}) {
  // Use sessionStorage (not localStorage) to avoid XSS exposure
  const adminKey = options.adminKey || 
    (typeof window !== "undefined" ? sessionStorage.getItem("adminKey") : null) ||
    process.env.NEXT_PUBLIC_ADMIN_API_KEY;

  if (!adminKey) {
    throw new Error("Admin API key required");
  }

  const res = await fetch(`${base}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Key": adminKey
    }
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// =============================================================================
// AGENT STATS
// =============================================================================

export interface AgentStats {
  agentId: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgLatencyMs: number;
  avgTokensUsed: number;
  totalCostLamports: number;
  fallbackToCount: number;
}

export interface AgentStatsResponse {
  success: boolean;
  period: string;
  agents: AgentStats[];
}

export const getAgentStats = (days: number = 7, agentId?: string): Promise<AgentStatsResponse> => {
  const params = new URLSearchParams({ days: days.toString() });
  if (agentId) params.append("agentId", agentId);
  return adminFetch(`/v1/chat/analytics/agents?${params}`);
};

// =============================================================================
// CLASSIFICATION STATS
// =============================================================================

export interface ClassificationStats {
  llmCount: number;
  keywordCount: number;
  llmSuccessRate: number;
  keywordSuccessRate: number;
  avgLlmLatencyMs: number;
  avgKeywordLatencyMs: number;
}

export interface ClassificationStatsResponse {
  success: boolean;
  period: string;
  classification: ClassificationStats;
}

export const getClassificationStats = (days: number = 7): Promise<ClassificationStatsResponse> => {
  return adminFetch(`/v1/chat/analytics/classification?days=${days}`);
};

// =============================================================================
// TASK TYPE STATS
// =============================================================================

export interface TaskTypeStats {
  taskType: string;
  count: number;
  avgCostLamports: number;
  avgLatencyMs: number;
}

export interface TaskTypeStatsResponse {
  success: boolean;
  period: string;
  taskTypes: TaskTypeStats[];
}

export const getTaskTypeStats = (days: number = 7): Promise<TaskTypeStatsResponse> => {
  return adminFetch(`/v1/chat/analytics/tasks?days=${days}`);
};

// =============================================================================
// FAILURES
// =============================================================================

export interface FailureLog {
  logId: string;
  userId: string;
  taskType: string;
  agentId: string;
  errorMessage: string;
  createdAt: string;
}

export interface FailuresResponse {
  success: boolean;
  failures: FailureLog[];
}

export const getRecentFailures = (limit: number = 10): Promise<FailuresResponse> => {
  return adminFetch(`/v1/chat/analytics/failures?limit=${limit}`);
};

// =============================================================================
// EXPLAIN ROUTING
// =============================================================================

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

export interface ExplainResponse {
  success: boolean;
  explanation: RoutingExplanation;
}

export const explainRoutingDecision = (logId: string): Promise<ExplainResponse> => {
  return adminFetch(`/v1/chat/analytics/explain/${logId}`);
};

// =============================================================================
// DASHBOARD SUMMARY (aggregates all stats)
// =============================================================================

export interface DashboardSummary {
  agents: AgentStats[];
  classification: ClassificationStats;
  taskTypes: TaskTypeStats[];
  recentFailures: FailureLog[];
  period: string;
}

export async function getDashboardSummary(days: number = 7): Promise<DashboardSummary> {
  const [agentRes, classRes, taskRes, failRes] = await Promise.all([
    getAgentStats(days),
    getClassificationStats(days),
    getTaskTypeStats(days),
    getRecentFailures(10)
  ]);

  return {
    agents: agentRes.agents,
    classification: classRes.classification,
    taskTypes: taskRes.taskTypes,
    recentFailures: failRes.failures,
    period: `${days} days`
  };
}
