/**
 * Chat Module
 * 
 * Handles chat operations including streaming responses.
 */

import type { RequestFn } from "./base";
import { MonocleStreamError, MonocleStreamInterruptedError } from "../errors";

// =============================================================================
// TYPES
// =============================================================================

export interface ChatOptions {
  conversationId?: string;
  preferredTaskType?: "code" | "research" | "reasoning" | "writing" | "math" | "translation" | "general";
  maxCostLamports?: number;
  preferQuality?: boolean;
}

export interface ChatResponse {
  content: string;
  conversationId: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: {
    lamports: number;
    usd: number;
  };
  agent: {
    id: string;
    name: string;
    model: string;
  };
  routing: {
    taskType: string;
    confidence: number;
    reasoning: string;
    alternatives: Array<{
      agentId: string;
      name: string;
      model: string;
      ratePer1kTokens: number;
    }>;
  };
  latencyMs: number;
}

export interface StreamChunk {
  /** The text content of this chunk */
  text: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** Cumulative text received so far */
  accumulated: string;
  /** Token count for this chunk (if available) */
  tokens?: number;
  /** Metadata available on final chunk */
  meta?: {
    conversationId: string;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    cost: { lamports: number; usd: number };
    agent: { id: string; name: string; model: string };
    routing: { taskType: string; confidence: number };
    latencyMs: number;
  };
}

export interface StreamOptions extends ChatOptions {
  /** Called for each chunk received */
  onChunk?: (chunk: StreamChunk) => void;
  /** Called on stream error */
  onError?: (error: Error) => void;
  /** Called when stream completes */
  onComplete?: (response: ChatResponse) => void;
  /** AbortController signal to cancel the stream */
  signal?: AbortSignal;
}

// =============================================================================
// CHAT MODULE
// =============================================================================

export class ChatModule {
  constructor(
    private request: RequestFn,
    private streamRequest: (path: string, body: object, signal?: AbortSignal) => Promise<Response>
  ) {}

  /**
   * Send a message and get a complete response.
   * 
   * For streaming responses, use `stream()` or iterate over `chat()` directly.
   * 
   * @example
   * ```typescript
   * const response = await client.chat.send("Explain async/await");
   * console.log(response.content);
   * console.log(response.cost.lamports);
   * ```
   */
  async send(message: string, options?: ChatOptions): Promise<ChatResponse> {
    return this.request("/chat", {
      method: "POST",
      body: JSON.stringify({ message, ...options }),
    });
  }

  /**
   * Stream a chat response chunk by chunk.
   * 
   * Returns an async iterator that yields text chunks as they arrive.
   * The final chunk includes metadata (cost, usage, etc).
   * 
   * @example
   * ```typescript
   * // Simple streaming
   * for await (const chunk of client.chat.stream("Explain AI")) {
   *   process.stdout.write(chunk.text);
   * }
   * 
   * // With metadata
   * let finalMeta;
   * for await (const chunk of client.chat.stream("Hello")) {
   *   process.stdout.write(chunk.text);
   *   if (chunk.done) finalMeta = chunk.meta;
   * }
   * console.log(`\nCost: ${finalMeta.cost.lamports} lamports`);
   * ```
   */
  async *stream(message: string, options?: StreamOptions): AsyncGenerator<StreamChunk, void, unknown> {
    const response = await this.streamRequest(
      "/chat/stream",
      { message, ...options },
      options?.signal
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new MonocleStreamError(
        body?.error?.message || `Stream failed: ${response.status}`,
        { httpStatus: response.status }
      );
    }

    if (!response.body) {
      throw new MonocleStreamError("No response body for stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Emit final chunk
          const finalChunk: StreamChunk = { text: "", done: true, accumulated };
          options?.onChunk?.(finalChunk);
          yield finalChunk;
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            
            if (data === "[DONE]") {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              
              // Handle STREAM_ERROR event - interruption mid-stream
              if (parsed.type === "STREAM_ERROR") {
                throw new MonocleStreamInterruptedError(
                  parsed.error?.message || "Stream interrupted",
                  {
                    partialContent: parsed.partialContent || accumulated,
                    tokensConsumed: parsed.tokensConsumed || 0,
                    errorCode: parsed.error?.code || "STREAM_ERROR",
                  }
                );
              }
              
              // Handle legacy error format
              if (parsed.error && parsed.type !== "STREAM_ERROR") {
                throw new MonocleStreamError(parsed.error.message, {
                  httpStatus: parsed.error.code || 500,
                  partialResponse: accumulated,
                });
              }

              const text = parsed.choices?.[0]?.delta?.content || parsed.text || "";
              accumulated += text;

              const chunk: StreamChunk = {
                text,
                done: false,
                accumulated,
                tokens: parsed.usage?.completion_tokens,
              };

              // Check for final meta data
              if (parsed.done || parsed.finish_reason === "stop") {
                chunk.done = true;
                chunk.meta = {
                  conversationId: parsed.conversationId || "",
                  usage: parsed.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                  cost: parsed.cost || { lamports: 0, usd: 0 },
                  agent: parsed.agent || { id: "", name: "", model: "" },
                  routing: parsed.routing || { taskType: "", confidence: 0 },
                  latencyMs: parsed.latencyMs || 0,
                };

                if (chunk.meta && options?.onComplete) {
                  options.onComplete({
                    content: accumulated,
                    conversationId: chunk.meta.conversationId,
                    usage: chunk.meta.usage,
                    cost: chunk.meta.cost,
                    agent: chunk.meta.agent,
                    routing: { ...chunk.meta.routing, reasoning: "", alternatives: [] },
                    latencyMs: chunk.meta.latencyMs,
                  });
                }
              }

              options?.onChunk?.(chunk);
              yield chunk;

            } catch (parseError) {
              // Skip malformed JSON
              if (parseError instanceof MonocleStreamError) throw parseError;
            }
          }
        }
      }
    } catch (error: any) {
      options?.onError?.(error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Collect a complete streamed response.
   * 
   * Useful when you want streaming behavior internally but need the
   * full response as a single object.
   * 
   * @example
   * ```typescript
   * const response = await client.chat.streamToCompletion("Hello", {
   *   onChunk: (c) => process.stdout.write(c.text)
   * });
   * console.log(`\nFull response: ${response.content}`);
   * ```
   */
  async streamToCompletion(message: string, options?: StreamOptions): Promise<ChatResponse> {
    let result: ChatResponse | null = null;

    for await (const chunk of this.stream(message, options)) {
      if (chunk.done && chunk.meta) {
        result = {
          content: chunk.accumulated,
          conversationId: chunk.meta.conversationId,
          usage: chunk.meta.usage,
          cost: chunk.meta.cost,
          agent: chunk.meta.agent,
          routing: { ...chunk.meta.routing, reasoning: "", alternatives: [] },
          latencyMs: chunk.meta.latencyMs,
        };
      }
    }

    if (!result) {
      throw new MonocleStreamError("Stream completed without final metadata");
    }

    return result;
  }
}
