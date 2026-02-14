/**
 * Input Validation Middleware
 * 
 * Provides validation utilities for common input patterns.
 * Prevents injection attacks and ensures data integrity.
 */

// =============================================================================
// VALIDATION PATTERNS
// =============================================================================

// Agent ID: alphanumeric, underscores, hyphens (3-64 chars)
const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;

// Tool name: alphanumeric, underscores, hyphens, dots (1-128 chars)
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_.-]{1,128}$/;

// UUID v4 pattern
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Wallet address (Solana base58: 32-44 chars)
const SOLANA_WALLET_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// API key prefix pattern
const API_KEY_PREFIX_PATTERN = /^[a-zA-Z0-9]{8,}$/;

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string | number;
}

/**
 * Validate and sanitize an agent ID
 */
export function validateAgentId(value: unknown): ValidationResult {
  if (typeof value !== "string") {
    return { valid: false, error: "Agent ID must be a string" };
  }
  
  const trimmed = value.trim();
  
  if (trimmed.length < 3) {
    return { valid: false, error: "Agent ID must be at least 3 characters" };
  }
  
  if (trimmed.length > 64) {
    return { valid: false, error: "Agent ID must be at most 64 characters" };
  }
  
  if (!AGENT_ID_PATTERN.test(trimmed)) {
    return { 
      valid: false, 
      error: "Agent ID can only contain letters, numbers, underscores, and hyphens" 
    };
  }
  
  return { valid: true, sanitized: trimmed };
}

/**
 * Validate and sanitize a tool name
 */
export function validateToolName(value: unknown): ValidationResult {
  if (typeof value !== "string") {
    return { valid: false, error: "Tool name must be a string" };
  }
  
  const trimmed = value.trim();
  
  if (trimmed.length < 1) {
    return { valid: false, error: "Tool name cannot be empty" };
  }
  
  if (trimmed.length > 128) {
    return { valid: false, error: "Tool name must be at most 128 characters" };
  }
  
  if (!TOOL_NAME_PATTERN.test(trimmed)) {
    return { 
      valid: false, 
      error: "Tool name can only contain letters, numbers, underscores, hyphens, and dots" 
    };
  }
  
  return { valid: true, sanitized: trimmed };
}

/**
 * Validate and sanitize a positive integer (for tokens, amounts, etc.)
 */
export function validatePositiveInteger(
  value: unknown, 
  fieldName: string,
  options?: { min?: number; max?: number }
): ValidationResult {
  const num = Number(value);
  
  if (value === undefined || value === null || value === "") {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a number` };
  }
  
  if (!Number.isInteger(num)) {
    return { valid: false, error: `${fieldName} must be an integer` };
  }
  
  if (num < 0) {
    return { valid: false, error: `${fieldName} cannot be negative` };
  }
  
  if (options?.min !== undefined && num < options.min) {
    return { valid: false, error: `${fieldName} must be at least ${options.min}` };
  }
  
  if (options?.max !== undefined && num > options.max) {
    return { valid: false, error: `${fieldName} cannot exceed ${options.max}` };
  }
  
  return { valid: true, sanitized: num };
}

/**
 * Validate and sanitize a non-negative number (for rates, etc.)
 */
export function validateNonNegativeNumber(
  value: unknown,
  fieldName: string,
  options?: { min?: number; max?: number }
): ValidationResult {
  const num = Number(value);
  
  if (value === undefined || value === null || value === "") {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  if (isNaN(num)) {
    return { valid: false, error: `${fieldName} must be a number` };
  }
  
  if (!isFinite(num)) {
    return { valid: false, error: `${fieldName} must be a finite number` };
  }
  
  if (num < 0) {
    return { valid: false, error: `${fieldName} cannot be negative` };
  }
  
  if (options?.min !== undefined && num < options.min) {
    return { valid: false, error: `${fieldName} must be at least ${options.min}` };
  }
  
  if (options?.max !== undefined && num > options.max) {
    return { valid: false, error: `${fieldName} cannot exceed ${options.max}` };
  }
  
  return { valid: true, sanitized: num };
}

/**
 * Validate a UUID
 */
export function validateUUID(value: unknown, fieldName: string): ValidationResult {
  if (typeof value !== "string") {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  
  const trimmed = value.trim().toLowerCase();
  
  if (!UUID_PATTERN.test(trimmed)) {
    return { valid: false, error: `${fieldName} must be a valid UUID` };
  }
  
  return { valid: true, sanitized: trimmed };
}

/**
 * Validate a Solana wallet address
 */
export function validateWalletAddress(value: unknown): ValidationResult {
  if (typeof value !== "string") {
    return { valid: false, error: "Wallet address must be a string" };
  }
  
  const trimmed = value.trim();
  
  if (!SOLANA_WALLET_PATTERN.test(trimmed)) {
    return { valid: false, error: "Invalid Solana wallet address format" };
  }
  
  return { valid: true, sanitized: trimmed };
}

/**
 * Validate a pagination limit
 */
export function validateLimit(
  value: unknown,
  defaultValue: number = 50,
  maxValue: number = 1000
): number {
  const num = Number(value);
  
  if (isNaN(num) || num <= 0) {
    return defaultValue;
  }
  
  return Math.min(Math.floor(num), maxValue);
}

/**
 * Validate and sanitize a string field
 */
export function validateString(
  value: unknown,
  fieldName: string,
  options?: { minLength?: number; maxLength?: number; pattern?: RegExp }
): ValidationResult {
  if (value === undefined || value === null) {
    return { valid: false, error: `${fieldName} is required` };
  }
  
  if (typeof value !== "string") {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  
  const trimmed = value.trim();
  
  if (options?.minLength !== undefined && trimmed.length < options.minLength) {
    return { 
      valid: false, 
      error: `${fieldName} must be at least ${options.minLength} characters` 
    };
  }
  
  if (options?.maxLength !== undefined && trimmed.length > options.maxLength) {
    return { 
      valid: false, 
      error: `${fieldName} must be at most ${options.maxLength} characters` 
    };
  }
  
  if (options?.pattern && !options.pattern.test(trimmed)) {
    return { valid: false, error: `${fieldName} has an invalid format` };
  }
  
  return { valid: true, sanitized: trimmed };
}

/**
 * Validate an enum value
 */
export function validateEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[]
): ValidationResult & { sanitized?: T } {
  if (typeof value !== "string") {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  
  const normalized = value.trim().toLowerCase() as T;
  
  if (!allowedValues.includes(normalized)) {
    return { 
      valid: false, 
      error: `${fieldName} must be one of: ${allowedValues.join(", ")}` 
    };
  }
  
  return { valid: true, sanitized: normalized };
}

/**
 * Sanitize a string for safe logging (remove potential injection)
 */
export function sanitizeForLogging(value: unknown, maxLength: number = 200): string {
  if (value === undefined || value === null) {
    return "[null]";
  }
  
  const str = typeof value === "string" ? value : String(value);
  
  // Remove control characters except newlines and tabs
  const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  
  // Truncate if too long
  if (cleaned.length > maxLength) {
    return cleaned.substring(0, maxLength) + "...[truncated]";
  }
  
  return cleaned;
}

export default {
  validateAgentId,
  validateToolName,
  validatePositiveInteger,
  validateNonNegativeNumber,
  validateUUID,
  validateWalletAddress,
  validateLimit,
  validateString,
  validateEnum,
  sanitizeForLogging,
};
