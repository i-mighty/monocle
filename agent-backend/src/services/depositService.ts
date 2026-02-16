/**
 * Solana Deposit Service
 * 
 * Handles real SOL deposits to fund agent accounts.
 * 
 * Architecture:
 * - Platform has a single "treasury" address (from SOLANA_PAYER_SECRET)
 * - Each agent gets a unique reference ID for deposits
 * - Deposits are tracked via transaction signature + memo
 * - Balance is credited after confirmation
 */

import { 
  Connection, 
  PublicKey, 
  Keypair,
  LAMPORTS_PER_SOL,
  ParsedTransactionWithMeta,
  ConfirmedSignatureInfo
} from "@solana/web3.js";
import { query } from "../db/client";
import crypto from "crypto";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");

// Platform treasury keypair
let treasuryKeypair: Keypair | null = null;
let treasuryAddress: string | null = null;

try {
  const secret = process.env.SOLANA_PAYER_SECRET;
  if (secret) {
    treasuryKeypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret)));
    treasuryAddress = treasuryKeypair.publicKey.toBase58();
    console.log(`[Deposits] Treasury address: ${treasuryAddress}`);
  }
} catch (e) {
  console.error("[Deposits] Failed to load treasury keypair:", e);
}

// ============================================================================
// DEPOSIT ADDRESS GENERATION
// ============================================================================

/**
 * Get the platform's treasury address for deposits.
 * All agents deposit to this single address with their agentId as reference.
 */
export function getTreasuryAddress(): string {
  if (!treasuryAddress) {
    throw new Error("Treasury not configured. Set SOLANA_PAYER_SECRET.");
  }
  return treasuryAddress;
}

/**
 * Generate a unique deposit reference for an agent.
 * This is used to identify which agent a deposit belongs to.
 */
export function generateDepositReference(agentId: string): string {
  // Create a deterministic but unique reference
  const hash = crypto.createHash("sha256")
    .update(`deposit:${agentId}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16);
  return `DEP-${hash.toUpperCase()}`;
}

/**
 * Get or create a pending deposit record for an agent.
 * Returns deposit instructions with address and reference.
 */
export async function createDepositIntent(agentId: string, amountLamports?: number): Promise<{
  depositAddress: string;
  reference: string;
  expectedAmount: number | null;
  expiresAt: Date;
  instructions: string;
  qrData: string;
}> {
  const address = getTreasuryAddress();
  const reference = generateDepositReference(agentId);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Store pending deposit intent
  await query(
    `INSERT INTO deposit_intents (agent_id, reference, expected_amount_lamports, deposit_address, expires_at, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (reference) DO UPDATE SET updated_at = NOW()`,
    [agentId, reference, amountLamports || null, address, expiresAt]
  );

  // Solana Pay compatible QR data
  const qrData = amountLamports 
    ? `solana:${address}?amount=${amountLamports / LAMPORTS_PER_SOL}&reference=${reference}&label=AgentPay&message=Deposit+for+${agentId}`
    : `solana:${address}?reference=${reference}&label=AgentPay&message=Deposit+for+${agentId}`;

  return {
    depositAddress: address,
    reference,
    expectedAmount: amountLamports || null,
    expiresAt,
    instructions: `Send SOL to ${address}. Include reference: ${reference} in memo.`,
    qrData
  };
}

// ============================================================================
// DEPOSIT VERIFICATION
// ============================================================================

/**
 * Verify a deposit transaction on Solana.
 * Checks that the transaction:
 * 1. Exists and is confirmed
 * 2. Sent SOL to our treasury
 * 3. Has not already been credited
 */
export async function verifyDeposit(txSignature: string, agentId: string): Promise<{
  success: boolean;
  amountLamports: number;
  error?: string;
  alreadyCredited?: boolean;
}> {
  try {
    // Check if already processed
    const existing = await query(
      `SELECT id, amount_lamports, status FROM deposits WHERE tx_signature = $1`,
      [txSignature]
    );

    if (existing.rows.length > 0) {
      const deposit = existing.rows[0];
      return {
        success: deposit.status === "confirmed",
        amountLamports: Number(deposit.amount_lamports),
        alreadyCredited: true
      };
    }

    // Fetch transaction from Solana
    const tx = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0
    });

    if (!tx) {
      return { success: false, amountLamports: 0, error: "Transaction not found" };
    }

    if (!tx.meta || tx.meta.err) {
      return { success: false, amountLamports: 0, error: "Transaction failed" };
    }

    // Find SOL transfer to our treasury
    const treasuryPubkey = getTreasuryAddress();
    let depositAmount = 0;

    // Check pre/post balances for treasury
    const accountKeys = tx.transaction.message.accountKeys;
    const treasuryIndex = accountKeys.findIndex(
      (key) => key.pubkey.toBase58() === treasuryPubkey
    );

    if (treasuryIndex >= 0 && tx.meta.preBalances && tx.meta.postBalances) {
      const preBalance = tx.meta.preBalances[treasuryIndex];
      const postBalance = tx.meta.postBalances[treasuryIndex];
      depositAmount = postBalance - preBalance;
    }

    if (depositAmount <= 0) {
      return { 
        success: false, 
        amountLamports: 0, 
        error: "No deposit to treasury found in transaction" 
      };
    }

    // Record the deposit
    await query(
      `INSERT INTO deposits (agent_id, tx_signature, amount_lamports, status, confirmed_at)
       VALUES ($1, $2, $3, 'confirmed', NOW())`,
      [agentId, txSignature, depositAmount]
    );

    // Credit the agent's balance
    await query(
      `UPDATE agents SET balance_lamports = balance_lamports + $1 WHERE id = $2`,
      [depositAmount, agentId]
    );

    // Log the deposit
    console.log(`[Deposits] Credited ${depositAmount} lamports to ${agentId} from tx ${txSignature}`);

    return {
      success: true,
      amountLamports: depositAmount
    };
  } catch (error) {
    console.error("[Deposits] Verification error:", error);
    return {
      success: false,
      amountLamports: 0,
      error: (error as Error).message
    };
  }
}

// ============================================================================
// DEPOSIT MONITORING
// ============================================================================

/**
 * Scan recent transactions to the treasury for unprocessed deposits.
 * This can be run periodically to auto-credit deposits.
 */
export async function scanForDeposits(limit: number = 20): Promise<{
  scanned: number;
  credited: number;
  deposits: Array<{ agentId: string; amount: number; txSignature: string }>;
}> {
  if (!treasuryAddress) {
    return { scanned: 0, credited: 0, deposits: [] };
  }

  const credited: Array<{ agentId: string; amount: number; txSignature: string }> = [];

  try {
    // Get recent signatures
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey(treasuryAddress),
      { limit }
    );

    for (const sigInfo of signatures) {
      // Skip if already processed
      const existing = await query(
        `SELECT id FROM deposits WHERE tx_signature = $1`,
        [sigInfo.signature]
      );

      if (existing.rows.length > 0) continue;

      // Check if there's a matching deposit intent
      // For now, we'll look for intents created in the last 24h
      const intent = await query(
        `SELECT agent_id FROM deposit_intents 
         WHERE status = 'pending' AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`
      );

      if (intent.rows.length > 0) {
        const agentId = intent.rows[0].agent_id;
        const result = await verifyDeposit(sigInfo.signature, agentId);
        
        if (result.success && !result.alreadyCredited) {
          credited.push({
            agentId,
            amount: result.amountLamports,
            txSignature: sigInfo.signature
          });

          // Mark intent as completed
          await query(
            `UPDATE deposit_intents SET status = 'completed' WHERE agent_id = $1 AND status = 'pending'`,
            [agentId]
          );
        }
      }
    }

    return {
      scanned: signatures.length,
      credited: credited.length,
      deposits: credited
    };
  } catch (error) {
    console.error("[Deposits] Scan error:", error);
    return { scanned: 0, credited: 0, deposits: [] };
  }
}

// ============================================================================
// DEPOSIT HISTORY
// ============================================================================

/**
 * Get deposit history for an agent.
 */
export async function getDepositHistory(agentId: string, limit: number = 50): Promise<Array<{
  id: string;
  txSignature: string;
  amountLamports: number;
  amountSOL: number;
  status: string;
  confirmedAt: string;
}>> {
  const result = await query(
    `SELECT id, tx_signature, amount_lamports, status, confirmed_at
     FROM deposits
     WHERE agent_id = $1
     ORDER BY confirmed_at DESC
     LIMIT $2`,
    [agentId, limit]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    txSignature: row.tx_signature,
    amountLamports: Number(row.amount_lamports),
    amountSOL: Number(row.amount_lamports) / LAMPORTS_PER_SOL,
    status: row.status,
    confirmedAt: row.confirmed_at
  }));
}

/**
 * Get pending deposit intents for an agent.
 */
export async function getPendingDeposits(agentId: string): Promise<Array<{
  reference: string;
  expectedAmount: number | null;
  depositAddress: string;
  expiresAt: string;
  createdAt: string;
}>> {
  const result = await query(
    `SELECT reference, expected_amount_lamports, deposit_address, expires_at, created_at
     FROM deposit_intents
     WHERE agent_id = $1 AND status = 'pending' AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [agentId]
  );

  return result.rows.map((row: any) => ({
    reference: row.reference,
    expectedAmount: row.expected_amount_lamports ? Number(row.expected_amount_lamports) : null,
    depositAddress: row.deposit_address,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  }));
}

// ============================================================================
// WITHDRAWALS (Agent -> External Wallet)
// ============================================================================

/**
 * Withdraw SOL from agent's balance to their external wallet.
 * The agent must have a public_key set.
 */
export async function withdrawToWallet(agentId: string, amountLamports: number): Promise<{
  success: boolean;
  txSignature?: string;
  error?: string;
}> {
  if (!treasuryKeypair) {
    return { success: false, error: "Treasury not configured" };
  }

  try {
    // Get agent details
    const agentResult = await query(
      `SELECT public_key, balance_lamports FROM agents WHERE id = $1`,
      [agentId]
    );

    if (agentResult.rows.length === 0) {
      return { success: false, error: "Agent not found" };
    }

    const agent = agentResult.rows[0];

    if (!agent.public_key) {
      return { success: false, error: "Agent has no wallet address set" };
    }

    if (Number(agent.balance_lamports) < amountLamports) {
      return { success: false, error: "Insufficient balance" };
    }

    // Deduct from balance first
    await query(
      `UPDATE agents SET balance_lamports = balance_lamports - $1 WHERE id = $2`,
      [amountLamports, agentId]
    );

    try {
      // Send SOL
      const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import("@solana/web3.js");
      
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: treasuryKeypair.publicKey,
          toPubkey: new PublicKey(agent.public_key),
          lamports: amountLamports
        })
      );

      const signature = await sendAndConfirmTransaction(connection, tx, [treasuryKeypair]);

      // Record withdrawal
      await query(
        `INSERT INTO withdrawals (agent_id, tx_signature, amount_lamports, to_address, status)
         VALUES ($1, $2, $3, $4, 'confirmed')`,
        [agentId, signature, amountLamports, agent.public_key]
      );

      console.log(`[Withdrawals] Sent ${amountLamports} lamports to ${agent.public_key}: ${signature}`);

      return { success: true, txSignature: signature };
    } catch (txError) {
      // Refund balance on failure
      await query(
        `UPDATE agents SET balance_lamports = balance_lamports + $1 WHERE id = $2`,
        [amountLamports, agentId]
      );
      return { success: false, error: (txError as Error).message };
    }
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export default {
  getTreasuryAddress,
  createDepositIntent,
  verifyDeposit,
  scanForDeposits,
  getDepositHistory,
  getPendingDeposits,
  withdrawToWallet
};
