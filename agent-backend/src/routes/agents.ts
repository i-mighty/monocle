import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { query } from "../db/client";
import { calculateCost, getAgentMetrics, PRICING_CONSTANTS } from "../services/pricingService";
import { AppError, asyncHandler, sendSuccess, ErrorCodes } from "../errors";
import * as agentRegistry from "../services/agentRegistryService";

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

// =============================================================================
// AGENT REGISTRY ENHANCEMENTS
// =============================================================================

/**
 * GET /agents/search
 *
 * Search and discover agents by various criteria.
 *
 * Query params:
 *   - q: Search query (name, bio, id)
 *   - category: Filter by category
 *   - capability: Filter by capability
 *   - verified: Only verified agents (true/false)
 *   - minReputation: Minimum reputation score
 *   - limit: Max results (default 50)
 *   - offset: Pagination offset
 */
router.get("/search", apiKeyAuth, asyncHandler(async (req, res) => {
  const result = await agentRegistry.searchAgents({
    query: req.query.q as string,
    category: req.query.category as string,
    capability: req.query.capability as string,
    verifiedOnly: req.query.verified === "true",
    minReputationScore: req.query.minReputation ? Number(req.query.minReputation) : undefined,
    limit: req.query.limit ? Math.min(Number(req.query.limit), 100) : 50,
    offset: req.query.offset ? Number(req.query.offset) : 0,
  });

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Search failed");
  }

  sendSuccess(res, {
    agents: result.agents,
    total: result.total,
  });
}));

/**
 * GET /agents/leaderboard
 *
 * Get top agents by reputation score.
 *
 * Query params:
 *   - limit: Max results (default 50)
 *   - category: Filter by category
 */
router.get("/leaderboard", apiKeyAuth, asyncHandler(async (req, res) => {
  const result = await agentRegistry.getAgentLeaderboard({
    limit: req.query.limit ? Math.min(Number(req.query.limit), 100) : 50,
    category: req.query.category as string,
  });

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to get leaderboard");
  }

  sendSuccess(res, { leaderboard: result.leaderboard });
}));

/**
 * GET /agents/:agentId/full-profile
 *
 * Get complete agent profile including tools, audits, capabilities, and version history.
 */
router.get("/:agentId/full-profile", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const result = await agentRegistry.getAgentFullProfile(agentId);

  if (!result.success) {
    if (result.error === "Agent not found") {
      throw AppError.agentNotFound(agentId);
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to get profile");
  }

  sendSuccess(res, {
    profile: result.profile,
    tools: result.tools,
    audits: result.audits,
    capabilities: result.capabilities,
    versionHistory: result.versionHistory,
  });
}));

/**
 * PATCH /agents/:agentId/profile
 *
 * Update agent profile information.
 *
 * Request body:
 *   {
 *     name?: string,
 *     bio?: string,
 *     websiteUrl?: string,
 *     logoUrl?: string,
 *     categories?: string[],
 *     version?: string,
 *     ownerEmail?: string,
 *     supportUrl?: string
 *   }
 */
router.patch("/:agentId/profile", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const { name, bio, websiteUrl, logoUrl, categories, version, ownerEmail, supportUrl } = req.body;

  const result = await agentRegistry.updateAgentProfile(agentId, {
    agentId,
    name,
    bio,
    websiteUrl,
    logoUrl,
    categories,
    version,
    ownerEmail,
    supportUrl,
  });

  if (!result.success) {
    if (result.error === "Agent not found") {
      throw AppError.agentNotFound(agentId);
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to update profile");
  }

  sendSuccess(res, { agent: result.agent });
}));

// =============================================================================
// REPUTATION & VERIFICATION
// =============================================================================

/**
 * GET /agents/:agentId/reputation
 *
 * Get agent's current reputation score with calculation breakdown.
 */
router.get("/:agentId/reputation", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const result = await agentRegistry.calculateReputationScore(agentId);

  if (!result.success) {
    if (result.error === "Agent not found") {
      throw AppError.agentNotFound(agentId);
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to calculate reputation");
  }

  sendSuccess(res, {
    agentId,
    score: result.score,
    factors: result.factors,
  });
}));

/**
 * POST /agents/:agentId/reputation/recalculate
 *
 * Recalculate and store the agent's reputation score.
 */
router.post("/:agentId/reputation/recalculate", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const calcResult = await agentRegistry.calculateReputationScore(agentId);

  if (!calcResult.success) {
    if (calcResult.error === "Agent not found") {
      throw AppError.agentNotFound(agentId);
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, calcResult.error || "Failed to calculate reputation");
  }

  const updateResult = await agentRegistry.updateReputationScore(
    agentId,
    calcResult.score!,
    "Automatic recalculation"
  );

  if (!updateResult.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, updateResult.error || "Failed to update reputation");
  }

  sendSuccess(res, {
    agentId,
    previousScore: updateResult.previousScore,
    newScore: updateResult.newScore,
    factors: calcResult.factors,
  });
}));

/**
 * PATCH /agents/:agentId/verification
 *
 * Update agent verification status (admin endpoint).
 *
 * Request body:
 *   { status: "unverified" | "pending" | "verified" | "suspended", verifiedBy?: string }
 */
router.patch("/:agentId/verification", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const { status, verifiedBy } = req.body;

  const validStatuses = ["unverified", "pending", "verified", "suspended"];
  if (!status || !validStatuses.includes(status)) {
    throw new AppError(
      ErrorCodes.VALIDATION_INVALID_TYPE,
      { field: "status", allowed: validStatuses },
      `status must be one of: ${validStatuses.join(", ")}`
    );
  }

  const result = await agentRegistry.updateVerificationStatus(agentId, status, verifiedBy);

  if (!result.success) {
    if (result.error === "Agent not found") {
      throw AppError.agentNotFound(agentId);
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to update verification");
  }

  sendSuccess(res, {
    agentId,
    status,
    message: `Verification status updated to ${status}`,
  });
}));

// =============================================================================
// AUDITS
// =============================================================================

/**
 * GET /agents/:agentId/audits
 *
 * Get agent's audit history.
 *
 * Query params:
 *   - type: Filter by audit type
 *   - result: Filter by result (passed, failed, pending, expired)
 *   - limit: Max results
 */
router.get("/:agentId/audits", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const result = await agentRegistry.getAgentAudits(agentId, {
    type: req.query.type as string,
    result: req.query.result as string,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to get audits");
  }

  sendSuccess(res, { audits: result.audits });
}));

/**
 * POST /agents/:agentId/audits
 *
 * Create a new audit record for an agent.
 *
 * Request body:
 *   {
 *     auditType: string (e.g., "security", "compliance", "performance"),
 *     auditorId?: string,
 *     auditorName?: string,
 *     auditorType?: string ("internal", "external", "automated", "system"),
 *     summary?: string,
 *     details?: object,
 *     evidenceUrl?: string,
 *     validUntil?: string (ISO date),
 *     score?: number (0-100),
 *     notes?: string
 *   }
 */
router.post("/:agentId/audits", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const { auditType, auditorId, auditorName, auditorType, summary, details, evidenceUrl, validUntil, score, notes } = req.body;

  if (!auditType) {
    throw AppError.required("auditType");
  }

  const result = await agentRegistry.createAudit(agentId, {
    auditType,
    auditorId,
    auditorName,
    auditorType,
    summary,
    details,
    evidenceUrl,
    validUntil: validUntil ? new Date(validUntil) : undefined,
    score,
    notes,
  });

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to create audit");
  }

  sendSuccess(res, { audit: result.audit }, 201);
}));

/**
 * PATCH /agents/:agentId/audits/:auditId
 *
 * Update an audit result.
 *
 * Request body:
 *   { result: "passed" | "failed" | "pending" | "expired", score?: number, notes?: string }
 */
router.patch("/:agentId/audits/:auditId", apiKeyAuth, asyncHandler(async (req, res) => {
  const { auditId } = req.params;
  const { result: auditResult, score, notes } = req.body;

  const validResults = ["passed", "failed", "pending", "expired"];
  if (!auditResult || !validResults.includes(auditResult)) {
    throw new AppError(
      ErrorCodes.VALIDATION_INVALID_TYPE,
      { field: "result", allowed: validResults },
      `result must be one of: ${validResults.join(", ")}`
    );
  }

  const result = await agentRegistry.updateAuditResult(auditId, auditResult, score, notes);

  if (!result.success) {
    if (result.error === "Audit not found") {
      throw new AppError(ErrorCodes.AGENT_NOT_FOUND, { resource: "audit", id: auditId }, "Audit not found");
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to update audit");
  }

  sendSuccess(res, { message: "Audit updated", result: auditResult });
}));

// =============================================================================
// CAPABILITIES
// =============================================================================

/**
 * GET /agents/:agentId/capabilities
 *
 * Get agent's declared capabilities.
 */
router.get("/:agentId/capabilities", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const result = await agentRegistry.getAgentCapabilities(agentId);

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to get capabilities");
  }

  sendSuccess(res, { capabilities: result.capabilities });
}));

/**
 * POST /agents/:agentId/capabilities
 *
 * Add or update a capability for an agent.
 *
 * Request body:
 *   {
 *     capability: string,
 *     proficiencyLevel?: string ("basic", "intermediate", "advanced", "expert"),
 *     metadata?: object
 *   }
 */
router.post("/:agentId/capabilities", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const { capability, proficiencyLevel, metadata } = req.body;

  if (!capability) {
    throw AppError.required("capability");
  }

  const validLevels = ["basic", "intermediate", "advanced", "expert"];
  if (proficiencyLevel && !validLevels.includes(proficiencyLevel)) {
    throw new AppError(
      ErrorCodes.VALIDATION_INVALID_TYPE,
      { field: "proficiencyLevel", allowed: validLevels },
      `proficiencyLevel must be one of: ${validLevels.join(", ")}`
    );
  }

  const result = await agentRegistry.setCapability(agentId, capability, proficiencyLevel, metadata);

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to set capability");
  }

  sendSuccess(res, { capability: result.capability }, 201);
}));

/**
 * DELETE /agents/:agentId/capabilities/:capability
 *
 * Remove a capability from an agent.
 */
router.delete("/:agentId/capabilities/:capability", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId, capability } = req.params;

  const result = await agentRegistry.removeCapability(agentId, capability);

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to remove capability");
  }

  sendSuccess(res, { message: `Capability '${capability}' removed` });
}));

/**
 * GET /agents/by-capability/:capability
 *
 * Find agents that have a specific capability.
 *
 * Query params:
 *   - minProficiency: Minimum proficiency level
 *   - verified: Only verified agents (true/false)
 *   - limit: Max results
 */
router.get("/by-capability/:capability", apiKeyAuth, asyncHandler(async (req, res) => {
  const { capability } = req.params;

  const result = await agentRegistry.findAgentsByCapability(capability, {
    minProficiency: req.query.minProficiency as string,
    verifiedOnly: req.query.verified === "true",
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to find agents");
  }

  sendSuccess(res, { agents: result.agents });
}));

// =============================================================================
// VERSION HISTORY
// =============================================================================

/**
 * GET /agents/:agentId/version-history
 *
 * Get agent's version/change history.
 *
 * Query params:
 *   - changeType: Filter by change type
 *   - limit: Max results
 */
router.get("/:agentId/version-history", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const result = await agentRegistry.getVersionHistory(agentId, {
    changeType: req.query.changeType as string,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to get version history");
  }

  sendSuccess(res, { history: result.history });
}));

// =============================================================================
// TOOL METADATA
// =============================================================================

/**
 * PATCH /agents/:agentId/tools/:toolId/metadata
 *
 * Update tool metadata (schema, examples, categorization, deprecation).
 *
 * Request body:
 *   {
 *     description?: string,
 *     version?: string,
 *     category?: string,
 *     inputSchema?: object,
 *     outputSchema?: object,
 *     examples?: array,
 *     avgTokensPerCall?: number,
 *     maxTokensPerCall?: number,
 *     docsUrl?: string,
 *     isDeprecated?: boolean,
 *     deprecationMessage?: string
 *   }
 */
router.patch("/:agentId/tools/:toolId/metadata", apiKeyAuth, asyncHandler(async (req, res) => {
  const { toolId } = req.params;

  const result = await agentRegistry.updateToolMetadata(toolId, req.body);

  if (!result.success) {
    if (result.error === "Tool not found") {
      throw new AppError(ErrorCodes.AGENT_NOT_FOUND, { resource: "tool", id: toolId }, "Tool not found");
    }
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to update tool metadata");
  }

  sendSuccess(res, { tool: result.tool });
}));

/**
 * GET /agents/tools/by-category/:category
 *
 * Get tools by category across all agents.
 *
 * Query params:
 *   - verified: Only from verified agents (true/false)
 *   - limit: Max results
 */
router.get("/tools/by-category/:category", apiKeyAuth, asyncHandler(async (req, res) => {
  const { category } = req.params;

  const result = await agentRegistry.getToolsByCategory(category, {
    verifiedAgentsOnly: req.query.verified === "true",
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });

  if (!result.success) {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, result.error || "Failed to get tools");
  }

  sendSuccess(res, { tools: result.tools });
}));

export default router;
