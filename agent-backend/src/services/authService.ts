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
import { query } from "../db/client";

const JWT_TTL_SECONDS = Number(process.env.AUTH_JWT_TTL_SECONDS) || 60 * 60 * 24; // 24h
const COOKIE_NAME = "monocle_session";

export interface UserRecord {
  id: string;
  walletPubkey: string;
  solName: string | null;
  displayName: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface SessionPayload {
  sub: string;     // user id
  wallet: string;  // base58 pubkey
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
     returning id, wallet_pubkey, sol_name, display_name, created_at, last_seen_at`,
    [walletPubkey]
  );
  const r = result.rows[0];
  return {
    id: r.id,
    walletPubkey: r.wallet_pubkey,
    solName: r.sol_name,
    displayName: r.display_name,
    createdAt: new Date(r.created_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
  };
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const result = await query(
    `select id, wallet_pubkey, sol_name, display_name, created_at, last_seen_at
     from users where id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    walletPubkey: r.wallet_pubkey,
    solName: r.sol_name,
    displayName: r.display_name,
    createdAt: new Date(r.created_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
  };
}

export function signSessionToken(user: UserRecord): string {
  return jwt.sign(
    { sub: user.id, wallet: user.walletPubkey },
    getJwtSecret(),
    { expiresIn: JWT_TTL_SECONDS }
  );
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as SessionPayload;
    if (typeof decoded.sub !== "string" || typeof decoded.wallet !== "string") return null;
    return decoded;
  } catch {
    return null;
  }
}
