/**
 * Monocle SDK - Main Client
 * 
 * The primary interface for interacting with Monocle.
 * 
 * @example
 * ```typescript
 * import { MonocleClient } from "monocle-sdk";
 * 
 * const client = new MonocleClient({ apiKey: "your-api-key" });
 * 
 * // Stream a chat response
 * for await (const chunk of client.chat("Explain quantum computing")) {
 *   process.stdout.write(chunk.text);
 * }
 * 
 * // Browse agents
 * const { agents } = await client.agents.list({ taskType: "code" });
 * 
 * // Register your agent
 * const { apiKey, agentId } = await client.agents.register({ ... });
 * ```
 */

import { ChatModule, StreamChunk, ChatOptions, ChatResponse, StreamOptions } from "./modules/chat";
import { AgentsModule } from "./modules/agents";
import { ConversationsModule } from "./modules/conversations";
import { WalletModule } from "./modules/wallet";
import { 
  MonocleError, 
  MonocleNetworkError, 
  MonocleTimeoutError,
  createErrorFromResponse,
  createNetworkError,
} from "./errors";

// =============================================================================
// TYPES
// =============================================================================

export interface MonocleClientOptions {
  /** Your Monocle API key */
  apiKey: string;
  /** API base URL (default: http://localhost:3001/v1) */
  baseUrl?: string;
  /** Maximum retry attempts for failed requests (default: 3) */
  maxRetries?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

// =============================================================================
// MAIN CLIENT
// =============================================================================

export class MonocleClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  /** Chat module - send messages and stream responses */
  public readonly chat: ChatModule & ((message: string, options?: StreamOptions) => AsyncGenerator<StreamChunk>);
  
  /** Agents module - browse marketplace, register, manage */
  public readonly agents: AgentsModule;
  
  /** Conversations module - history, search, export */
  public readonly conversations: ConversationsModule;

  /** Wallet module - dWallet custody, spending policies, audit log */
  public readonly wallet: WalletModule;

  constructor(options: MonocleClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || process.env.MONOCLE_API_URL || "http://localhost:3001/v1";
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30000;

    // Initialize modules
    const chatModule = new ChatModule(
      this.request.bind(this),
      this.streamRequest.bind(this)
    );
    this.agents = new AgentsModule(this.request.bind(this));
    this.conversations = new ConversationsModule(this.request.bind(this));
    this.wallet = new WalletModule(this.request.bind(this));

    // Create callable chat that streams by default
    // This allows: for await (const chunk of client.chat("Hello")) { ... }
    const chatCallable = (message: string, options?: StreamOptions) => {
      return chatModule.stream(message, options);
    };
    
    // Merge module methods onto the callable
    Object.assign(chatCallable, chatModule);
    this.chat = chatCallable as any;
  }

  // ===========================================================================
  // INTERNAL REQUEST HANDLING
  // ===========================================================================

  /**
   * Make a request with retries and error handling.
   */
  private async request(path: string, init: RequestInit): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    let lastError: MonocleError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.apiKey,
            ...(init.headers || {}),
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Parse response
        let body: any;
        try {
          body = await response.json();
        } catch {
          body = null;
        }

        // Handle errors
        if (!response.ok) {
          const error = createErrorFromResponse(response.status, body);
          
          // Retry if appropriate
          if (error.isRetryable() && attempt < this.maxRetries) {
            lastError = error;
            const delay = error.getRetryDelayMs() || Math.pow(2, attempt) * 500;
            await this.sleep(delay);
            continue;
          }

          throw error;
        }

        // Success - unwrap if wrapped in success envelope
        if (body && body.success === true && body.data !== undefined) {
          return body.data;
        }
        return body;

      } catch (error: any) {
        clearTimeout(timeoutId);

        // Handle network errors
        if (!(error instanceof MonocleError)) {
          const networkError = createNetworkError(error, url);
          
          if (networkError.isRetryable() && attempt < this.maxRetries) {
            lastError = networkError;
            const delay = Math.pow(2, attempt) * 500;
            await this.sleep(delay);
            continue;
          }

          throw networkError;
        }

        throw error;
      }
    }

    throw lastError || new MonocleError("Request failed after all retries");
  }

  /**
   * Make a streaming request.
   */
  private async streamRequest(path: string, body: object, signal?: AbortSignal): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs * 10); // Longer timeout for streaming

    // Combine with external signal if provided
    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
          "Accept": "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;

    } catch (error: any) {
      clearTimeout(timeoutId);
      throw createNetworkError(error, url);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Send a chat message and get a complete response (non-streaming).
   * 
   * For streaming, use `client.chat("message")` directly.
   * 
   * @example
   * ```typescript
   * const response = await client.send("Hello");
   * console.log(response.content);
   * ```
   */
  async send(message: string, options?: ChatOptions): Promise<ChatResponse> {
    return (this.chat as ChatModule).send(message, options);
  }

  /**
   * Stream a chat response with a callback for each chunk.
   * 
   * Alternative to the async iterator style.
   * 
   * @example
   * ```typescript
   * await client.streamChat("Explain AI", {
   *   onChunk: (chunk) => process.stdout.write(chunk.text),
   *   onComplete: (response) => console.log(`\nCost: ${response.cost.lamports}`)
   * });
   * ```
   */
  async streamChat(message: string, options: StreamOptions): Promise<void> {
    for await (const _ of this.chat(message, options)) {
      // Callbacks handle the chunks
    }
  }
}

// Default export
export default MonocleClient;
