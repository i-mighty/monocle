/**
 * Monocle SDK
 * 
 * The official SDK for the Monocle AI Router.
 * 
 * @example
 * ```typescript
 * import { MonocleClient } from "monocle-sdk";
 * 
 * const client = new MonocleClient({ apiKey: "your-api-key" });
 * 
 * // Stream responses (default)
 * for await (const chunk of client.chat("Explain quantum computing")) {
 *   process.stdout.write(chunk.text);
 * }
 * 
 * // Non-streaming
 * const response = await client.send("Hello");
 * console.log(response.content);
 * 
 * // Browse marketplace
 * const { agents } = await client.agents.list({ taskType: "code" });
 * ```
 */

// New modular client (recommended)
export { MonocleClient, default } from "./monocle";
export type { MonocleClientOptions } from "./monocle";

// Modules
export * from "./modules";

// Typed errors
export * from "./errors";

// Legacy client (for backward compatibility)
export { AgentPayClient, AgentPayClient as AgentClient } from "./client";

// Types (excluding AgentProfile which is already exported from modules)
export {
  type AgentSdkOptions,
  type VerifyResponse,
  type MeterLog,
  type PaymentRequest,
  type PaymentResponse,
  type ApiErrorResponse,
  ErrorCodes,
  type ErrorCode,
  AgentSdkError,
  type AgentAudit,
  type AgentCapability,
  type VersionHistoryEntry,
  type ToolMetadata,
  type LeaderboardEntry,
  type AgentFullProfile,
  type ReputationFactors,
  type AgentSearchResult,
} from "./types";

// x402 protocol
export * from "./x402";

// Middleware
export {
  AgentPayMiddleware,
  createMiddleware,
  withAgentPay,
  agentPayExpress,
  simulateWorkflow,
} from "./middleware";
export type {
  MiddlewareConfig,
  ToolContext,
  ExecutionResult,
  ToolHandler,
  ToolOptions,
} from "./middleware";
