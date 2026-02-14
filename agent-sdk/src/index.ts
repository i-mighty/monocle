export { AgentPayClient as default } from "./client";
export * from "./types";
export { AgentPayClient as AgentClient } from "./client";
export * from "./x402";

// Middleware for one-line integration
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
