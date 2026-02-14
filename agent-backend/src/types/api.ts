/**
 * AgentPay API Types
 * Auto-generated from OpenAPI specification
 * 
 * These types can be used by:
 * - Backend (validation)
 * - SDK (client types)
 * - Frontend (API responses)
 * - External services (integration)
 */

// ==================== COMMON ====================

export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface InsufficientBalanceError {
  error: string;
  currentBalance?: number;
  requiredAmount?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ==================== AGENTS ====================

export interface AgentRegisterRequest {
  agentId: string;
  name?: string;
  publicKey?: string;
  ratePer1kTokens?: number;
}

export interface AgentResponse {
  agentId: string;
  name: string | null;
  publicKey: string | null;
  ratePer1kTokens: number;
  balanceLamports: number;
  pendingLamports: number;
  createdAt?: string;
}

export interface AgentMetrics {
  agentId: string;
  balanceLamports: number;
  pendingLamports: number;
  totalSpent: number;
  totalEarned: number;
  callsMade: number;
  callsReceived: number;
  ratePer1kTokens: number;
}

export interface PricingUpdateRequest {
  ratePer1kTokens: number;
}

export interface PricingUpdateResponse {
  agentId: string;
  ratePer1kTokens: number;
  balanceLamports: number;
  pendingLamports: number;
  message: string;
}

// ==================== IDENTITY ====================

export interface ToolRegistration {
  name: string;
  ratePer1kTokens: number;
  description?: string;
}

export interface IdentityVerifyRequest {
  agentId: string;
  firstName: string;
  lastName: string;
  dob: string;
  idNumber: string;
  defaultRatePer1kTokens?: number;
  tools?: ToolRegistration[];
}

export interface IdentityVerifyResponse {
  status: 'verified' | 'failed';
  agent: {
    id: string;
    name: string;
    defaultRatePer1kTokens: number;
    balanceLamports: number;
    tools: Array<{
      name: string;
      ratePer1kTokens: number;
    }>;
  };
  details?: Record<string, unknown>;
}

// ==================== METER ====================

export interface ToolExecuteRequest {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensUsed: number;
  quoteId?: string;
}

export type PricingSource = 'quote' | 'live';

export interface ToolExecuteResponse {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensUsed: number;
  costLamports: number;
  pricingSource?: PricingSource;
  quoteId?: string;
  pricingFrozenAt?: string;
}

export interface ToolCallRecord {
  id: string;
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensUsed: number;
  costLamports: number;
  createdAt: string;
}

// ==================== PAYMENTS ====================

export type SettlementStatus = 'pending' | 'completed' | 'failed';

export interface SettlementResponse {
  settlementId: string;
  agentId: string;
  grossLamports: number;
  platformFeeLamports: number;
  netLamports: number;
  txSignature?: string;
  status: SettlementStatus;
}

export interface SettlementRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  grossLamports: number;
  platformFeeLamports: number;
  netLamports: number;
  txSignature?: string;
  status: string;
  createdAt: string;
}

export interface TopupRequest {
  agentId: string;
  amountLamports: number;
}

export interface TopupResponse {
  agentId: string;
  newBalance: number;
  amountAdded: number;
  message: string;
}

// ==================== PRICING ====================

export interface PricingConstants {
  minCostLamports: number;
  maxTokensPerCall: number;
  platformFeePercent: number;
  minPayoutLamports: number;
}

export interface PricingPreviewRequest {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensEstimate: number;
}

export interface CostBreakdown {
  tokenBlocks: number;
  ratePer1kTokens: number;
  rawCost: number;
  platformFee: number;
  totalCost: number;
}

export interface PricingPreviewResponse {
  canExecute: boolean;
  costLamports: number | null;
  breakdown?: CostBreakdown;
  budgetStatus?: BudgetStatus;
  warnings?: string[];
  error?: string;
}

export interface CalculateCostRequest {
  tokensUsed: number;
  ratePer1kTokens: number;
}

export interface CalculateCostResponse {
  tokensUsed: number;
  ratePer1kTokens: number;
  costLamports: number;
  breakdown: {
    tokenBlocks: number;
    rawCost: number;
    minCostEnforced: boolean;
  };
}

export interface CreateQuoteRequest {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensEstimate: number;
  ttlSeconds?: number;
}

export type QuoteStatus = 'active' | 'used' | 'expired';

export interface PricingQuote {
  quoteId: string;
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensEstimate: number;
  costLamports: number;
  ratePer1kTokens: number;
  createdAt: string;
  expiresAt: string;
  status: QuoteStatus;
}

// ==================== BUDGET ====================

export interface BudgetStatus {
  agentId: string;
  dailyLimit: number | null;
  dailySpent: number;
  remainingToday: number | null;
  killSwitchActive: boolean;
  canSpend: boolean;
}

export interface BudgetAuthorizeRequest {
  amountLamports: number;
  dailyLimit?: number;
  reason?: string;
}

export interface BudgetAuthorization {
  authorizationId: string;
  agentId: string;
  amountLamports: number;
  dailyLimit: number | null;
  createdAt: string;
  expiresAt: string;
}

export interface KillSwitchRequest {
  active: boolean;
  reason?: string;
}

export interface KillSwitchResponse {
  agentId: string;
  killSwitchActive: boolean;
  reason?: string;
}

// ==================== ACTIVITY ====================

export type ActivityEventType =
  | 'identity_created'
  | 'agent_registered'
  | 'agent_updated'
  | 'pricing_changed'
  | 'tool_registered'
  | 'tool_executed'
  | 'payment_executed'
  | 'settlement_completed'
  | 'budget_changed'
  | 'verification_changed'
  | 'capability_added'
  | 'capability_removed'
  | 'audit_created'
  | 'api_key_used'
  | 'error_occurred';

export type ActivitySeverity = 'debug' | 'info' | 'warn' | 'error';

export type ActorType = 'system' | 'agent' | 'user' | 'api';

export interface ActivityLogEntry {
  id: string;
  eventType: ActivityEventType;
  severity: ActivitySeverity;
  agentId: string | null;
  actorId: string | null;
  actorType: ActorType;
  resourceType: string | null;
  resourceId: string | null;
  action: string;
  description: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface ActivityLogsResponse {
  logs: ActivityLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface ActivityQueryParams {
  agentId?: string;
  eventType?: ActivityEventType;
  severity?: ActivitySeverity;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface ActivitySummary {
  agentId: string;
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  firstEvent: string;
  lastEvent: string;
}

// ==================== WEBHOOKS ====================

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
  createdAt: string;
}

// ==================== ANALYTICS ====================

export interface UsageStats {
  agentId: string;
  period: string;
  totalCalls: number;
  totalTokens: number;
  totalCostLamports: number;
  uniqueTools: number;
  uniqueCallees: number;
}

export interface RevenueStats {
  agentId: string;
  period: string;
  totalEarnings: number;
  totalSettled: number;
  pendingBalance: number;
  uniqueCallers: number;
}

// ==================== REPUTATION ====================

export interface ReputationScore {
  agentId: string;
  score: number;
  reliability: number;
  responseTime: number;
  successRate: number;
  totalInteractions: number;
  updatedAt: string;
}

export interface TrustRelationship {
  fromAgentId: string;
  toAgentId: string;
  trustLevel: number;
  interactions: number;
  createdAt: string;
  updatedAt: string;
}

// ==================== REQUEST/RESPONSE HELPERS ====================

/**
 * API response wrapper for success responses
 */
export interface ApiResponse<T> {
  success: true;
  data: T;
}

/**
 * API response wrapper for error responses
 */
export interface ApiErrorResponse {
  success: false;
  error: ApiError;
}

/**
 * Union type for all API responses
 */
export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;

// ==================== TYPE GUARDS ====================

export function isApiError(response: unknown): response is ApiErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    (response as ApiErrorResponse).success === false
  );
}

export function isApiSuccess<T>(response: ApiResult<T>): response is ApiResponse<T> {
  return response.success === true;
}

// ==================== API CLIENT TYPES ====================

export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
  onError?: (error: ApiError) => void;
}
