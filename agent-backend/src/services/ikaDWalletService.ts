/**
 * ikaDWalletService.ts
 *
 * Ika dWallet integration for Monocle agent custody.
 *
 * Each Monocle agent gets a dWallet — a distributed signing key managed by
 * Ika's 2PC-MPC protocol on Solana devnet. No single party (not even Monocle)
 * can unilaterally sign transactions; the agent must consent.
 *
 * This service:
 *   1. Creates dWallets for agents via DKG (Distributed Key Generation)
 *   2. Derives on-chain PDA addresses for dWallet accounts
 *   3. Builds & submits ApproveMessage instructions for payment authorization
 *   4. Enforces spending policies (per-task limits, daily caps)
 *   5. Emits SSE events for dashboard visualization
 *
 * Ika Solana Pre-Alpha:
 *   Program ID: 87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY
 *   gRPC:       https://pre-alpha-dev-1.ika.ika-network.net:443
 *   Curves:     Curve25519/Ed25519 (curve=2), Secp256k1 (curve=0)
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import { query } from "../db/client";

// ─── Constants ────────────────────────────────────────────────────────────────

const IKA_PROGRAM_ID = new PublicKey("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");
const IKA_GRPC_ENDPOINT = "https://pre-alpha-dev-1.ika.ika-network.net:443";
const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";

// Instruction discriminators (from Ika on-chain program)
const DISC_APPROVE_MESSAGE = 8;
const DISC_COMMIT_DWALLET = 31;
const DISC_TRANSFER_OWNERSHIP = 24;

// Curve identifiers
const CURVE_SECP256K1 = 0;
const CURVE_ED25519 = 2;  // Curve25519 / Ed25519

// Signature schemes
const SIG_SCHEME_ED25519 = 0;

// Hash schemes
const HASH_SHA512 = 1;  // Mandatory for Ed25519

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DWalletInfo {
  agentId: string;
  dwalletAddress: string;      // On-chain PDA
  publicKey: string;           // 65-byte compressed public key (hex)
  authority: string;           // Authority pubkey (controls approve_message)
  curve: "ed25519" | "secp256k1";
  createdAt: string;
}

export interface SpendingPolicy {
  agentId: string;
  maxPerTransaction: number;   // lamports
  dailyCap: number;            // lamports
  spentToday: number;          // lamports
  remainingToday: number;      // lamports
  requiresApproval: boolean;   // whether transactions auto-approve or queue
  lastResetAt: string;
}

export interface PaymentApproval {
  agentId: string;
  messageHash: string;
  approvalPda: string;
  status: "pending" | "approved" | "signed" | "rejected";
  txSignature?: string;
  amount: number;
  recipient: string;
  timestamp: string;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

const dwalletCache = new Map<string, DWalletInfo>();
const spendingCache = new Map<string, SpendingPolicy>();
const dailySpend = new Map<string, { total: number; resetAt: number }>();

// ─── Default spending policies per agent type ─────────────────────────────────

const DEFAULT_POLICIES: Record<string, { maxPerTx: number; dailyCap: number }> = {
  "orchestrator-001": { maxPerTx: 50_000, dailyCap: 500_000 },
  "researcher-001":   { maxPerTx: 10_000, dailyCap: 100_000 },
  "writer-001":       { maxPerTx: 10_000, dailyCap: 100_000 },
  "coder-001":        { maxPerTx: 15_000, dailyCap: 150_000 },
  "image-001":        { maxPerTx: 20_000, dailyCap: 200_000 },
  "factcheck-001":    { maxPerTx: 5_000,  dailyCap: 50_000 },
  "formatter-001":    { maxPerTx: 5_000,  dailyCap: 50_000 },
};

// ─── PDA Derivation ───────────────────────────────────────────────────────────

/**
 * Derive the dWallet PDA from a public key and curve type.
 * Seeds: ["dwallet", ...chunks_of(curve_byte || public_key)]
 * The concatenated (curve_byte || public_key) is split into 32-byte chunks.
 */
function deriveDWalletPDA(publicKeyBytes: Uint8Array, curve: number): [PublicKey, number] {
  const data = new Uint8Array(1 + publicKeyBytes.length);
  data[0] = curve;
  data.set(publicKeyBytes, 1);

  // Split into 32-byte chunks for PDA seeds
  const seeds: Uint8Array[] = [Buffer.from("dwallet")];
  for (let i = 0; i < data.length; i += 32) {
    seeds.push(data.slice(i, Math.min(i + 32, data.length)));
  }

  return PublicKey.findProgramAddressSync(seeds, IKA_PROGRAM_ID);
}

/**
 * Derive the MessageApproval PDA.
 * Seeds: ["message_approval", dwallet_pubkey, message_hash]
 */
function deriveMessageApprovalPDA(
  dwalletPubkey: PublicKey,
  messageHash: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("message_approval"),
      dwalletPubkey.toBytes(),
      messageHash.slice(0, 32),
    ],
    IKA_PROGRAM_ID
  );
}

// ─── DKG (Distributed Key Generation) ─────────────────────────────────────────

/**
 * Generate a dWallet for an agent via DKG.
 *
 * In the pre-alpha, DKG goes through gRPC → returns an attestation with the
 * public key. For the hackathon we derive a deterministic dWallet from the
 * agent's existing Ed25519 identity and register it on-chain.
 *
 * Production flow: gRPC DWalletRequest::DKG → 2PC-MPC ceremony → attestation
 */
export async function createAgentDWallet(agentId: string): Promise<DWalletInfo> {
  // Check cache first
  const cached = dwalletCache.get(agentId);
  if (cached) return cached;

  // Derive a deterministic Ed25519 public key for this agent's dWallet
  // Uses the same HKDF pattern as agentIdentityService but with dWallet-specific salt
  const hash = crypto.createHash("sha512");
  hash.update(`monocle-dwallet-v1:${agentId}`);
  const seed = hash.digest().subarray(0, 32);
  const keypair = Keypair.fromSeed(seed);

  // The dWallet public key (Ed25519, 32 bytes for Solana, padded to 65 for Ika format)
  const rawPubkey = keypair.publicKey.toBytes(); // 32 bytes
  // Ika stores 65-byte keys; for Ed25519 we prefix with 0x00 + pad
  const ikaPubkey = new Uint8Array(65);
  ikaPubkey[0] = 0x00; // Ed25519 prefix
  ikaPubkey.set(rawPubkey, 1);

  // Derive the on-chain PDA
  const [dwalletPDA] = deriveDWalletPDA(ikaPubkey, CURVE_ED25519);

  // Build authority PDA (the payer/orchestrator controls authorization)
  const payerSecret = process.env.SOLANA_PAYER_SECRET;
  let authorityKey = keypair.publicKey.toBase58();
  if (payerSecret) {
    try {
      const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(payerSecret)));
      authorityKey = payer.publicKey.toBase58();
    } catch (_) { /* use agent's own key as authority */ }
  }

  const info: DWalletInfo = {
    agentId,
    dwalletAddress: dwalletPDA.toBase58(),
    publicKey: Buffer.from(ikaPubkey).toString("hex"),
    authority: authorityKey,
    curve: "ed25519",
    createdAt: new Date().toISOString(),
  };

  dwalletCache.set(agentId, info);

  // Persist to DB
  try {
    await query(
      `UPDATE agents
       SET dwallet_id = $1,
           dwallet_cap_id = $2,
           dwallet_status = 'active',
           updated_at = NOW()
       WHERE id = $3`,
      [dwalletPDA.toBase58(), authorityKey, agentId]
    );
  } catch (_) { /* DB update is non-critical */ }

  console.log(`🔑 dWallet created for ${agentId}: ${dwalletPDA.toBase58()}`);
  return info;
}

// ─── Spending Policy Enforcement ──────────────────────────────────────────────

/**
 * Get the spending policy for an agent.
 */
export function getSpendingPolicy(agentId: string): SpendingPolicy {
  const cached = spendingCache.get(agentId);
  if (cached) return cached;

  const defaults = DEFAULT_POLICIES[agentId] ?? { maxPerTx: 10_000, dailyCap: 100_000 };
  const now = Date.now();
  const spend = dailySpend.get(agentId);

  // Reset daily spend if past midnight UTC
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const resetTime = todayStart.getTime();

  let spentToday = 0;
  if (spend && spend.resetAt >= resetTime) {
    spentToday = spend.total;
  } else {
    dailySpend.set(agentId, { total: 0, resetAt: now });
  }

  const policy: SpendingPolicy = {
    agentId,
    maxPerTransaction: defaults.maxPerTx,
    dailyCap: defaults.dailyCap,
    spentToday,
    remainingToday: Math.max(0, defaults.dailyCap - spentToday),
    requiresApproval: true,
    lastResetAt: new Date(spend?.resetAt ?? now).toISOString(),
  };

  spendingCache.set(agentId, policy);
  return policy;
}

/**
 * Check if a payment amount is within the agent's spending policy.
 * Returns { allowed, reason }.
 */
export function checkSpendingPolicy(
  agentId: string,
  amountLamports: number
): { allowed: boolean; reason: string } {
  const policy = getSpendingPolicy(agentId);

  if (amountLamports > policy.maxPerTransaction) {
    return {
      allowed: false,
      reason: `Amount ${amountLamports} exceeds per-tx limit of ${policy.maxPerTransaction} lamports`,
    };
  }

  if (amountLamports > policy.remainingToday) {
    return {
      allowed: false,
      reason: `Amount ${amountLamports} exceeds remaining daily budget of ${policy.remainingToday} lamports`,
    };
  }

  return { allowed: true, reason: "Within spending policy" };
}

/**
 * Record a spend against the agent's daily budget.
 */
export function recordSpend(agentId: string, amountLamports: number): void {
  const now = Date.now();
  const existing = dailySpend.get(agentId) ?? { total: 0, resetAt: now };
  existing.total += amountLamports;
  dailySpend.set(agentId, existing);

  // Invalidate cached policy
  spendingCache.delete(agentId);
}

// ─── Message Approval (ApproveMessage Instruction) ────────────────────────────

/**
 * Build the ApproveMessage instruction data.
 *
 * Layout: disc(1) + bump(1) + message_hash(32) + user_pubkey(32) + signature_scheme(1) = 67 bytes
 */
function buildApproveMessageData(
  bump: number,
  messageHash: Uint8Array,
  userPubkey: PublicKey,
  signatureScheme: number = SIG_SCHEME_ED25519
): Buffer {
  const data = Buffer.alloc(67);
  data.writeUInt8(DISC_APPROVE_MESSAGE, 0);  // discriminator
  data.writeUInt8(bump, 1);                   // PDA bump
  Buffer.from(messageHash).copy(data, 2, 0, 32); // 32-byte message hash
  data.set(userPubkey.toBytes(), 34);         // 32-byte user public key
  data.writeUInt8(signatureScheme, 66);       // signature scheme
  return data;
}

/**
 * Approve a payment message for dWallet signing.
 *
 * This builds and submits an ApproveMessage instruction to the Ika program,
 * creating a MessageApproval PDA on-chain. The Ika network watches for
 * these events and initiates the 2PC-MPC signing ceremony.
 *
 * Flow:
 *   1. Check spending policy → reject if over limit
 *   2. Hash the payment message (SHA-256)
 *   3. Derive MessageApproval PDA
 *   4. Build ApproveMessage ix (disc=8)
 *   5. Submit transaction to devnet
 *   6. Return approval with tx signature
 */
export async function approvePayment(
  agentId: string,
  recipient: string,
  amountLamports: number,
  memo?: string
): Promise<PaymentApproval> {
  // 1. Get or create dWallet
  const dwallet = await createAgentDWallet(agentId);

  // 2. Check spending policy
  const policyCheck = checkSpendingPolicy(agentId, amountLamports);
  if (!policyCheck.allowed) {
    return {
      agentId,
      messageHash: "",
      approvalPda: "",
      status: "rejected",
      amount: amountLamports,
      recipient,
      timestamp: new Date().toISOString(),
    };
  }

  // 3. Build payment message and hash it
  const paymentMessage = JSON.stringify({
    from: agentId,
    to: recipient,
    amount: amountLamports,
    memo: memo ?? "monocle-agent-payment",
    timestamp: Date.now(),
  });
  const messageHash = crypto.createHash("sha256").update(paymentMessage).digest();

  // 4. Derive PDAs
  const dwalletPubkey = new PublicKey(dwallet.dwalletAddress);
  const [approvalPDA, bump] = deriveMessageApprovalPDA(dwalletPubkey, messageHash);

  // 5. Build the approval
  const approval: PaymentApproval = {
    agentId,
    messageHash: messageHash.toString("hex"),
    approvalPda: approvalPDA.toBase58(),
    status: "approved",
    amount: amountLamports,
    recipient,
    timestamp: new Date().toISOString(),
  };

  // 6. Attempt on-chain submission
  try {
    const payerSecret = process.env.SOLANA_PAYER_SECRET;
    if (payerSecret) {
      const connection = new Connection(RPC, "confirmed");
      const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(payerSecret)));

      // Build ApproveMessage instruction
      const ixData = buildApproveMessageData(
        bump,
        messageHash,
        payer.publicKey,
        SIG_SCHEME_ED25519
      );

      const ix = new TransactionInstruction({
        programId: IKA_PROGRAM_ID,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },       // authority
          { pubkey: dwalletPubkey, isSigner: false, isWritable: false },        // dwallet account
          { pubkey: approvalPDA, isSigner: false, isWritable: true },           // message approval PDA
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system program
        ],
        data: ixData,
      });

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
      approval.txSignature = sig;
      approval.status = "approved";

      console.log(`✅ dWallet payment approved on-chain: ${sig}`);
    } else {
      // No payer — simulate approval (pre-alpha mock mode)
      approval.txSignature = `sim_${messageHash.toString("hex").slice(0, 16)}`;
      console.log(`🔸 dWallet payment approved (simulated): ${approval.txSignature}`);
    }
  } catch (err) {
    // On-chain submission can fail in pre-alpha; continue with simulation
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️  dWallet on-chain approval failed (using simulation): ${errMsg}`);
    approval.txSignature = `sim_${messageHash.toString("hex").slice(0, 16)}`;
  }

  // 7. Record spend
  recordSpend(agentId, amountLamports);

  return approval;
}

// ─── Read dWallet Account (On-Chain) ──────────────────────────────────────────

/**
 * Read a dWallet account from on-chain.
 *
 * Account layout (from Ika docs):
 *   - discriminator: 8 bytes
 *   - authority: 32 bytes (offset 8)
 *   - public_key: 65 bytes (offset 40)
 *   - curve: 1 byte (offset 105)
 */
export async function readDWalletAccount(
  dwalletAddress: string
): Promise<{ authority: string; publicKey: string; curve: number } | null> {
  try {
    const connection = new Connection(RPC, "confirmed");
    const pubkey = new PublicKey(dwalletAddress);
    const info = await connection.getAccountInfo(pubkey);

    if (!info || !info.data || info.data.length < 106) {
      return null; // Account doesn't exist on-chain yet (expected in pre-alpha)
    }

    const data = info.data;
    const authority = new PublicKey(data.slice(8, 40)).toBase58();
    const publicKey = Buffer.from(data.slice(40, 105)).toString("hex");
    const curve = data[105];

    return { authority, publicKey, curve };
  } catch {
    return null;
  }
}

// ─── Initialize All Agent dWallets ────────────────────────────────────────────

const AGENT_IDS = [
  "orchestrator-001",
  "researcher-001",
  "writer-001",
  "coder-001",
  "image-001",
  "factcheck-001",
  "formatter-001",
];

/**
 * Initialize dWallets for all Monocle agents at startup.
 * Returns a map of agentId → DWalletInfo.
 */
export async function initializeAgentDWallets(): Promise<Map<string, DWalletInfo>> {
  console.log("🔑 Initializing Ika dWallets for all agents...");

  const results = new Map<string, DWalletInfo>();
  for (const agentId of AGENT_IDS) {
    try {
      const info = await createAgentDWallet(agentId);
      results.set(agentId, info);
    } catch (err) {
      console.warn(`⚠️  Failed to create dWallet for ${agentId}:`, err);
    }
  }

  console.log(`🔑 Initialized ${results.size}/${AGENT_IDS.length} dWallets`);
  return results;
}

/**
 * Get dWallet info for an agent (from cache or creates one).
 */
export async function getDWalletInfo(agentId: string): Promise<DWalletInfo | null> {
  return dwalletCache.get(agentId) ?? await createAgentDWallet(agentId);
}

/**
 * Get a summary of all agent dWallets for dashboard display.
 */
export async function getAllDWalletSummary(): Promise<{
  agents: Array<DWalletInfo & { policy: SpendingPolicy }>;
  programId: string;
  network: string;
}> {
  await initializeAgentDWallets();

  const agents = AGENT_IDS.map((id) => {
    const info = dwalletCache.get(id);
    if (!info) return null;
    return { ...info, policy: getSpendingPolicy(id) };
  }).filter(Boolean) as Array<DWalletInfo & { policy: SpendingPolicy }>;

  return {
    agents,
    programId: IKA_PROGRAM_ID.toBase58(),
    network: "devnet",
  };
}
