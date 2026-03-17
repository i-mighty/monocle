/**
 * Base Module Types
 * 
 * Shared types and interfaces for SDK modules.
 */

/**
 * Standard request function signature.
 */
export type RequestFn = (path: string, init: RequestInit) => Promise<any>;

/**
 * Pagination info returned by list endpoints.
 */
export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Agent stats summary.
 */
export interface AgentStats {
  totalRequests30d: number;
  successRate: string;
  avgLatencyMs: number | null;
}

/**
 * Agent listing from marketplace.
 */
export interface AgentListing {
  id: string;
  name: string;
  bio: string;
  websiteUrl: string;
  logoUrl: string;
  taskTypes: string[];
  ratePer1kTokens: number;
  reputationScore: number;
  verified: boolean;
  createdAt: string;
  stats: AgentStats;
}

/**
 * Featured agent (simplified listing).
 */
export interface FeaturedAgent {
  id: string;
  name: string;
  bio: string;
  logoUrl: string;
  taskTypes: string[];
  ratePer1kTokens: number;
  reputationScore: number;
}

/**
 * Task type with agent count.
 */
export interface TaskTypeInfo {
  type: string;
  count: number;
}

/**
 * Agent profile with detailed stats.
 */
export interface AgentProfile {
  agent: {
    id: string;
    name: string;
    bio: string;
    websiteUrl: string;
    logoUrl: string;
    taskTypes: string[];
    ratePer1kTokens: number;
    reputationScore: number;
    verified: boolean;
    createdAt: string;
  };
  stats: {
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    totalEarnings: number;
  };
  reputation: {
    score: number;
    factors: Record<string, any>;
    isProvisional: boolean;
  };
}

/**
 * Agent registration request.
 */
export interface AgentRegistration {
  name: string;
  publicKey: string;
  endpointUrl: string;
  taskTypes: string[];
  ratePer1kTokens: number;
  bio?: string;
  websiteUrl?: string;
  logoUrl?: string;
}

/**
 * Agent registration response.
 */
export interface AgentRegistrationResult {
  agentId: string;
  apiKey: string;  // ONE-TIME DISPLAY - STORE SECURELY!
  name: string;
  publicKey: string;
  ratePer1kTokens: number;
  taskTypes: string[];
  createdAt: string;
  message: string;
}

/**
 * Agent metrics (own agent).
 */
export interface AgentMetrics {
  balance: number;
  pending: number;
  earned: number;
  spent: number;
  requestCount: number;
}

/**
 * Withdrawal result.
 */
export interface WithdrawalResult {
  txSignature: string;
  amountLamports: number;
  destinationWallet: string;
  newBalance: number;
}
