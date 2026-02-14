import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import { demoOnly } from "../middleware/demoOnly";
import { sendMicropayment } from "../services/solanaService";
import {
  settleAgent,
  checkSettlementEligibility,
  getAgentMetrics,
  PRICING_CONSTANTS,
} from "../services/pricingService";
import { query } from "../db/client";
import { logSettlementCompleted, logPaymentExecuted } from "../services/activityService";

const router = Router();

/**
 * POST /payments/settle/:agentId
 *
 * Trigger on-chain settlement for an agent.
 *
 * Workflow:
 *   1. Check if agent has pending balance above minimum threshold
 *   2. Create settlement record (status = pending)
 *   3. Send Solana transaction (payout minus platform fee)
 *   4. On confirmation, clear pending balance and record platform fee
 *
 * Response (200):
 *   {
 *     settlementId, agentId, pending, platformFee, payout, txSignature, status
 *   }
 *
 * Error:
 *   - 404: Agent not found
 *   - 402: Insufficient pending balance
 *   - 500: Transaction failed
 */
router.post("/settle/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    // Check eligibility before attempting settlement
    const eligible = await checkSettlementEligibility(agentId);
    if (!eligible) {
      const metrics = await getAgentMetrics(agentId);
      return res.status(402).json({
        error: `Pending balance (${metrics.pendingLamports}) below minimum payout threshold (${PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS})`,
        currentPending: metrics.pendingLamports,
        minimumRequired: PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS,
      });
    }

       // Execute settlement (atomic)
    // The sendMicropayment needs: sender (payer), receiver (agent), amount
    const payerPublicKey = process.env.SOLANA_PAYER_PUBLIC_KEY;
    if (!payerPublicKey) {
      return res.status(500).json({ error: "Solana payer not configured" });
    }

    const result = await settleAgent(agentId, async (recipientId, lamports) => {
      return await sendMicropayment(payerPublicKey, recipientId, lamports);
    });

    // Log settlement completion
    logSettlementCompleted(
      agentId,
      result.settlementId || "unknown",
      result.grossLamports || 0,
      result.platformFeeLamports || 0,
      result.netLamports || 0,
      result.txSignature || ""
    );

    res.json(result);
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes("not found") ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
});

/**
 * GET /payments/settlements/:agentId
 *
 * Fetch settlement history for an agent.
 */
router.get("/settlements/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 500);

    const { rows } = await query(
      `select id, from_agent_id, to_agent_id, gross_lamports, platform_fee_lamports, net_lamports,
              tx_signature, status, created_at
       from settlements
       where from_agent_id = $1 or to_agent_id = $1
       order by created_at desc
       limit $2`,
      [agentId, limit]
    );

    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching settlements:", error);
    res.status(500).json({ error: "Failed to fetch settlements" });
  }
});

/**
 * POST /payments/topup
 *
 * Top up an agent's balance (for testing/development).
 * DEMO ENDPOINT: Disabled in production unless ALLOW_DEMO_ENDPOINTS=true
 *
 * Request:
 *   { agentId: string, amountLamports: number }
 */
router.post("/topup", apiKeyAuth, demoOnly, async (req, res) => {
  try {
    const { agentId, amountLamports } = req.body;

    if (!agentId || !amountLamports || amountLamports <= 0) {
      return res.status(400).json({
        error: "Invalid request: agentId and positive amountLamports required",
      });
    }

    // Update agent balance
    const result = await query(
      "update agents set balance_lamports = balance_lamports + $1 where id = $2 returning id, balance_lamports, pending_lamports",
      [Math.floor(Number(amountLamports)), agentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const agent = result.rows[0] as {
      id: string;
      balance_lamports: number;
      pending_lamports: number;
    };

    // Log topup payment
    logPaymentExecuted(agentId, "topup", amountLamports, {
      newBalance: agent.balance_lamports,
    });

    res.json({
      agentId: agent.id,
      amountAdded: amountLamports,
      newBalance: agent.balance_lamports,
      pendingBalance: agent.pending_lamports,
    });
  } catch (error) {
    console.error("Topup error:", error);
    res.status(500).json({ error: "Topup failed" });
  }
});

/**
 * GET /payments/metrics/:agentId
 *
 * Fetch agent's economic state (pricing, balance, usage, earnings).
 */
router.get("/metrics/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const metrics = await getAgentMetrics(agentId);
    res.json(metrics);
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes("not found") ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
});

/**
 * GET /payments/ (Legacy compatibility)
 *
 * Fetch recent settlements.
 */
router.get("/", apiKeyAuth, async (_req, res) => {
  try {
    const { rows } = await query(
      `select id, from_agent_id, to_agent_id, gross_lamports, platform_fee_lamports, net_lamports,
              tx_signature, status, created_at
       from settlements
       order by created_at desc
       limit 100`
    );
    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.json([]);
  }
});

export default router;

