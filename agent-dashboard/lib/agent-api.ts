/**
 * Agent API Client
 *
 * Fetches agent profile and stats from the backend.
 * Public endpoints - no auth required for discovery.
 */

const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

// =============================================================================
// TYPES
// =============================================================================

export interface AgentProfile {
  id: string;
  name: string;
  bio: string | null;
  websiteUrl: string | null;
  verified: boolean;
  reputationScore: number;
  ratePer1kTokens: number;
  taskTypes: string[];
  memberSince: string;
}

export interface LatencyStats {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface PerformanceStats {
  periodDays: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: string;
  uptimePercent: string;
  latency: LatencyStats;
  totalTokensProcessed: number;
  totalEarningsLamports: number;
  totalEarningsSol: string;
  firstRequestAt: string | null;
  lastRequestAt: string | null;
}

export interface TaskBreakdown {
  taskType: string;
  count: number;
  avgLatencyMs: number;
  successRate: string;
}

export interface AgentStatsResponse {
  success: boolean;
  agent: AgentProfile;
  performance: PerformanceStats;
  taskBreakdown: TaskBreakdown[];
}

export interface AgentListItem {
  agentId: string;
  name: string;
  publicKey: string | null;
  ratePer1kTokens: number;
  balanceLamports: number;
  pendingLamports: number;
  createdAt: string;
}

export interface AgentSearchResult {
  success: boolean;
  agents: AgentListItem[];
  total: number;
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Get agent profile and performance stats
 */
export async function getAgentStats(agentId: string, days: number = 30): Promise<AgentStatsResponse> {
  return fetchJson(`/v1/agents/${agentId}/stats?days=${days}`);
}

/**
 * Search/discover agents (requires API key)
 */
export async function searchAgents(params: {
  query?: string;
  category?: string;
  verified?: boolean;
  limit?: number;
  offset?: number;
}, apiKey: string): Promise<AgentSearchResult> {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set("q", params.query);
  if (params.category) searchParams.set("category", params.category);
  if (params.verified !== undefined) searchParams.set("verified", String(params.verified));
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));

  const res = await fetch(`${base}/v1/agents/search?${searchParams}`, {
    headers: { "X-API-Key": apiKey }
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}
