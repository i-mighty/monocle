/**
 * Admin Authentication Middleware
 *
 * Secures admin/analytics endpoints with:
 * - Admin API key validation (ADMIN_API_KEY env var)
 * - Or session-based auth via admin_users table
 *
 * Usage:
 *   router.get("/admin/stats", adminAuth, handler);
 */

import { Request, Response, NextFunction } from "express";
import { query } from "../db/client";
import * as crypto from "crypto";

// =============================================================================
// TYPES
// =============================================================================

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "super_admin";
}

declare global {
  namespace Express {
    interface Request {
      adminUser?: AdminUser;
    }
  }
}

// =============================================================================
// ADMIN API KEY AUTH (Simple)
// =============================================================================

/**
 * Is this request carrying a valid X-Admin-Key?
 *
 * Predicate form of adminKeyAuth, for handlers that only need admin rights for
 * *part* of a request (e.g. one privileged field) rather than the whole route,
 * where mounting the middleware would lock the entire endpoint.
 *
 * Fails closed: false when ADMIN_API_KEY is unset, so a misconfigured server
 * denies the privileged path rather than opening it. Constant-time comparison.
 */
export function hasValidAdminKey(req: Request): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;

  const provided = req.headers["x-admin-key"];
  if (typeof provided !== "string" || provided.length === 0) return false;

  const expected = Buffer.from(adminKey);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Validate admin access via ADMIN_API_KEY environment variable
 * Header: X-Admin-Key: <key>
 */
export function adminKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const adminKey = process.env.ADMIN_API_KEY;
  
  if (!adminKey) {
    // If no admin key configured, deny all access
    res.status(503).json({
      success: false,
      error: "Admin access not configured"
    });
    return;
  }

  const providedKey = req.headers["x-admin-key"] as string;
  
  if (!providedKey) {
    res.status(401).json({
      success: false,
      error: "Admin authentication required",
      hint: "Provide X-Admin-Key header"
    });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  const keyBuffer = Buffer.from(adminKey);
  const providedBuffer = Buffer.from(providedKey);
  
  if (keyBuffer.length !== providedBuffer.length || 
      !crypto.timingSafeEqual(keyBuffer, providedBuffer)) {
    res.status(403).json({
      success: false,
      error: "Invalid admin key"
    });
    return;
  }

  // Set admin user context
  req.adminUser = {
    id: "admin-key",
    email: "admin@system",
    name: "API Key Admin",
    role: "super_admin"
  };

  next();
}

// =============================================================================
// ADMIN SESSION AUTH (Database-backed)
// =============================================================================

/**
 * Validate admin access via Bearer token (JWT or session token)
 * Header: Authorization: Bearer <token>
 * 
 * For simplicity, this uses a basic token format: admin:<id>:<hash>
 * In production, use proper JWT with short expiry
 */
export async function adminSessionAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: "Admin authentication required",
      hint: "Provide Authorization: Bearer <token> header"
    });
    return;
  }

  const token = authHeader.slice(7);
  
  try {
    // Parse token: admin:<id>:<timestamp>:<signature>
    const parts = token.split(":");
    if (parts.length !== 4 || parts[0] !== "admin") {
      throw new Error("Invalid token format");
    }

    const [, adminId, timestamp, signature] = parts;
    
    // Check token expiry (24 hour max)
    const tokenTime = parseInt(timestamp, 10);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    if (isNaN(tokenTime) || now - tokenTime > maxAge) {
      throw new Error("Token expired");
    }

    // Verify signature
    const secret = getAdminSessionSecret();
    if (!secret) {
      // Fail closed, exactly as adminKeyAuth does when ADMIN_API_KEY is unset.
      // A misconfigured server must deny admin access, not invent a key.
      res.status(503).json({
        success: false,
        error: "Admin sessions are not configured",
      });
      return;
    }

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${adminId}:${timestamp}`)
      .digest("hex")
      .slice(0, 16);

    // Constant-time: a byte-by-byte early exit leaks how much of a guessed
    // signature was right, which is enough to forge one a byte at a time.
    const expectedBuf = Buffer.from(expectedSig);
    const actualBuf = Buffer.from(signature);
    if (
      expectedBuf.length !== actualBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new Error("Invalid signature");
    }

    // Fetch admin user from database
    const result = await query(`
      SELECT id, email, name, role FROM admin_users 
      WHERE id = $1 AND is_active = true
    `, [adminId]);

    if (!result.rows[0]) {
      throw new Error("Admin user not found or inactive");
    }

    req.adminUser = result.rows[0] as AdminUser;
    next();
    
  } catch (error: any) {
    // The reason stays in the logs. Returning error.message told the caller
    // whether a token was malformed, expired, wrongly signed, or named an admin
    // that does not exist — which is a map for guessing a valid one, and leaked
    // database errors verbatim when a lookup failed.
    console.warn("[adminAuth] session token rejected:", error?.message ?? error);
    res.status(403).json({
      success: false,
      error: "Invalid admin token",
    });
  }
}

// =============================================================================
// COMBINED AUTH (Key OR Session)
// =============================================================================

/**
 * Accept either X-Admin-Key or Bearer token
 */
export async function adminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Try API key first
  if (req.headers["x-admin-key"]) {
    return adminKeyAuth(req, res, next);
  }
  
  // Try session token
  if (req.headers.authorization?.startsWith("Bearer ")) {
    return adminSessionAuth(req, res, next);
  }

  res.status(401).json({
    success: false,
    error: "Admin authentication required",
    hint: "Provide X-Admin-Key or Authorization: Bearer <token>"
  });
}

// =============================================================================
// HELPERS
// =============================================================================

/** Warn once rather than on every signature check. */
let adminSecretWarningIssued = false;

/**
 * The HMAC key admin session tokens are signed with, or null when unconfigured.
 *
 * There is no fallback, and that is the entire point. This previously read:
 *
 *   ADMIN_SESSION_SECRET || ADMIN_API_KEY || "default-secret"
 *
 * Neither variable is set on this deployment, so tokens were signed with the
 * literal string "default-secret" — a value published in this file. Anyone could
 * mint a token that passed signature verification:
 *
 *   admin:<id>:<ts>:HMAC-SHA256("default-secret", "<id>:<ts>").slice(0,16)
 *
 * Confirmed against the running server: such a token passed the signature check
 * and failed only at the admin_users lookup, while a deliberately wrong
 * signature was rejected at the signature check. The only thing standing between
 * an attacker and admin access was knowing a valid admin UUID — a second factor,
 * not a substitute for a secret.
 *
 * ADMIN_API_KEY is no longer accepted here either. Signing sessions with the API
 * key means one leak compromises both, and they have different lifetimes and
 * blast radii. Sessions need their own secret.
 */
function getAdminSessionSecret(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    if (!adminSecretWarningIssued) {
      console.warn(
        "[adminAuth] ADMIN_SESSION_SECRET is not set — admin session tokens are disabled. " +
          "Set it to a long random value to enable them. X-Admin-Key auth is unaffected."
      );
      adminSecretWarningIssued = true;
    }
    return null;
  }
  if (secret.length < 32 && !adminSecretWarningIssued) {
    console.warn(
      `[adminAuth] ADMIN_SESSION_SECRET is only ${secret.length} characters. ` +
        "Use at least 32 random characters; a short HMAC key is brute-forceable offline."
    );
    adminSecretWarningIssued = true;
  }
  return secret;
}

/**
 * Generate admin session token.
 *
 * Throws when no signing secret is configured rather than producing a token
 * signed with something guessable — a token that cannot be verified is better
 * than one anybody can mint.
 */
export function generateAdminToken(adminId: string): string {
  const secret = getAdminSessionSecret();
  if (!secret) {
    throw new Error(
      "ADMIN_SESSION_SECRET is not configured — refusing to issue an admin session token"
    );
  }

  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${adminId}:${timestamp}`)
    .digest("hex")
    .slice(0, 16);

  return `admin:${adminId}:${timestamp}:${signature}`;
}

/**
 * Hash password for storage
 */
export function hashPassword(password: string): string {
  // In production, use bcrypt. This is a simple fallback.
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify password against stored hash
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  const verifyHash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(verifyHash));
}

/**
 * Hash user ID for privacy-safe logging
 */
export function hashUserId(userId: string): string {
  return crypto
    .createHash("sha256")
    .update(userId + (process.env.USER_HASH_SALT || ""))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Truncate message for preview (first 200 chars)
 */
export function truncateForPreview(message: string, maxLength: number = 200): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength) + "...";
}
