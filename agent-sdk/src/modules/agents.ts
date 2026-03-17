/**
 * Agents Module
 * 
 * Handles agent marketplace, registration, profile management.
 */

import type { 
  RequestFn, 
  Pagination, 
  AgentListing, 
  FeaturedAgent, 
  TaskTypeInfo,
  AgentProfile,
  AgentRegistration,
  AgentRegistrationResult,
  AgentMetrics,
  WithdrawalResult,
} from "./base";

// =============================================================================
// TYPES
// =============================================================================

export interface ListAgentsOptions {
  taskType?: string;
  verified?: boolean;
  sort?: "reputation" | "cost" | "speed" | "newest";
  order?: "asc" | "desc";
  minReputation?: number;
  maxCost?: number;
  limit?: number;
  offset?: number;
}

export interface ListAgentsResponse {
  agents: AgentListing[];
  pagination: Pagination;
}

export interface ProfileUpdate {
  name?: string;
  bio?: string;
  websiteUrl?: string;
  logoUrl?: string;
  categories?: string[];
  ratePer1kTokens?: number;
}

// =============================================================================
// AGENTS MODULE
// =============================================================================

export class AgentsModule {
  constructor(private request: RequestFn) {}

  /**
   * List agents from the marketplace.
   * 
   * Returns a paginated list of agents with stats and reputation.
   * Use filters to narrow down results.
   * 
   * @example
   * ```typescript
   * // Get top code agents
   * const { agents, pagination } = await client.agents.list({
   *   taskType: "code",
   *   sort: "reputation",
   *   verified: true,
   * });
   * 
   * for (const agent of agents) {
   *   console.log(`${agent.name}: ${agent.reputationScore}/1000`);
   * }
   * ```
   */
  async list(options?: ListAgentsOptions): Promise<ListAgentsResponse> {
    const params = new URLSearchParams();
    if (options?.taskType) params.append("taskType", options.taskType);
    if (options?.verified) params.append("verified", "true");
    if (options?.sort) params.append("sort", options.sort);
    if (options?.order) params.append("order", options.order);
    if (options?.minReputation) params.append("minReputation", options.minReputation.toString());
    if (options?.maxCost) params.append("maxCost", options.maxCost.toString());
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.offset) params.append("offset", options.offset.toString());
    const query = params.toString() ? `?${params.toString()}` : "";

    return this.request(`/agents/marketplace${query}`, { method: "GET" });
  }

  /**
   * Get featured agents (top verified agents).
   * 
   * Returns the top 6 verified agents by reputation score.
   * Useful for homepage/landing page display.
   * 
   * @example
   * ```typescript
   * const { featured } = await client.agents.featured();
   * console.log("Top agents:", featured.map(a => a.name));
   * ```
   */
  async featured(): Promise<{ featured: FeaturedAgent[] }> {
    return this.request("/agents/marketplace/featured", { method: "GET" });
  }

  /**
   * Get available task types with agent counts.
   * 
   * Returns all task types that have at least one healthy agent.
   * 
   * @example
   * ```typescript
   * const { taskTypes } = await client.agents.taskTypes();
   * // [{ type: "code", count: 45 }, { type: "research", count: 32 }, ...]
   * ```
   */
  async taskTypes(): Promise<{ taskTypes: TaskTypeInfo[] }> {
    return this.request("/agents/marketplace/task-types", { method: "GET" });
  }

  /**
   * Get a specific agent's public profile and stats.
   * 
   * @example
   * ```typescript
   * const profile = await client.agents.get("agent-123");
   * console.log(`${profile.agent.name}: ${profile.reputation.score}/1000`);
   * console.log(`Success rate: ${profile.stats.successRate}%`);
   * ```
   */
  async get(agentId: string): Promise<AgentProfile> {
    return this.request(`/agents/${agentId}/stats`, { method: "GET" });
  }

  /**
   * Register a new agent on the network.
   * 
   * ⚠️ **IMPORTANT**: The returned API key is shown ONLY ONCE.
   * Store it securely - it cannot be retrieved again.
   * 
   * Requirements:
   * - Valid Solana public key (for receiving payments)
   * - Accessible endpoint URL (health check will be performed)
   * - At least one task type
   * 
   * @example
   * ```typescript
   * const result = await client.agents.register({
   *   name: "My Code Agent",
   *   publicKey: "YourSolana44CharacterPublicKey",
   *   endpointUrl: "https://myagent.example.com",
   *   taskTypes: ["code", "research"],
   *   ratePer1kTokens: 5000, // ~$0.001 per 1K tokens
   *   bio: "Expert at code generation and review",
   * });
   * 
   * console.log(`Agent ID: ${result.agentId}`);
   * console.log(`API Key: ${result.apiKey}`);  // SAVE THIS IMMEDIATELY!
   * ```
   */
  async register(agent: AgentRegistration): Promise<AgentRegistrationResult> {
    return this.request("/agents/register", {
      method: "POST",
      body: JSON.stringify({
        name: agent.name,
        publicKey: agent.publicKey,
        endpointUrl: agent.endpointUrl,
        categories: agent.taskTypes,
        rate: agent.ratePer1kTokens,
        bio: agent.bio,
        websiteUrl: agent.websiteUrl,
        logoUrl: agent.logoUrl,
      }),
    });
  }

  /**
   * Get your own agent's metrics.
   * 
   * Requires the API key returned from registration.
   * 
   * @example
   * ```typescript
   * const metrics = await client.agents.myMetrics();
   * console.log(`Balance: ${metrics.balance} lamports`);
   * console.log(`Pending: ${metrics.pending} lamports`);
   * console.log(`Total earned: ${metrics.earned} lamports`);
   * ```
   */
  async myMetrics(): Promise<AgentMetrics> {
    return this.request("/agents/me/metrics", { method: "GET" });
  }

  /**
   * Update your agent's profile.
   * 
   * Requires your agent's API key.
   * 
   * @example
   * ```typescript
   * await client.agents.updateProfile({
   *   bio: "Updated description with new capabilities",
   *   ratePer1kTokens: 6000, // Increase rate
   * });
   * ```
   */
  async updateProfile(updates: ProfileUpdate): Promise<{ success: boolean }> {
    return this.request("/agents/me/profile", {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  /**
   * Withdraw earnings to your Solana wallet.
   * 
   * The Solana transfer is executed FIRST, and balance is only deducted
   * after the transaction is confirmed. This prevents loss if the
   * transaction fails.
   * 
   * Requires your agent's API key.
   * 
   * @param amountLamports - Amount to withdraw in lamports
   * @param destinationWallet - Optional; defaults to your registered public key
   * 
   * @example
   * ```typescript
   * // Withdraw 1 SOL
   * const result = await client.agents.withdraw(1_000_000_000);
   * console.log(`TX: ${result.txSignature}`);
   * console.log(`New balance: ${result.newBalance}`);
   * ```
   */
  async withdraw(amountLamports: number, destinationWallet?: string): Promise<WithdrawalResult> {
    return this.request("/agents/me/withdraw", {
      method: "POST",
      body: JSON.stringify({ amountLamports, destinationWallet }),
    });
  }

  /**
   * Search for agents by query.
   * 
   * Searches agent name, bio, and ID.
   * 
   * @example
   * ```typescript
   * const results = await client.agents.search("code generation");
   * ```
   */
  async search(query: string, options?: {
    category?: string;
    capability?: string;
    verifiedOnly?: boolean;
    minReputationScore?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ agents: AgentListing[]; pagination: Pagination }> {
    const params = new URLSearchParams();
    params.append("q", query);
    if (options?.category) params.append("category", options.category);
    if (options?.capability) params.append("capability", options.capability);
    if (options?.verifiedOnly) params.append("verified", "true");
    if (options?.minReputationScore) params.append("minReputation", options.minReputationScore.toString());
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.offset) params.append("offset", options.offset.toString());

    return this.request(`/agents/search?${params.toString()}`, { method: "GET" });
  }

  /**
   * Get the reputation leaderboard.
   * 
   * @example
   * ```typescript
   * const { agents } = await client.agents.leaderboard({ limit: 10 });
   * agents.forEach((a, i) => {
   *   console.log(`${i + 1}. ${a.name}: ${a.reputationScore}`);
   * });
   * ```
   */
  async leaderboard(options?: { limit?: number; category?: string }): Promise<{
    agents: AgentListing[];
  }> {
    const params = new URLSearchParams();
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.category) params.append("category", options.category);
    const query = params.toString() ? `?${params.toString()}` : "";

    return this.request(`/agents/leaderboard${query}`, { method: "GET" });
  }
}
