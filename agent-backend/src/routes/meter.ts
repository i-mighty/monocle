import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { logToolCall, getToolCallHistory } from "../services/meterService";
import { 
  getAgentMetrics, 
  registerTool, 
  listAgentTools, 
  updateToolPricing,
  getToolPricing 
} from "../services/pricingService";
import { db, toolUsage } from "../db/client";
import { desc } from "drizzle-orm";
import { logToolExecuted } from "../services/activityService";

const router = Router();

/**
 * POST /meter/execute
 *
 * Execute a tool call with pricing enforcement.
 * Supports optional quoteId for frozen pricing.
 *
 * Request:
 *   {
 *     callerId: string (agent making the call)
 *     calleeId: string (agent being called)
 *     toolName: string
 *     tokensUsed: number
 *     quoteId?: string (optional - locks in quoted price)
 *   }
 *
 * Response (200):
 *   {
 *     callerId, calleeId, toolName, tokensUsed, costLamports,
 *     pricingSource: "quote" | "live",
 *     quoteId?: string,
 *     pricingFrozenAt?: string
 *   }
 *
 * Error (400/402/500):
 *   - Insufficient balance (402)
 *   - Quote expired/invalid (400)
 *   - Agent not found
 *   - Transaction failed
 */
router.post("/execute", apiKeyAuth, async (req, res) => {
  try {
    const { callerId, calleeId, toolName, tokensUsed, quoteId } = req.body;

    if (!callerId || !calleeId || !toolName || tokensUsed === undefined) {
      return res.status(400).json({
        error: "Missing required fields: callerId, calleeId, toolName, tokensUsed",
      });
    }

    const result = await logToolCall(
      callerId, 
      calleeId, 
      toolName, 
      Number(tokensUsed),
      quoteId // Pass optional quoteId
    );

    // Log tool execution for audit trail
    logToolExecuted(
      callerId,
      calleeId,
      toolName,
      Number(tokensUsed),
      result.costLamports,
      result.pricingSource || "live",
      { quoteId }
    );
    
    res.json({
      ...result,
      // Format dates if present
      pricingFrozenAt: result.pricingFrozenAt?.toISOString?.() || result.pricingFrozenAt,
    });
  } catch (error) {
    const message = (error as Error).message;
    let statusCode = 500;
    if (message.includes("Insufficient balance")) statusCode = 402;
    if (message.includes("Quote")) statusCode = 400;
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
    if (!db) {
      return res.json([]);
    }
    const rows = await db
      .select()
      .from(toolUsage)
      .orderBy(desc(toolUsage.createdAt))
      .limit(100);
    res.json(rows || []);
  } catch (error) {
    console.error("Error fetching logs:", error);
    res.json([]);
  }
});

// =============================================================================
// TOOL MANAGEMENT ROUTES (Per-Tool Pricing)
// =============================================================================

/**
 * POST /meter/tools
 *
 * Register a new tool with its pricing.
 *
 * Request:
 *   {
 *     agentId: string,
 *     name: string,
 *     description?: string,
 *     ratePer1kTokens: number
 *   }
 */
router.post("/tools", apiKeyAuth, async (req, res) => {
  try {
    const { agentId, name, description, ratePer1kTokens } = req.body;

    if (!agentId || !name || ratePer1kTokens === undefined) {
      return res.status(400).json({
        error: "Missing required fields: agentId, name, ratePer1kTokens",
      });
    }

    const tool = await registerTool({
      agentId,
      name,
      description,
      ratePer1kTokens: Number(ratePer1kTokens),
    });

    res.status(201).json(tool);
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes("not found") ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
});

/**
 * GET /meter/tools/:agentId
 *
 * List all tools for an agent with their pricing.
 */
router.get("/tools/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const tools = await listAgentTools(agentId);
    res.json(tools);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /meter/tools/:agentId/:toolName/pricing
 *
 * Get pricing for a specific tool (or agent default if tool not registered).
 */
router.get("/tools/:agentId/:toolName/pricing", apiKeyAuth, async (req, res) => {
  try {
    const { agentId, toolName } = req.params;
    const pricing = await getToolPricing(agentId, toolName);
    res.json({
      agentId,
      toolName,
      ...pricing,
    });
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes("not found") ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
});

/**
 * PATCH /meter/tools/:agentId/:toolName
 *
 * Update pricing for a specific tool.
 *
 * Request:
 *   { ratePer1kTokens: number }
 */
router.patch("/tools/:agentId/:toolName", apiKeyAuth, async (req, res) => {
  try {
    const { agentId, toolName } = req.params;
    const { ratePer1kTokens } = req.body;

    if (ratePer1kTokens === undefined) {
      return res.status(400).json({
        error: "Missing required field: ratePer1kTokens",
      });
    }

    const tool = await updateToolPricing(agentId, toolName, Number(ratePer1kTokens));
    res.json(tool);
  } catch (error) {
    const message = (error as Error).message;
    const statusCode = message.includes("not found") ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
});

export default router;

