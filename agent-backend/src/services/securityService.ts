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

// Track if we've warned about insecure configuration
let insecureKeyWarningIssued = false;

// Get encryption key from environment or generate deterministic fallback
function getEncryptionKey(): Buffer {
  const envKey = process.env.LOG_ENCRYPTION_KEY;
  if (envKey) {
    // Use provided key (should be 32 bytes base64)
    return Buffer.from(envKey, "base64").subarray(0, KEY_LENGTH);
  }
  
  // Check environment - in production, require explicit key
  const nodeEnv = process.env.NODE_ENV || "development";
  if (nodeEnv === "production") {
    console.error("CRITICAL SECURITY ERROR: LOG_ENCRYPTION_KEY is required in production!");
    console.error("Generate a secure key with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"");
    throw new Error("Missing LOG_ENCRYPTION_KEY in production - aborting for security");
  }
  
  // Development/test fallback: derive from API key with warning
  const apiKey = process.env.AGENTPAY_API_KEY;
  if (!apiKey) {
    console.error("CRITICAL SECURITY ERROR: Neither LOG_ENCRYPTION_KEY nor AGENTPAY_API_KEY is set!");
    throw new Error("Missing encryption keys - aborting for security");
  }
  
  // Issue a warning once about insecure configuration
  if (!insecureKeyWarningIssued) {
    console.warn("[SECURITY WARNING] Using derived encryption key from AGENTPAY_API_KEY.");
    console.warn("For production, set LOG_ENCRYPTION_KEY environment variable.");
    insecureKeyWarningIssued = true;
  }
  
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
  /**
   * The agent this key acts as, or null for platform/developer keys.
   *
   * This is the field the whole authorization model hangs off: a key with an
   * agentId may only act as that agent, so `callerId` in a request body stops
   * being an unverified claim. routes/agents.ts has always read
   * `apiKeyRecord?.agentId` to enforce "you can only withdraw from your own
   * agent account" — the field never existed, so that check silently never fired.
   *
   * null means "not scoped to an agent", which is deliberately NOT the same as
   * "may act as any agent". Money routes require a non-null agentId; see
   * requireOwnAgent.
   */
  agentId: string | null;
  /**
   * The user this key belongs to, or null for agent/platform keys.
   *
   * Set for developer keys (`Mon_...`), which are issued to a human once their
   * email is verified. Like agentId, a non-null userId narrows what the key may
   * do rather than widening it: it identifies whose key this is, and is NOT a
   * grant to act as any agent that user happens to own. Money routes still
   * require agentId (see requireOwnAgent), which a developer key never has.
   */
  userId: string | null;
  developerId: string | null;
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
/**
 * sha256 of an agent key, matching how routes/agents.ts hashes it at mint time.
 * Agent keys are never stored in plaintext — only this digest.
 */
export function hashAgentKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Validate an agent-scoped key (`mk_...`) against api_keys.key_hash.
 *
 * These keys are minted by POST /agents/register/public and handed to the agent's
 * operator. Until now nothing validated them: validateApiKey only recognised the
 * `agp_` prefix and everything else fell through to the single env platform key,
 * so an agent's own key authenticated as nobody and was rejected.
 *
 * Lookup is by digest, so the plaintext key never has to be stored or compared.
 */
async function validateAgentKey(key: string): Promise<ApiKeyValidationResult> {
  const result = await query(
    `SELECT id, agent_id, developer_id, name, scopes, is_active, created_at, revoked_at
     FROM api_keys
     WHERE key_hash = $1`,
    [hashAgentKey(key)]
  );
  if (result.rows.length === 0) return { valid: false, error: "Invalid API key" };

  const row = result.rows[0];
  if (row.is_active === false || row.revoked_at) {
    return { valid: false, error: "API key revoked" };
  }

  let scopes: ApiKeyScope[] = ["read:own", "write:own"] as unknown as ApiKeyScope[];
  try {
    if (row.scopes) scopes = JSON.parse(row.scopes);
  } catch {
    /* malformed scopes fall back to the least-privilege default above */
  }

  return {
    valid: true,
    keyRecord: {
      id: row.id,
      agentId: row.agent_id ?? null,
      userId: null,
      developerId: row.developer_id ?? null,
      name: row.name ?? "Agent Key",
      keyPrefix: key.slice(0, 8),
      keyHash: "",
      scopes,
      rateLimit: 60,
      rateLimitBurst: 10,
      expiresAt: null,
      lastUsedAt: row.last_used_at ?? null,
      lastUsedIp: null,
      isActive: true,
      version: 1,
      previousKeyHash: null,
      rotatedAt: null,
      createdAt: row.created_at ?? new Date(),
      updatedAt: new Date(),
    },
  };
}

// =============================================================================
// DEVELOPER KEYS (`Mon_...`)
// =============================================================================

/** Prefix for developer-facing keys. Distinct from `mk_` (agent) and `agp_` (v2). */
export const DEVELOPER_KEY_PREFIX = "Mon_";

/**
 * Scopes a developer key carries by default.
 *
 * Read access plus agent registration — enough for a signed-in developer to run
 * the dashboard and register agents they own. Deliberately excludes write:payments:
 * moving money requires an agent-scoped key, and granting it here would be
 * meaningless anyway since requireOwnAgent rejects a key with no agentId.
 */
export const DEFAULT_DEVELOPER_SCOPES: ApiKeyScope[] = [
  "read:agents",
  "read:analytics",
  "read:activity",
  "read:payments",
  "write:agents",
];

/**
 * Generate a developer key: `Mon_` + 32 cryptographically random bytes, base64url.
 *
 * base64url so the key is safe in headers, query strings and env files without
 * escaping. 32 bytes (~256 bits) puts it far beyond brute force, which is what
 * makes the unsalted sha256 below an acceptable way to store it.
 */
export function generateDeveloperKey(): string {
  return `${DEVELOPER_KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

/**
 * Mint a developer key for a user and store ONLY its digest.
 *
 * Uses hashAgentKey (sha256), the same one-way storage the agent keys use, rather
 * than the reversible encryption or the PBKDF2 prefix-lookup scheme in
 * api_keys_v2. Two reasons: lookup is a single indexed probe on the digest, and
 * there is deliberately no path from a stored row back to the key — which is why
 * the dashboard offers "Regenerate" and not "Reveal".
 *
 * The caller is handed the plaintext exactly once and must show it immediately;
 * it cannot be recovered afterwards.
 *
 * `name` and `scopes` are persisted per-key so issuing a developer several named
 * keys later needs no migration, even though today everyone gets one "Default".
 */
export async function createDeveloperKey(input: {
  userId: string;
  name?: string;
  scopes?: ApiKeyScope[];
}): Promise<{ plainKey: string; id: string; name: string; scopes: ApiKeyScope[]; createdAt: Date }> {
  const plainKey = generateDeveloperKey();
  const name = input.name?.trim() || "Default";
  const scopes = input.scopes ?? DEFAULT_DEVELOPER_SCOPES;

  const result = await query(
    `INSERT INTO api_keys (user_id, key_hash, name, scopes, is_active)
     VALUES ($1, $2, $3, $4, true)
     RETURNING id, name, scopes, created_at`,
    [input.userId, hashAgentKey(plainKey), name, JSON.stringify(scopes)]
  );

  const row = result.rows[0];
  return {
    plainKey,
    id: row.id,
    name: row.name,
    scopes,
    createdAt: row.created_at ?? new Date(),
  };
}

/**
 * Revoke every active developer key for a user. Returns how many were revoked.
 *
 * Rows are kept and marked revoked rather than deleted, so a compromised key
 * leaves a trail. The partial unique index only covers active, unrevoked rows,
 * so this is what makes room for the replacement key.
 */
export async function revokeDeveloperKeysForUser(userId: string): Promise<number> {
  const result = await query(
    `UPDATE api_keys
        SET is_active = false, revoked_at = now()
      WHERE user_id = $1 AND is_active = true AND revoked_at IS NULL`,
    [userId]
  );
  return result.rowCount ?? 0;
}

/**
 * Metadata for a user's active developer key — never the key or its digest.
 *
 * This is what the dashboard is allowed to see: enough to confirm a key exists
 * and when it was issued, with nothing that could reconstruct it.
 */
export async function getDeveloperKeyMetadata(
  userId: string
): Promise<{ id: string; name: string; scopes: ApiKeyScope[]; createdAt: Date; lastUsedAt: Date | null } | null> {
  const result = await query(
    `SELECT id, name, scopes, created_at, last_used_at
       FROM api_keys
      WHERE user_id = $1 AND is_active = true AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name ?? "Default",
    scopes: parseScopes(row.scopes, DEFAULT_DEVELOPER_SCOPES),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
  };
}

/** Parse a JSON-encoded scopes column, falling back when absent or malformed. */
function parseScopes(raw: unknown, fallback: ApiKeyScope[]): ApiKeyScope[] {
  if (!raw) return fallback;
  if (Array.isArray(raw)) return raw as ApiKeyScope[];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? (parsed as ApiKeyScope[]) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Validate a developer key (`Mon_...`) against api_keys.key_hash.
 *
 * Resolves to a record with a userId and — importantly — agentId null, so a
 * developer key authenticates its owner for reads and agent registration but is
 * still refused by requireOwnAgent on every route that moves money. Widening
 * that boundary is a deliberate future decision, not something this lookup
 * should quietly grant.
 */
async function validateDeveloperKey(key: string): Promise<ApiKeyValidationResult> {
  const result = await query(
    `SELECT k.id, k.user_id, k.name, k.scopes, k.is_active, k.revoked_at,
            k.created_at, k.last_used_at
       FROM api_keys k
      WHERE k.key_hash = $1 AND k.user_id IS NOT NULL`,
    [hashAgentKey(key)]
  );
  if (result.rows.length === 0) return { valid: false, error: "Invalid API key" };

  const row = result.rows[0];
  if (row.is_active === false || row.revoked_at) {
    return { valid: false, error: "API key revoked" };
  }

  // Best-effort: a failed usage stamp must never fail the request.
  query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [row.id]).catch(
    (err) => console.error("[SecurityService] developer key usage stamp failed:", err?.message ?? err)
  );

  return {
    valid: true,
    keyRecord: {
      id: row.id,
      agentId: null,
      userId: row.user_id,
      developerId: null,
      name: row.name ?? "Default",
      keyPrefix: DEVELOPER_KEY_PREFIX,
      keyHash: "",
      scopes: parseScopes(row.scopes, DEFAULT_DEVELOPER_SCOPES),
      rateLimit: 60,
      rateLimitBurst: 10,
      expiresAt: null,
      lastUsedAt: row.last_used_at ?? null,
      lastUsedIp: null,
      isActive: true,
      version: 1,
      previousKeyHash: null,
      rotatedAt: null,
      createdAt: row.created_at ?? new Date(),
      updatedAt: new Date(),
    },
  };
}

export async function validateApiKey(
  key: string
): Promise<ApiKeyValidationResult> {
  // Developer key (`Mon_...`): resolves to a user, never to an agent.
  if (key.startsWith(DEVELOPER_KEY_PREFIX)) {
    return validateDeveloperKey(key);
  }

  // Agent-scoped key (`mk_...`): resolves to a specific agent.
  if (key.startsWith("mk_")) {
    return validateAgentKey(key);
  }

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
    // Create a synthetic record for legacy keys.
    //
    // agentId is null: this key is the platform operator, not any particular
    // agent. That is deliberately not the same as "may act as every agent" —
    // money routes require a key that names an agent (see requireOwnAgent), so
    // this key can no longer bill, settle or withdraw on someone else's behalf.
    return {
      valid: true,
      keyRecord: {
        id: "legacy",
        agentId: null,
        userId: null,
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
    // api_keys_v2 rows are developer-scoped, not agent-scoped: they act as a
    // developer, never as a specific agent, so they cannot move an agent's money.
    agentId: row.agent_id ?? null,
    // api_keys_v2 has no user_id: these predate developer keys and belong to the
    // free-text developer_id owner instead.
    userId: null,
    developerId: row.developer_id ?? null,
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
