import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { query } from "../db/client";
import { calculateCost, getAgentMetrics, PRICING_CONSTANTS } from "../services/pricingService";

const router = Router();

/**
 * POST /agents/register
 *
 * Register a new agent with pricing configuration.
 *
 * Request:
 *   {
 *     agentId: string (unique identifier)
 *     name?: string (display name)
 *     publicKey?: string (Solana public key for settlements)
 *     ratePer1kTokens?: number (lamports per 1K tokens, default 1000)
 *   }
 *
 * Response (201):
 *   {
 *     agentId, name, publicKey, ratePer1kTokens, balanceLamports, pendingLamports
 *   }
 */
router.post("/register", apiKeyAuth, async (req, res) => {
  try {
    const { agentId, name, publicKey, ratePer1kTokens } = req.body;

    if (!agentId) {
      return res.status(400).json({ error: "agentId is required" });
    }

    // Validate rate (must be positive integer)
    const rate = ratePer1kTokens ? Math.max(1, Math.floor(Number(ratePer1kTokens))) : 1000;

    const result = await query(
      `insert into agents (id, name, public_key, rate_per_1k_tokens, balance_lamports, pending_lamports)
       values ($1, $2, $3, $4, 0, 0)
       on conflict (id) do update set
         name = coalesce(excluded.name, agents.name),
         public_key = coalesce(excluded.public_key, agents.public_key)
       returning id, name, public_key, rate_per_1k_tokens, balance_lamports, pending_lamports`,
      [agentId, name || null, publicKey || null, rate]
    );

    const agent = result.rows[0];
    res.status(201).json({
      agentId: agent.id,
      name: agent.name,
      publicKey: agent.public_key,
      ratePer1kTokens: Number(agent.rate_per_1k_tokens),
      balanceLamports: Number(agent.balance_lamports),
      pendingLamports: Number(agent.pending_lamports),
    });
  } catch (error) {
    console.error("Agent registration error:", error);
    res.status(500).json({ error: "Failed to register agent" });
  }
});

/**
 * GET /agents/:agentId
 *
 * Fetch agent details including pricing and balances.
 */
router.get("/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    const result = await query(
      `select id, name, public_key, rate_per_1k_tokens, balance_lamports, pending_lamports, created_at
       from agents where id = $1`,
      [agentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const agent = result.rows[0];
    res.json({
      agentId: agent.id,
      name: agent.name,
      publicKey: agent.public_key,
      ratePer1kTokens: Number(agent.rate_per_1k_tokens),
      balanceLamports: Number(agent.balance_lamports),
      pendingLamports: Number(agent.pending_lamports),
      createdAt: agent.created_at,
    });
  } catch (error) {
    console.error("Error fetching agent:", error);
    res.status(500).json({ error: "Failed to fetch agent" });
  }
});

/**
 * PATCH /agents/:agentId/pricing
 *
 * Update an agent's pricing rate.
 * NOTE: This only affects FUTURE calls. Past executions are immutable.
 *
 * Request:
 *   { ratePer1kTokens: number }
 */
router.patch("/:agentId/pricing", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { ratePer1kTokens } = req.body;

    if (!ratePer1kTokens || ratePer1kTokens <= 0) {
      return res.status(400).json({
        error: "ratePer1kTokens must be a positive integer (lamports)",
      });
    }

    const rate = Math.max(1, Math.floor(Number(ratePer1kTokens)));

    const result = await query(
      `update agents set rate_per_1k_tokens = $1 where id = $2
       returning id, rate_per_1k_tokens, balance_lamports, pending_lamports`,
      [rate, agentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const agent = result.rows[0];
    res.json({
      agentId: agent.id,
      ratePer1kTokens: Number(agent.rate_per_1k_tokens),
      balanceLamports: Number(agent.balance_lamports),
      pendingLamports: Number(agent.pending_lamports),
      message: "Pricing updated. Only future calls will use this rate.",
    });
  } catch (error) {
    console.error("Error updating pricing:", error);
    res.status(500).json({ error: "Failed to update pricing" });
  }
});

/**
 * GET /agents/:agentId/metrics
 *
 * Fetch comprehensive agent metrics (balances, usage, earnings).
 */
router.get("/:agentId/metrics", apiKeyAuth, async (req, res) => {
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
 * POST /agents/quote
 *
 * Calculate the cost of a hypothetical tool call WITHOUT executing it.
 * Useful for agents to check affordability before making a call.
 *
 * Request:
 *   { calleeId: string, tokensUsed: number }
 *
 * Response:
 *   { calleeId, tokensUsed, ratePer1kTokens, costLamports }
 */
router.post("/quote", apiKeyAuth, async (req, res) => {
  try {
    const { calleeId, tokensUsed } = req.body;

    if (!calleeId || tokensUsed === undefined) {
      return res.status(400).json({
        error: "calleeId and tokensUsed are required",
      });
    }

    const tokens = Number(tokensUsed);
    if (tokens < 0 || tokens > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
      return res.status(400).json({
        error: `tokensUsed must be between 0 and ${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL}`,
      });
    }

    // Fetch callee's rate
    const result = await query(
      "select rate_per_1k_tokens from agents where id = $1",
      [calleeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const ratePer1kTokens = Number(result.rows[0].rate_per_1k_tokens);
    const costLamports = calculateCost(tokens, ratePer1kTokens);

    res.json({
      calleeId,
      tokensUsed: tokens,
      ratePer1kTokens,
      costLamports,
      minimumCost: PRICING_CONSTANTS.MIN_COST_LAMPORTS,
    });
  } catch (error) {
    console.error("Error calculating quote:", error);
    res.status(500).json({ error: "Failed to calculate quote" });
  }
});

/**
 * GET /agents
 *
 * List all registered agents (paginated).
 */
router.get("/", apiKeyAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Number(req.query.offset) || 0;

    const result = await query(
      `select id, name, public_key, rate_per_1k_tokens, balance_lamports, pending_lamports, created_at
       from agents
       order by created_at desc
       limit $1 offset $2`,
      [limit, offset]
    );

    res.json(
      result.rows.map((agent: any) => ({
        agentId: agent.id,
        name: agent.name,
        publicKey: agent.public_key,
        ratePer1kTokens: Number(agent.rate_per_1k_tokens),
        balanceLamports: Number(agent.balance_lamports),
        pendingLamports: Number(agent.pending_lamports),
        createdAt: agent.created_at,
      }))
    );
  } catch (error) {
    console.error("Error listing agents:", error);
    res.status(500).json({ error: "Failed to list agents" });
  }
});

export default router;
