/**
 * Monocle SDK Error Types
 * 
 * Typed error classes for specific error conditions. Developers can catch
 * and handle specific error types without parsing error messages.
 * 
 * @example
 * ```typescript
 * import { MonocleInsufficientBalanceError, MonocleAgentUnavailableError } from "monocle-sdk";
 * 
 * try {
 *   await client.chat("Hello");
 * } catch (e) {
 *   if (e instanceof MonocleInsufficientBalanceError) {
 *     console.log(`Need ${e.shortfall} more lamports`);
 *     await topUpBalance(e.shortfall);
 *   } else if (e instanceof MonocleAgentUnavailableError) {
 *     console.log(`Agent ${e.agentId} is unavailable, trying alternatives...`);
 *   } else if (e instanceof MonocleRateLimitError) {
 *     console.log(`Rate limited. Retry after ${e.retryAfterMs}ms`);
 *   }
 * }
 * ```
 */

// =============================================================================
// BASE ERROR CLASS
// =============================================================================

export interface MonocleErrorDetails {
  code: string;
  httpStatus: number;
  requestId?: string;
  timestamp: string;
  [key: string]: any;
}

/**
 * Base class for all Monocle SDK errors.
 * 
 * All Monocle errors extend this class, making it easy to catch
 * any SDK error with a single catch block.
 */
export class MonocleError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly requestId?: string;
  public readonly timestamp: string;
  public readonly details: Record<string, any>;

  constructor(message: string, details: Partial<MonocleErrorDetails> = {}) {
    super(message);
    this.name = "MonocleError";
    this.code = details.code || "UNKNOWN_ERROR";
    this.httpStatus = details.httpStatus || 500;
    this.requestId = details.requestId;
    this.timestamp = details.timestamp || new Date().toISOString();
    this.details = details;
    
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Check if this error is retryable */
  isRetryable(): boolean {
    return false;
  }

  /** Get suggested retry delay in milliseconds */
  getRetryDelayMs(): number | null {
    return null;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      httpStatus: this.httpStatus,
      requestId: this.requestId,
      timestamp: this.timestamp,
      details: this.details,
    };
  }
}

// =============================================================================
// AUTHENTICATION ERRORS
// =============================================================================

/**
 * Thrown when authentication fails (invalid/missing API key).
 */
export class MonocleAuthError extends MonocleError {
  constructor(message: string, details: Partial<MonocleErrorDetails> = {}) {
    super(message, { ...details, code: details.code || "AUTH_ERROR", httpStatus: 401 });
    this.name = "MonocleAuthError";
  }
}

/**
 * Thrown when the API key is invalid or expired.
 */
export class MonocleInvalidApiKeyError extends MonocleAuthError {
  constructor(message: string = "Invalid or expired API key", details: Partial<MonocleErrorDetails> = {}) {
    super(message, { ...details, code: "AUTH_INVALID_API_KEY" });
    this.name = "MonocleInvalidApiKeyError";
  }
}

// =============================================================================
// PAYMENT ERRORS
// =============================================================================

/**
 * Thrown when a payment-related operation fails.
 */
export class MonoclePaymentError extends MonocleError {
  constructor(message: string, details: Partial<MonocleErrorDetails> = {}) {
    super(message, { ...details, code: details.code || "PAYMENT_ERROR", httpStatus: details.httpStatus || 402 });
    this.name = "MonoclePaymentError";
  }
}

/**
 * Thrown when the account balance is insufficient for the operation.
 */
export class MonocleInsufficientBalanceError extends MonoclePaymentError {
  public readonly currentBalance: number;
  public readonly requiredAmount: number;
  public readonly shortfall: number;

  constructor(
    message: string = "Insufficient balance",
    details: Partial<MonocleErrorDetails> & {
      currentBalance?: number;
      requiredAmount?: number;
      shortfall?: number;
    } = {}
  ) {
    super(message, { ...details, code: "PAYMENT_INSUFFICIENT_FUNDS" });
    this.name = "MonocleInsufficientBalanceError";
    this.currentBalance = details.currentBalance || 0;
    this.requiredAmount = details.requiredAmount || 0;
    this.shortfall = details.shortfall || (this.requiredAmount - this.currentBalance);
  }
}

/**
 * Thrown when payment is required (402 response).
 */
export class MonoclePaymentRequiredError extends MonoclePaymentError {
  public readonly requiredAmount: number;
  public readonly paymentAddress: string;

  constructor(
    message: string = "Payment required",
    details: Partial<MonocleErrorDetails> & {
      requiredAmount?: number;
      paymentAddress?: string;
    } = {}
  ) {
    super(message, { ...details, code: "PAYMENT_REQUIRED", httpStatus: 402 });
    this.name = "MonoclePaymentRequiredError";
    this.requiredAmount = details.requiredAmount || 0;
    this.paymentAddress = details.paymentAddress || "";
  }
}

// =============================================================================
// BUDGET ERRORS
// =============================================================================

/**
 * Thrown when a budget limit is exceeded.
 */
export class MonocleBudgetExceededError extends MonocleError {
  public readonly limitType: "daily" | "per-call" | "total";
  public readonly currentUsage: number;
  public readonly limit: number;

  constructor(
    message: string = "Budget limit exceeded",
    details: Partial<MonocleErrorDetails> & {
      limitType?: "daily" | "per-call" | "total";
      currentUsage?: number;
      limit?: number;
    } = {}
  ) {
    super(message, { ...details, code: details.code || "BUDGET_EXCEEDED", httpStatus: 403 });
    this.name = "MonocleBudgetExceededError";
    this.limitType = details.limitType || "total";
    this.currentUsage = details.currentUsage || 0;
    this.limit = details.limit || 0;
  }
}

/**
 * Thrown when spending is paused for an agent.
 */
export class MonocleSpendingPausedError extends MonocleError {
  public readonly pausedAt: string;
  public readonly reason?: string;

  constructor(
    message: string = "Spending is paused",
    details: Partial<MonocleErrorDetails> & {
      pausedAt?: string;
      reason?: string;
    } = {}
  ) {
    super(message, { ...details, code: "BUDGET_SPENDING_PAUSED", httpStatus: 403 });
    this.name = "MonocleSpendingPausedError";
    this.pausedAt = details.pausedAt || new Date().toISOString();
    this.reason = details.reason;
  }
}

// =============================================================================
// AGENT ERRORS
// =============================================================================

/**
 * Thrown when an agent is not found.
 */
export class MonocleAgentNotFoundError extends MonocleError {
  public readonly agentId: string;

  constructor(
    agentId: string,
    message: string = `Agent not found: ${agentId}`,
    details: Partial<MonocleErrorDetails> = {}
  ) {
    super(message, { ...details, code: "AGENT_NOT_FOUND", httpStatus: 404 });
    this.name = "MonocleAgentNotFoundError";
    this.agentId = agentId;
  }
}

/**
 * Thrown when an agent is unavailable (unhealthy, suspended, etc.).
 */
export class MonocleAgentUnavailableError extends MonocleError {
  public readonly agentId: string;
  public readonly reason: "unhealthy" | "suspended" | "overloaded" | "unknown";

  constructor(
    agentId: string,
    reason: "unhealthy" | "suspended" | "overloaded" | "unknown" = "unknown",
    message?: string,
    details: Partial<MonocleErrorDetails> = {}
  ) {
    super(message || `Agent ${agentId} is ${reason}`, { ...details, code: "AGENT_UNAVAILABLE", httpStatus: 503 });
    this.name = "MonocleAgentUnavailableError";
    this.agentId = agentId;
    this.reason = reason;
  }

  isRetryable(): boolean {
    return this.reason === "overloaded";
  }

  getRetryDelayMs(): number | null {
    return this.reason === "overloaded" ? 5000 : null;
  }
}

/**
 * Thrown when no suitable agent is available for the task.
 */
export class MonocleNoAgentsAvailableError extends MonocleError {
  public readonly taskType: string;
  public readonly filters?: Record<string, any>;

  constructor(
    taskType: string,
    message?: string,
    details: Partial<MonocleErrorDetails> & { filters?: Record<string, any> } = {}
  ) {
    super(message || `No agents available for task type: ${taskType}`, { 
      ...details, 
      code: "NO_AGENTS_AVAILABLE", 
      httpStatus: 503 
    });
    this.name = "MonocleNoAgentsAvailableError";
    this.taskType = taskType;
    this.filters = details.filters;
  }

  isRetryable(): boolean {
    return true;
  }

  getRetryDelayMs(): number | null {
    return 10000; // 10 seconds
  }
}

// =============================================================================
// RATE LIMIT ERRORS
// =============================================================================

/**
 * Thrown when rate limit is exceeded.
 */
export class MonocleRateLimitError extends MonocleError {
  public readonly retryAfterMs: number;
  public readonly limit: number;
  public readonly remaining: number;
  public readonly resetAt: string;

  constructor(
    message: string = "Rate limit exceeded",
    details: Partial<MonocleErrorDetails> & {
      retryAfterMs?: number;
      limit?: number;
      remaining?: number;
      resetAt?: string;
    } = {}
  ) {
    super(message, { ...details, code: "RATE_LIMIT_EXCEEDED", httpStatus: 429 });
    this.name = "MonocleRateLimitError";
    this.retryAfterMs = details.retryAfterMs || 5000;
    this.limit = details.limit || 0;
    this.remaining = details.remaining || 0;
    this.resetAt = details.resetAt || new Date(Date.now() + this.retryAfterMs).toISOString();
  }

  isRetryable(): boolean {
    return true;
  }

  getRetryDelayMs(): number {
    return this.retryAfterMs;
  }
}

// =============================================================================
// VALIDATION ERRORS
// =============================================================================

/**
 * Thrown when request validation fails.
 */
export class MonocleValidationError extends MonocleError {
  public readonly field?: string;
  public readonly reason: string;

  constructor(
    message: string,
    details: Partial<MonocleErrorDetails> & {
      field?: string;
      reason?: string;
    } = {}
  ) {
    super(message, { ...details, code: details.code || "VALIDATION_ERROR", httpStatus: 400 });
    this.name = "MonocleValidationError";
    this.field = details.field;
    this.reason = details.reason || message;
  }
}

// =============================================================================
// QUOTE ERRORS
// =============================================================================

/**
 * Thrown when a pricing quote is not found.
 */
export class MonocleQuoteNotFoundError extends MonocleError {
  public readonly quoteId: string;

  constructor(
    quoteId: string,
    message?: string,
    details: Partial<MonocleErrorDetails> = {}
  ) {
    super(message || `Quote not found: ${quoteId}`, { ...details, code: "PRICING_QUOTE_NOT_FOUND", httpStatus: 404 });
    this.name = "MonocleQuoteNotFoundError";
    this.quoteId = quoteId;
  }
}

/**
 * Thrown when a pricing quote has expired.
 */
export class MonocleQuoteExpiredError extends MonocleError {
  public readonly quoteId: string;
  public readonly expiredAt: string;

  constructor(
    quoteId: string,
    expiredAt?: string,
    message?: string,
    details: Partial<MonocleErrorDetails> = {}
  ) {
    super(message || `Quote expired: ${quoteId}`, { ...details, code: "PRICING_QUOTE_EXPIRED", httpStatus: 410 });
    this.name = "MonocleQuoteExpiredError";
    this.quoteId = quoteId;
    this.expiredAt = expiredAt || new Date().toISOString();
  }
}

// =============================================================================
// NETWORK ERRORS
// =============================================================================

/**
 * Thrown when a network request fails.
 */
export class MonocleNetworkError extends MonocleError {
  public readonly url?: string;
  public readonly cause?: Error;

  constructor(
    message: string = "Network request failed",
    details: Partial<MonocleErrorDetails> & {
      url?: string;
      cause?: Error;
    } = {}
  ) {
    super(message, { ...details, code: "NETWORK_ERROR", httpStatus: 0 });
    this.name = "MonocleNetworkError";
    this.url = details.url;
    this.cause = details.cause;
  }

  isRetryable(): boolean {
    return true;
  }

  getRetryDelayMs(): number {
    return 1000;
  }
}

/**
 * Thrown when a request times out.
 */
export class MonocleTimeoutError extends MonocleNetworkError {
  public readonly timeoutMs: number;

  constructor(
    timeoutMs: number,
    message?: string,
    details: Partial<MonocleErrorDetails> & { url?: string } = {}
  ) {
    super(message || `Request timed out after ${timeoutMs}ms`, { ...details, code: "TIMEOUT" });
    this.name = "MonocleTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// =============================================================================
// STREAMING ERRORS
// =============================================================================

/**
 * Thrown when a streaming connection fails.
 */
export class MonocleStreamError extends MonocleError {
  public readonly partialResponse?: string;

  constructor(
    message: string = "Stream error",
    details: Partial<MonocleErrorDetails> & {
      partialResponse?: string;
    } = {}
  ) {
    super(message, { ...details, code: "STREAM_ERROR", httpStatus: details.httpStatus || 500 });
    this.name = "MonocleStreamError";
    this.partialResponse = details.partialResponse;
  }

  isRetryable(): boolean {
    return true;
  }
}

/**
 * Thrown when a stream is interrupted mid-response.
 * 
 * Contains the partial response that arrived before the interruption,
 * allowing callers to salvage what was received.
 * 
 * @example
 * ```typescript
 * try {
 *   for await (const chunk of client.chat("...")) {
 *     process.stdout.write(chunk.text);
 *   }
 * } catch (e) {
 *   if (e instanceof MonocleStreamInterruptedError) {
 *     console.log("\n--- Stream interrupted ---");
 *     console.log(`Partial response: ${e.partialContent}`);
 *     console.log(`Tokens consumed: ${e.tokensConsumed}`);
 *   }
 * }
 * ```
 */
export class MonocleStreamInterruptedError extends MonocleStreamError {
  public readonly partialContent: string;
  public readonly tokensConsumed: number;
  public readonly errorCode: string;

  constructor(
    message: string,
    details: {
      partialContent: string;
      tokensConsumed?: number;
      errorCode?: string;
    }
  ) {
    super(message, {
      code: "STREAM_INTERRUPTED",
      httpStatus: 500,
      partialResponse: details.partialContent,
    });
    this.name = "MonocleStreamInterruptedError";
    this.partialContent = details.partialContent;
    this.tokensConsumed = details.tokensConsumed || 0;
    this.errorCode = details.errorCode || "STREAM_ERROR";
  }

  isRetryable(): boolean {
    return true;
  }

  /**
   * Check if enough content was received to be useful.
   */
  hasUsableContent(): boolean {
    return this.partialContent.length > 50;
  }
}

// =============================================================================
// ERROR FACTORY
// =============================================================================

/**
 * Error details from API response.
 */
interface ErrorDetails {
  code: string;
  httpStatus: number;
  agentId?: string;
  taskType?: string;
  quoteId?: string;
  expiredAt?: string;
  required?: number;
  available?: number;
  shortfall?: number;
  limitType?: "daily" | "per-call";
  limit?: number;
  current?: number;
  retryAfterMs?: number;
  fieldName?: string;
  expectedFormat?: string;
  minValue?: number;
  maxValue?: number;
  actualValue?: number;
  pausedAt?: string;
  reason?: string;
  [key: string]: any;
}

/**
 * Create the appropriate error type from an API response.
 */
export function createErrorFromResponse(
  httpStatus: number,
  body: { error?: { code?: string; message?: string; details?: Record<string, any> } } | null
): MonocleError {
  const code = body?.error?.code || `HTTP_${httpStatus}`;
  const message = body?.error?.message || `Request failed with status ${httpStatus}`;
  const details: ErrorDetails = { ...body?.error?.details, code, httpStatus };

  switch (code) {
    // Auth
    case "AUTH_INVALID_API_KEY":
    case "AUTH_UNAUTHORIZED":
      return new MonocleInvalidApiKeyError(message, details);

    // Payment
    case "PAYMENT_INSUFFICIENT_FUNDS":
      return new MonocleInsufficientBalanceError(message, details as any);
    case "PAYMENT_REQUIRED":
      return new MonoclePaymentRequiredError(message, details as any);

    // Budget
    case "BUDGET_EXCEEDED":
    case "BUDGET_DAILY_LIMIT_EXCEEDED":
    case "BUDGET_PER_CALL_LIMIT_EXCEEDED":
      return new MonocleBudgetExceededError(message, details as any);
    case "BUDGET_SPENDING_PAUSED":
      return new MonocleSpendingPausedError(message, details as any);

    // Agent
    case "AGENT_NOT_FOUND":
      return new MonocleAgentNotFoundError(details.agentId || "unknown", message, details);
    case "AGENT_UNAVAILABLE":
    case "AGENT_SUSPENDED":
      return new MonocleAgentUnavailableError(
        details.agentId || "unknown",
        code === "AGENT_SUSPENDED" ? "suspended" : "unknown",
        message,
        details
      );
    case "NO_AGENTS_AVAILABLE":
      return new MonocleNoAgentsAvailableError(details.taskType || "unknown", message, details as any);

    // Rate limit
    case "RATE_LIMIT_EXCEEDED":
      return new MonocleRateLimitError(message, details as any);

    // Validation
    case "VALIDATION_REQUIRED_FIELD":
    case "VALIDATION_INVALID_FORMAT":
    case "VALIDATION_OUT_OF_RANGE":
      return new MonocleValidationError(message, details as any);

    // Quote
    case "PRICING_QUOTE_NOT_FOUND":
      return new MonocleQuoteNotFoundError(details.quoteId || "unknown", message, details);
    case "PRICING_QUOTE_EXPIRED":
      return new MonocleQuoteExpiredError(details.quoteId || "unknown", details.expiredAt, message, details);

    default:
      return new MonocleError(message, details);
  }
}

/**
 * Create error from fetch/network failure.
 */
export function createNetworkError(error: any, url?: string): MonocleNetworkError {
  if (error.name === "AbortError") {
    return new MonocleTimeoutError(0, "Request was aborted", { url });
  }
  
  return new MonocleNetworkError(
    error.message || "Network request failed",
    { url, cause: error }
  );
}
