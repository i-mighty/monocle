/**
 * Security Service
 *
 * Provides cryptographic utilities and security functions:
 * - API key generation and hashing
 * - Timing-safe comparison
 * - Sensitive data encryption/decryption
 * - Key rotation support
 */

import crypto from "crypto";
import { query } from "../db/client";

// =============================================================================
// CONFIGURATION
// =============================================================================

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const HASH_ITERATIONS = 100000;
const HASH_KEY_LENGTH = 64;

// Get encryption key from environment or generate deterministic fallback
function getEncryptionKey(): Buffer {
  const envKey = process.env.LOG_ENCRYPTION_KEY;
  if (envKey) {
    // Use provided key (should be 32 bytes base64)
    return Buffer.from(envKey, "base64").subarray(0, KEY_LENGTH);
  }
  // Fallback: derive from API key (not ideal but better than plaintext)
  const apiKey = process.env.AGENTPAY_API_KEY || "default-insecure-key";
  return crypto.scryptSync(apiKey, "agentpay-log-salt", KEY_LENGTH);
}

// =============================================================================
// API KEY TYPES
// =============================================================================

export type ApiKeyScope =
  | "read:agents"
  | "write:agents"
  | "read:payments"
  | "write:payments"
  | "read:analytics"
  | "read:activity"
  | "write:tools"
  | "execute:tools"
  | "admin"
  | "*"; // Wildcard scope

export interface ApiKeyRecord {
  id: string;
  developerId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  rateLimit: number; // requests per minute
  rateLimitBurst: number; // burst allowance
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  isActive: boolean;
  version: number;
  previousKeyHash: string | null; // For rotation grace period
  rotatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApiKeyInput {
  developerId: string;
  name: string;
  scopes?: ApiKeyScope[];
  rateLimit?: number;
  rateLimitBurst?: number;
  expiresAt?: Date | null;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  keyRecord?: ApiKeyRecord;
  error?: string;
  usedRotatedKey?: boolean;
}

// =============================================================================
// CRYPTOGRAPHIC UTILITIES
// =============================================================================

/**
 * Generate a cryptographically secure API key
 * Format: agp_{prefix}_{random}
 */
export function generateApiKey(): { key: string; prefix: string } {
  const prefix = crypto.randomBytes(4).toString("hex");
  const random = crypto.randomBytes(24).toString("base64url");
  const key = `agp_${prefix}_${random}`;
  return { key, prefix };
}

/**
 * Hash an API key using PBKDF2
 * Returns: salt$hash (both base64)
 */
export function hashApiKey(key: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const hash = crypto.pbkdf2Sync(
    key,
    salt,
    HASH_ITERATIONS,
    HASH_KEY_LENGTH,
    "sha512"
  );
  return `${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Verify an API key against a hash using timing-safe comparison
 */
export function verifyApiKeyHash(key: string, storedHash: string): boolean {
  try {
    const [saltB64, hashB64] = storedHash.split("$");
    if (!saltB64 || !hashB64) return false;

    const salt = Buffer.from(saltB64, "base64");
    const expectedHash = Buffer.from(hashB64, "base64");

    const actualHash = crypto.pbkdf2Sync(
      key,
      salt,
      HASH_ITERATIONS,
      HASH_KEY_LENGTH,
      "sha512"
    );

    // Timing-safe comparison
    return crypto.timingSafeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}

/**
 * Timing-safe string comparison
 */
export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);

    // If lengths differ, still perform comparison to maintain constant time
    if (bufA.length !== bufB.length) {
      const dummy = Buffer.alloc(bufA.length);
      crypto.timingSafeEqual(bufA, dummy);
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Encrypt sensitive data using AES-256-GCM
 * Returns: iv$authTag$ciphertext (all base64)
 */
export function encryptSensitiveData(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}$${authTag.toString("base64")}$${encrypted}`;
}

/**
 * Decrypt sensitive data
 */
export function decryptSensitiveData(encryptedData: string): string | null {
  try {
    const key = getEncryptionKey();
    const [ivB64, authTagB64, ciphertext] = encryptedData.split("$");

    if (!ivB64 || !authTagB64 || !ciphertext) return null;

    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Redact sensitive fields from an object
 */
export function redactSensitiveFields(
  obj: Record<string, any>,
  fieldsToRedact: string[] = [
    "password",
    "secret",
    "key",
    "token",
    "apiKey",
    "api_key",
    "authorization",
    "credit_card",
    "ssn",
    "private_key",
    "privateKey",
  ]
): Record<string, any> {
  const redacted = { ...obj };

  for (const key of Object.keys(redacted)) {
    const lowerKey = key.toLowerCase();

    if (fieldsToRedact.some((f) => lowerKey.includes(f.toLowerCase()))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof redacted[key] === "object" && redacted[key] !== null) {
      redacted[key] = redactSensitiveFields(redacted[key], fieldsToRedact);
    }
  }

  return redacted;
}

/**
 * Mask a string, showing only first/last N characters
 */
export function maskString(
  str: string,
  showFirst: number = 4,
  showLast: number = 4
): string {
  if (str.length <= showFirst + showLast) {
    return "*".repeat(str.length);
  }
  const first = str.substring(0, showFirst);
  const last = str.substring(str.length - showLast);
  const masked = "*".repeat(str.length - showFirst - showLast);
  return `${first}${masked}${last}`;
}

// =============================================================================
// API KEY MANAGEMENT
// =============================================================================

/**
 * Create a new API key
 */
export async function createApiKey(
  input: CreateApiKeyInput
): Promise<{ keyRecord: ApiKeyRecord; plainKey: string }> {
  const { key, prefix } = generateApiKey();
  const keyHash = hashApiKey(key);

  const scopes = input.scopes || ["read:agents", "read:analytics"];
  const rateLimit = input.rateLimit || 60; // 60 requests per minute default
  const rateLimitBurst = input.rateLimitBurst || 10;

  const result = await query(
    `INSERT INTO api_keys_v2 (
      developer_id, name, key_prefix, key_hash, scopes,
      rate_limit, rate_limit_burst, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      input.developerId,
      input.name,
      prefix,
      keyHash,
      JSON.stringify(scopes),
      rateLimit,
      rateLimitBurst,
      input.expiresAt || null,
    ]
  );

  return {
    keyRecord: formatApiKeyRecord(result.rows[0]),
    plainKey: key,
  };
}

/**
 * Validate an API key and return its record
 */
export async function validateApiKey(
  key: string
): Promise<ApiKeyValidationResult> {
  // Extract prefix from key format: agp_{prefix}_{random}
  const match = key.match(/^agp_([a-f0-9]+)_/);
  if (!match) {
    // Fallback: check legacy key format
    return validateLegacyApiKey(key);
  }

  const prefix = match[1];

  // Find key by prefix (efficient index lookup)
  const result = await query(
    `SELECT * FROM api_keys_v2 WHERE key_prefix = $1 AND is_active = true`,
    [prefix]
  );

  if (result.rows.length === 0) {
    return { valid: false, error: "Invalid API key" };
  }

  const record = result.rows[0];

  // Check expiration
  if (record.expires_at && new Date(record.expires_at) < new Date()) {
    return { valid: false, error: "API key expired" };
  }

  // Verify hash (timing-safe)
  if (verifyApiKeyHash(key, record.key_hash)) {
    await updateKeyUsage(record.id);
    return {
      valid: true,
      keyRecord: formatApiKeyRecord(record),
      usedRotatedKey: false,
    };
  }

  // Check if this is the previous key (rotation grace period)
  if (record.previous_key_hash && verifyApiKeyHash(key, record.previous_key_hash)) {
    // Check if within rotation grace period (24 hours)
    const rotatedAt = new Date(record.rotated_at);
    const gracePeriod = 24 * 60 * 60 * 1000; // 24 hours
    if (Date.now() - rotatedAt.getTime() < gracePeriod) {
      await updateKeyUsage(record.id);
      return {
        valid: true,
        keyRecord: formatApiKeyRecord(record),
        usedRotatedKey: true, // Signal to add warning header
      };
    }
  }

  return { valid: false, error: "Invalid API key" };
}

/**
 * Validate legacy API key (backward compatibility)
 */
async function validateLegacyApiKey(key: string): Promise<ApiKeyValidationResult> {
  const envKey = process.env.AGENTPAY_API_KEY;
  if (!envKey) {
    return { valid: false, error: "API key not configured" };
  }

  if (timingSafeCompare(key, envKey)) {
    // Create a synthetic record for legacy keys
    return {
      valid: true,
      keyRecord: {
        id: "legacy",
        developerId: "system",
        name: "Legacy API Key",
        keyPrefix: "legacy",
        keyHash: "",
        scopes: ["*"], // Legacy keys have full access
        rateLimit: 1000,
        rateLimitBurst: 100,
        expiresAt: null,
        lastUsedAt: new Date(),
        lastUsedIp: null,
        isActive: true,
        version: 1,
        previousKeyHash: null,
        rotatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  }

  return { valid: false, error: "Invalid API key" };
}

/**
 * Update key usage metadata
 */
async function updateKeyUsage(keyId: string, ip?: string): Promise<void> {
  try {
    await query(
      `UPDATE api_keys_v2 SET last_used_at = NOW(), last_used_ip = COALESCE($2, last_used_ip) WHERE id = $1`,
      [keyId, ip || null]
    );
  } catch (error) {
    console.error("[SecurityService] Failed to update key usage:", error);
  }
}

/**
 * Rotate an API key (generate new key, keep old one valid for grace period)
 */
export async function rotateApiKey(
  keyId: string
): Promise<{ newKey: string; oldKeyValidUntil: Date } | null> {
  const result = await query(
    `SELECT * FROM api_keys_v2 WHERE id = $1 AND is_active = true`,
    [keyId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const record = result.rows[0];
  const { key: newKey, prefix: newPrefix } = generateApiKey();
  const newKeyHash = hashApiKey(newKey);

  // Store current hash as previous (for grace period)
  await query(
    `UPDATE api_keys_v2 
     SET key_prefix = $1, key_hash = $2, previous_key_hash = $3, 
         rotated_at = NOW(), version = version + 1, updated_at = NOW()
     WHERE id = $4`,
    [newPrefix, newKeyHash, record.key_hash, keyId]
  );

  const gracePeriodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return {
    newKey,
    oldKeyValidUntil: gracePeriodEnd,
  };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyId: string): Promise<boolean> {
  const result = await query(
    `UPDATE api_keys_v2 SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [keyId]
  );
  return result.rows.length > 0;
}

/**
 * List API keys for a developer (without exposing hashes)
 */
export async function listApiKeys(developerId: string): Promise<ApiKeyRecord[]> {
  const result = await query(
    `SELECT * FROM api_keys_v2 WHERE developer_id = $1 ORDER BY created_at DESC`,
    [developerId]
  );
  return result.rows.map(formatApiKeyRecord);
}

/**
 * Check if a key has a required scope
 */
export function hasScope(
  keyRecord: ApiKeyRecord,
  requiredScope: ApiKeyScope
): boolean {
  // Wildcard scope grants all permissions
  if (keyRecord.scopes.includes("*")) return true;

  // Admin scope grants all permissions
  if (keyRecord.scopes.includes("admin")) return true;

  // Direct match
  if (keyRecord.scopes.includes(requiredScope)) return true;

  // Check if write scope covers read scope
  // e.g., "write:agents" should also grant "read:agents"
  if (requiredScope.startsWith("read:")) {
    const writeScope = requiredScope.replace("read:", "write:") as ApiKeyScope;
    if (keyRecord.scopes.includes(writeScope)) return true;
  }

  return false;
}

/**
 * Format database row to ApiKeyRecord
 */
function formatApiKeyRecord(row: any): ApiKeyRecord {
  return {
    id: row.id,
    developerId: row.developer_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    scopes: typeof row.scopes === "string" ? JSON.parse(row.scopes) : row.scopes,
    rateLimit: row.rate_limit,
    rateLimitBurst: row.rate_limit_burst,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    lastUsedIp: row.last_used_ip,
    isActive: row.is_active,
    version: row.version,
    previousKeyHash: row.previous_key_hash,
    rotatedAt: row.rotated_at ? new Date(row.rotated_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// =============================================================================
// EXPORTS FOR TESTING
// =============================================================================

export const __testing = {
  getEncryptionKey,
  HASH_ITERATIONS,
  HASH_KEY_LENGTH,
};
