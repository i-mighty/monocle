/**
 * agentIdentityService.ts
 *
 * Wallet-based agent identity: each agent gets a Solana keypair.
 * Messages are signed with ed25519 and verified before trust is granted.
 *
 * Flow:
 *   1. On first use, each agent gets a Keypair generated deterministically
 *      from its agentId + a server-side seed (or loaded from DB).
 *   2. Every negotiation message includes a signature over the payload.
 *   3. Receiving agents verify the signature before processing.
 *   4. The public key is stored in the agents table.
 */

import { Keypair } from "@solana/web3.js";
import { query } from "../db/client";
import * as crypto from "crypto";

// ─── Server seed for deterministic keypair derivation ─────────────────────────
const IDENTITY_SEED = process.env.AGENT_IDENTITY_SEED ?? "monocle-agent-identity-v1";

// ─── In-memory keypair cache ──────────────────────────────────────────────────
const keypairCache = new Map<string, Keypair>();

/**
 * Derive a deterministic Keypair from an agentId.
 * Uses HKDF(SHA-512) to stretch the agentId + server seed into 32 bytes,
 * then generates an ed25519 keypair from that seed.
 */
function deriveKeypair(agentId: string): Keypair {
  const cached = keypairCache.get(agentId);
  if (cached) return cached;

  // HKDF-like derivation: SHA-512(seed + agentId) → first 32 bytes as ed25519 seed
  const hash = crypto.createHash("sha512");
  hash.update(`${IDENTITY_SEED}:${agentId}`);
  const derived = hash.digest().subarray(0, 32);

  const kp = Keypair.fromSeed(derived);
  keypairCache.set(agentId, kp);
  return kp;
}

/**
 * Get or initialize an agent's identity.
 * If the agent doesn't have a public_key in the DB, store it now.
 */
export async function getAgentIdentity(agentId: string): Promise<{
  publicKey: string;
  keypair: Keypair;
}> {
  const kp = deriveKeypair(agentId);
  const publicKey = kp.publicKey.toBase58();

  // Check if public key is already stored
  const result = await query(
    `SELECT public_key FROM agents WHERE id = $1`,
    [agentId]
  );

  if (result.rows.length > 0 && !result.rows[0].public_key) {
    // Store the derived public key
    await query(
      `UPDATE agents SET public_key = $1, verified_status = 'verified', verified_at = NOW()
       WHERE id = $2 AND public_key IS NULL`,
      [publicKey, agentId]
    );
  }

  return { publicKey, keypair: kp };
}

// ─── Message signing ──────────────────────────────────────────────────────────

export interface SignedPayload {
  payload: string;       // JSON-stringified message content
  signature: string;     // base64-encoded ed25519 signature
  signerPublicKey: string; // base58 public key of signer
  signedAt: string;      // ISO timestamp
}

/**
 * Sign a message payload with an agent's keypair.
 */
export function signMessage(agentId: string, payload: object): SignedPayload {
  const kp = deriveKeypair(agentId);
  const payloadStr = JSON.stringify(payload);
  const messageBytes = Buffer.from(payloadStr, "utf-8");

  // ed25519 sign via nacl (bundled with @solana/web3.js)
  const signature = Buffer.from(
    kp.secretKey.subarray(0, 64)  // nacl expects 64-byte secret key
  );

  // Use tweetnacl sign.detached via the Keypair
  const nacl = require("tweetnacl");
  const sig = nacl.sign.detached(messageBytes, kp.secretKey);

  return {
    payload: payloadStr,
    signature: Buffer.from(sig).toString("base64"),
    signerPublicKey: kp.publicKey.toBase58(),
    signedAt: new Date().toISOString(),
  };
}

/**
 * Verify a signed message against the claimed signer's public key.
 * Returns { valid, agentId } or throws on invalid.
 */
export function verifyMessage(signed: SignedPayload): {
  valid: boolean;
  publicKey: string;
} {
  const nacl = require("tweetnacl");
  const messageBytes = Buffer.from(signed.payload, "utf-8");
  const signatureBytes = Buffer.from(signed.signature, "base64");

  // Decode base58 public key
  const bs58 = require("bs58");
  const publicKeyBytes = bs58.decode(signed.signerPublicKey);

  const valid = nacl.sign.detached.verify(
    messageBytes,
    signatureBytes,
    publicKeyBytes
  );

  return { valid, publicKey: signed.signerPublicKey };
}

/**
 * Verify a message came from a specific agent.
 * Checks signature AND that the public key matches the agent's registered key.
 */
export async function verifyAgentMessage(
  agentId: string,
  signed: SignedPayload
): Promise<{ valid: boolean; reason?: string }> {
  // 1. Verify the cryptographic signature
  const { valid } = verifyMessage(signed);
  if (!valid) {
    return { valid: false, reason: "Invalid ed25519 signature" };
  }

  // 2. Verify the public key matches the agent's registered identity
  const result = await query(
    `SELECT public_key FROM agents WHERE id = $1`,
    [agentId]
  );

  if (result.rows.length === 0) {
    return { valid: false, reason: `Agent ${agentId} not found` };
  }

  const registeredKey = result.rows[0].public_key;
  if (registeredKey && registeredKey !== signed.signerPublicKey) {
    return { valid: false, reason: "Public key mismatch — possible impersonation" };
  }

  return { valid: true };
}

/**
 * Initialize identities for all known agents.
 * Call once at startup to populate public keys.
 */
export async function initializeAgentIdentities(): Promise<void> {
  const result = await query(`SELECT id FROM agents WHERE public_key IS NULL`);
  for (const row of result.rows) {
    await getAgentIdentity(row.id);
  }
  console.log(`[Identity] Initialized ${result.rows.length} agent identities`);
}
