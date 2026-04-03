/**
 * customAgentAdapter.ts
 *
 * Executes calls to any externally registered agent that implements
 * the Monocle Agent Protocol (MAP) — a minimal HTTP contract.
 */

import { ConversationMessage } from "./specialistService";

// ─── Monocle Agent Protocol (MAP) types ───────────────────────────────────────

export interface MAPRequest {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  systemPrompt: string;
  taskType: string;
  maxTokens: number;
  sessionId?: string;
  monocleVersion: "1.0";
}

export interface MAPResponse {
  content: string;
  usage: {
    totalTokens: number;
    promptTokens?: number;
    completionTokens?: number;
  };
  agentMeta?: {
    model?: string;
    latencyMs?: number;
    [key: string]: unknown;
  };
}

export interface CustomAgentConfig {
  endpointUrl: string;
  agentId: string;
  agentName: string;
  authHeader?: string;
  timeoutMs?: number;
}

// ─── Execute call to external custom agent ────────────────────────────────────

export async function executeCustomAgent(
  config: CustomAgentConfig,
  messages: ConversationMessage[],
  systemPrompt: string,
  taskType: string
): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {

  const timeout = config.timeoutMs ?? 30_000;

  const payload: MAPRequest = {
    messages: messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
    systemPrompt,
    taskType,
    maxTokens: 2048,
    monocleVersion: "1.0",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Monocle-Request": "true",
    "X-Monocle-Agent-Id": config.agentId,
  };

  if (config.authHeader) {
    headers["Authorization"] = config.authHeader.startsWith("Bearer ")
      ? config.authHeader
      : `Bearer ${config.authHeader}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(config.endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      throw new Error(`Custom agent ${config.agentName} timed out after ${timeout}ms`);
    }
    throw new Error(`Custom agent ${config.agentName} unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 402) {
    throw new Error(
      `Agent ${config.agentName} returned 402 Payment Required. ` +
      `Ensure x402 payment header is attached before calling this agent.`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Custom agent ${config.agentName} returned ${response.status}: ${body.slice(0, 200)}`
    );
  }

  let data: MAPResponse;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Custom agent ${config.agentName} returned invalid JSON`);
  }

  if (!data.content || typeof data.content !== "string") {
    throw new Error(
      `Custom agent ${config.agentName} response missing required field: content`
    );
  }
  if (!data.usage?.totalTokens) {
    data.usage = {
      totalTokens: Math.ceil(data.content.length / 4),
      promptTokens: 0,
      completionTokens: Math.ceil(data.content.length / 4),
    };
  }

  return {
    content: data.content,
    usage: {
      promptTokens: data.usage.promptTokens ?? 0,
      completionTokens: data.usage.completionTokens ?? data.usage.totalTokens,
      totalTokens: data.usage.totalTokens,
    },
  };
}

// ─── Health check for custom agent endpoint ───────────────────────────────────

export async function pingCustomAgent(
  endpointUrl: string,
  timeoutMs: number = 5000
): Promise<{ alive: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();

  const targets = [
    endpointUrl.replace(/\/$/, "") + "/health",
    endpointUrl.replace(/\/$/, "") + "/",
    endpointUrl,
  ];

  for (const url of targets) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "X-Monocle-Ping": "true" },
      });
      clearTimeout(timer);

      if (res.status < 500) {
        return { alive: true, latencyMs: Date.now() - start };
      }
    } catch {
      continue;
    }
  }

  return {
    alive: false,
    latencyMs: Date.now() - start,
    error: "All health check URLs failed",
  };
}
