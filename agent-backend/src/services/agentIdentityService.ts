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
  // Returns the messaging identity only. It deliberately no longer touches
  // agents.public_key.
  //
  // It used to write this derived key into agents.public_key — the PAYOUT wallet
  // settlements and x402 payments are sent to — for any agent that had none, and
  // set verified_status = 'verified' at the same time. Two problems with that:
  //
  //   1. Custody. The key is derived from IDENTITY_SEED + agentId, and
  //      IDENTITY_SEED falls back to the literal "monocle-agent-identity-v1"
  //      published in this file. Agent ids are public in the marketplace, so
  //      anyone reading the repository could compute the private key of any
  //      wallet assigned this way and spend from it. Not "the operator holds the
  //      key" — anybody does.
  //
  //   2. It granted the verified badge as a side effect of having no wallet,
  //      which is the opposite of what verification is supposed to mean, and the
  //      marketplace surfaces that badge as a trust signal.
  //
  // An agent with no payout wallet now simply has none. That is already handled
  // downstream: x402 refuses to quote for it (AGENT_NO_PAYOUT_WALLET) rather
  // than quoting a payment nobody can claim.
  const kp = deriveKeypair(agentId);
  return { publicKey: kp.publicKey.toBase58(), keypair: kp };
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
  // Warms the messaging-keypair cache. It no longer assigns payout wallets: it
  // used to select every agent with a null public_key and fill one in from a
  // key derived off a published constant, which handed spendable wallets to
  // anyone who could read the repository. See getAgentIdentity.
  //
  // Derivation is deterministic and cached in-process, so nothing needs storing.
  // Agents without a payout wallet stay without one until their owner supplies
  // an address they control.
  const result = await query(`SELECT id FROM agents WHERE public_key IS NULL`);
  if (result.rows.length > 0) {
    console.warn(
      `[Identity] ${result.rows.length} agent(s) have no payout wallet and cannot be paid. ` +
        `Their owners must register an address they control.`
    );
  }
}
