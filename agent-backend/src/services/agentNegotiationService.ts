/**
 * agentNegotiationService.ts
 *
 * Handles price negotiation between agents:
 *   1. Requester asks for a quote
 *   2. Provider calculates price and responds
 *   3. Requester accepts or rejects
 *   4. On acceptance: escrow hold created, work begins
 */

import { query } from "../db/client";
import { EventEmitter } from "events";
import { signMessage, verifyAgentMessage, SignedPayload } from "./agentIdentityService";
import { getSolName } from "./snsIdentityService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuoteRequest {
  sessionId: string;
  requesterId: string;
  providerId: string;
  taskType: string;
  taskDescription: string;
  estimatedTokens: number;
  maxBudgetLamports: number;
  depth: number;
  parentMessageId?: string;
}

export interface QuoteResponse {
  negotiationId: string;
  providerId: string;
  providerName: string;
  taskType: string;
  quotedLamports: bigint;
  estimatedTokens: number;
  ratePer1kTokens: bigint;
  expiresAt: Date;
  accepted: boolean;
}

export interface NegotiationResult {
  success: boolean;
  negotiationId: string;
  agreedLamports: bigint;
  providerAgent: AgentRecord;
  messageId: string;
}

interface AgentRecord {
  id: string;
  name: string;
  default_rate_per_1k_tokens: bigint;
  balance_lamports: bigint;
}

// ─── Event bus for SSE streaming to UI ───────────────────────────────────────
export const negotiationEvents = new EventEmitter();
negotiationEvents.setMaxListeners(100);

export function emitNegotiationEvent(sessionId: string, event: object) {
  negotiationEvents.emit(`session:${sessionId}`, event);
  negotiationEvents.emit("all", { sessionId, ...event as object });
}

// ─── Calculate quote ──────────────────────────────────────────────────────────
function calculateQuote(
  ratePer1kTokens: bigint,
  estimatedTokens: number
): bigint {
  const MIN_COST = 100n;
  const tokenBlocks = BigInt(Math.ceil(estimatedTokens / 1000));
  const raw = tokenBlocks * ratePer1kTokens;
  return raw < MIN_COST ? MIN_COST : raw;
}

// ─── Log agent message to DB (signed) ─────────────────────────────────────────
async function logAgentMessage(
  sessionId: string,
  fromAgentId: string,
  toAgentId: string,
  messageType: string,
  content: object,
  depth: number,
  parentMessageId?: string
): Promise<string> {
  // Sign the message with the sender's identity
  const signed = signMessage(fromAgentId, {
    sessionId,
    from: fromAgentId,
    to: toAgentId,
    type: messageType,
    content,
    depth,
    timestamp: new Date().toISOString(),
  });

  const signedContent = {
    ...content,
    _identity: {
      signature: signed.signature,
      signerPublicKey: signed.signerPublicKey,
      signedAt: signed.signedAt,
    },
  };

  const result = await query(
    `INSERT INTO agent_messages
       (session_id, from_agent_id, to_agent_id, message_type, content, depth, parent_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [sessionId, fromAgentId, toAgentId, messageType, JSON.stringify(signedContent), depth, parentMessageId ?? null]
  );
  return result.rows[0].id;
}

// ─── REQUEST QUOTE ────────────────────────────────────────────────────────────
export async function requestQuote(req: QuoteRequest): Promise<QuoteResponse> {
  // Get provider agent's rate
  const agentResult = await query(
    `SELECT id, name, default_rate_per_1k_tokens, balance_lamports FROM agents WHERE id = $1`,
    [req.providerId]
  );

  if (agentResult.rows.length === 0) {
    throw new Error(`Agent ${req.providerId} not found`);
  }

  const provider: AgentRecord = agentResult.rows[0];
  const quotedLamports = calculateQuote(
    BigInt(provider.default_rate_per_1k_tokens),
    req.estimatedTokens
  );

  const expiresAt = new Date(Date.now() + 30_000); // 30 second quote validity

  // Record negotiation
  const negResult = await query(
    `INSERT INTO agent_negotiations
       (session_id, requester_agent_id, provider_agent_id, task_type,
        estimated_tokens, quoted_lamports, status, quote_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
     RETURNING id`,
    [req.sessionId, req.requesterId, req.providerId, req.taskType,
     req.estimatedTokens, quotedLamports.toString(), expiresAt]
  );

  const negotiationId = negResult.rows[0].id;

  // Log quote_request message
  await logAgentMessage(req.sessionId, req.requesterId, req.providerId, "quote_request", {
    taskType: req.taskType,
    taskDescription: req.taskDescription,
    estimatedTokens: req.estimatedTokens,
    maxBudget: req.maxBudgetLamports,
    negotiationId,
  }, req.depth, req.parentMessageId);

  // Emit for UI — include identity info
  const [requesterSolName, providerSolName] = await Promise.all([
    getSolName(req.requesterId),
    getSolName(req.providerId),
  ]);

  emitNegotiationEvent(req.sessionId, {
    type: "quote_requested",
    depth: req.depth,
    fromAgent: { id: req.requesterId, solName: requesterSolName },
    toAgent: { id: req.providerId, name: provider.name, solName: providerSolName },
    taskType: req.taskType,
    taskDescription: req.taskDescription,
    negotiationId,
    identity: { signed: true, signerPublicKey: signMessage(req.requesterId, {}).signerPublicKey },
    timestamp: new Date().toISOString(),
  });

  // Small delay to make negotiation feel real in the UI
  await sleep(400);

  // Log quote_response from provider
  await logAgentMessage(req.sessionId, req.providerId, req.requesterId, "quote_response", {
    negotiationId,
    quotedLamports: quotedLamports.toString(),
    ratePer1kTokens: provider.default_rate_per_1k_tokens.toString(),
    estimatedTokens: req.estimatedTokens,
    expiresAt: expiresAt.toISOString(),
  }, req.depth);

  // Emit quote response for UI — include provider identity
  emitNegotiationEvent(req.sessionId, {
    type: "quote_received",
    depth: req.depth,
    fromAgent: { id: req.providerId, name: provider.name, solName: providerSolName },
    toAgent: { id: req.requesterId, solName: requesterSolName },
    negotiationId,
    quotedLamports: quotedLamports.toString(),
    ratePer1kTokens: provider.default_rate_per_1k_tokens.toString(),
    identity: { signed: true, signerPublicKey: signMessage(req.providerId, {}).signerPublicKey },
    timestamp: new Date().toISOString(),
  });

  return {
    negotiationId,
    providerId: provider.id,
    providerName: provider.name,
    taskType: req.taskType,
    quotedLamports,
    estimatedTokens: req.estimatedTokens,
    ratePer1kTokens: BigInt(provider.default_rate_per_1k_tokens),
    expiresAt,
    accepted: false,
  };
}

// ─── ACCEPT QUOTE ─────────────────────────────────────────────────────────────
export async function acceptQuote(
  sessionId: string,
  negotiationId: string,
  requesterId: string,
  depth: number
): Promise<NegotiationResult> {
  // Load negotiation
  const negResult = await query(
    `SELECT n.*, a.name as provider_name, a.default_rate_per_1k_tokens, a.balance_lamports
     FROM agent_negotiations n
     JOIN agents a ON a.id = n.provider_agent_id
     WHERE n.id = $1 AND n.session_id = $2`,
    [negotiationId, sessionId]
  );

  if (negResult.rows.length === 0) throw new Error("Negotiation not found");
  const neg = negResult.rows[0];

  if (neg.status !== "pending") throw new Error(`Negotiation already ${neg.status}`);
  if (new Date(neg.quote_expires_at) < new Date()) {
    await query(`UPDATE agent_negotiations SET status = 'expired' WHERE id = $1`, [negotiationId]);
    throw new Error("Quote expired");
  }

  // Deduct from requester balance (escrow)
  const deductResult = await query(
    `UPDATE agents
     SET balance_lamports = balance_lamports - $1
     WHERE id = $2 AND balance_lamports >= $1
     RETURNING balance_lamports`,
    [neg.quoted_lamports, requesterId]
  );

  if (deductResult.rows.length === 0) {
    throw new Error(`Insufficient balance to pay ${neg.quoted_lamports} lamports`);
  }

  // Credit provider pending
  await query(
    `UPDATE agents SET pending_lamports = pending_lamports + $1 WHERE id = $2`,
    [neg.quoted_lamports, neg.provider_agent_id]
  );

  // Mark accepted
  await query(
    `UPDATE agent_negotiations
     SET status = 'accepted', agreed_lamports = $1, resolved_at = NOW()
     WHERE id = $2`,
    [neg.quoted_lamports, negotiationId]
  );

  // Log acceptance message
  const msgId = await logAgentMessage(
    sessionId, requesterId, neg.provider_agent_id, "acceptance",
    { negotiationId, agreedLamports: neg.quoted_lamports }, depth
  );

  // Emit for UI — include identity verification
  const [requesterSolName, providerSolName] = await Promise.all([
    getSolName(requesterId),
    getSolName(neg.provider_agent_id),
  ]);

  emitNegotiationEvent(sessionId, {
    type: "quote_accepted",
    depth,
    fromAgent: { id: requesterId, solName: requesterSolName },
    toAgent: { id: neg.provider_agent_id, name: neg.provider_name, solName: providerSolName },
    negotiationId,
    agreedLamports: neg.quoted_lamports,
    identity: {
      signed: true,
      requesterKey: signMessage(requesterId, {}).signerPublicKey,
      providerKey: signMessage(neg.provider_agent_id, {}).signerPublicKey,
    },
    timestamp: new Date().toISOString(),
  });

  await sleep(200);

  return {
    success: true,
    negotiationId,
    agreedLamports: BigInt(neg.quoted_lamports),
    providerAgent: {
      id: neg.provider_agent_id,
      name: neg.provider_name,
      default_rate_per_1k_tokens: BigInt(neg.default_rate_per_1k_tokens),
      balance_lamports: BigInt(neg.balance_lamports),
    },
    messageId: msgId,
  };
}

// ─── REJECT QUOTE (budget exceeded) ──────────────────────────────────────────
export async function rejectQuote(
  sessionId: string,
  negotiationId: string,
  requesterId: string,
  reason: string,
  depth: number
): Promise<void> {
  await query(
    `UPDATE agent_negotiations SET status = 'rejected', resolved_at = NOW() WHERE id = $1`,
    [negotiationId]
  );

  const neg = await query(
    `SELECT provider_agent_id FROM agent_negotiations WHERE id = $1`, [negotiationId]
  );

  if (neg.rows.length > 0) {
    await logAgentMessage(
      sessionId, requesterId, neg.rows[0].provider_agent_id, "rejection",
      { negotiationId, reason }, depth
    );

    emitNegotiationEvent(sessionId, {
      type: "quote_rejected",
      depth,
      negotiationId,
      reason,
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── NEGOTIATE AND PAY (convenience wrapper) ──────────────────────────────────
// Full flow: request quote → evaluate → accept or reject → return result
export async function negotiateAndPay(
  req: QuoteRequest
): Promise<NegotiationResult> {
  const quote = await requestQuote(req);

  // Reject if over budget
  if (Number(quote.quotedLamports) > req.maxBudgetLamports) {
    await rejectQuote(req.sessionId, quote.negotiationId, req.requesterId,
      `Quote ${quote.quotedLamports} exceeds budget ${req.maxBudgetLamports}`, req.depth);
    throw new Error(
      `Agent ${req.providerId} quoted ${quote.quotedLamports} lamports, exceeds budget of ${req.maxBudgetLamports}`
    );
  }

  return acceptQuote(req.sessionId, quote.negotiationId, req.requesterId, req.depth);
}

// ─── LOG RESULT MESSAGE ───────────────────────────────────────────────────────
export async function logResultMessage(
  sessionId: string,
  fromAgentId: string,
  toAgentId: string,
  result: string,
  costLamports: bigint,
  tokensUsed: number,
  depth: number,
  txSignature?: string
): Promise<void> {
  await logAgentMessage(sessionId, fromAgentId, toAgentId, "result", {
    resultPreview: result.slice(0, 200),
    costLamports: costLamports.toString(),
    tokensUsed,
    txSignature,
  }, depth);

  const [fromSolName, toSolName] = await Promise.all([
    getSolName(fromAgentId),
    getSolName(toAgentId),
  ]);

  emitNegotiationEvent(sessionId, {
    type: "result_delivered",
    depth,
    fromAgent: { id: fromAgentId, solName: fromSolName },
    toAgent: { id: toAgentId, solName: toSolName },
    resultPreview: result.slice(0, 120) + (result.length > 120 ? "..." : ""),
    costLamports: costLamports.toString(),
    tokensUsed,
    txSignature,
    identity: { signed: true, verified: true, signerPublicKey: signMessage(fromAgentId, {}).signerPublicKey },
    timestamp: new Date().toISOString(),
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
