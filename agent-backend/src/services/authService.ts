/**
 * User-session auth: JWT signing/verification and user upsert.
 *
 * Tokens last AUTH_JWT_TTL_SECONDS (24h by default). They're issued after a
 * successful SIWS verification and carry { sub: userId, wallet, iat, exp }.
 *
 * Storage: HttpOnly cookie on the dashboard's domain. The `requireUser`
 * middleware reads the cookie and verifies the token on every protected
 * request.
 */

import jwt from "jsonwebtoken";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { query } from "../db/client";
import { hashPassword, verifyPassword } from "../utils/password";
import { normalizeEmail } from "./emailService";

const JWT_TTL_SECONDS = Number(process.env.AUTH_JWT_TTL_SECONDS) || 60 * 60 * 24; // 24h
const COOKIE_NAME = "monocle_session";

// Email verification codes: 6 digits, single-use, short-lived.
const VERIFICATION_TTL_MINUTES = Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES) || 15;
const MAX_VERIFICATION_ATTEMPTS = 5;

export interface UserRecord {
  id: string;
  walletPubkey: string | null;
  solName: string | null;
  displayName: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
}

// Columns selected wherever we build a UserRecord — keep this list and the
// mapper below in sync.
const USER_COLUMNS =
  "id, wallet_pubkey, sol_name, display_name, email, email_verified_at, created_at, last_seen_at";

function mapUserRow(r: any): UserRecord {
  return {
    id: r.id,
    walletPubkey: r.wallet_pubkey ?? null,
    solName: r.sol_name ?? null,
    displayName: r.display_name ?? null,
    email: r.email ?? null,
    emailVerifiedAt: r.email_verified_at ? new Date(r.email_verified_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
  };
}

export interface SessionPayload {
  sub: string;             // user id
  wallet: string | null;   // base58 pubkey, or null for email-only accounts
  iat: number;
  exp: number;
}

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET is not configured (must be at least 32 chars)");
  }
  return s;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_TTL_SECONDS = JWT_TTL_SECONDS;

/**
 * Look up a user by wallet, or create one. Updates last_seen_at on every
 * call so we have a heartbeat without a separate endpoint.
 */
export async function upsertUserByWallet(walletPubkey: string): Promise<UserRecord> {
  const result = await query(
    `insert into users (wallet_pubkey)
     values ($1)
     on conflict (wallet_pubkey) do update set last_seen_at = now()
     returning ${USER_COLUMNS}`,
    [walletPubkey]
  );
  return mapUserRow(result.rows[0]);
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const result = await query(
    `select ${USER_COLUMNS} from users where id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return mapUserRow(result.rows[0]);
}

// ===========================================================================
// EMAIL / PASSWORD ACCOUNTS
// ===========================================================================

/** Look up a user by email (case-insensitive). Returns null if none. */
export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const result = await query(
    `select ${USER_COLUMNS} from users where lower(email) = lower($1)`,
    [normalizeEmail(email)]
  );
  if (result.rows.length === 0) return null;
  return mapUserRow(result.rows[0]);
}

/**
 * Create a brand-new email/password account (no wallet). The email starts
 * unverified. Caller is responsible for issuing a verification code.
 * Throws "EMAIL_TAKEN" if the address is already registered.
 */
export async function createUserWithEmail(email: string, password: string): Promise<UserRecord> {
  const normalized = normalizeEmail(email);
  const passwordHash = hashPassword(password);
  try {
    const result = await query(
      `insert into users (email, password_hash)
       values ($1, $2)
       returning ${USER_COLUMNS}`,
      [normalized, passwordHash]
    );
    return mapUserRow(result.rows[0]);
  } catch (err: any) {
    // 23505 = unique_violation (users_email_lower_unique)
    if (err?.code === "23505") throw new Error("EMAIL_TAKEN");
    throw err;
  }
}

/**
 * Attach an email + password to an existing (wallet) account. Used when a
 * wallet user adds email as a second factor / KYC contact. The email starts
 * unverified. Throws "EMAIL_TAKEN" if the address belongs to another user.
 */
export async function attachEmailToUser(
  userId: string,
  email: string,
  password: string
): Promise<UserRecord> {
  const normalized = normalizeEmail(email);
  const passwordHash = hashPassword(password);
  try {
    const result = await query(
      `update users
       set email = $2, password_hash = $3, email_verified_at = null
       where id = $1
       returning ${USER_COLUMNS}`,
      [userId, normalized, passwordHash]
    );
    if (result.rows.length === 0) throw new Error("USER_NOT_FOUND");
    return mapUserRow(result.rows[0]);
  } catch (err: any) {
    if (err?.code === "23505") throw new Error("EMAIL_TAKEN");
    throw err;
  }
}

/**
 * Verify an email/password login. Returns the user on success, or null on
 * unknown email / no password set / wrong password (callers must not reveal
 * which). Updates last_seen_at on success.
 */
export async function verifyEmailLogin(email: string, password: string): Promise<UserRecord | null> {
  const result = await query(
    `select ${USER_COLUMNS}, password_hash from users where lower(email) = lower($1)`,
    [normalizeEmail(email)]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (!verifyPassword(password, row.password_hash)) return null;

  await query(`update users set last_seen_at = now() where id = $1`, [row.id]);
  return mapUserRow(row);
}

// ===========================================================================
// EMAIL VERIFICATION CODES (light KYC)
// ===========================================================================

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateCode(): string {
  // 6-digit, zero-padded, cryptographically random.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export interface VerificationChallenge {
  email: string;
  expiresAt: string;
  ttlMinutes: number;
  /** The plaintext code — hand to emailService, never return to the client. */
  code: string;
}

/**
 * What a verification code is allowed to authorise.
 *
 * Codes are scoped so that one obtained for a routine action cannot be redeemed
 * for a sensitive one. Without this, every code in the table is interchangeable:
 * a code mailed out to confirm an address would also satisfy the step-up
 * challenge guarding API key regeneration, which is the whole reason that
 * challenge exists.
 *
 * The `purpose` column has existed since 0002 and was always written as
 * 'verify_email'; this makes it mean something.
 */
export type VerificationPurpose = "verify_email" | "regenerate_api_key";

/**
 * Issue a fresh verification code for the user's current email. Invalidates
 * previous unconsumed codes *of the same purpose* so only the newest works, and
 * returns the plaintext code for the caller to email out.
 *
 * Burning is scoped to the purpose: requesting a step-up code must not silently
 * invalidate a signup code the user is midway through typing, and vice versa.
 */
export async function createEmailVerification(
  user: UserRecord,
  purpose: VerificationPurpose = "verify_email"
): Promise<VerificationChallenge> {
  if (!user.email) throw new Error("NO_EMAIL");

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60 * 1000);

  // One active code at a time per purpose: burn older unconsumed ones.
  await query(
    `update email_verifications set consumed_at = now()
     where user_id = $1 and purpose = $2 and consumed_at is null`,
    [user.id, purpose]
  );

  await query(
    `insert into email_verifications (user_id, email, code_hash, purpose, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [user.id, user.email, codeHash, purpose, expiresAt]
  );

  return { email: user.email, expiresAt: expiresAt.toISOString(), ttlMinutes: VERIFICATION_TTL_MINUTES, code };
}

/**
 * Mark an email verified without a code. Admin-only escape hatch (see
 * routes/auth.ts) for pre-seeding a demo account or rescuing a user when mail
 * delivery is broken. Returns null if no user has that email.
 *
 * Also burns any outstanding codes so a stale one can't be replayed later.
 * Deliberately unscoped by purpose, unlike the rest of this module: this is the
 * operator's break-glass path, so invalidating every outstanding challenge —
 * including any pending API key step-up — is the conservative choice.
 */
export async function forceVerifyEmail(email: string): Promise<UserRecord | null> {
  const result = await query(
    `update users set email_verified_at = now()
     where lower(email) = lower($1)
     returning ${USER_COLUMNS}`,
    [normalizeEmail(email)]
  );
  if (result.rows.length === 0) return null;

  const user = mapUserRow(result.rows[0]);
  await query(
    `update email_verifications set consumed_at = now()
     where user_id = $1 and consumed_at is null`,
    [user.id]
  );
  return user;
}

export type VerificationFailure = "no_code" | "expired" | "too_many_attempts" | "mismatch";

export type ConfirmResult =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: VerificationFailure };

export type ConsumeResult = { ok: true } | { ok: false; reason: VerificationFailure };

/**
 * Validate and consume the user's newest active code *for a given purpose*.
 *
 * Shared by every code-redeeming flow so they cannot drift apart — in particular
 * so the step-up challenge keeps the same expiry window, attempt ceiling and
 * timing-safe comparison as signup verification rather than reimplementing them.
 *
 * The `purpose` filter is the security boundary: a code issued to confirm an
 * email address is not visible to a lookup for a regeneration code, so it can
 * never be redeemed as one.
 */
async function consumeCode(
  userId: string,
  code: string,
  purpose: VerificationPurpose
): Promise<ConsumeResult> {
  const result = await query(
    `select id, code_hash, attempts, expires_at
     from email_verifications
     where user_id = $1 and purpose = $2 and consumed_at is null
     order by created_at desc
     limit 1`,
    [userId, purpose]
  );
  if (result.rows.length === 0) return { ok: false, reason: "no_code" };
  const row = result.rows[0];

  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_VERIFICATION_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  const provided = Buffer.from(hashCode(code));
  const expected = Buffer.from(row.code_hash);
  const matches = provided.length === expected.length && timingSafeEqual(provided, expected);

  if (!matches) {
    await query(`update email_verifications set attempts = attempts + 1 where id = $1`, [row.id]);
    return { ok: false, reason: "mismatch" };
  }

  await query(`update email_verifications set consumed_at = now() where id = $1`, [row.id]);
  return { ok: true };
}

/**
 * Confirm a submitted code against the user's newest active verification.
 * On success, marks the code consumed and stamps users.email_verified_at.
 *
 * Only ever accepts a 'verify_email' code: a step-up code issued for API key
 * regeneration must not be redeemable to verify an address.
 */
export async function confirmEmailVerification(userId: string, code: string): Promise<ConfirmResult> {
  const consumed = await consumeCode(userId, code, "verify_email");
  if (!consumed.ok) return consumed;

  const upd = await query(
    `update users set email_verified_at = now(), last_seen_at = now()
     where id = $1
     returning ${USER_COLUMNS}`,
    [userId]
  );
  return { ok: true, user: mapUserRow(upd.rows[0]) };
}

/**
 * Redeem a step-up code for a sensitive action (today: API key regeneration).
 *
 * Deliberately does NOT touch email_verified_at. Proving control of the inbox a
 * second time authorises one action; it is not a re-verification of the address,
 * and conflating the two would let this path quietly grant KYC state.
 */
export async function consumeStepUpCode(
  userId: string,
  code: string,
  purpose: Exclude<VerificationPurpose, "verify_email">
): Promise<ConsumeResult> {
  return consumeCode(userId, code, purpose);
}

export function signSessionToken(user: UserRecord): string {
  return jwt.sign(
    { sub: user.id, wallet: user.walletPubkey ?? null },
    getJwtSecret(),
    { expiresIn: JWT_TTL_SECONDS }
  );
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as SessionPayload;
    // Only `sub` (user id) is required — email-only accounts have no wallet.
    if (typeof decoded.sub !== "string") return null;
    return decoded;
  } catch {
    return null;
  }
}
