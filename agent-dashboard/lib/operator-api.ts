/**
 * Operator console client.
 *
 * Talks to /v1/admin/* through the same-origin proxy, carrying the session
 * cookie. There is no operator key to hold: access is a role on the account,
 * checked by the server on every request.
 */

const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

export type AdminRole = "viewer" | "admin" | "owner";

export class OperatorError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const err = json?.error ?? {};
    throw new OperatorError(err.code ?? "UNKNOWN", err.message ?? `HTTP ${res.status}`, res.status);
  }
  return (json?.data ?? json) as T;
}

// ---- agents -----------------------------------------------------------------

export interface OperatorAgent {
  agentId: string;
  name: string | null;
  ownerEmail: string | null;
  claimed: boolean;
  payoutWallet: string | null;
  ratePer1kTokens: number;
  isPaused: boolean;
  createdAt: string;
  endpoint: {
    url: string | null;
    isHealthy: boolean;
    isActive: boolean;
    consecutiveFailures: number;
    lastCheckAt: string | null;
    lastError: string | null;
    listedInMarketplace: boolean;
  };
  callsServed: number;
  callsMade: number;
  // Absent for viewers — the server omits rather than zeroes these.
  earnedLamports?: number;
  spentLamports?: number;
  settledLamports?: number;
  pendingLamports?: number;
  balanceLamports?: number;
  directLamports?: number;
}

export const getOperatorAgents = (limit = 100, offset = 0) =>
  request<{
    agents: OperatorAgent[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
    moneyVisible: boolean;
  }>(`/v1/admin/agents?limit=${limit}&offset=${offset}`);

// ---- calls ------------------------------------------------------------------

export interface OperatorCall {
  id: string;
  callerAgentId: string;
  calleeAgentId: string;
  toolName: string;
  tokensUsed: number;
  ratePer1kTokens: number;
  costLamports: number;
  createdAt: string;
}

export const getOperatorCalls = (limit = 50, offset = 0, agentId?: string) =>
  request<{
    calls: OperatorCall[];
    pagination: { total: number; limit: number; offset: number; hasMore: boolean };
  }>(
    `/v1/admin/calls?limit=${limit}&offset=${offset}${agentId ? `&agentId=${encodeURIComponent(agentId)}` : ""}`
  );

// ---- money ------------------------------------------------------------------

export interface PlatformMoney {
  platformRevenueLamports: number;
  settlement: { count: number; grossLamports: number; netLamports: number; feeLamports: number };
  metered: { calls: number; volumeLamports: number };
  direct: { payments: number; volumeLamports: number; feeLamports: number; note: string };
  pendingToAgentsLamports: number;
  monetisedShare: number | null;
}

export const getPlatformMoney = () => request<PlatformMoney>("/v1/admin/money");

// ---- operators --------------------------------------------------------------

export interface Operator {
  id: string;
  email: string | null;
  role: AdminRole;
  createdAt: string;
  lastSeenAt: string;
}

export const getOperators = () =>
  request<{ operators: Operator[]; roles: AdminRole[] }>("/v1/admin/operators");

export const setOperatorRole = (email: string, role: AdminRole | null) =>
  request<{ email: string; previousRole: AdminRole | null; role: AdminRole | null }>(
    "/v1/admin/operators",
    { method: "PUT", body: JSON.stringify({ email, role }) }
  );
