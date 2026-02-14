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
  // Now supports optional quoteId for frozen pricing
  executeTool(
    callerId: string, 
    calleeId: string, 
    toolName: string, 
    tokensUsed: number, 
    options?: { quoteId?: string; payload?: object }
  ) {
    return this.request("/meter/execute", {
      method: "POST",
      body: JSON.stringify({ 
        callerId, 
        calleeId, 
        toolName, 
        tokensUsed, 
        quoteId: options?.quoteId,
        payload: options?.payload 
      }),
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

  // ==================== Pricing Quotes (Price Freeze) ====================

  /**
   * Issue a pricing quote with frozen pricing and expiry
   * 
   * The quote locks in the current price for a specified validity period.
   * Use the returned quoteId when executing to guarantee the quoted price.
   * 
   * @param callerAgentId - Agent making the call
   * @param calleeAgentId - Agent being called (tool provider)
   * @param toolName - Name of the tool
   * @param estimatedTokens - Expected token usage
   * @param validityMs - Optional validity period (default 5 min, max 30 min)
   */
  getPricingQuote(
    callerAgentId: string,
    calleeAgentId: string,
    toolName: string,
    estimatedTokens: number,
    validityMs?: number
  ) {
    return this.request("/pricing/quote", {
      method: "POST",
      body: JSON.stringify({ 
        callerAgentId, 
        calleeAgentId, 
        toolName, 
        estimatedTokens,
        validityMs 
      }),
    });
  }

  /**
   * Get details of an existing pricing quote
   */
  getQuoteDetails(quoteId: string) {
    return this.request(`/pricing/quote/${quoteId}`, { method: "GET" });
  }

  /**
   * Validate a quote before execution (pre-flight check)
   */
  validateQuote(
    quoteId: string,
    callerAgentId: string,
    calleeAgentId: string,
    toolName: string,
    actualTokens: number
  ) {
    return this.request(`/pricing/quote/${quoteId}/validate`, {
      method: "POST",
      body: JSON.stringify({ 
        callerAgentId, 
        calleeAgentId, 
        toolName, 
        actualTokens 
      }),
    });
  }

  /**
   * Cancel an active pricing quote
   */
  cancelQuote(quoteId: string) {
    return this.request(`/pricing/quote/${quoteId}`, { method: "DELETE" });
  }

  /**
   * List all active quotes for an agent
   */
  listActiveQuotes(agentId: string) {
    return this.request(`/pricing/quotes/${agentId}`, { method: "GET" });
  }

  /**
   * Get quote statistics for an agent
   */
  getQuoteStats(agentId: string) {
    return this.request(`/pricing/quotes/${agentId}/stats`, { method: "GET" });
  }

  /**
   * Execute a tool call with a pre-obtained quote
   * This is a convenience method that validates the quote and executes in one step.
   * 
   * @example
   * // Get quote first
   * const quote = await client.getPricingQuote(callerId, calleeId, "gpt-4", 5000);
   * // Execute with quote (price locked)
   * const result = await client.executeWithQuote(quote.quote.quoteId, callerId, calleeId, "gpt-4", 4500);
   */
  executeWithQuote(
    quoteId: string,
    callerId: string,
    calleeId: string,
    toolName: string,
    tokensUsed: number
  ) {
    return this.executeTool(callerId, calleeId, toolName, tokensUsed, { quoteId });
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
   * Include callerAgentId to get a quoteId for price-locked execution
   */
  getX402Quote(
    agentId: string, 
    toolName: string, 
    estimatedTokens: number,
    callerAgentId?: string
  ) {
    return this.request("/x402/quote", {
      method: "POST",
      body: JSON.stringify({ agentId, toolName, estimatedTokens, callerAgentId }),
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

  // ==================== Anti-Abuse / Pre-Authorization Methods ====================

  /**
   * Reserve balance before execution (pre-authorization)
   */
  reserve(callerId: string, calleeId: string, toolName: string, estimatedTokens: number, timeoutMs?: number) {
    return this.request("/anti-abuse/reserve", {
      method: "POST",
      body: JSON.stringify({ callerId, calleeId, toolName, estimatedTokens, timeoutMs }),
    });
  }

  /**
   * Capture a reservation (complete payment after successful execution)
   */
  capture(reservationId: string, actualTokens: number) {
    return this.request(`/anti-abuse/capture/${reservationId}`, {
      method: "POST",
      body: JSON.stringify({ actualTokens }),
    });
  }

  /**
   * Release a reservation (cancel on failure)
   */
  release(reservationId: string, reason?: string) {
    return this.request(`/anti-abuse/release/${reservationId}`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  /**
   * Get active reservations for an agent
   */
  getActiveReservations(agentId: string) {
    return this.request(`/anti-abuse/reservations/${agentId}`, {
      method: "GET",
    });
  }

  /**
   * Get available balance (total minus reservations)
   */
  getAvailableBalance(agentId: string) {
    return this.request(`/anti-abuse/balance/${agentId}`, {
      method: "GET",
    });
  }

  /**
   * Get anomaly alerts for an agent
   */
  getAnomalyAlerts(agentId: string, options?: { status?: string; severity?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (options?.status) params.append("status", options.status);
    if (options?.severity) params.append("severity", options.severity);
    if (options?.limit) params.append("limit", options.limit.toString());
    const query = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/anti-abuse/alerts/${agentId}${query}`, {
      method: "GET",
    });
  }

  /**
   * Resolve an anomaly alert
   */
  resolveAlert(alertId: string, status: "resolved" | "false_positive", notes?: string) {
    return this.request(`/anti-abuse/alerts/${alertId}`, {
      method: "PATCH",
      body: JSON.stringify({ status, notes }),
    });
  }

  /**
   * Get behavior profile for an agent
   */
  getBehaviorProfile(agentId: string) {
    return this.request(`/anti-abuse/profile/${agentId}`, {
      method: "GET",
    });
  }

  /**
   * Run anomaly detection scan
   */
  scanForAnomalies(agentId: string, callerId: string, toolName: string, tokensUsed: number, ratePer1kTokens: number) {
    return this.request(`/anti-abuse/scan/${agentId}`, {
      method: "POST",
      body: JSON.stringify({ callerId, toolName, tokensUsed, ratePer1kTokens }),
    });
  }

  /**
   * Execute tool with pre-authorization (one-shot helper)
   * 
   * Handles reserve -> execute -> capture/release automatically.
   * If you need more control, use reserve/capture/release separately.
   */
  async executeWithPreAuth(
    callerId: string,
    calleeId: string,
    toolName: string,
    estimatedTokens: number,
    executor: () => Promise<{ actualTokens: number; result: any }>
  ) {
    // Step 1: Reserve
    const reservation = await this.reserve(callerId, calleeId, toolName, estimatedTokens);
    
    if (!reservation.success) {
      throw new Error(reservation.error || "Failed to create reservation");
    }

    try {
      // Step 2: Execute
      const { actualTokens, result } = await executor();

      // Step 3: Capture
      const captureResult = await this.capture(reservation.data.reservationId, actualTokens);

      return {
        success: true,
        result,
        reservation: reservation.data,
        capture: captureResult.data,
      };
    } catch (error: any) {
      // Step 3 (alt): Release on failure
      await this.release(reservation.data.reservationId, error.message);
      throw error;
    }
  }

  // ==================== Budget Authorization Methods ====================
  
  /**
   * Pre-authorize a spend before execution
   * 
   * Performs comprehensive budget checks and optionally creates a balance reservation.
   * Use this for enterprise risk mitigation - fail fast before cost accrual.
   * 
   * @example
   * const auth = await client.authorizeSpend({
   *   agentId: "my-agent",
   *   calls: [
   *     { calleeId: "gpt-provider", toolName: "gpt-4", estimatedTokens: 8000 },
   *     { calleeId: "dalle-provider", toolName: "dalle-3", estimatedTokens: 1000 }
   *   ],
   *   createReservation: true,
   *   purpose: "Image generation workflow"
   * });
   * if (auth.authorized) {
   *   // Safe to proceed
   * }
   */
  authorizeSpend(request: {
    agentId: string;
    estimatedSpendLamports?: number;
    calls?: Array<{
      calleeId: string;
      toolName: string;
      estimatedTokens: number;
    }>;
    createReservation?: boolean;
    reservationTimeoutMs?: number;
    purpose?: string;
  }) {
    return this.request("/budget/authorize", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Get comprehensive budget status for an agent
   * 
   * Returns balance, limits, spending history, and health indicators.
   */
  getBudgetStatus(agentId: string) {
    return this.request(`/budget/status/${agentId}`, {
      method: "GET",
    });
  }

  /**
   * Forecast if a spend would be allowed (lightweight check)
   * 
   * Does NOT create reservations - just checks if execution would succeed.
   */
  forecastSpend(agentId: string, calls: Array<{
    calleeId: string;
    toolName: string;
    estimatedTokens: number;
  }>) {
    return this.request("/budget/forecast", {
      method: "POST",
      body: JSON.stringify({ agentId, calls }),
    });
  }

  /**
   * Set spend limits for an agent
   * 
   * @param agentId - Agent to configure
   * @param limits - New limit values (null = no limit)
   */
  setSpendLimits(agentId: string, limits: {
    maxCostPerCall?: number | null;
    dailySpendCap?: number | null;
    allowedCallees?: string[] | null;
  }) {
    return this.request(`/budget/limits/${agentId}`, {
      method: "PUT",
      body: JSON.stringify(limits),
    });
  }

  /**
   * Emergency pause all spending for an agent
   * 
   * Use when suspicious activity is detected - immediately halts all outgoing payments.
   */
  pauseSpending(agentId: string, reason?: string) {
    return this.request(`/budget/pause/${agentId}`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  /**
   * Resume spending for a paused agent
   */
  resumeSpending(agentId: string) {
    return this.request(`/budget/resume/${agentId}`, {
      method: "POST",
    });
  }

  /**
   * Get recent spending history for an agent
   * 
   * @param agentId - Agent ID
   * @param options - Query options (limit, days)
   */
  getSpendingHistory(agentId: string, options?: { limit?: number; days?: number }) {
    const params = new URLSearchParams();
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.days) params.append("days", options.days.toString());
    const query = params.toString() ? `?${params.toString()}` : "";
    
    return this.request(`/budget/history/${agentId}${query}`, {
      method: "GET",
    });
  }

  /**
   * Authorize and execute a workflow with automatic pre-authorization
   * 
   * Convenience method that:
   * 1. Pre-authorizes the spend (with reservation)
   * 2. Executes the workflow
   * 3. Handles success/failure cleanup
   * 
   * @example
   * await client.executeWithBudgetAuth({
   *   agentId: "my-agent",
   *   calls: [{ calleeId: "gpt", toolName: "gpt-4", estimatedTokens: 5000 }],
   *   purpose: "Analysis workflow",
   * }, async (auth) => {
   *   // Execute your workflow here
   *   const result = await client.executeTool(...);
   *   return result;
   * });
   */
  async executeWithBudgetAuth<T>(
    authorization: {
      agentId: string;
      calls: Array<{
        calleeId: string;
        toolName: string;
        estimatedTokens: number;
      }>;
      purpose?: string;
    },
    executor: (auth: any) => Promise<T>
  ): Promise<{ success: boolean; result?: T; authorization: any; error?: string }> {
    // Pre-authorize with reservation
    const auth = await this.authorizeSpend({
      ...authorization,
      createReservation: true,
    });

    if (!auth.authorized) {
      return {
        success: false,
        authorization: auth,
        error: auth.violations?.join("; ") || "Authorization denied",
      };
    }

    try {
      const result = await executor(auth);
      return {
        success: true,
        result,
        authorization: auth,
      };
    } catch (error: any) {
      return {
        success: false,
        authorization: auth,
        error: error.message,
      };
    }
  }
}
