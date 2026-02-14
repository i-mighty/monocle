import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { query } from "../db/client";
import { calculateCost, getAgentMetrics, PRICING_CONSTANTS } from "../services/pricingService";
import { AppError, asyncHandler, sendSuccess, ErrorCodes } from "../errors";

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
router.post("/register", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId, name, publicKey, ratePer1kTokens } = req.body;

  if (!agentId) {
    throw AppError.required("agentId");
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
  sendSuccess(res, {
    agentId: agent.id,
    name: agent.name,
    publicKey: agent.public_key,
    ratePer1kTokens: Number(agent.rate_per_1k_tokens),
    balanceLamports: Number(agent.balance_lamports),
    pendingLamports: Number(agent.pending_lamports),
  }, 201);
}));

/**
 * GET /agents/:agentId
 *
 * Fetch agent details including pricing and balances.
 */
router.get("/:agentId", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const result = await query(
    `select id, name, public_key, rate_per_1k_tokens, balance_lamports, pending_lamports, created_at
     from agents where id = $1`,
    [agentId]
  );

  if (result.rows.length === 0) {
    throw AppError.agentNotFound(agentId);
  }

  const agent = result.rows[0];
  sendSuccess(res, {
    agentId: agent.id,
    name: agent.name,
    publicKey: agent.public_key,
    ratePer1kTokens: Number(agent.rate_per_1k_tokens),
    balanceLamports: Number(agent.balance_lamports),
    pendingLamports: Number(agent.pending_lamports),
    createdAt: agent.created_at,
  });
}));

/**
 * PATCH /agents/:agentId/pricing
 *
 * Update an agent's pricing rate.
 * NOTE: This only affects FUTURE calls. Past executions are immutable.
 *
 * Request:
 *   { ratePer1kTokens: number }
 */
router.patch("/:agentId/pricing", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const { ratePer1kTokens } = req.body;

  if (!ratePer1kTokens || ratePer1kTokens <= 0) {
    throw new AppError(
      ErrorCodes.PRICING_INVALID_RATE,
      { ratePer1kTokens },
      "ratePer1kTokens must be a positive integer (lamports)"
    );
  }

  const rate = Math.max(1, Math.floor(Number(ratePer1kTokens)));

  const result = await query(
    `update agents set rate_per_1k_tokens = $1 where id = $2
     returning id, rate_per_1k_tokens, balance_lamports, pending_lamports`,
    [rate, agentId]
  );

  if (result.rows.length === 0) {
    throw AppError.agentNotFound(agentId);
  }

  const agent = result.rows[0];
  sendSuccess(res, {
    agentId: agent.id,
    ratePer1kTokens: Number(agent.rate_per_1k_tokens),
    balanceLamports: Number(agent.balance_lamports),
    pendingLamports: Number(agent.pending_lamports),
    message: "Pricing updated. Only future calls will use this rate.",
  });
}));

/**
 * GET /agents/:agentId/metrics
 *
 * Fetch comprehensive agent metrics (balances, usage, earnings).
 */
router.get("/:agentId/metrics", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const metrics = await getAgentMetrics(agentId);
  sendSuccess(res, metrics);
}));

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
router.post("/quote", apiKeyAuth, asyncHandler(async (req, res) => {
  const { calleeId, tokensUsed } = req.body;

  if (!calleeId || tokensUsed === undefined) {
    throw new AppError(
      ErrorCodes.VALIDATION_REQUIRED_FIELD,
      { fields: ["calleeId", "tokensUsed"] },
      "calleeId and tokensUsed are required"
    );
  }

  const tokens = Number(tokensUsed);
  if (tokens < 0 || tokens > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
    throw new AppError(
      ErrorCodes.VALIDATION_OUT_OF_RANGE,
      { field: "tokensUsed", min: 0, max: PRICING_CONSTANTS.MAX_TOKENS_PER_CALL, value: tokens },
      `tokensUsed must be between 0 and ${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL}`
    );
  }

  // Fetch callee's rate
  const result = await query(
    "select rate_per_1k_tokens from agents where id = $1",
    [calleeId]
  );

  if (result.rows.length === 0) {
    throw AppError.agentNotFound(calleeId);
  }

  const ratePer1kTokens = Number(result.rows[0].rate_per_1k_tokens);
  const costLamports = calculateCost(tokens, ratePer1kTokens);

  sendSuccess(res, {
    calleeId,
    tokensUsed: tokens,
    ratePer1kTokens,
    costLamports,
    minimumCost: PRICING_CONSTANTS.MIN_COST_LAMPORTS,
  });
}));

/**
 * POST /agents/fund
 *
 * Add funds to an agent's balance (for testing/demo purposes).
 * In production, this would be replaced by actual deposit verification.
 *
 * Request:
 *   { agentId: string, amount: number (lamports) }
 */
router.post("/fund", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId, amount } = req.body;

  if (!agentId || !amount) {
    throw new AppError(
      ErrorCodes.VALIDATION_REQUIRED_FIELD,
      { fields: ["agentId", "amount"] },
      "agentId and amount are required"
    );
  }

  const lamports = Math.floor(Number(amount));
  if (lamports <= 0) {
    throw AppError.invalidAmount(amount, "amount must be positive");
  }

  const result = await query(
    `update agents 
     set balance_lamports = balance_lamports + $1 
     where id = $2
     returning id, balance_lamports`,
    [lamports, agentId]
  );

  if (result.rows.length === 0) {
    throw AppError.agentNotFound(agentId);
  }

  sendSuccess(res, {
    agentId: result.rows[0].id,
    balance: Number(result.rows[0].balance_lamports),
    funded: lamports,
    message: `Added ${lamports} lamports to balance`,
  });
}));

/**
 * GET /agents/:agentId/balance
 *
 * Get agent's current balance.
 */
router.get("/:agentId/balance", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const result = await query(
    "select balance_lamports from agents where id = $1",
    [agentId]
  );

  if (result.rows.length === 0) {
    throw AppError.agentNotFound(agentId);
  }

  sendSuccess(res, {
    agentId,
    balance: Number(result.rows[0].balance_lamports),
  });
}));

/**
 * GET /agents/:agentId/pending
 *
 * Get agent's pending balance (earnings not yet settled).
 */
router.get("/:agentId/pending", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const result = await query(
    "select pending_lamports from agents where id = $1",
    [agentId]
  );

  if (result.rows.length === 0) {
    throw AppError.agentNotFound(agentId);
  }

  sendSuccess(res, {
    agentId,
    pendingBalance: Number(result.rows[0].pending_lamports),
  });
}));

/**
 * GET /agents
 *
 * List all registered agents (paginated).
 */
router.get("/", apiKeyAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;

  const result = await query(
    `select id, name, public_key, rate_per_1k_tokens, balance_lamports, pending_lamports, created_at
     from agents
     order by created_at desc
     limit $1 offset $2`,
    [limit, offset]
  );

  sendSuccess(res, result.rows.map((agent: any) => ({
    agentId: agent.id,
    name: agent.name,
    publicKey: agent.public_key,
    ratePer1kTokens: Number(agent.rate_per_1k_tokens),
    balanceLamports: Number(agent.balance_lamports),
    pendingLamports: Number(agent.pending_lamports),
    createdAt: agent.created_at,
  })));
}));

export default router;
