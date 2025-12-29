import { AgentSdkError } from "./types.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const defaultBaseUrl = process.env.AGENT_BACKEND_URL || "http://localhost:3001";
export class AgentPayClient {
  constructor(opts) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? defaultBaseUrl;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 10000;
  }
  async request(path, init) {
    const url = `${this.baseUrl}${path}`;
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            ...(init.headers || {}),
          },
          signal: ctrl.signal,
        });
        clearTimeout(to);
        if (!res.ok)
          throw new AgentSdkError(`HTTP ${res.status}`, `${res.status}`);
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
  verifyIdentity(input) {
    return this.request("/verify-identity", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  /**
   * Alias for logging/metering only, without performing a tool action.
   */
  logToolCall(agentId, toolName, tokensUsed, payload) {
    return this.request("/meter/log", {
      method: "POST",
      body: JSON.stringify({ agentId, toolName, tokensUsed, payload }),
    });
  }
  async callTool(agentId, toolName, payload, tokensUsed = 0) {
    await this.logToolCall(agentId, toolName, tokensUsed, payload);
    return { ok: true, echo: payload };
  }
  payAgent(senderWallet, receiverWallet, lamports) {
    return this.request("/pay", {
      method: "POST",
      body: JSON.stringify({
        sender: senderWallet,
        receiver: receiverWallet,
        lamports,
      }),
    });
  }
}
