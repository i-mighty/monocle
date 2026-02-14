import { ErrorCode, ErrorCodes, ErrorHttpStatus, ErrorMessages } from "./codes";

/**
 * Standardized API Error Response Structure
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, any>;
    timestamp: string;
    requestId?: string;
  };
}

/**
 * Custom Application Error class for structured error handling
 * 
 * @example
 * throw new AppError("AGENT_NOT_FOUND", { agentId: "agent-123" });
 * throw new AppError("VALIDATION_REQUIRED_FIELD", { field: "amount" }, "Amount is required for this operation");
 * throw AppError.validation("amount", "must be a positive number");
 * throw AppError.notFound("Agent", agentId);
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: Record<string, any>;
  public readonly isOperational: boolean;

  constructor(
    code: ErrorCode,
    details?: Record<string, any>,
    customMessage?: string
  ) {
    const message = customMessage || ErrorMessages[code] || "Unknown error";
    super(message);
    
    this.code = code;
    this.httpStatus = ErrorHttpStatus[code] || 500;
    this.details = details;
    this.isOperational = true; // Distinguishes from programming errors
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Convert to API response format
   */
  toResponse(requestId?: string): ApiErrorResponse {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        timestamp: new Date().toISOString(),
        requestId,
      },
    };
  }

  // ==================== Factory Methods ====================

  /**
   * Create a validation error
   */
  static validation(field: string, reason: string): AppError {
    return new AppError(
      ErrorCodes.VALIDATION_REQUIRED_FIELD,
      { field, reason },
      `Validation failed for '${field}': ${reason}`
    );
  }

  /**
   * Create a "required field" error
   */
  static required(field: string): AppError {
    return new AppError(
      ErrorCodes.VALIDATION_REQUIRED_FIELD,
      { field },
      `${field} is required`
    );
  }

  /**
   * Create a "not found" error
   */
  static notFound(resource: string, id?: string): AppError {
    const details: Record<string, any> = { resource };
    if (id) details.id = id;
    return new AppError(
      ErrorCodes.AGENT_NOT_FOUND,
      details,
      id ? `${resource} not found: ${id}` : `${resource} not found`
    );
  }

  /**
   * Create an "agent not found" error
   */
  static agentNotFound(agentId: string): AppError {
    return new AppError(
      ErrorCodes.AGENT_NOT_FOUND,
      { agentId },
      `Agent not found: ${agentId}`
    );
  }

  /**
   * Create an "insufficient funds" error
   */
  static insufficientFunds(required: number, available: number, currency = "lamports"): AppError {
    return new AppError(
      ErrorCodes.PAYMENT_INSUFFICIENT_FUNDS,
      { required, available, currency, shortfall: required - available },
      `Insufficient funds: need ${required} ${currency}, have ${available}`
    );
  }

  /**
   * Create a "budget exceeded" error
   */
  static budgetExceeded(limit: number, attempted: number, limitType: string): AppError {
    return new AppError(
      ErrorCodes.BUDGET_EXCEEDED,
      { limit, attempted, limitType, excess: attempted - limit },
      `Budget exceeded: ${limitType} limit is ${limit}, attempted ${attempted}`
    );
  }

  /**
   * Create a "daily limit exceeded" error
   */
  static dailyLimitExceeded(limit: number, spent: number): AppError {
    return new AppError(
      ErrorCodes.BUDGET_DAILY_LIMIT_EXCEEDED,
      { dailyLimit: limit, spentToday: spent, remaining: limit - spent },
      `Daily spending limit exceeded: limit is ${limit}, already spent ${spent}`
    );
  }

  /**
   * Create a "spending paused" error
   */
  static spendingPaused(agentId: string, reason?: string): AppError {
    return new AppError(
      ErrorCodes.BUDGET_SPENDING_PAUSED,
      { agentId, reason },
      reason ? `Spending paused for ${agentId}: ${reason}` : `Spending is paused for ${agentId}`
    );
  }

  /**
   * Create an "unauthorized" error
   */
  static unauthorized(reason?: string): AppError {
    return new AppError(
      ErrorCodes.AUTH_UNAUTHORIZED,
      reason ? { reason } : undefined,
      reason || "Authentication required"
    );
  }

  /**
   * Create a "payment required" error
   */
  static paymentRequired(amount: number, recipient: string, details?: Record<string, any>): AppError {
    return new AppError(
      ErrorCodes.PAYMENT_REQUIRED,
      { amount, recipient, ...details },
      `Payment of ${amount} lamports required to ${recipient}`
    );
  }

  /**
   * Create an "internal error" error
   */
  static internal(reason?: string, details?: Record<string, any>): AppError {
    return new AppError(
      ErrorCodes.INTERNAL_ERROR,
      details,
      reason || "An internal error occurred"
    );
  }

  /**
   * Create a "database error" error
   */
  static database(operation: string, details?: Record<string, any>): AppError {
    return new AppError(
      ErrorCodes.INTERNAL_DATABASE_ERROR,
      { operation, ...details },
      `Database error during ${operation}`
    );
  }

  /**
   * Create a "rate limit exceeded" error
   */
  static rateLimited(limit: number, window: string, retryAfter?: number): AppError {
    return new AppError(
      ErrorCodes.RATE_LIMIT_EXCEEDED,
      { limit, window, retryAfter },
      `Rate limit exceeded: ${limit} requests per ${window}`
    );
  }

  /**
   * Create an "invalid amount" error
   */
  static invalidAmount(amount: any, reason: string): AppError {
    return new AppError(
      ErrorCodes.PAYMENT_INVALID_AMOUNT,
      { amount, reason },
      `Invalid amount: ${reason}`
    );
  }

  /**
   * Create a "reservation not found" error
   */
  static reservationNotFound(reservationId: string): AppError {
    return new AppError(
      ErrorCodes.BUDGET_RESERVATION_NOT_FOUND,
      { reservationId },
      `Reservation not found: ${reservationId}`
    );
  }

  /**
   * Create a "quote expired" error
   */
  static quoteExpired(quoteId: string, expiredAt: string): AppError {
    return new AppError(
      ErrorCodes.PRICING_QUOTE_EXPIRED,
      { quoteId, expiredAt },
      `Price quote ${quoteId} expired at ${expiredAt}`
    );
  }

  /**
   * Create from any error (wraps non-AppError)
   */
  static from(error: any): AppError {
    if (error instanceof AppError) {
      return error;
    }
    
    // Handle known error patterns
    if (error?.code === "ECONNREFUSED") {
      return new AppError(
        ErrorCodes.INTERNAL_SERVICE_UNAVAILABLE,
        { originalError: error.message }
      );
    }
    
    if (error?.code === "ENOTFOUND") {
      return new AppError(
        ErrorCodes.INTERNAL_NETWORK_ERROR,
        { originalError: error.message }
      );
    }
    
    // Generic internal error
    return new AppError(
      ErrorCodes.INTERNAL_ERROR,
      { originalError: error?.message || String(error) }
    );
  }
}

export default AppError;
