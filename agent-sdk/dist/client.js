import { AgentSdkError } from "./types";
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
                        ...(init.headers || {})
                    },
                    signal: ctrl.signal
                });
                clearTimeout(to);
                if (!res.ok)
                    throw new AgentSdkError(`HTTP ${res.status}`, `${res.status}`);
                return await res.json();
            }
            catch (err) {
                lastErr = err;
                if (attempt === this.maxRetries)
                    throw err;
                await sleep(2 ** attempt * 200);
            }
            finally {
                clearTimeout(to);
            }
        }
        throw lastErr;
    }
    // Register agent with identity verification
    verifyIdentity(input) {
        return this.request("/identity/verify-identity", {
            method: "POST",
            body: JSON.stringify(input),
        });
    }
    // Execute tool call with pricing enforcement (REPLACES logToolCall)
    executeTool(callerId, calleeId, toolName, tokensUsed, payload) {
        return this.request("/meter/execute", {
            method: "POST",
            body: JSON.stringify({ callerId, calleeId, toolName, tokensUsed, payload }),
        });
    }
    // Get execution history
    getToolHistory(agentId, asCallee = false, limit = 100) {
        return this.request(`/meter/history/${agentId}?asCallee=${asCallee}&limit=${limit}`, {
            method: "GET",
        });
    }
    // Get agent metrics (balance, pending, earnings)
    getMetrics(agentId) {
        return this.request(`/meter/metrics/${agentId}`, { method: "GET" });
    }
    // Settle pending payments on-chain
    settle(agentId) {
        return this.request(`/payments/settle/${agentId}`, { method: "POST" });
    }
    // Get settlement history
    getSettlements(agentId, limit = 100) {
        return this.request(`/payments/settlements/${agentId}?limit=${limit}`, {
            method: "GET",
        });
    }
    // Top up agent balance (dev/testing)
    topup(agentId, lamports) {
        return this.request("/payments/topup", {
            method: "POST",
            body: JSON.stringify({ agentId, lamports }),
        });
    }
}
