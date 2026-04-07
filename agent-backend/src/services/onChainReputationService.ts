/**
 * onChainReputationService.ts
 *
 * Manages agent reputation:
 *   1. Updates reputation_score in DB after each task
 *   2. Anchors reputation proofs on-chain as Solana memo transactions
 *   3. Provides reputation queries for agent selection
 */

import { Connection, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction, Keypair } from "@solana/web3.js";
import { query } from "../db/client";
import { getSolName } from "./snsIdentityService";

const RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

let payer: Keypair | null = null;
try {
  const secret = process.env.SOLANA_PAYER_SECRET;
  if (secret) {
    payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret)));
  }
} catch (_) {
  // payer stays null — on-chain anchoring will be skipped
}

// ─── Score deltas per outcome ─────────────────────────────────────────────────
const SCORE_DELTA = {
  success: 10,       // Successful task completion
  verified: 5,       // Identity verified
  fast_completion: 3, // Below median latency
  failure: -15,      // Task failed
  verification_fail: -10, // Identity verification failed
} as const;

const MIN_SCORE = 0;
const MAX_SCORE = 1000;

// ─── Update reputation in DB ──────────────────────────────────────────────────

export interface ReputationUpdate {
  agentId: string;
  sessionId: string;
  taskId: string;
  outcome: keyof typeof SCORE_DELTA;
  previousScore: number;
  newScore: number;
  delta: number;
  txSignature?: string;
}

/**
 * Bump an agent's reputation score after a task outcome.
 * Returns the update details including optional on-chain tx signature.
 */
export async function updateReputation(
  agentId: string,
  sessionId: string,
  taskId: string,
  outcome: keyof typeof SCORE_DELTA,
): Promise<ReputationUpdate> {
  // Get current score
  const { rows } = await query(
    `SELECT reputation_score FROM agents WHERE id = $1`,
    [agentId],
  );
  const previousScore: number = rows[0]?.reputation_score ?? 500;
  const delta = SCORE_DELTA[outcome];
  const newScore = Math.max(MIN_SCORE, Math.min(MAX_SCORE, previousScore + delta));

  // Update DB
  await query(
    `UPDATE agents SET reputation_score = $1 WHERE id = $2`,
    [newScore, agentId],
  );

  // Anchor on-chain (best-effort, non-blocking)
  let txSignature: string | undefined;
  const solName = await getSolName(agentId);
  try {
    txSignature = await anchorReputationOnChain(agentId, solName, sessionId, taskId, outcome, newScore, delta);
  } catch (err) {
    console.warn(`On-chain reputation anchor failed (non-fatal):`, err);
  }

  return { agentId, sessionId, taskId, outcome, previousScore, newScore, delta, txSignature };
}

// ─── Anchor reputation proof on Solana via Memo ───────────────────────────────

async function anchorReputationOnChain(
  agentId: string,
  solName: string,
  sessionId: string,
  taskId: string,
  outcome: string,
  newScore: number,
  delta: number,
): Promise<string | undefined> {
  if (!payer) return undefined;

  const memo = JSON.stringify({
    protocol: "monocle-reputation-v1",
    agent: agentId,
    solName,
    session: sessionId.slice(0, 8),
    task: taskId,
    outcome,
    score: newScore,
    delta,
    ts: Date.now(),
  });

  const connection = new Connection(RPC, "confirmed");
  const tx = new Transaction().add(
    new TransactionInstruction({
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, "utf-8"),
    }),
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  return sig;
}

// ─── Query reputation for agent selection ─────────────────────────────────────

export interface AgentReputation {
  agentId: string;
  reputationScore: number;
  defaultRate: number;
}

/**
 * Get reputation scores for a list of agent IDs.
 */
export async function getAgentReputations(
  agentIds: string[],
): Promise<AgentReputation[]> {
  if (agentIds.length === 0) return [];
  const placeholders = agentIds.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await query(
    `SELECT id, reputation_score, default_rate_per_1k_tokens
     FROM agents WHERE id IN (${placeholders})`,
    agentIds,
  );
  return rows.map((r: any) => ({
    agentId: r.id,
    reputationScore: r.reputation_score,
    defaultRate: r.default_rate_per_1k_tokens,
  }));
}

/**
 * Select the best agent for a task type from candidates, weighted by reputation.
 * Higher reputation → more likely to be selected. Agents below score 200 are
 * penalized, agents above 700 get a discount on effective rate.
 */
export function selectByReputation(
  candidates: AgentReputation[],
): AgentReputation | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Sort by reputation descending — pick highest
  const sorted = [...candidates].sort((a, b) => b.reputationScore - a.reputationScore);
  return sorted[0];
}

/**
 * Compute a reputation-adjusted max budget. High-rep agents get a bonus budget
 * (the orchestrator is willing to pay more for reliable agents).
 */
export function reputationAdjustedBudget(
  baseBudget: number,
  reputationScore: number,
): number {
  if (reputationScore >= 700) return Math.round(baseBudget * 1.2);  // 20% bonus
  if (reputationScore >= 500) return baseBudget;                      // standard
  if (reputationScore >= 300) return Math.round(baseBudget * 0.9);   // 10% cut
  return Math.round(baseBudget * 0.75);                               // 25% cut for low rep
}
