/**
 * Sign-In With Solana (SIWS) — challenge/verify primitives.
 *
 * Flow:
 *   1. Client requests a challenge for their wallet pubkey.
 *   2. Server returns a structured message string (per SIWS-style spec) and
 *      a nonce. The exact message string is stored alongside the nonce so
 *      verification can reconstruct it byte-for-byte.
 *   3. Client signs the message bytes with their wallet's private key.
 *   4. Client sends back { wallet, signature, nonce }.
 *   5. Server verifies the ed25519 signature against the wallet pubkey and
 *      the stored message bytes. If valid, the nonce is marked used and the
 *      client is authenticated.
 *
 * Nonces are one-shot and expire in NONCE_TTL_MS.
 */

import { randomBytes } from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { query } from "../db/client";

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ORIGIN = process.env.SIWS_ORIGIN || "https://monocleai.up.railway.app";
const CHAIN = process.env.SOLANA_NETWORK === "mainnet" ? "solana-mainnet-beta" : "solana-devnet";

export interface ChallengeResult {
  message: string;
  nonce: string;
  expiresAt: string;
}

/**
 * Build the canonical SIWS message string. Format is inspired by EIP-4361
 * (Sign-In With Ethereum) adapted for Solana.
 */
function buildSiwsMessage(opts: {
  wallet: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}): string {
  const host = new URL(ORIGIN).host;
  return [
    `${host} wants you to sign in with your Solana account:`,
    opts.wallet,
    "",
    "Sign in to Monocle.",
    "",
    `URI: ${ORIGIN}`,
    `Version: 1`,
    `Chain ID: ${CHAIN}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt.toISOString()}`,
    `Expiration Time: ${opts.expiresAt.toISOString()}`,
  ].join("\n");
}

/**
 * Validate that a string is a plausible Solana base58 pubkey. Decodes to
 * exactly 32 bytes. Doesn't check that the curve point is on-curve.
 */
export function isValidWalletPubkey(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try {
    const bytes = bs58.decode(s);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

/**
 * Generate a fresh challenge for the given wallet. Persists the nonce + the
 * exact message text so verify() can reconstruct without trusting the client.
 */
export async function createChallenge(wallet: string): Promise<ChallengeResult> {
  if (!isValidWalletPubkey(wallet)) {
    throw new Error("Invalid wallet pubkey");
  }

  const nonce = randomBytes(32).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
  const message = buildSiwsMessage({ wallet, nonce, issuedAt, expiresAt });

  await query(
    `insert into auth_nonces (nonce, wallet_pubkey, message, issued_at, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [nonce, wallet, message, issuedAt, expiresAt]
  );

  return { message, nonce, expiresAt: expiresAt.toISOString() };
}

export type VerifyResult =
  | { ok: true; wallet: string }
  | { ok: false; reason: "nonce_not_found" | "nonce_expired" | "nonce_used" | "wallet_mismatch" | "bad_signature" };

/**
 * Verify a SIWS signature. Looks up the stored nonce, reconstructs the
 * canonical message, runs ed25519 verification with tweetnacl, then marks
 * the nonce one-shot consumed.
 */
export async function verifyChallenge(input: {
  wallet: string;
  nonce: string;
  signature: string; // base58 ed25519 signature, 64 bytes
}): Promise<VerifyResult> {
  if (!isValidWalletPubkey(input.wallet)) return { ok: false, reason: "wallet_mismatch" };

  const row = await query(
    `select wallet_pubkey, message, expires_at, used_at
     from auth_nonces where nonce = $1`,
    [input.nonce]
  );
  if (row.rows.length === 0) return { ok: false, reason: "nonce_not_found" };
  const r = row.rows[0];

  if (r.used_at) return { ok: false, reason: "nonce_used" };
  if (new Date(r.expires_at).getTime() < Date.now()) return { ok: false, reason: "nonce_expired" };
  if (r.wallet_pubkey !== input.wallet) return { ok: false, reason: "wallet_mismatch" };

  let pubkeyBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    pubkeyBytes = bs58.decode(input.wallet);
    sigBytes = bs58.decode(input.signature);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (pubkeyBytes.length !== 32 || sigBytes.length !== 64) {
    return { ok: false, reason: "bad_signature" };
  }

  const messageBytes = new TextEncoder().encode(r.message);
  const ok = nacl.sign.detached.verify(messageBytes, sigBytes, pubkeyBytes);
  if (!ok) return { ok: false, reason: "bad_signature" };

  // Atomic one-shot consumption: mark used only if still unused.
  const consume = await query(
    `update auth_nonces set used_at = now()
     where nonce = $1 and used_at is null
     returning nonce`,
    [input.nonce]
  );
  if (consume.rows.length === 0) {
    // Race: someone else consumed between our read and write.
    return { ok: false, reason: "nonce_used" };
  }

  return { ok: true, wallet: input.wallet };
}
