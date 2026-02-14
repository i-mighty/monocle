/**
 * Secure Error Utilities
 * 
 * Prevents information disclosure by sanitizing error messages
 * before sending them to clients.
 */

import crypto from "crypto";

// =============================================================================
// ERROR SANITIZATION
// =============================================================================

// Patterns that indicate internal/sensitive information
const SENSITIVE_PATTERNS = [
  /stack\s*:/i,
  /at\s+\S+\s*\(/i, // Stack trace lines
  /node_modules/i,
  /\/home\//i,
  /\/root\//i,
  /c:\\users\\/i,
  /password/i,
  /secret/i,
  /private.*key/i,
  /api.*key/i,
  /token/i,
  /credential/i,
  /connection.*string/i,
  /database.*url/i,
  /postgres.*:\/\//i,
  /mysql.*:\/\//i,
  /mongodb.*:\/\//i,
  /redis.*:\/\//i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /getaddrinfo/i,
];

// Safe error messages to expose
const SAFE_ERROR_MESSAGES: { [key: string]: string } = {
  // Database errors
  "relation.*does not exist": "Database error occurred",
  "duplicate key": "Resource already exists",
  "violates foreign key": "Referenced resource not found",
  "violates check constraint": "Invalid data provided",
  "null value in column": "Missing required field",
  "connection refused": "Service temporarily unavailable",
  "connection timeout": "Service temporarily unavailable",
  
  // Auth errors  
  "invalid api key": "Authentication failed",
  "api key required": "Authentication required",
  "unauthorized": "Access denied",
  "forbidden": "Access denied",
  
  // Validation errors
  "validation failed": "Invalid request data",
  "invalid.*format": "Invalid data format",
  "required field": "Missing required field",
  "must be.*number": "Invalid data type",
  "must be.*string": "Invalid data type",
  
  // Not found
  "not found": "Resource not found",
  "does not exist": "Resource not found",
  
  // Rate limiting
  "rate limit": "Too many requests",
  "quota exceeded": "Quota exceeded",
};

/**
 * Generate a unique error reference ID for logging correlation
 */
export function generateErrorRefId(): string {
  return `ERR-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Check if an error message contains sensitive information
 */
function containsSensitiveInfo(message: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }
  return false;
}

/**
 * Get a safe user-facing message for an error
 */
function getSafeMessage(originalMessage: string): string | null {
  const lowerMessage = originalMessage.toLowerCase();
  
  for (const [pattern, safeMessage] of Object.entries(SAFE_ERROR_MESSAGES)) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(lowerMessage)) {
      return safeMessage;
    }
  }
  
  return null;
}

/**
 * Sanitize an error message for client response
 * 
 * @param error - The original error
 * @param refId - Optional error reference ID for logging correlation
 * @returns Sanitized error message safe for client exposure
 */
export function sanitizeErrorMessage(
  error: Error | string | unknown,
  refId?: string
): string {
  // Get the message
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = "Unknown error";
  }

  // Check for safe known message patterns
  const safeMessage = getSafeMessage(message);
  if (safeMessage) {
    return refId ? `${safeMessage} (ref: ${refId})` : safeMessage;
  }

  // If message contains sensitive info, return generic message
  if (containsSensitiveInfo(message)) {
    const generic = "An internal error occurred";
    return refId ? `${generic} (ref: ${refId})` : generic;
  }

  // For short, simple messages without obvious sensitive info, allow through
  // but truncate to prevent large error dumps
  if (message.length <= 100 && !message.includes("\n")) {
    return message;
  }

  // Default to generic message for long/complex errors
  const generic = "An error occurred while processing your request";
  return refId ? `${generic} (ref: ${refId})` : generic;
}

/**
 * Create a sanitized error response object
 */
export function createSafeErrorResponse(
  error: Error | string | unknown,
  statusCode: number = 500,
  additionalInfo?: Record<string, unknown>
): {
  success: false;
  error: string;
  statusCode: number;
  refId: string;
  [key: string]: unknown;
} {
  const refId = generateErrorRefId();
  const message = sanitizeErrorMessage(error, refId);

  // Log the full error internally (you should have proper logging here)
  console.error(`[${refId}]`, error);

  return {
    success: false,
    error: message,
    statusCode,
    refId,
    ...additionalInfo,
  };
}

/**
 * Determine appropriate HTTP status code from error
 */
export function getErrorStatusCode(error: Error | string | unknown): number {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    if (message.includes("not found") || message.includes("does not exist")) {
      return 404;
    }
    if (message.includes("unauthorized") || message.includes("invalid api key") || message.includes("authentication")) {
      return 401;
    }
    if (message.includes("forbidden") || message.includes("access denied") || message.includes("permission")) {
      return 403;
    }
    if (message.includes("insufficient") && message.includes("balance")) {
      return 402;
    }
    if (message.includes("validation") || message.includes("invalid") || message.includes("required")) {
      return 400;
    }
    if (message.includes("rate limit") || message.includes("too many")) {
      return 429;
    }
    if (message.includes("conflict") || message.includes("already exists")) {
      return 409;
    }
  }
  
  return 500;
}

export default {
  sanitizeErrorMessage,
  createSafeErrorResponse,
  getErrorStatusCode,
  generateErrorRefId,
};
