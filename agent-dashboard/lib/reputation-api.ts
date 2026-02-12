// API client for Agent Reputation service
const reputationBase = process.env.NEXT_PUBLIC_REPUTATION_URL ?? "http://localhost:3004";

async function reputationFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${reputationBase}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Types
export interface Agent {
  id: string;
  name: string;
  slug: string;
  builderId: string;
  description?: string;
  version: string;
  sourceUrl?: string;
  mcpEndpoint?: string;
  a2aCardUrl?: string;
  logoUrl?: string;
  createdAt: number;
  updatedAt: number;
  isVerified: boolean;
  verificationTier: 'none' | 'basic' | 'standard' | 'enterprise';
  status: 'active' | 'deprecated' | 'suspended';
}

export interface TrustScore {
  overallScore: number;
  reliabilityScore?: number;
  performanceScore?: number;
  securityScore?: number;
  satisfactionScore?: number;
  networkScore?: number;
  lastCalculated: number;
  decayFactor: number;
}

export interface Review {
  id: string;
  agentId: string;
  reviewerId: string;
  reviewerName?: string;
  reviewerCompany?: string;
  rating: number;
  title?: string;
  content?: string;
  useCase?: string;
  deploymentDurationDays?: number;
  wouldRecommend: boolean;
  pros?: string[];
  cons?: string[];
  verifiedDeployment: boolean;
  createdAt: number;
  helpfulCount: number;
}

export interface AgentSkill {
  id: string;
  agentId: string;
  skillName: string;
  benchmarkName?: string;
  benchmarkScore?: number;
  benchmarkPercentile?: number;
  verified: boolean;
}

export interface Badge {
  id: string;
  agentId: string;
  badgeType: string;
  name: string;
  description?: string;
  awardedAt: number;
}

export interface Builder {
  id: string;
  name: string;
  slug: string;
  website?: string;
  logoUrl?: string;
  description?: string;
  verified: boolean;
}

export interface FullAgentProfile {
  agent: Agent;
  builder?: Builder;
  skills: AgentSkill[];
  badges: Badge[];
  reviews: Review[];
  trustScore?: TrustScore;
}

export interface AgentSearchResult {
  agent: Agent;
  trustScore?: TrustScore;
  builder?: Builder;
}

// API Functions
export async function searchAgents(params?: {
  query?: string;
  skill?: string;
  minTrust?: number;
  verified?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ agents: AgentSearchResult[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.query) searchParams.set('query', params.query);
  if (params?.skill) searchParams.set('skill', params.skill);
  if (params?.minTrust) searchParams.set('minTrust', params.minTrust.toString());
  if (params?.verified !== undefined) searchParams.set('verified', params.verified.toString());
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());
  
  const queryString = searchParams.toString();
  return reputationFetch<{ agents: AgentSearchResult[]; total: number }>(
    `/agents${queryString ? `?${queryString}` : ''}`
  );
}

export async function getAgentBySlug(slug: string): Promise<FullAgentProfile> {
  return reputationFetch<FullAgentProfile>(`/agents/${slug}?full=true`);
}

export async function getAgentTrustScore(agentId: string): Promise<TrustScore> {
  return reputationFetch<TrustScore>(`/agents/${agentId}/trust-score`);
}

export async function createReview(data: {
  agentId: string;
  reviewerId: string;
  reviewerName?: string;
  reviewerCompany?: string;
  rating: number;
  title?: string;
  content?: string;
  useCase?: string;
  deploymentDurationDays?: number;
  wouldRecommend: boolean;
  pros?: string[];
  cons?: string[];
}): Promise<Review> {
  return reputationFetch<Review>('/reviews', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function getAgentReviews(agentId: string): Promise<Review[]> {
  return reputationFetch<Review[]>(`/agents/${agentId}/reviews`);
}
