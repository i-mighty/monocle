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

  verifyIdentity(input: { firstName: string; lastName: string; dob: string; idNumber: string }) {
    return this.request("/verify-identity", { method: "POST", body: JSON.stringify(input) });
  }

  /**
   * Alias for logging/metering only, without performing a tool action.
   */
  logToolCall(agentId: string, toolName: string, tokensUsed: number, payload?: object) {
    return this.request("/meter/log", { method: "POST", body: JSON.stringify({ agentId, toolName, tokensUsed, payload }) });
  }

  async callTool(agentId: string, toolName: string, payload: object, tokensUsed = 0) {
    await this.logToolCall(agentId, toolName, tokensUsed, payload);
    return { ok: true, echo: payload };
  }

  payAgent(senderWallet: string, receiverWallet: string, lamports: number) {
    return this.request("/pay", { method: "POST", body: JSON.stringify({ sender: senderWallet, receiver: receiverWallet, lamports }) });
  }
}

