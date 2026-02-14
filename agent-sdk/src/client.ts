import { AgentSdkOptions, AgentSdkError } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const defaultBaseUrl = process.env.AGENT_BACKEND_URL || "http://localhost:3001";

export class AgentPayClient {
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number;
  private timeoutMs: number;

  constructor(opts: AgentSdkOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? defaultBaseUrl;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            ...(init.headers || {})
          },
          signal: ctrl.signal
        });
        clearTimeout(to);
        if (!res.ok) throw new AgentSdkError(`HTTP ${res.status}`, `${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (attempt === this.maxRetries) throw err;
        await sleep(2 ** attempt * 200);
      } finally {
        clearTimeout(to);
      }
    }
    throw lastErr;
  }

  // Register agent with identity verification
  verifyIdentity(input: {
    agentId: string;
    firstName: string;
    lastName: string;
    dob: string;
    idNumber: string;
    ratePer1kTokens?: number;
  }) {
    return this.request("/identity/verify-identity", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // Execute tool call with pricing enforcement (REPLACES logToolCall)
  executeTool(callerId: string, calleeId: string, toolName: string, tokensUsed: number, payload?: object) {
    return this.request("/meter/execute", {
      method: "POST",
      body: JSON.stringify({ callerId, calleeId, toolName, tokensUsed, payload }),
    });
  }

  // Get execution history
  getToolHistory(agentId: string, asCallee: boolean = false, limit: number = 100) {
    return this.request(`/meter/history/${agentId}?asCallee=${asCallee}&limit=${limit}`, {
      method: "GET",
    });
  }

  // Get agent metrics (balance, pending, earnings)
  getMetrics(agentId: string) {
    return this.request(`/meter/metrics/${agentId}`, { method: "GET" });
  }

  // Settle pending payments on-chain
  settle(agentId: string) {
    return this.request(`/payments/settle/${agentId}`, { method: "POST" });
  }

  // Get settlement history
  getSettlements(agentId: string, limit: number = 100) {
    return this.request(`/payments/settlements/${agentId}?limit=${limit}`, {
      method: "GET",
    });
  }

  // Top up agent balance (dev/testing)
  topup(agentId: string, lamports: number) {
    return this.request("/payments/topup", {
      method: "POST",
      body: JSON.stringify({ agentId, lamports }),
    });
  }

  // ==================== x402 Protocol Methods ====================

  /**
   * Get x402 protocol information
   */
  getX402Info() {
    return this.request("/x402/info", { method: "GET" });
  }

  /**
   * Get x402 pricing information
   */
  getX402Pricing() {
    return this.request("/x402/pricing", { method: "GET" });
  }

  /**
   * Get a payment quote for a tool execution (returns 402 with requirements)
   */
  getX402Quote(agentId: string, toolName: string, estimatedTokens: number) {
    return this.request("/x402/quote", {
      method: "POST",
      body: JSON.stringify({ agentId, toolName, estimatedTokens }),
    });
  }

  /**
   * Simulate an x402 payment flow (for testing/integration)
   */
  simulateX402(tokens: number, agentId?: string, toolName?: string) {
    return this.request("/x402/simulate", {
      method: "POST",
      body: JSON.stringify({ tokens, agentId, toolName }),
    });
  }

  /**
   * Verify a payment signature
   */
  verifyX402Payment(signature: string, payer: string, amount: number, nonce: string, expectedAmount?: number) {
    return this.request("/x402/verify", {
      method: "POST",
      body: JSON.stringify({ signature, payer, amount, nonce, expectedAmount }),
    });
  }

  // ==================== Agent Messaging Methods ====================

  /**
   * Check for DM activity (for heartbeat polling)
   */
  checkDMActivity(agentId: string) {
    return this.request("/messaging/dm/check", {
      method: "GET",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Send a chat request to another agent
   */
  sendChatRequest(agentId: string, toAgentId: string, message: string) {
    return this.request("/messaging/dm/request", {
      method: "POST",
      headers: { "x-agent-id": agentId },
      body: JSON.stringify({ to: toAgentId, message }),
    });
  }

  /**
   * Get pending chat requests
   */
  getPendingRequests(agentId: string) {
    return this.request("/messaging/dm/requests", {
      method: "GET",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Approve a chat request
   */
  approveRequest(agentId: string, conversationId: string) {
    return this.request(`/messaging/dm/requests/${conversationId}/approve`, {
      method: "POST",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Reject a chat request (optionally block)
   */
  rejectRequest(agentId: string, conversationId: string, block: boolean = false) {
    return this.request(`/messaging/dm/requests/${conversationId}/reject`, {
      method: "POST",
      headers: { "x-agent-id": agentId },
      body: JSON.stringify({ block }),
    });
  }

  /**
   * List active conversations
   */
  listConversations(agentId: string) {
    return this.request("/messaging/dm/conversations", {
      method: "GET",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Get messages in a conversation (marks as read)
   */
  getMessages(agentId: string, conversationId: string) {
    return this.request(`/messaging/dm/conversations/${conversationId}`, {
      method: "GET",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Send a message in an approved conversation
   */
  sendMessage(agentId: string, conversationId: string, message: string, needsHumanInput: boolean = false) {
    return this.request(`/messaging/dm/conversations/${conversationId}/send`, {
      method: "POST",
      headers: { "x-agent-id": agentId },
      body: JSON.stringify({ message, needs_human_input: needsHumanInput }),
    });
  }

  /**
   * Follow an agent
   */
  followAgent(agentId: string, targetAgentId: string) {
    return this.request(`/messaging/agents/${targetAgentId}/follow`, {
      method: "POST",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Unfollow an agent
   */
  unfollowAgent(agentId: string, targetAgentId: string) {
    return this.request(`/messaging/agents/${targetAgentId}/follow`, {
      method: "DELETE",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Get agents you're following
   */
  getFollowing(agentId: string) {
    return this.request("/messaging/agents/me/following", {
      method: "GET",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Get your followers
   */
  getFollowers(agentId: string) {
    return this.request("/messaging/agents/me/followers", {
      method: "GET",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Block an agent
   */
  blockAgent(agentId: string, targetAgentId: string) {
    return this.request(`/messaging/agents/${targetAgentId}/block`, {
      method: "POST",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Unblock an agent
   */
  unblockAgent(agentId: string, targetAgentId: string) {
    return this.request(`/messaging/agents/${targetAgentId}/block`, {
      method: "DELETE",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Get blocked agents list
   */
  getBlockedAgents(agentId: string) {
    return this.request("/messaging/agents/me/blocked", {
      method: "GET",
      headers: { "x-agent-id": agentId },
    });
  }

  /**
   * Search for agents by name
   */
  searchAgents(query: string, limit: number = 20) {
    return this.request(`/messaging/agents/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
      method: "GET",
    });
  }

  /**
   * Get agent profile with stats
   */
  getAgentProfile(targetAgentId: string) {
    return this.request(`/messaging/agents/${targetAgentId}/profile`, {
      method: "GET",
    });
  }

  // ==================== Simulation Methods ====================

  /**
   * Simulate a single tool call (no payment)
   */
  simulateCall(callerId: string, calleeId: string, toolName: string, tokensEstimate: number) {
    return this.request("/simulation/call", {
      method: "POST",
      body: JSON.stringify({ callerId, calleeId, toolName, tokensEstimate }),
    });
  }

  /**
   * Simulate an entire workflow
   */
  simulateWorkflow(callGraph: Array<{
    callerId: string;
    calleeId: string;
    toolName: string;
    tokensEstimate: number;
  }>) {
    return this.request("/simulation/workflow", {
      method: "POST",
      body: JSON.stringify({ callGraph }),
    });
  }

  /**
   * Compare multiple workflow options
   */
  compareWorkflows(workflows: Array<{
    name: string;
    callGraph: Array<{
      callerId: string;
      calleeId: string;
      toolName: string;
      tokensEstimate: number;
    }>;
  }>) {
    return this.request("/simulation/compare", {
      method: "POST",
      body: JSON.stringify({ workflows }),
    });
  }

  /**
   * Quick cost estimate (no DB lookup)
   */
  quickEstimate(tokensTotal: number, ratePer1kTokens?: number) {
    return this.request("/simulation/estimate", {
      method: "POST",
      body: JSON.stringify({ tokensTotal, ratePer1kTokens }),
    });
  }

  // ==================== Webhook Methods ====================

  /**
   * Register a webhook
   */
  registerWebhook(agentId: string, url: string, events: string[]) {
    return this.request("/webhooks", {
      method: "POST",
      body: JSON.stringify({ agentId, url, events }),
    });
  }

  /**
   * List webhooks for an agent
   */
  listWebhooks(agentId: string) {
    return this.request(`/webhooks/${agentId}`, {
      method: "GET",
    });
  }

  /**
   * Update a webhook
   */
  updateWebhook(webhookId: string, updates: { url?: string; events?: string[]; isActive?: boolean }) {
    return this.request(`/webhooks/${webhookId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  /**
   * Delete a webhook
   */
  deleteWebhook(webhookId: string) {
    return this.request(`/webhooks/${webhookId}`, {
      method: "DELETE",
    });
  }

  /**
   * Get webhook delivery history
   */
  getWebhookDeliveries(webhookId: string, limit: number = 100) {
    return this.request(`/webhooks/${webhookId}/deliveries?limit=${limit}`, {
      method: "GET",
    });
  }

  /**
   * Rotate webhook secret
   */
  rotateWebhookSecret(webhookId: string) {
    return this.request(`/webhooks/${webhookId}/rotate-secret`, {
      method: "POST",
    });
  }

  /**
   * Retry a failed webhook delivery
   */
  retryWebhookDelivery(deliveryId: string) {
    return this.request(`/webhooks/deliveries/${deliveryId}/retry`, {
      method: "POST",
    });
  }
}
