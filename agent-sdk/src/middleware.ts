/**
 * AgentPay Middleware
 *
 * One-line integration for automatic:
 * - Usage logging
 * - Pricing enforcement
 * - Payment handling
 *
 * Usage:
 *   import { AgentPayMiddleware, createMiddleware } from 'agent-sdk/middleware';
 *
 *   // For class-based agents
 *   agent.use(AgentPayMiddleware);
 *
 *   // For function-based, wrap your handler
 *   const protectedTool = withAgentPay(myToolHandler, config);
 *
 * Reduces integration friction massively.
 */

import { AgentPayClient } from "./client";

// =============================================================================
// TYPES
// =============================================================================

export interface MiddlewareConfig {
  /** AgentPay API key */
  apiKey: string;

  /** This agent's ID (the provider/callee) */
  agentId: string;

  /** Base URL for AgentPay backend */
  baseUrl?: string;

  /** Token counting strategy */
  tokenCounter?: "estimate" | "exact" | ((input: unknown, output: unknown) => number);

  /** Default tokens per call if not specified */
  defaultTokens?: number;

  /** Enable simulation mode (no real charges) */
  simulationMode?: boolean;

  /** Error handler */
  onError?: (error: Error, context: ToolContext) => void;

  /** Success handler */
  onSuccess?: (result: ExecutionResult, context: ToolContext) => void;

  /** Pre-execution hook (can reject by throwing) */
  beforeExecute?: (context: ToolContext) => Promise<void>;

  /** Post-execution hook */
  afterExecute?: (result: ExecutionResult, context: ToolContext) => Promise<void>;
}

export interface ToolContext {
  callerId: string;
  calleeId: string;
  toolName: string;
  input: unknown;
  startTime: number;
}

export interface ExecutionResult {
  output: unknown;
  tokensUsed: number;
  costLamports: number;
  latencyMs: number;
  success: boolean;
}

export type ToolHandler<TInput, TOutput> = (
  input: TInput,
  context: { callerId: string }
) => Promise<TOutput>;

// =============================================================================
// MIDDLEWARE CLASS (for agent.use() pattern)
// =============================================================================

export class AgentPayMiddleware {
  private client: AgentPayClient;
  private config: MiddlewareConfig;
  private tools: Map<string, { handler: ToolHandler<any, any>; options?: ToolOptions }> = new Map();

  constructor(config: MiddlewareConfig) {
    this.config = {
      defaultTokens: 1000,
      simulationMode: false,
      ...config,
    };

    this.client = new AgentPayClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
  }

  /**
   * Register a tool with the middleware
   */
  registerTool<TInput, TOutput>(
    name: string,
    handler: ToolHandler<TInput, TOutput>,
    options?: ToolOptions
  ): void {
    this.tools.set(name, { handler, options });
  }

  /**
   * Execute a tool with automatic payment handling
   */
  async execute<TInput, TOutput>(
    toolName: string,
    input: TInput,
    callerId: string
  ): Promise<TOutput> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool not registered: ${toolName}`);
    }

    const context: ToolContext = {
      callerId,
      calleeId: this.config.agentId,
      toolName,
      input,
      startTime: Date.now(),
    };

    try {
      // Pre-execution hook
      if (this.config.beforeExecute) {
        await this.config.beforeExecute(context);
      }

      // Execute the tool
      const output = await tool.handler(input, { callerId });
      const latencyMs = Date.now() - context.startTime;

      // Count tokens
      const tokensUsed = this.countTokens(input, output, tool.options);

      // Log to AgentPay (unless simulation mode)
      let costLamports = 0;
      if (!this.config.simulationMode) {
        const result = await this.client.executeTool(
          callerId,
          this.config.agentId,
          toolName,
          tokensUsed
        );
        costLamports = result.data?.costLamports || 0;
      } else {
        // Simulation mode - just log locally
        console.log(
          `[AgentPay Simulation] ${callerId} -> ${this.config.agentId}/${toolName}: ${tokensUsed} tokens`
        );
      }

      const executionResult: ExecutionResult = {
        output,
        tokensUsed,
        costLamports,
        latencyMs,
        success: true,
      };

      // Success handler
      if (this.config.onSuccess) {
        this.config.onSuccess(executionResult, context);
      }

      // Post-execution hook
      if (this.config.afterExecute) {
        await this.config.afterExecute(executionResult, context);
      }

      return output;
    } catch (error: any) {
      // Error handler
      if (this.config.onError) {
        this.config.onError(error, context);
      }
      throw error;
    }
  }

  /**
   * Create wrapped handler for a tool
   */
  wrap<TInput, TOutput>(
    toolName: string,
    handler: ToolHandler<TInput, TOutput>,
    options?: ToolOptions
  ): (input: TInput, callerId: string) => Promise<TOutput> {
    this.registerTool(toolName, handler, options);
    return (input: TInput, callerId: string) =>
      this.execute(toolName, input, callerId);
  }

  /**
   * Count tokens for input/output
   */
  private countTokens(
    input: unknown,
    output: unknown,
    options?: ToolOptions
  ): number {
    // Use per-tool token count if specified
    if (options?.fixedTokens) {
      return options.fixedTokens;
    }

    // Use custom counter if provided
    if (typeof this.config.tokenCounter === "function") {
      return this.config.tokenCounter(input, output);
    }

    // Estimate based on JSON size
    if (this.config.tokenCounter === "exact") {
      // Exact counting requires external tokenizer
      // Fall back to estimate
    }

    // Default: estimate based on JSON string length
    const inputStr = typeof input === "string" ? input : JSON.stringify(input);
    const outputStr =
      typeof output === "string" ? output : JSON.stringify(output);
    const totalChars = (inputStr?.length || 0) + (outputStr?.length || 0);

    // Rough estimate: ~4 chars per token
    return Math.max(Math.ceil(totalChars / 4), this.config.defaultTokens || 100);
  }

  /**
   * Get client for direct API access
   */
  getClient(): AgentPayClient {
    return this.client;
  }
}

// =============================================================================
// TOOL OPTIONS
// =============================================================================

export interface ToolOptions {
  /** Fixed token count (overrides counting) */
  fixedTokens?: number;

  /** Rate per 1k tokens (for preview) */
  ratePer1kTokens?: number;

  /** Description for discovery */
  description?: string;

  /** Whether to skip payment (free tool) */
  free?: boolean;
}

// =============================================================================
// FUNCTION-BASED MIDDLEWARE
// =============================================================================

/**
 * Create middleware instance
 */
export function createMiddleware(config: MiddlewareConfig): AgentPayMiddleware {
  return new AgentPayMiddleware(config);
}

/**
 * Wrap a single function with AgentPay payment handling
 *
 * Usage:
 *   const protectedTool = withAgentPay(
 *     async (input) => { ... return output; },
 *     { apiKey: '...', agentId: 'my-agent', toolName: 'my-tool' }
 *   );
 *
 *   // Call with automatic payment
 *   const result = await protectedTool(input, 'caller-agent-id');
 */
export function withAgentPay<TInput, TOutput>(
  handler: (input: TInput) => Promise<TOutput>,
  config: MiddlewareConfig & { toolName: string; toolOptions?: ToolOptions }
): (input: TInput, callerId: string) => Promise<TOutput> {
  const middleware = new AgentPayMiddleware(config);

  const wrappedHandler: ToolHandler<TInput, TOutput> = async (input, ctx) => {
    return handler(input);
  };

  return middleware.wrap(config.toolName, wrappedHandler, config.toolOptions);
}

// =============================================================================
// EXPRESS MIDDLEWARE (for HTTP APIs)
// =============================================================================

/**
 * Create Express middleware for automatic payment handling
 *
 * Usage:
 *   app.post('/api/tool',
 *     agentPayExpress({ apiKey, agentId, toolName: 'my-tool' }),
 *     (req, res) => { ... }
 *   );
 */
export function agentPayExpress(
  config: MiddlewareConfig & { toolName: string }
): (req: any, res: any, next: any) => Promise<void> {
  const client = new AgentPayClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  return async (req, res, next) => {
    const startTime = Date.now();
    const callerId = req.headers["x-caller-id"] || req.body?.callerId;

    if (!callerId) {
      res.status(400).json({ error: "Missing x-caller-id header or callerId in body" });
      return;
    }

    // Store original end method
    const originalEnd = res.end;
    let responseBody = "";

    // Intercept response
    res.end = function (chunk: any, ...args: any[]) {
      if (chunk) {
        responseBody = chunk.toString();
      }

      // Count tokens and log to AgentPay
      const inputStr = JSON.stringify(req.body);
      const totalChars = inputStr.length + responseBody.length;
      const tokensUsed = Math.max(Math.ceil(totalChars / 4), config.defaultTokens || 100);

      // Fire and forget - don't block response
      if (!config.simulationMode) {
        client
          .executeTool(callerId, config.agentId, config.toolName, tokensUsed)
          .catch((err) => {
            console.error("[AgentPay] Failed to log execution:", err);
            if (config.onError) {
              config.onError(err, {
                callerId,
                calleeId: config.agentId,
                toolName: config.toolName,
                input: req.body,
                startTime,
              });
            }
          });
      }

      // Call original end
      return originalEnd.call(this, chunk, ...args);
    };

    next();
  };
}

// =============================================================================
// SIMULATION HELPERS
// =============================================================================

/**
 * Simulate a workflow and get predicted cost
 *
 * Usage:
 *   const cost = await simulateWorkflow([
 *     { callerId: 'me', calleeId: 'code-agent', toolName: 'write-code', tokensEstimate: 5000 },
 *     { callerId: 'me', calleeId: 'review-agent', toolName: 'review', tokensEstimate: 3000 },
 *   ], client);
 */
export async function simulateWorkflow(
  callGraph: Array<{
    callerId: string;
    calleeId: string;
    toolName: string;
    tokensEstimate: number;
  }>,
  client: AgentPayClient
): Promise<{
  totalCostLamports: number;
  totalCostSol: number;
  breakdown: Array<{
    callerId: string;
    calleeId: string;
    toolName: string;
    estimatedCost: number;
  }>;
}> {
  const response = await (client as any).request("/simulation/workflow", {
    method: "POST",
    body: JSON.stringify({ callGraph }),
  });

  return {
    totalCostLamports: response.data.totalCostLamports,
    totalCostSol: response.data.totalCostLamports / 1_000_000_000,
    breakdown: response.data.calls.map((c: any) => ({
      callerId: c.callerId,
      calleeId: c.calleeId,
      toolName: c.toolName,
      estimatedCost: c.estimatedCostLamports,
    })),
  };
}
