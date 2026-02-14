export type AgentSdkOptions = {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
};

export type VerifyResponse = { valid: boolean; agentId: string };
export type MeterLog = { agentId: string; toolName: string; payload?: unknown; cost?: number };
export type PaymentRequest = { sender: string; receiver: string; amount: number };
export type PaymentResponse = { signature: string };

/**
 * Standardized API Error Response from AgentPay backend
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    timestamp: string;
    requestId?: string;
  };
}

/**
 * Standard error codes returned by AgentPay API
 */
export const ErrorCodes = {
  // Auth
  AUTH_UNAUTHORIZED: "AUTH_UNAUTHORIZED",
  AUTH_INVALID_API_KEY: "AUTH_INVALID_API_KEY",
  AUTH_API_KEY_NOT_CONFIGURED: "AUTH_API_KEY_NOT_CONFIGURED",
  AUTH_MISSING_HEADER: "AUTH_MISSING_HEADER",
  
  // Agent
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_ALREADY_EXISTS: "AGENT_ALREADY_EXISTS",
  AGENT_SUSPENDED: "AGENT_SUSPENDED",
  
  // Payment
  PAYMENT_INSUFFICIENT_FUNDS: "PAYMENT_INSUFFICIENT_FUNDS",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_INVALID_AMOUNT: "PAYMENT_INVALID_AMOUNT",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  PAYMENT_PAYER_NOT_CONFIGURED: "PAYMENT_PAYER_NOT_CONFIGURED",
  
  // Budget
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  BUDGET_DAILY_LIMIT_EXCEEDED: "BUDGET_DAILY_LIMIT_EXCEEDED",
  BUDGET_PER_CALL_LIMIT_EXCEEDED: "BUDGET_PER_CALL_LIMIT_EXCEEDED",
  BUDGET_SPENDING_PAUSED: "BUDGET_SPENDING_PAUSED",
  BUDGET_AUTHORIZATION_FAILED: "BUDGET_AUTHORIZATION_FAILED",
  BUDGET_RESERVATION_NOT_FOUND: "BUDGET_RESERVATION_NOT_FOUND",
  
  // Pricing
  PRICING_QUOTE_EXPIRED: "PRICING_QUOTE_EXPIRED",
  PRICING_QUOTE_NOT_FOUND: "PRICING_QUOTE_NOT_FOUND",
  PRICING_INVALID_RATE: "PRICING_INVALID_RATE",
  
  // Validation
  VALIDATION_REQUIRED_FIELD: "VALIDATION_REQUIRED_FIELD",
  VALIDATION_INVALID_FORMAT: "VALIDATION_INVALID_FORMAT",
  VALIDATION_OUT_OF_RANGE: "VALIDATION_OUT_OF_RANGE",
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  
  // Internal
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INTERNAL_DATABASE_ERROR: "INTERNAL_DATABASE_ERROR",
  INTERNAL_SERVICE_UNAVAILABLE: "INTERNAL_SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

/**
 * Enhanced SDK Error with structured error information
 * 
 * @example
 * try {
 *   await client.getAgent("unknown-id");
 * } catch (error) {
 *   if (error instanceof AgentSdkError) {
 *     if (error.isNotFound()) {
 *       console.log("Agent doesn't exist");
 *     } else if (error.isInsufficientFunds()) {
 *       console.log(`Need ${error.details?.shortfall} more lamports`);
 *     }
 *   }
 * }
 */
export class AgentSdkError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: Record<string, any>;
  public readonly requestId?: string;
  public readonly timestamp: string;
  public readonly cause?: unknown;

  constructor(
    message: string,
    code?: string,
    httpStatus?: number,
    details?: Record<string, any>,
    requestId?: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "AgentSdkError";
    this.code = code || "UNKNOWN_ERROR";
    this.httpStatus = httpStatus || 500;
    this.details = details;
    this.requestId = requestId;
    this.timestamp = new Date().toISOString();
    this.cause = cause;
    
    // Maintain proper prototype chain
    Object.setPrototypeOf(this, AgentSdkError.prototype);
  }

  /**
   * Create from API error response
   */
  static fromResponse(response: ApiErrorResponse, httpStatus: number): AgentSdkError {
    return new AgentSdkError(
      response.error.message,
      response.error.code,
      httpStatus,
      response.error.details,
      response.error.requestId
    );
  }

  /**
   * Create from fetch error
   */
  static fromFetchError(error: any, url: string): AgentSdkError {
    if (error instanceof AgentSdkError) return error;
    
    return new AgentSdkError(
      error.message || "Network request failed",
      ErrorCodes.INTERNAL_ERROR,
      500,
      { url, originalError: error.message },
      undefined,
      error
    );
  }

  // ==================== Type Guards ====================

  /** Check if this is an authentication error */
  isAuthError(): boolean {
    return this.code.startsWith("AUTH_");
  }

  /** Check if this is a "not found" error */
  isNotFound(): boolean {
    return this.code === ErrorCodes.AGENT_NOT_FOUND || 
           this.code === ErrorCodes.PRICING_QUOTE_NOT_FOUND ||
           this.code === ErrorCodes.BUDGET_RESERVATION_NOT_FOUND ||
           this.httpStatus === 404;
  }

  /** Check if this is an insufficient funds error */
  isInsufficientFunds(): boolean {
    return this.code === ErrorCodes.PAYMENT_INSUFFICIENT_FUNDS ||
           this.code === ErrorCodes.BUDGET_EXCEEDED;
  }

  /** Check if this is a budget/spending limit error */
  isBudgetError(): boolean {
    return this.code.startsWith("BUDGET_");
  }

  /** Check if this is a rate limit error */
  isRateLimited(): boolean {
    return this.code === ErrorCodes.RATE_LIMIT_EXCEEDED || this.httpStatus === 429;
  }

  /** Check if this is a validation error */
  isValidationError(): boolean {
    return this.code.startsWith("VALIDATION_");
  }

  /** Check if this is a payment required (402) error */
  isPaymentRequired(): boolean {
    return this.code === ErrorCodes.PAYMENT_REQUIRED || this.httpStatus === 402;
  }

  /** Check if this is a server error (5xx) */
  isServerError(): boolean {
    return this.httpStatus >= 500;
  }

  /** Check if the error is retryable */
  isRetryable(): boolean {
    return this.isRateLimited() || 
           this.code === ErrorCodes.INTERNAL_SERVICE_UNAVAILABLE ||
           this.httpStatus === 503 ||
           this.httpStatus === 502;
  }

  /**
   * Get suggested retry delay in milliseconds
   */
  getRetryDelay(): number | null {
    if (!this.isRetryable()) return null;
    
    // Check for Retry-After in details
    if (this.details?.retryAfter) {
      return Number(this.details.retryAfter) * 1000;
    }
    
    // Default backoff
    return this.isRateLimited() ? 5000 : 1000;
  }

  /**
   * Convert to JSON for logging
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      httpStatus: this.httpStatus,
      details: this.details,
      requestId: this.requestId,
      timestamp: this.timestamp,
    };
  }
}

