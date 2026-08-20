/**
 * Agent reviews.
 *
 * Distinct from lib/reputation-api.ts, which talks to the standalone
 * agent-reputation service on localhost:3004 — not deployed, backed by a JSON
 * file, and accepting a reviewer id the browser makes up. These endpoints live
 * in the main backend beside the payment records, because "did this agent
 * actually pay" is a question only that database can answer.
 */

const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "/api/proxy";

export interface ReviewSummary {
  count: number;
  average: number | null;
  distribution?: Record<string, number>;
}

export interface AgentReview {
  id: string;
  reviewerAgentId: string;
  reviewerName: string | null;
  rating: number;
  comment: string | null;
  basis: "metered" | "x402";
  /** What the reviewer had spent with this agent when they wrote it. */
  paidLamports: number;
  callsAtReview: number;
  createdAt: string;
  edited: boolean;
}

export interface ReviewEligibility {
  eligible: boolean;
  reason: "paid" | "no_payment" | "self";
  message: string;
  basis: "metered" | "x402" | null;
  paidLamports: number;
  calls: number;
  existingReview: { rating: number; comment: string | null } | null;
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
    /* empty body */
  }
  if (!res.ok) {
    // The server's message is the useful part here — "X has not paid Y for any
    // work" tells the reviewer exactly what is missing.
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return (json?.data ?? json) as T;
}

export const getAgentReviews = (agentId: string, limit = 20, offset = 0) =>
  request<{ summary: ReviewSummary; reviews: AgentReview[] }>(
    `/v1/agents/${encodeURIComponent(agentId)}/reviews?limit=${limit}&offset=${offset}`
  );

export const checkReviewEligibility = (agentId: string, reviewerAgentId: string) =>
  request<ReviewEligibility>(
    `/v1/agents/${encodeURIComponent(agentId)}/reviews/eligibility?reviewerAgentId=${encodeURIComponent(
      reviewerAgentId
    )}`
  );

export const submitReview = (
  agentId: string,
  body: { reviewerAgentId: string; rating: number; comment?: string }
) =>
  request<AgentReview>(`/v1/agents/${encodeURIComponent(agentId)}/reviews`, {
    method: "POST",
    body: JSON.stringify(body),
  });
