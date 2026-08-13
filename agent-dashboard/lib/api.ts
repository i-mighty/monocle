const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

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
 * Reads below go through the same-origin proxy, which attaches the server-side
 * key for non-money paths. They used to take an `apiKey` argument sourced from
 * localStorage, which is why the UI had to ask the developer to paste one in —
 * and why every user ended up holding the shared platform key. The browser now
 * sends no key of its own for these.
 */

/** Fetch deployed/registered agents. */
export const getDeployedAgents = (limit: number = 50) =>
  authFetch(`/v1/agents?limit=${limit}`);

/**
 * The API base URL shown next to a key, so a developer knows where to send it.
 *
 * Display only — nothing in the dashboard fetches from here. That distinction
 * matters: NEXT_PUBLIC_BACKEND_URL changes where the browser actually calls, and
 * setting it strips the session cookie and the server-side key from every
 * request. This is a string we print.
 *
 * Kept in step with the SDK's own default (agent-sdk/src/client.ts).
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.monocle.3lvn4g.xyz/v1";

export interface MyAgent {
  agentId: string;
  name: string | null;
  publicKey: string | null;
  ratePer1kTokens: number;
  balanceLamports: number;
  pendingLamports: number;
  isPaused: boolean;
  categories?: unknown;
  createdAt: string;
  endpointUrl: string | null;
  endpointHealthy: boolean | null;
  listedInMarketplace: boolean;
}

/**
 * The signed-in user's own agents.
 *
 * Distinct from getDeployedAgents, which lists every agent in the system —
 * public discovery data, not yours. Anything that says "your agents" must use
 * this, or it is showing other people's.
 */
export const getMyAgents = (): Promise<{ agents: MyAgent[] }> =>
  authFetch("/v1/agents/mine");

/**
 * Issue this agent's `mk_` key — the credential every money route requires.
 *
 * Returns the plaintext once; only its digest is stored. `code` is required only
 * when rotating, because rotation invalidates a key that live services may be
 * using. Goes through sensitiveFetch so the session cookie rides along: this is
 * authorised by who you are, not by a key you hold.
 */
export const issueAgentKey = (agentId: string, opts?: { rotate?: boolean; code?: string; name?: string }) =>
  sensitiveFetch(`/v1/agents/${encodeURIComponent(agentId)}/keys/mine`, {
    method: "POST",
    body: JSON.stringify(opts ?? {}),
  });

/** Email a step-up code for rotating this agent's key. */
export const sendAgentKeyCode = (agentId: string) =>
  sensitiveFetch(`/v1/agents/${encodeURIComponent(agentId)}/keys/mine/send-code`, {
    method: "POST",
  });

/**
 * Set or change where this agent is paid.
 *
 * `code` is required only when a wallet already exists: changing one redirects
 * money that is already flowing, whereas setting the first diverts nothing.
 */
export const setPayoutWallet = (agentId: string, publicKey: string, code?: string) =>
  sensitiveFetch(`/v1/agents/${encodeURIComponent(agentId)}/payout-wallet`, {
    method: "PUT",
    body: JSON.stringify(code ? { publicKey, code } : { publicKey }),
  });

/** Email a step-up code for changing this agent's payout wallet. */
export const sendPayoutWalletCode = (agentId: string) =>
  sensitiveFetch(`/v1/agents/${encodeURIComponent(agentId)}/payout-wallet/send-code`, {
    method: "POST",
  });

/** Get a single agent. */
export const getAgentDetails = (agentId: string) =>
  authFetch(`/v1/agents/${agentId}`);

/** Get agent metrics (calls, spend, etc.) */
export const getAgentMetrics = (agentId: string) =>
  authFetch(`/v1/agents/${agentId}/metrics`);

// ==================== AGENT ECONOMY API ====================

/**
 * Fetch for the dashboard's own read calls.
 *
 * Routed through the same-origin proxy so the session cookie rides along and the
 * proxy can attach the server-side key on non-money paths. Previously this read a
 * key out of localStorage and threw "API key required" when absent, which is what
 * forced the "Enter API Key" prompt into the UI.
 *
 * The developer's own `Mon_` key is deliberately not used here. It is issued for
 * calling Monocle from their services; the dashboard authenticates as the person
 * signed into it, and the key is unrecoverable after creation anyway.
 */
export async function authFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(err.code ?? "UNKNOWN", err.message ?? `HTTP ${res.status}`, res.status);
  }
  return json?.data ?? json;
}

// =============================================================================
// SENSITIVE ACTIONS (settle / register agent / withdraw)
// =============================================================================

/** Same-origin proxy — forwards the session cookie, injects the API key server-side. */
const PROXY_BASE = "/api/proxy";

/** Error carrying the backend's structured code so callers can react to KYC gates. */
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Fetch for money/identity actions that are gated on a verified email (KYC).
 *
 * Always goes through the same-origin proxy rather than straight to the backend
 * so the HttpOnly `monocle_session` cookie rides along — the backend's gate can
 * only enforce verification on requests that actually carry a session. The
 * proxy also refuses these paths outright when no session is present.
 *
 * No API key is attached from the browser. This previously forwarded whatever
 * was in localStorage, which only ever had a value because the UI asked the
 * developer to paste one in; with that prompt gone the fallback had nothing to
 * read and was dead code.
 *
 * Note this does not by itself make the money paths work from the dashboard. The
 * proxy deliberately withholds the platform key on those, and they require an
 * agent-scoped (`mk_`) key that names the agent whose funds are moving — a
 * developer key never can, by design (see requireOwnAgent). Wiring the dashboard
 * up to agent-scoped keys is separate work.
 */
export async function sensitiveFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const err = json?.error ?? {};
    throw new ApiError(err.code ?? "UNKNOWN", err.message ?? `HTTP ${res.status}`, res.status);
  }
  // The backend wraps success payloads as { success, data }. Callers read the
  // fields directly (result.agentId, result.txSignature, …), so unwrap the
  // envelope here. Falls back to the raw body for any endpoint that returns flat.
  return json?.data ?? json;
}

/** True when an error means "signed in but email not verified" (or not signed in). */
export function isKycError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    ["AUTH_EMAIL_NOT_VERIFIED", "AUTH_NOT_SIGNED_IN", "AUTH_INVALID_SESSION"].includes(err.code)
  );
}

// === Agent Registration ===

export interface RegisterAgentRequest {
  agentId: string;
  name?: string;
  publicKey?: string;
  ratePer1kTokens?: number;
}

export interface RegisteredAgent {
  agentId: string;
  name: string | null;
  publicKey: string | null;
  ratePer1kTokens: number;
  balanceLamports: number;
  pendingLamports: number;
}

// Gated on a verified email — routed through the session-carrying proxy.
export const registerAgent = (data: RegisterAgentRequest) =>
  sensitiveFetch("/v1/agents/register", {
    method: "POST",
    body: JSON.stringify(data)
  });

// === Economic State ===

export interface AgentEconomicState {
  agentId: string;
  ratePer1kTokens: number;
  balanceLamports: number;
  pendingLamports: number;
  totalCallsMade: number;
  totalCallsReceived: number;
  totalSpentLamports: number;
  totalEarnedLamports: number;
}

export const getAgentEconomicState = (agentId: string) =>
  authFetch(`/v1/payments/metrics/${agentId}`);

// === Tool Call Execution ===

export interface ExecuteCallRequest {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensUsed: number;
  quoteId?: string;
}

export interface ExecuteCallResult {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensUsed: number;
  costLamports: number;
  pricingSource: "quote" | "live";
  quoteId?: string;
  pricingFrozenAt?: string;
  callerNewBalance?: number;
  calleePendingIncrease?: number;
}

export const executeToolCall = (data: ExecuteCallRequest) =>
  authFetch("/v1/meter/execute", {
    method: "POST",
    body: JSON.stringify(data)
  });

// === Tool Call History ===

export interface ToolCallRecord {
  id: string;
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensUsed: number;
  costLamports: number;
  timestamp: string;
}

export const getToolCallHistory = (agentId: string, limit: number = 50) =>
  authFetch(`/v1/meter/history/${agentId}?limit=${limit}`);

export const getEarningsHistory = (agentId: string, limit: number = 50) =>
  authFetch(`/v1/meter/earnings/${agentId}?limit=${limit}`);

// === Pricing ===

export interface PricingConstants {
  minCostLamports: number;
  maxTokensPerCall: number;
  platformFeePercent: number;
  minPayoutLamports: number;
}

export const getPricingConstants = () =>
  fetchJson("/v1/pricing/constants");

export interface CostPreviewRequest {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensEstimate: number;
}

export interface CostPreview {
  canExecute: boolean;
  costLamports: number;
  breakdown: {
    tokenBlocks: number;
    rawCost: number;
    ratePer1kTokens: number;
    minimumApplied: boolean;
  };
  budgetStatus: {
    currentBalance: number;
    afterCallBalance: number;
    budgetRemaining: number;
  };
  warnings: string[];
}

export const previewCost = (data: CostPreviewRequest) =>
  authFetch("/v1/pricing/preview", {
    method: "POST",
    body: JSON.stringify(data)
  });

// === Settlements ===

export interface Settlement {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  grossLamports: number;
  platformFeeLamports: number;
  netLamports: number;
  txSignature: string | null;
  status: "pending" | "completed" | "failed";
  createdAt: string;
}

export const getSettlementHistory = (agentId: string) =>
  authFetch(`/v1/payments/settlements/${agentId}`);

// Gated on a verified email — routed through the session-carrying proxy.
export const settlePayment = (agentId: string) =>
  sensitiveFetch(`/v1/payments/settle/${agentId}`, {
    method: "POST"
  });

export const getAllSettlements = () =>
  authFetch("/v1/payments/");

// === Platform Revenue ===

export interface PlatformRevenue {
  totalFeesLamports: number;
  totalFeesSOL: number;
  settlementCount: number;
  recentFees: {
    id: string;
    feeLamports: number;
    agentId: string;
    grossLamports: number;
    netLamports: number;
    txSignature: string | null;
    createdAt: string;
  }[];
}

export const getPlatformRevenue = () =>
  authFetch("/v1/pricing/platform-revenue");

// === Demo Mode (for testing) ===

export const topUpAgent = (agentId: string, amountLamports: number) =>
  authFetch("/v1/payments/topup", {
    method: "POST",
    body: JSON.stringify({ agentId, amountLamports })
  });

// =============================================================================
// DEPOSITS: Real Solana deposits to fund agent accounts
// =============================================================================

export interface DepositAddress {
  treasuryAddress: string;
  network: string;
  currency: string;
  minimumDeposit: number;
  instructions: string;
}

export interface DepositIntent {
  intentId: string;
  agentId: string;
  reference: string;
  depositAddress: string;
  expectedAmountLamports: number | null;
  expiresAt: string;
  status: string;
  qrCodeData: string;
  instructions: string[];
}

export interface Deposit {
  id: string;
  agentId: string;
  txSignature: string;
  amountLamports: number;
  status: string;
  confirmedAt: string | null;
  creditedAt: string | null;
  createdAt: string;
}

export interface DepositVerifyResult {
  verified: boolean;
  txSignature: string;
  amountLamports: number | null;
  agentId: string | null;
  status: string;
  message: string;
  newBalance: number | null;
}

export interface PendingIntent {
  intentId: string;
  reference: string;
  expectedAmountLamports: number | null;
  depositAddress: string;
  expiresAt: string;
  status: string;
}

export interface WithdrawResult {
  success: boolean;
  withdrawalId: string;
  txSignature: string;
  amountLamports: number;
  toAddress: string;
  newBalance: number;
}

// Get treasury address for deposits (public)
export const getDepositAddress = (): Promise<DepositAddress> =>
  fetchJson("/v1/deposits/address");

// Create deposit intent with QR code
export const createDepositIntent = (agentId: string, amountLamports?: number): Promise<DepositIntent> =>
  authFetch("/v1/deposits/intent", {
    method: "POST",
    body: JSON.stringify({ agentId, amountLamports })
  });

// Verify a deposit transaction
export const verifyDeposit = (txSignature: string, agentId: string): Promise<DepositVerifyResult> =>
  authFetch("/v1/deposits/verify", {
    method: "POST",
    body: JSON.stringify({ txSignature, agentId })
  });

// Get deposit history for an agent
export const getDepositHistory = (agentId: string): Promise<{ deposits: Deposit[] }> =>
  authFetch(`/v1/deposits/${agentId}`);

// Get pending deposit intents for an agent
export const getPendingDepositIntents = (agentId: string): Promise<{ pendingIntents: PendingIntent[] }> =>
  authFetch(`/v1/deposits/${agentId}/pending`);

// Withdraw to external wallet — gated on a verified email, routed through the
// session-carrying proxy.
export const withdrawToWallet = (agentId: string, amountLamports: number, toAddress: string): Promise<WithdrawResult> =>
  sensitiveFetch("/v1/deposits/withdraw", {
    method: "POST",
    body: JSON.stringify({ agentId, amountLamports, toAddress })
  });
