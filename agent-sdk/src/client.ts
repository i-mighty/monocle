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
}