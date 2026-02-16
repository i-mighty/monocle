const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Legacy endpoints
export const getUsage = () => fetchJson("/dashboard/usage");
export const getReceipts = () => fetchJson("/pay");
export const getToolLogs = () => fetchJson("/meter/logs");
export const getEarnings = () => fetchJson("/dashboard/earnings");
export const getEarningsByAgent = () => fetchJson("/dashboard/earnings/by-agent");

// ==================== NEW ANALYTICS ENDPOINTS ====================

// Platform Overview
export const getPlatformOverview = () => fetchJson("/v1/dashboard/overview");

// Cost Analytics
export const getCostAnalytics = (period: string = "day", agentId?: string) => {
  const params = new URLSearchParams({ period });
  if (agentId) params.append("agentId", agentId);
  return fetchJson(`/v1/dashboard/costs?${params}`);
};

export const getAgentCostTimeSeries = (agentId: string, period: string = "week") =>
  fetchJson(`/v1/dashboard/costs/${agentId}/timeseries?period=${period}`);

// Spend Analytics
export const getSpendReports = (period: string = "all", limit: number = 50) =>
  fetchJson(`/v1/dashboard/spend?period=${period}&limit=${limit}`);

export const getAgentSpend = (agentId: string, period: string = "week") =>
  fetchJson(`/v1/dashboard/spend/${agentId}?period=${period}`);

// Revenue Analytics
export const getRevenueReports = (period: string = "all", limit: number = 50) =>
  fetchJson(`/v1/dashboard/revenue?period=${period}&limit=${limit}`);

export const getAgentRevenue = (agentId: string, period: string = "week") =>
  fetchJson(`/v1/dashboard/revenue/${agentId}?period=${period}`);

// Performance Analytics
export const getPerformanceMetrics = (period: string = "day", agentId?: string) => {
  const params = new URLSearchParams({ period });
  if (agentId) params.append("agentId", agentId);
  return fetchJson(`/v1/dashboard/performance?${params}`);
};

export const getAgentPerformance = (agentId: string, period: string = "day") =>
  fetchJson(`/v1/dashboard/performance/${agentId}?period=${period}`);

// Failure Analytics
export const getFailureAnalytics = (period: string = "day") =>
  fetchJson(`/v1/dashboard/failures?period=${period}`);

// Trust Metrics
export const getAgentTrustMetrics = (agentId: string) =>
  fetchJson(`/v1/dashboard/trust/${agentId}`);

// Leaderboards
export const getTopSpenders = (limit: number = 10) =>
  fetchJson(`/v1/dashboard/leaderboard/spenders?limit=${limit}`);

export const getTopEarners = (limit: number = 10) =>
  fetchJson(`/v1/dashboard/leaderboard/earners?limit=${limit}`);

export const getMostActiveAgents = (limit: number = 10) =>
  fetchJson(`/v1/dashboard/leaderboard/active?limit=${limit}`);

// Types
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

export interface CostAnalytics {
  period: string;
  totalCostLamports: number;
  totalCalls: number;
  totalTokens: number;
  avgCostPerCall: number;
  avgTokensPerCall: number;
  timeSeries: { timestamp: string; value: number }[];
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
  failuresByAgent: { agentId: string; failureCount: number; failureRate: number }[];
  recentFailures: { timestamp: string; agentId: string; errorType: string; errorMessage: string }[];
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

// ==================== AGENTS ENDPOINTS ====================

export interface DeployedAgent {
  agentId: string;
  name: string | null;
  publicKey: string | null;
  ratePer1kTokens: number;
  balanceLamports: number;
  pendingLamports: number;
  createdAt: string;
}

/**
 * Fetch deployed/registered agents.
 * Requires API key authentication via X-API-Key header.
 */
export const getDeployedAgents = (apiKey: string, limit: number = 50) => 
  fetchJson(`/v1/agents?limit=${limit}`, {
    headers: { "X-API-Key": apiKey }
  });

/**
 * Get agent metrics (calls, spend, etc.)
 */
export const getAgentDetails = (apiKey: string, agentId: string) =>
  fetchJson(`/v1/agents/${agentId}`, {
    headers: { "X-API-Key": apiKey }
  });

/**
 * Get agent metrics
 */
export const getAgentMetrics = (apiKey: string, agentId: string) =>
  fetchJson(`/v1/agents/${agentId}/metrics`, {
    headers: { "X-API-Key": apiKey }
  });

