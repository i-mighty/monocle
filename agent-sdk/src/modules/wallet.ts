/**
 * Wallet Module
 *
 * Agent wallet management: dWallet custody, spending policies, x402
 * micropayments, and a full audit trail of every agent action.
 *
 * @example
 * ```typescript
 * const client = new MonocleClient({ apiKey: "your-key" });
 *
 * // Get wallet info
 * const wallet = await client.wallet.get("my-agent");
 *
 * // Set spending policy
 * await client.wallet.policy.set("my-agent", {
 *   maxPerTransaction: 50_000,
 *   dailyCap: 500_000,
 *   allowedRecipients: ["gpt-provider", "dalle-provider"],
 * });
 *
 * // Authorize a payment (checks policy + creates dWallet approval)
 * const approval = await client.wallet.authorize("my-agent", {
 *   recipient: "gpt-provider",
 *   amount: 5000,
 *   memo: "code review task",
 * });
 *
 * // Pull audit log
 * const log = await client.wallet.audit("my-agent", { limit: 50 });
 * ```
 */

import type { RequestFn, Pagination } from "./base";

// =============================================================================
// TYPES
// =============================================================================

/** On-chain dWallet information for an agent. */
export interface AgentWallet {
  agentId: string;
  publicKey: string;
  dwalletAddress: string;
  authority: string;
  curve: "ed25519" | "secp256k1";
  solName?: string;
  balanceLamports: number;
  pendingLamports: number;
  createdAt: string;
}

/** Spending policy enforced by the dWallet policy engine. */
export interface SpendingPolicy {
  agentId: string;
  maxPerTransaction: number;
  dailyCap: number;
  spentToday: number;
  remainingToday: number;
  isPaused: boolean;
  allowedRecipients: string[] | null;
  timeBudgets: TimeBudget[] | null;
  lastResetAt: string;
}

/** Time-windowed spending budget. */
export interface TimeBudget {
  windowMinutes: number;
  maxSpend: number;
  currentSpend: number;
  windowStart: string;
}

/** Policy update request. */
export interface PolicyUpdate {
  maxPerTransaction?: number | null;
  dailyCap?: number | null;
  allowedRecipients?: string[] | null;
  timeBudgets?: Array<{ windowMinutes: number; maxSpend: number }> | null;
  isPaused?: boolean;
}

/** Payment authorization request. */
export interface AuthorizePaymentRequest {
  recipient: string;
  amount: number;
  toolName?: string;
  memo?: string;
}

/** Payment authorization result. */
export interface PaymentAuthorization {
  authorized: boolean;
  agentId: string;
  recipient: string;
  amount: number;
  messageHash?: string;
  approvalPda?: string;
  dwalletAddress?: string;
  txSignature?: string;
  policyViolations: string[];
  timestamp: string;
}

/** Single entry in the agent's immutable audit log. */
export interface AuditEntry {
  id: string;
  action: "payment_sent" | "payment_received" | "policy_updated"
    | "policy_violation" | "wallet_created" | "spending_paused"
    | "spending_resumed" | "settlement" | "tool_execution"
    | "authorization_approved" | "authorization_rejected";
  agentId: string;
  counterparty?: string;
  amount?: number;
  details: Record<string, unknown>;
  txSignature?: string;
  timestamp: string;
}

/** Summary of all dWallets in the system. */
export interface WalletSummary {
  agents: Array<AgentWallet & { policy: SpendingPolicy }>;
  programId: string;
  network: string;
}

// =============================================================================
// POLICY SUB-MODULE
// =============================================================================

class PolicyModule {
  constructor(private request: RequestFn) {}

  /**
   * Get the current spending policy for an agent.
   *
   * @example
   * ```typescript
   * const policy = await client.wallet.policy.get("my-agent");
   * console.log(`Daily remaining: ${policy.remainingToday} lamports`);
   * ```
   */
  async get(agentId: string): Promise<SpendingPolicy> {
    return this.request(`/wallet/${agentId}/policy`, { method: "GET" });
  }

  /**
   * Update the spending policy for an agent.
   *
   * Pass `null` to remove a limit. Omitted fields remain unchanged.
   *
   * @example
   * ```typescript
   * await client.wallet.policy.set("my-agent", {
   *   maxPerTransaction: 25_000,
   *   dailyCap: 200_000,
   *   allowedRecipients: ["gpt-provider"],
   *   timeBudgets: [{ windowMinutes: 60, maxSpend: 100_000 }],
   * });
   * ```
   */
  async set(agentId: string, policy: PolicyUpdate): Promise<SpendingPolicy> {
    return this.request(`/wallet/${agentId}/policy`, {
      method: "PUT",
      body: JSON.stringify(policy),
    });
  }

  /**
   * Emergency pause — immediately halt all outgoing payments.
   *
   * @example
   * ```typescript
   * await client.wallet.policy.pause("my-agent", "suspicious activity detected");
   * ```
   */
  async pause(agentId: string, reason?: string): Promise<{ paused: boolean }> {
    return this.request(`/wallet/${agentId}/policy/pause`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  /**
   * Resume spending after a pause.
   */
  async resume(agentId: string): Promise<{ paused: boolean }> {
    return this.request(`/wallet/${agentId}/policy/resume`, {
      method: "POST",
    });
  }

  /**
   * Dry-run a payment against the policy engine without executing.
   *
   * @returns Whether the payment would be allowed, and any violations.
   */
  async check(
    agentId: string,
    amount: number,
    recipient?: string
  ): Promise<{ allowed: boolean; violations: string[] }> {
    return this.request(`/wallet/${agentId}/policy/check`, {
      method: "POST",
      body: JSON.stringify({ amount, recipient }),
    });
  }
}

// =============================================================================
// WALLET MODULE
// =============================================================================

export class WalletModule {
  /** Spending policy sub-module */
  public readonly policy: PolicyModule;

  constructor(private request: RequestFn) {
    this.policy = new PolicyModule(request);
  }

  /**
   * Get wallet info for an agent (dWallet address, balance, identity).
   *
   * @example
   * ```typescript
   * const w = await client.wallet.get("my-agent");
   * console.log(`dWallet: ${w.dwalletAddress}`);
   * console.log(`Balance: ${w.balanceLamports} lamports`);
   * ```
   */
  async get(agentId: string): Promise<AgentWallet> {
    return this.request(`/wallet/${agentId}`, { method: "GET" });
  }

  /**
   * List all agent wallets (admin / dashboard view).
   */
  async list(): Promise<WalletSummary> {
    return this.request("/wallet", { method: "GET" });
  }

  /**
   * Authorize a payment through the dWallet policy engine.
   *
   * 1. Checks spending policy (per-tx, daily cap, time budget, allowlist)
   * 2. Builds an Ika ApproveMessage instruction
   * 3. Submits on-chain (or simulates in pre-alpha)
   * 4. Logs to immutable audit trail
   *
   * @example
   * ```typescript
   * const auth = await client.wallet.authorize("my-agent", {
   *   recipient: "writer-001",
   *   amount: 3000,
   *   memo: "blog post task",
   * });
   * if (auth.authorized) {
   *   console.log(`Approved: ${auth.txSignature}`);
   * } else {
   *   console.log(`Blocked: ${auth.policyViolations.join(", ")}`);
   * }
   * ```
   */
  async authorize(
    agentId: string,
    payment: AuthorizePaymentRequest
  ): Promise<PaymentAuthorization> {
    return this.request(`/wallet/${agentId}/authorize`, {
      method: "POST",
      body: JSON.stringify(payment),
    });
  }

  /**
   * Get the immutable audit log for an agent.
   *
   * Every payment, policy change, and authorization decision is recorded.
   *
   * @example
   * ```typescript
   * const { entries } = await client.wallet.audit("my-agent", {
   *   action: "payment_sent",
   *   limit: 20,
   * });
   * for (const e of entries) {
   *   console.log(`${e.timestamp} ${e.action} ${e.amount ?? ""}`);
   * }
   * ```
   */
  async audit(
    agentId: string,
    options?: {
      action?: AuditEntry["action"];
      limit?: number;
      offset?: number;
      since?: string;
    }
  ): Promise<{ entries: AuditEntry[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    if (options?.action) params.append("action", options.action);
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.offset) params.append("offset", options.offset.toString());
    if (options?.since) params.append("since", options.since);
    const query = params.toString() ? `?${params.toString()}` : "";

    return this.request(`/wallet/${agentId}/audit${query}`, { method: "GET" });
  }

  /**
   * Top up an agent's balance (dev/testing only).
   */
  async topup(agentId: string, lamports: number): Promise<{
    agentId: string;
    addedLamports: number;
    newBalance: number;
  }> {
    return this.request(`/wallet/${agentId}/topup`, {
      method: "POST",
      body: JSON.stringify({ lamports }),
    });
  }

  /**
   * Settle pending earnings to the agent's on-chain wallet.
   */
  async settle(agentId: string): Promise<{
    settlementId: string;
    grossLamports: number;
    platformFeeLamports: number;
    netLamports: number;
    txSignature: string;
  }> {
    return this.request(`/wallet/${agentId}/settle`, {
      method: "POST",
    });
  }
}
