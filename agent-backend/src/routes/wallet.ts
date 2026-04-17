/**
 * wallet.ts — Agent Wallet API routes
 *
 * Exposes the dWallet policy engine, payment authorization, and audit log.
 *
 * Routes:
 *   GET    /wallet              — List all wallets (summary)
 *   GET    /wallet/:agentId     — Get wallet info
 *   POST   /wallet/:agentId/authorize — Authorize a payment
 *   GET    /wallet/:agentId/policy    — Get spending policy
 *   PUT    /wallet/:agentId/policy    — Update spending policy
 *   POST   /wallet/:agentId/policy/pause  — Emergency pause
 *   POST   /wallet/:agentId/policy/resume — Resume spending
 *   POST   /wallet/:agentId/policy/check  — Dry-run policy check
 *   GET    /wallet/:agentId/audit     — Get audit log
 *   POST   /wallet/:agentId/topup     — Dev top-up
 *   POST   /wallet/:agentId/settle    — Settle pending
 */

import { Router, Request, Response } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import {
  getDWalletInfo,
  getAllDWalletSummary,
  approvePayment,
  checkSpendingPolicy,
  getSpendingPolicy,
} from "../services/ikaDWalletService";
import {
  getAgent,
  getAgentBudgetStatus,
  updateAgentBudget,
  getAgentDailySpend,
  checkBudgetConstraints,
  getToolUsageHistory,
  settleAgent,
} from "../services/pricingService";
import { getSolName } from "../services/snsIdentityService";
import { query } from "../db/client";

const router = Router();

// ─── GET /wallet — List all agent wallets ──────────────────────────────────
router.get("/", apiKeyAuth, async (_req: Request, res: Response) => {
  try {
    const summary = await getAllDWalletSummary();
    res.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── GET /wallet/:agentId — Get wallet info ────────────────────────────────
router.get("/:agentId", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const [dwallet, agent, solName] = await Promise.all([
      getDWalletInfo(agentId),
      getAgent(agentId),
      getSolName(agentId),
    ]);

    if (!dwallet) {
      res.status(404).json({ error: "Wallet not found" });
      return;
    }

    res.json({
      agentId,
      publicKey: agent.publicKey ?? dwallet.publicKey,
      dwalletAddress: dwallet.dwalletAddress,
      authority: dwallet.authority,
      curve: dwallet.curve,
      solName,
      balanceLamports: agent.balanceLamports,
      pendingLamports: agent.pendingLamports,
      createdAt: dwallet.createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(err instanceof Error && msg.includes("not found") ? 404 : 500).json({ error: msg });
  }
});

// ─── POST /wallet/:agentId/authorize — Authorize payment ───────────────────
router.post("/:agentId/authorize", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { recipient, amount, toolName, memo } = req.body;

    if (!recipient || !amount) {
      res.status(400).json({ error: "recipient and amount are required" });
      return;
    }

    // 1. Check DB-level budget constraints
    const agent = await getAgent(agentId);
    const dailySpend = await getAgentDailySpend(agentId);
    const budgetCheck = checkBudgetConstraints(agent, recipient, amount, dailySpend);

    // 2. Check dWallet spending policy
    const policyCheck = checkSpendingPolicy(agentId, amount);

    const allViolations = [
      ...budgetCheck.violations,
      ...(policyCheck.allowed ? [] : [policyCheck.reason]),
    ];

    if (allViolations.length > 0) {
      // Log rejection to audit
      await logAudit(agentId, "authorization_rejected", {
        recipient,
        amount,
        violations: allViolations,
      });

      res.json({
        authorized: false,
        agentId,
        recipient,
        amount,
        policyViolations: allViolations,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // 3. Approve via dWallet
    const approval = await approvePayment(agentId, recipient, amount, memo ?? toolName);

    // 4. Log to audit
    await logAudit(agentId, "authorization_approved", {
      recipient,
      amount,
      toolName,
      memo,
      messageHash: approval.messageHash,
      approvalPda: approval.approvalPda,
      txSignature: approval.txSignature,
    });

    res.json({
      authorized: true,
      agentId,
      recipient,
      amount,
      messageHash: approval.messageHash,
      approvalPda: approval.approvalPda,
      dwalletAddress: (await getDWalletInfo(agentId))?.dwalletAddress,
      txSignature: approval.txSignature,
      policyViolations: [],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── GET /wallet/:agentId/policy — Get spending policy ─────────────────────
router.get("/:agentId/policy", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const [dwalletPolicy, budgetStatus] = await Promise.all([
      Promise.resolve(getSpendingPolicy(agentId)),
      getAgentBudgetStatus(agentId),
    ]);

    res.json({
      agentId,
      maxPerTransaction: budgetStatus.limits.maxCostPerCall ?? dwalletPolicy.maxPerTransaction,
      dailyCap: budgetStatus.limits.dailySpendCap ?? dwalletPolicy.dailyCap,
      spentToday: budgetStatus.dailySpend.used,
      remainingToday: budgetStatus.dailySpend.remaining ?? dwalletPolicy.remainingToday,
      isPaused: budgetStatus.limits.isPaused,
      allowedRecipients: budgetStatus.limits.allowedCallees,
      timeBudgets: null, // reserved for time-windowed budgets
      lastResetAt: dwalletPolicy.lastResetAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── PUT /wallet/:agentId/policy — Update spending policy ──────────────────
router.put("/:agentId/policy", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { maxPerTransaction, dailyCap, allowedRecipients, isPaused } = req.body;

    await updateAgentBudget(agentId, {
      maxCostPerCall: maxPerTransaction,
      dailySpendCap: dailyCap,
      allowedCallees: allowedRecipients,
      isPaused,
    });

    await logAudit(agentId, "policy_updated", {
      maxPerTransaction,
      dailyCap,
      allowedRecipients,
      isPaused,
    });

    // Return updated policy
    const updated = await getAgentBudgetStatus(agentId);
    const dwalletPolicy = getSpendingPolicy(agentId);

    res.json({
      agentId,
      maxPerTransaction: updated.limits.maxCostPerCall ?? dwalletPolicy.maxPerTransaction,
      dailyCap: updated.limits.dailySpendCap ?? dwalletPolicy.dailyCap,
      spentToday: updated.dailySpend.used,
      remainingToday: updated.dailySpend.remaining ?? dwalletPolicy.remainingToday,
      isPaused: updated.limits.isPaused,
      allowedRecipients: updated.limits.allowedCallees,
      timeBudgets: null,
      lastResetAt: dwalletPolicy.lastResetAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /wallet/:agentId/policy/pause — Emergency pause ──────────────────
router.post("/:agentId/policy/pause", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { reason } = req.body ?? {};

    await updateAgentBudget(agentId, { isPaused: true });
    await logAudit(agentId, "spending_paused", { reason });

    res.json({ paused: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /wallet/:agentId/policy/resume — Resume spending ─────────────────
router.post("/:agentId/policy/resume", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    await updateAgentBudget(agentId, { isPaused: false });
    await logAudit(agentId, "spending_resumed", {});

    res.json({ paused: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /wallet/:agentId/policy/check — Dry-run policy check ─────────────
router.post("/:agentId/policy/check", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { amount, recipient } = req.body;

    if (!amount) {
      res.status(400).json({ error: "amount is required" });
      return;
    }

    const agent = await getAgent(agentId);
    const dailySpend = await getAgentDailySpend(agentId);
    const budgetCheck = checkBudgetConstraints(agent, recipient ?? "any", amount, dailySpend);
    const policyCheck = checkSpendingPolicy(agentId, amount);

    const violations = [
      ...budgetCheck.violations,
      ...(policyCheck.allowed ? [] : [policyCheck.reason]),
    ];

    res.json({ allowed: violations.length === 0, violations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── GET /wallet/:agentId/audit — Audit log ────────────────────────────────
router.get("/:agentId/audit", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const action = req.query.action as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const since = req.query.since as string | undefined;

    // Build query from both wallet_audit_log and tool_usage tables
    let auditQuery = `
      SELECT id, action, agent_id, counterparty, amount,
             details, tx_signature, created_at as timestamp
      FROM wallet_audit_log
      WHERE agent_id = $1
    `;
    const params: (string | number)[] = [agentId];
    let paramIdx = 2;

    if (action) {
      auditQuery += ` AND action = $${paramIdx++}`;
      params.push(action);
    }
    if (since) {
      auditQuery += ` AND created_at >= $${paramIdx++}`;
      params.push(since);
    }

    auditQuery += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await query(auditQuery, params);

    // Also get tool execution history for a complete audit trail
    const toolHistory = await getToolUsageHistory(agentId, Math.min(limit, 50), false);

    // Merge and de-duplicate
    const auditEntries = (result.rows ?? []).map((r: any) => ({
      id: r.id,
      action: r.action,
      agentId: r.agent_id,
      counterparty: r.counterparty,
      amount: r.amount ? Number(r.amount) : undefined,
      details: typeof r.details === "string" ? JSON.parse(r.details) : r.details ?? {},
      txSignature: r.tx_signature,
      timestamp: r.timestamp,
    }));

    // Add tool executions as audit entries
    const toolEntries = (toolHistory ?? []).map((t: any) => ({
      id: t.id,
      action: "tool_execution" as const,
      agentId,
      counterparty: t.calleeAgentId ?? t.callee_agent_id,
      amount: Number(t.costLamports ?? t.cost_lamports ?? 0),
      details: {
        toolName: t.toolName ?? t.tool_name,
        tokensUsed: t.tokensUsed ?? t.tokens_used,
        ratePer1kTokens: t.ratePer1kTokens ?? t.rate_per_1k_tokens,
      },
      timestamp: t.createdAt ?? t.created_at,
    }));

    // Combine, sort by timestamp desc, apply limit
    const combined = [...auditEntries, ...toolEntries]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    // Count total for pagination
    const countResult = await query(
      "SELECT count(*) FROM wallet_audit_log WHERE agent_id = $1",
      [agentId]
    );
    const total = Number(countResult.rows?.[0]?.count ?? 0) + (toolHistory?.length ?? 0);

    res.json({
      entries: combined,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the audit table doesn't exist yet, return empty
    if (msg.includes("wallet_audit_log")) {
      res.json({ entries: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// ─── POST /wallet/:agentId/topup — Dev top-up ──────────────────────────────
router.post("/:agentId/topup", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { lamports } = req.body;

    if (!lamports || lamports <= 0) {
      res.status(400).json({ error: "lamports must be positive" });
      return;
    }

    const result = await query(
      `UPDATE agents SET balance_lamports = balance_lamports + $1, updated_at = NOW()
       WHERE id = $2 RETURNING balance_lamports`,
      [lamports, agentId]
    );

    if (!result.rows?.length) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    await logAudit(agentId, "payment_received", { amount: lamports, source: "topup" });

    res.json({
      agentId,
      addedLamports: lamports,
      newBalance: Number(result.rows[0].balance_lamports),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /wallet/:agentId/settle — Settle pending ─────────────────────────
router.post("/:agentId/settle", apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { sendMicropayment } = await import("../services/solanaService");
    const result = await settleAgent(agentId, (recipientId, lamports) =>
      sendMicropayment(agentId, recipientId, lamports)
    );
    await logAudit(agentId, "settlement", { ...result });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("insufficient") || msg.includes("minimum") ? 402 : 500;
    res.status(status).json({ error: msg });
  }
});

// ─── Audit log helper ──────────────────────────────────────────────────────
async function logAudit(
  agentId: string,
  action: string,
  details: Record<string, unknown>,
  counterparty?: string,
  amount?: number,
  txSignature?: string,
): Promise<void> {
  try {
    await query(
      `INSERT INTO wallet_audit_log (agent_id, action, counterparty, amount, details, tx_signature)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        agentId,
        action,
        counterparty ?? (details.recipient as string) ?? null,
        amount ?? (details.amount as number) ?? null,
        JSON.stringify(details),
        txSignature ?? (details.txSignature as string) ?? null,
      ]
    );
  } catch (err) {
    // Audit log writes are best-effort; don't fail the request
    console.warn("Audit log write failed:", err);
  }
}

export default router;
