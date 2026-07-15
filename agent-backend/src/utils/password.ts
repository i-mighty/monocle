/**
 * Password hashing for user email/password login.
 *
 * Uses PBKDF2-HMAC-SHA512 (100k iterations) from Node's built-in crypto — the
 * same scheme already used for admin_users in adminAuth.ts — so we add a
 * password login path without pulling in a native bcrypt/argon2 dependency
 * (important for clean Railway/Docker builds).
 *
 * Stored format: "<salt-hex>:<hash-hex>". Verification is constant-time.
 */

import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const ITERATIONS = 100_000;
const KEYLEN = 64;
const DIGEST = "sha512";
const SALT_BYTES = 16;

// Basic password policy. Kept intentionally light for the hackathon, but
// enforced server-side so it can't be bypassed by the client.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export function isValidPassword(pw: unknown): pw is string {
  return (
    typeof pw === "string" &&
    pw.length >= MIN_PASSWORD_LENGTH &&
    pw.length <= MAX_PASSWORD_LENGTH
  );
}

/** Hash a plaintext password for storage. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a plaintext password against a stored "salt:hash" string.
 * Returns false (never throws) on any malformed input so callers can treat it
 * as a simple boolean gate.
 */
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof stored !== "string") return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hash, "hex");
    actual = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST);
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
