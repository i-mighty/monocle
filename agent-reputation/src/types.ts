// Agent Reputation Types
// LinkedIn for AI Agents

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
  verificationTier: VerificationTier;
  status: AgentStatus;
}

export type VerificationTier = 'none' | 'basic' | 'standard' | 'enterprise';
export type AgentStatus = 'active' | 'deprecated' | 'suspended';

export interface Builder {
  id: string;
  name: string;
  slug: string;
  website?: string;
  logoUrl?: string;
  description?: string;
  verified: boolean;
  createdAt: number;
}

export interface AgentSkill {
  id: string;
  agentId: string;
  skillName: string;
  benchmarkName?: string;
  benchmarkScore?: number;
  benchmarkPercentile?: number;
  benchmarkDate?: number;
  verified: boolean;
  selfReported: boolean;
}

export interface DeploymentMetrics {
  id: string;
  agentId: string;
  periodStart: number;
  periodEnd: number;
  deploymentCount: number;
  activeDeployments: number;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  avgResponseTimeMs?: number;
  uptimePercentage?: number;
  errorRate?: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
  p99LatencyMs?: number;
  createdAt: number;
}

export interface PortfolioItem {
  id: string;
  agentId: string;
  title: string;
  description?: string;
  caseStudyUrl?: string;
  demoUrl?: string;
  screenshotUrls?: string[];
  metrics?: {
    before: Record<string, number>;
    after: Record<string, number>;
  };
  deploymentContext?: 'enterprise' | 'startup' | 'personal';
  verified: boolean;
  createdAt: number;
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

export interface Endorsement {
  id: string;
  endorserAgentId: string;
  endorsedAgentId: string;
  skillName?: string;
  context?: string;
  collaborationCount: number;
  createdAt: number;
}

export interface Incident {
  id: string;
  agentId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description?: string;
  rootCause?: string;
  resolution?: string;
  occurredAt: number;
  resolvedAt?: number;
  acknowledged: boolean;
  createdAt: number;
}

export interface TrustScore {
  id: string;
  agentId: string;
  overallScore: number;
  reliabilityScore?: number;
  performanceScore?: number;
  securityScore?: number;
  satisfactionScore?: number;
  networkScore?: number;
  scoreBreakdown?: TrustScoreBreakdown;
  lastCalculated: number;
  decayFactor: number;
}

export interface TrustScoreBreakdown {
  reliability: {
    uptime: number;
    errorRate: number;
    taskCompletion: number;
    weight: number;
  };
  performance: {
    benchmarkAvg: number;
    latency: number;
    weight: number;
  };
  security: {
    auditStatus: number;
    incidentHistory: number;
    weight: number;
  };
  satisfaction: {
    avgRating: number;
    reviewCount: number;
    recommendRate: number;
    weight: number;
  };
  network: {
    endorsementCount: number;
    collaborationScore: number;
    weight: number;
  };
}

export interface Integration {
  id: string;
  agentId: string;
  integrationType: 'mcp_server' | 'api' | 'sdk' | 'plugin';
  integrationName: string;
  versionCompatibility?: string;
  verified: boolean;
  createdAt: number;
}

export interface AgentPair {
  id: string;
  agentAId: string;
  agentBId: string;
  coDeploymentCount: number;
  avgCombinedSuccessRate?: number;
  lastSeen: number;
}

export interface SecurityAudit {
  id: string;
  agentId: string;
  auditorName: string;
  auditType: 'code_review' | 'penetration_test' | 'formal_verification';
  auditDate: number;
  findingsSummary?: string;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  passed: boolean;
  reportUrl?: string;
  verified: boolean;
}

export interface Badge {
  id: string;
  agentId: string;
  badgeType: string;
  badgeName: string;
  issuedAt: number;
  expiresAt?: number;
  issuer?: string;
}

// API Request/Response types
export interface CreateAgentRequest {
  name: string;
  slug: string;
  builderId: string;
  description?: string;
  version?: string;
  sourceUrl?: string;
  mcpEndpoint?: string;
  a2aCardUrl?: string;
  logoUrl?: string;
}

export interface CreateReviewRequest {
  agentId: string;
  reviewerId: string;
  reviewerName?: string;
  reviewerCompany?: string;
  rating: number;
  title?: string;
  content?: string;
  useCase?: string;
  deploymentDurationDays?: number;
  wouldRecommend?: boolean;
  pros?: string[];
  cons?: string[];
}

export interface AgentProfile {
  agent: Agent;
  builder: Builder;
  skills: AgentSkill[];
  metrics: DeploymentMetrics | null;
  trustScore: TrustScore | null;
  portfolio: PortfolioItem[];
  reviews: Review[];
  endorsements: Endorsement[];
  integrations: Integration[];
  badges: Badge[];
  incidents: Incident[];
  frequentlyDeployedWith: Agent[];
}

export interface AgentSearchFilters {
  query?: string;
  skills?: string[];
  minTrustScore?: number;
  verificationTier?: VerificationTier;
  integrations?: string[];
  builderId?: string;
  status?: AgentStatus;
  sortBy?: 'trust_score' | 'reviews' | 'deployments' | 'created_at';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AgentSearchResult {
  agents: (Agent & { trustScore?: number; reviewCount?: number })[];
  total: number;
  page: number;
  pageSize: number;
}
