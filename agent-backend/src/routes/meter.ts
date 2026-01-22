import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { logToolCall, getToolCallHistory } from "../services/meterService";
import { getAgentMetrics } from "../services/pricingService";
import { query } from "../db/client";

const router = Router();

/**
 * POST /meter/execute
 *
 * Execute a tool call with pricing enforcement.
 *
 * Request:
 *   {
 *     callerId: string (agent making the call)
 *     calleeId: string (agent being called)
 *     toolName: string
 *     tokensUsed: number
 *   }
 *
 * Response (200):
 *   {
 *     callerId, calleeId, toolName, tokensUsed, costLamports
 *   }
 *
 * Error (400/500):
 *   - Insufficient balance
 *   - Agent not found
 *   - Transaction failed
 */
router.post("/execute", apiKeyAuth, async (req, res) => {
  try {
    const { callerId, calleeId, toolName, tokensUsed } = req.body;

    if (!callerId || !calleeId || !toolName || tokensUsed === undefined) {
      return res.status(400).json({
        error: "Missing required fields: callerId, calleeId, toolName, tokensUsed",
      });
    }

    const result = await logToolCall(callerId, calleeId, toolName, Number(tokensUsed));
    res.json(result);
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes("Insufficient balance") ? 402 : 500;
    res.status(statusCode).json({ error: message });
  }
});

/**
 * GET /meter/history/:agentId
 *
 * Fetch execution ledger for an agent (as caller).
 */
router.get("/history/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 100, 1000);

    const history = await getToolCallHistory(agentId, limit, false);
    res.json(history);
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

/**
 * GET /meter/earnings/:agentId
 *
 * Fetch execution ledger where agent is the callee (earnings history).
 */
router.get("/earnings/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 100, 1000);

    const earnings = await getToolCallHistory(agentId, limit, true);
    res.json(earnings);
  } catch (error) {
    console.error("Error fetching earnings:", error);
    res.status(500).json({ error: "Failed to fetch earnings" });
  }
});

/**
 * GET /meter/metrics/:agentId
 *
 * Fetch agent's current economic state (pricing, balance, usage, earnings).
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
 * GET /meter/logs (Legacy compatibility)
 *
 * Fetch all tool executions (most recent first).
 */
router.get("/logs", apiKeyAuth, async (_req, res) => {
  try {
    const { rows } = await query(
      `select caller_agent_id, callee_agent_id, tool_name, tokens_used, cost_lamports, created_at
       from tool_usage
       order by created_at desc
       limit 100`
    );
    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching logs:", error);
    res.json([]);
  }
});

export default router;

