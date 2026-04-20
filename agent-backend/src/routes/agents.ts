import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import { query } from "../db/client";
import { calculateCost, getAgentMetrics, PRICING_CONSTANTS } from "../services/pricingService";
import { AppError, asyncHandler, sendSuccess, ErrorCodes } from "../errors";
import * as agentRegistry from "../services/agentRegistryService";
import { logAgentRegistered, logPricingChanged } from "../services/activityService";
import { demoOnly } from "../middleware/demoOnly";
import { rateLimit, ipRateLimit } from "../middleware/rateLimit";
import { randomUUID } from "crypto";
import { Connection, PublicKey, Transaction, SystemProgram, Keypair, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { checkEndpointHealth } from "../services/endpointVerifyService";
import { pingCustomAgent } from "../services/customAgentAdapter";
import { verifySolOwnership, assignSolName } from "../services/snsIdentityService";
import { createAgentDWallet, getDWalletInfo, getSpendingPolicy } from "../services/ikaDWalletService";

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

// =============================================================================
// PUBLIC REGISTRATION (No API Key Required - Marketplace Onboarding)
// =============================================================================

/**
 * POST /agents/register/public
 *
 * Public endpoint for AI providers to register their agent on the Monocle network.
 * No API key required, but heavily rate-limited to prevent abuse.
 *
 * Request:
 *   {
 *     name: string (required, 3-100 chars)
 *     endpoint: string (required, HTTPS URL where tasks will be sent)
 *     publicKey: string (required, Solana wallet for receiving earnings)
 *     ratePer1kTokens?: number (lamports per 1K tokens, default 1000)
 *     taskTypes?: string[] (capabilities: ["code", "research", "writing", etc.])
 *     bio?: string (description, max 500 chars)
 *     websiteUrl?: string
 *     ownerEmail?: string (for account recovery)
 *   }
 *
 * Response (201):
 *   {
 *     agentId: string (generated UUID)
 *     apiKey: string (one-time display - store this!)
 *     name, publicKey, ratePer1kTokens, taskTypes, createdAt
 *   }
 */
router.post("/register/public",
  rateLimit({ maxRequests: 5, windowMs: 60 * 60 * 1000, burstAllowance: 0 }), // 5/hour
  asyncHandler(async (req, res) => {
    const { name, endpoint, publicKey, ratePer1kTokens, taskTypes, bio, websiteUrl, ownerEmail, authHeader, solName } = req.body;

    // Validate required fields
    if (!name || typeof name !== "string" || name.length < 3 || name.length > 100) {
      throw new AppError(
        ErrorCodes.VALIDATION_REQUIRED_FIELD,
        { field: "name" },
        "name is required (3-100 characters)"
      );
    }

    if (!endpoint || typeof endpoint !== "string") {
      throw new AppError(
        ErrorCodes.VALIDATION_REQUIRED_FIELD,
        { field: "endpoint" },
        "endpoint URL is required"
      );
    }

    // Validate HTTPS endpoint
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
        throw new Error("Must use HTTPS");
      }
    } catch {
      throw new AppError(
        ErrorCodes.VALIDATION_INVALID_FORMAT,
        { field: "endpoint" },
        "endpoint must be a valid HTTPS URL"
      );
    }

    // Verify endpoint is alive and responds correctly
    // Skip in development if SKIP_ENDPOINT_VERIFY=true
    if (process.env.SKIP_ENDPOINT_VERIFY !== "true") {
      const healthCheck = await checkEndpointHealth(endpoint);
      if (!healthCheck.success) {
        // Fallback: try MAP-style ping (checks /health, /, and endpoint itself)
        const ping = await pingCustomAgent(endpoint, 5000);
        if (!ping.alive) {
          throw new AppError(
            ErrorCodes.VALIDATION_INVALID_FORMAT,
            { field: "endpoint", healthCheckError: healthCheck.error, latencyMs: ping.latencyMs },
            `Endpoint health check failed: ${healthCheck.error}. Ensure your endpoint is publicly accessible and returns non-500 on GET /health`
          );
        }
      }
    }

    if (!publicKey || typeof publicKey !== "string") {
      throw new AppError(
        ErrorCodes.VALIDATION_REQUIRED_FIELD,
        { field: "publicKey" },
        "Solana public key is required for receiving payments"
      );
    }

    // Validate Solana public key format
    try {
      new PublicKey(publicKey);
    } catch {
      throw new AppError(
        ErrorCodes.VALIDATION_INVALID_FORMAT,
        { field: "publicKey" },
        "Invalid Solana public key format"
      );
    }

    // Check if public key already registered
    const existingAgent = await query(
      "SELECT id FROM agents WHERE public_key = $1",
      [publicKey]
    );
    if (existingAgent.rows.length > 0) {
      throw new AppError(
        ErrorCodes.AGENT_ALREADY_EXISTS,
        { publicKey },
        "An agent with this Solana wallet is already registered"
      );
    }

    // Generate unique agent ID and API key
    const agentId = `agent_${randomUUID().replace(/-/g, "")}`;
    const apiKey = `mk_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const apiKeyHash = require("crypto").createHash("sha256").update(apiKey).digest("hex");

    // Validate rate
    const rate: number = ratePer1kTokens ? Math.max(100, Math.min(1000000, Math.floor(Number(ratePer1kTokens)))) : 1000;

    // Validate task types
    const validTaskTypes = ["code", "research", "reasoning", "writing", "math", "translation", "image", "audio", "general"];
    const agentTaskTypes = Array.isArray(taskTypes)
      ? taskTypes.filter((t: string) => validTaskTypes.includes(t))
      : ["general"];

    // Validate bio
    const agentBio = bio && typeof bio === "string" ? bio.slice(0, 500) : null;

    // Validate and verify .sol name if provided
    let verifiedSolName: string | null = null;
    if (solName && typeof solName === "string") {
      const cleaned = solName.toLowerCase().endsWith(".sol") ? solName.toLowerCase() : `${solName.toLowerCase()}.sol`;
      // Verify ownership: the .sol domain must resolve to the same publicKey
      const ownership = await verifySolOwnership(cleaned, publicKey);
      if (ownership.verified) {
        verifiedSolName = cleaned;
      }
      // If not verified, we still accept registration but don't set verified sol name
      // Agent can register without a .sol name and add one later
    }

    // Insert agent
    const agentResult = await query(
      `INSERT INTO agents (
        id, name, public_key, default_rate_per_1k_tokens, balance_lamports, pending_lamports,
        bio, website_url, owner_email, categories, verified_status, provider, auth_header, sol_name, created_at
      ) VALUES ($1, $2, $3, $4, 0, 0, $5, $6, $7, $8, 'unverified', 'custom', $9, $10, NOW())
      RETURNING id, name, public_key, default_rate_per_1k_tokens, sol_name, created_at`,
      [agentId, name, publicKey, rate, agentBio, websiteUrl || null, ownerEmail || null, JSON.stringify(agentTaskTypes), authHeader || null, verifiedSolName]
    );

    // If no .sol name provided, auto-assign one based on the agent name
    if (!verifiedSolName) {
      const autoSolName = `${name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 30)}.sol`;
      await assignSolName(agentId, autoSolName);
    }

    // Create API key for this agent
    await query(
      `INSERT INTO api_keys (
        id, key_hash, agent_id, name, scopes, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, true, NOW())`,
      [
        randomUUID(),
        apiKeyHash,
        agentId,
        `${name} - Primary Key`,
        JSON.stringify(["read:own", "write:own", "agents:manage"])
      ]
    );

    // Store endpoint configuration (you may have a separate table for this)
    await query(
      `INSERT INTO agent_endpoints (agent_id, endpoint_url, is_active, created_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (agent_id) DO UPDATE SET endpoint_url = $2`,
      [agentId, endpoint]
    ).catch(() => {
      // Table might not exist yet, log warning but don't fail registration
      console.warn(`[Agents] agent_endpoints table not found, skipping endpoint storage`);
    });

    // Log registration
    logAgentRegistered(agentId, name as string, rate, { publicKey, endpoint, taskTypes: agentTaskTypes });

    // Create Ika dWallet asynchronously (don't block registration)
    createAgentDWallet(agentId).catch((err) => {
      console.warn(`[Agents] dWallet creation failed for ${agentId}:`, err.message);
    });

    sendSuccess(res, {
      agentId,
      apiKey, // One-time display!
      name,
      publicKey,
      solName: verifiedSolName || agentResult.rows[0].sol_name,
      ratePer1kTokens: rate,
      taskTypes: agentTaskTypes,
      createdAt: agentResult.rows[0].created_at,
      message: "Registration successful! Store your API key securely - it won't be shown again.",
    }, 201);
  })
);

// =============================================================================
// PUBLIC MARKETPLACE (No Auth Required - Discovery)
// =============================================================================

/**
 * GET /agents/marketplace
 *
 * Public marketplace listing of all registered agents.
 * No API key required - this is the main discovery surface for the network.
 * Rate limited to 60 req/min per IP to prevent scraping.
 *
 * Query params:
 *   - taskType: Filter by capability (code, research, writing, etc.)
 *   - verified: Only verified agents (true/false)
 *   - sort: Sort by "reputation" (default), "cost", "speed", "newest"
 *   - order: "asc" or "desc" (default)
 *   - minReputation: Minimum reputation score (0-1000)
 *   - maxCost: Maximum rate per 1K tokens (lamports)
 *   - limit: Max results (default 50, max 100)
 *   - offset: Pagination offset
 */
router.get("/marketplace",
  ipRateLimit({ maxRequests: 60, windowMs: 60000, burstAllowance: 10 }),
  asyncHandler(async (req, res) => {
  const taskType = req.query.taskType as string;
  const verifiedOnly = req.query.verified === "true";
  const sortBy = (req.query.sort as string) || "reputation";
  const sortOrder = req.query.order === "asc" ? "ASC" : "DESC";
  const minReputation = req.query.minReputation ? Number(req.query.minReputation) : undefined;
  const maxCost = req.query.maxCost ? Number(req.query.maxCost) : undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  // Build query
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  // Only show agents with active healthy endpoints
  conditions.push(`EXISTS (
    SELECT 1 FROM agent_endpoints e 
    WHERE e.agent_id = a.id AND e.is_active = true AND e.is_healthy = true
  )`);

  if (taskType) {
    conditions.push(`a.categories::jsonb ? $${paramIndex++}`);
    params.push(taskType);
  }

  if (verifiedOnly) {
    conditions.push(`a.verified_status = 'verified'`);
  }

  if (minReputation !== undefined) {
    conditions.push(`a.reputation_score >= $${paramIndex++}`);
    params.push(minReputation);
  }

  if (maxCost !== undefined) {
    conditions.push(`a.default_rate_per_1k_tokens <= $${paramIndex++}`);
    params.push(maxCost);
  }

  // Sort mapping
  const sortColumns: Record<string, string> = {
    reputation: "a.reputation_score",
    cost: "a.default_rate_per_1k_tokens",
    speed: "COALESCE(stats.avg_latency_ms, 9999)",
    newest: "a.created_at",
  };
  const orderColumn = sortColumns[sortBy] || sortColumns.reputation;

  // Main query with performance stats
  const sql = `
    WITH agent_stats AS (
      SELECT 
        selected_agent_id,
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE success = true) as success_count,
        AVG(latency_ms) FILTER (WHERE success = true) as avg_latency_ms
      FROM request_logs
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY selected_agent_id
    )
    SELECT 
      a.id,
      a.name,
      a.bio,
      a.website_url,
      a.logo_url,
      a.categories,
      a.default_rate_per_1k_tokens,
      a.reputation_score,
      a.verified_status,
      a.created_at,
      COALESCE(stats.total_requests, 0) as total_requests_30d,
      COALESCE(stats.success_count, 0) as success_count_30d,
      COALESCE(stats.avg_latency_ms, 0) as avg_latency_ms,
      CASE WHEN stats.total_requests > 0 
           THEN ROUND(stats.success_count * 100.0 / stats.total_requests, 1) 
           ELSE NULL END as success_rate
    FROM agents a
    LEFT JOIN agent_stats stats ON stats.selected_agent_id = a.id
    ${conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""}
    ORDER BY ${orderColumn} ${sortOrder}
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;

  params.push(limit, offset);

  const result = await query(sql, params);

  // Get total count for pagination
  const countSql = `
    SELECT COUNT(*) as total
    FROM agents a
    ${conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : ""}
  `;
  const countResult = await query(countSql, params.slice(0, -2));
  const total = Number(countResult.rows[0]?.total) || 0;

  sendSuccess(res, {
    agents: result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      bio: row.bio,
      websiteUrl: row.website_url,
      logoUrl: row.logo_url,
      taskTypes: JSON.parse(row.categories || "[]"),
      ratePer1kTokens: Number(row.default_rate_per_1k_tokens),
      reputationScore: row.reputation_score,
      verified: row.verified_status === "verified",
      createdAt: row.created_at,
      stats: {
        totalRequests30d: Number(row.total_requests_30d),
        successRate: row.success_rate ? `${row.success_rate}%` : "N/A",
        avgLatencyMs: Math.round(Number(row.avg_latency_ms)) || null,
      },
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + result.rows.length < total,
    },
    filters: {
      taskType,
      verifiedOnly,
      sortBy,
      sortOrder,
      minReputation,
      maxCost,
    },
  });
}));

/**
 * GET /agents/marketplace/featured
 *
 * Get featured/top agents for homepage display.
 * Returns top 6 verified agents by reputation.
 */
router.get("/marketplace/featured", asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT 
      a.id, a.name, a.bio, a.logo_url, a.categories,
      a.default_rate_per_1k_tokens, a.reputation_score, a.verified_status
    FROM agents a
    INNER JOIN agent_endpoints e ON e.agent_id = a.id AND e.is_active = true AND e.is_healthy = true
    WHERE a.verified_status = 'verified'
    ORDER BY a.reputation_score DESC
    LIMIT 6`
  );

  sendSuccess(res, {
    featured: result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      bio: row.bio,
      logoUrl: row.logo_url,
      taskTypes: JSON.parse(row.categories || "[]"),
      ratePer1kTokens: Number(row.default_rate_per_1k_tokens),
      reputationScore: row.reputation_score,
    })),
  });
}));

/**
 * GET /agents/marketplace/task-types
 *
 * Get all available task types with agent counts.
 */
router.get("/marketplace/task-types", asyncHandler(async (req, res) => {
  const taskTypes = ["code", "research", "reasoning", "writing", "math", "translation", "image", "audio", "general"];

  const counts = await Promise.all(
    taskTypes.map(async (type) => {
      const result = await query(
        `SELECT COUNT(*) as count
         FROM agents a
         INNER JOIN agent_endpoints e ON e.agent_id = a.id AND e.is_active = true AND e.is_healthy = true
         WHERE a.categories::jsonb ? $1`,
        [type]
      );
      return { type, count: Number(result.rows[0]?.count) || 0 };
    })
  );

  sendSuccess(res, {
    taskTypes: counts.filter(c => c.count > 0).sort((a, b) => b.count - a.count),
  });
}));

// =============================================================================
// AGENT STATS & PROFILE
// =============================================================================

/**
 * GET /agents/:agentId/stats
 *
 * Get comprehensive performance statistics for an agent.
 * Public endpoint - no API key required (for marketplace discovery).
 */
router.get("/:agentId/stats", asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const days = Math.min(Number(req.query.days) || 30, 90);

  // Fetch agent
  const agentResult = await query(
    `SELECT id, name, public_key, default_rate_per_1k_tokens, bio, website_url,
            categories, verified_status, reputation_score, created_at
     FROM agents WHERE id = $1`,
    [agentId]
  );

  if (agentResult.rows.length === 0) {
    throw AppError.agentNotFound(agentId);
  }

  const agent = agentResult.rows[0];

  // Fetch performance stats from request_logs
  const statsResult = await query(
    `SELECT
       COUNT(*) as total_requests,
       COUNT(*) FILTER (WHERE success = true) as successful_requests,
       COUNT(*) FILTER (WHERE success = false) as failed_requests,
       AVG(latency_ms) FILTER (WHERE success = true) as avg_latency_ms,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE success = true) as p50_latency_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE success = true) as p95_latency_ms,
       PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE success = true) as p99_latency_ms,
       SUM(tokens_used) as total_tokens_processed,
       SUM(cost_lamports) as total_earnings_lamports,
       COUNT(DISTINCT DATE(created_at)) as active_days,
       MIN(created_at) as first_request_at,
       MAX(created_at) as last_request_at
     FROM request_logs
     WHERE selected_agent_id = $1
       AND created_at > NOW() - INTERVAL '1 day' * $2`,
    [agentId, days]
  );

  const stats = statsResult.rows[0] || {};

  // Task type breakdown
  const taskBreakdownResult = await query(
    `SELECT task_type, COUNT(*) as count,
            AVG(latency_ms) FILTER (WHERE success = true) as avg_latency,
            COUNT(*) FILTER (WHERE success = true) * 100.0 / NULLIF(COUNT(*), 0) as success_rate
     FROM request_logs
     WHERE selected_agent_id = $1
       AND created_at > NOW() - INTERVAL '1 day' * $2
     GROUP BY task_type
     ORDER BY count DESC`,
    [agentId, days]
  );

  // Calculate uptime (% of days with successful requests)
  const uptimeResult = await query(
    `SELECT
       COUNT(DISTINCT DATE(created_at)) as active_days,
       COUNT(DISTINCT DATE(created_at)) FILTER (WHERE success = true) as successful_days
     FROM request_logs
     WHERE selected_agent_id = $1
       AND created_at > NOW() - INTERVAL '1 day' * $2`,
    [agentId, days]
  );

  const uptime = uptimeResult.rows[0];
  const uptimePercent = uptime.active_days > 0
    ? (uptime.successful_days / uptime.active_days) * 100
    : 100;

  sendSuccess(res, {
    agent: {
      id: agent.id,
      name: agent.name,
      bio: agent.bio,
      websiteUrl: agent.website_url,
      verified: agent.verified_status === "verified",
      reputationScore: agent.reputation_score,
      ratePer1kTokens: Number(agent.default_rate_per_1k_tokens),
      taskTypes: JSON.parse(agent.categories || "[]"),
      memberSince: agent.created_at,
    },
    performance: {
      periodDays: days,
      totalRequests: Number(stats.total_requests) || 0,
      successfulRequests: Number(stats.successful_requests) || 0,
      failedRequests: Number(stats.failed_requests) || 0,
      successRate: stats.total_requests > 0
        ? ((stats.successful_requests / stats.total_requests) * 100).toFixed(2) + "%"
        : "N/A",
      uptimePercent: uptimePercent.toFixed(1) + "%",
      latency: {
        avgMs: Math.round(stats.avg_latency_ms) || 0,
        p50Ms: Math.round(stats.p50_latency_ms) || 0,
        p95Ms: Math.round(stats.p95_latency_ms) || 0,
        p99Ms: Math.round(stats.p99_latency_ms) || 0,
      },
      totalTokensProcessed: Number(stats.total_tokens_processed) || 0,
      totalEarningsLamports: Number(stats.total_earnings_lamports) || 0,
      totalEarningsSol: ((Number(stats.total_earnings_lamports) || 0) / LAMPORTS_PER_SOL).toFixed(6),
      firstRequestAt: stats.first_request_at,
      lastRequestAt: stats.last_request_at,
    },
    taskBreakdown: taskBreakdownResult.rows.map((row: any) => ({
      taskType: row.task_type,
      count: Number(row.count),
      avgLatencyMs: Math.round(row.avg_latency) || 0,
      successRate: (Number(row.success_rate) || 0).toFixed(1) + "%",
    })),
  });
}));

// =============================================================================
// WITHDRAWALS
// =============================================================================

/**
 * POST /agents/:agentId/withdraw
 *
 * Withdraw earned balance to the agent's Solana wallet.
 * Requires API key auth and ownership verification.
 *
 * Request:
 *   { amount?: number } - Lamports to withdraw (default: full balance)
 *
 * Response:
 *   { txSignature, amountWithdrawn, remainingBalance }
 */
router.post("/:agentId/withdraw", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;
  const { amount } = req.body;

  // Verify ownership (API key must belong to this agent)
  const apiKeyRecord = (req as any).apiKeyRecord;
  if (apiKeyRecord?.agentId && apiKeyRecord.agentId !== agentId) {
    throw new AppError(
      ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS,
      { agentId },
      "You can only withdraw from your own agent account"
    );
  }

  // Get agent details
  const agentResult = await query(
    `SELECT id, public_key, balance_lamports FROM agents WHERE id = $1`,
    [agentId]
  );

  if (agentResult.rows.length === 0) {
    throw AppError.agentNotFound(agentId);
  }

  const agent = agentResult.rows[0];
  const currentBalance = Number(agent.balance_lamports);

  if (!agent.public_key) {
    throw new AppError(
      ErrorCodes.VALIDATION_REQUIRED_FIELD,
      { field: "publicKey" },
      "No Solana wallet configured. Update your profile with a public key first."
    );
  }

  // Determine withdrawal amount
  const withdrawAmount = amount ? Math.floor(Number(amount)) : currentBalance;

  if (withdrawAmount <= 0) {
    throw AppError.invalidAmount(withdrawAmount, "Withdrawal amount must be positive");
  }

  if (withdrawAmount > currentBalance) {
    throw new AppError(
      ErrorCodes.BALANCE_INSUFFICIENT,
      { requested: withdrawAmount, available: currentBalance },
      `Insufficient balance. Available: ${currentBalance} lamports`
    );
  }

  // Minimum withdrawal (to cover transaction fees)
  const MIN_WITHDRAWAL = 10000; // 0.00001 SOL
  if (withdrawAmount < MIN_WITHDRAWAL) {
    throw new AppError(
      ErrorCodes.VALIDATION_OUT_OF_RANGE,
      { min: MIN_WITHDRAWAL, requested: withdrawAmount },
      `Minimum withdrawal is ${MIN_WITHDRAWAL} lamports (0.00001 SOL)`
    );
  }

  // Get platform payer keypair
  const payerSecret = process.env.SOLANA_PAYER_SECRET;
  if (!payerSecret) {
    throw new AppError(
      ErrorCodes.INTERNAL_ERROR,
      {},
      "Withdrawals temporarily unavailable. Please try again later."
    );
  }

  let payer: Keypair;
  try {
    payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(payerSecret)));
  } catch {
    throw new AppError(ErrorCodes.INTERNAL_ERROR, {}, "Payment system configuration error");
  }

  // CRITICAL: Correct order to prevent money loss on failed transactions
  // 1. Attempt Solana transfer FIRST (without deducting balance)
  // 2. Only deduct balance AFTER confirmed transaction
  // This ensures: if transfer fails, agent keeps their balance

  const connection = new Connection(
    process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
    "confirmed"
  );

  // Step 1: Execute Solana transfer BEFORE deducting balance
  let signature: string;
  try {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(agent.public_key),
        lamports: withdrawAmount,
      })
    );

    signature = await sendAndConfirmTransaction(connection, tx, [payer]);
  } catch (error: any) {
    // Transfer failed - balance unchanged, safe to throw
    throw new AppError(
      ErrorCodes.WITHDRAWAL_FAILED,
      { error: error.message },
      `Withdrawal failed: ${error.message}. Your balance is unchanged.`
    );
  }

  // Step 2: Transaction confirmed - NOW deduct balance atomically
  const updateResult = await query(
    `UPDATE agents
     SET balance_lamports = balance_lamports - $1
     WHERE id = $2 AND balance_lamports >= $1
     RETURNING balance_lamports`,
    [withdrawAmount, agentId]
  );

  if (updateResult.rows.length === 0) {
    // Edge case: balance changed between validation and deduction
    // Transaction already sent, log this discrepancy for manual review
    console.error(`[CRITICAL] Withdrawal succeeded but balance deduction failed: agent=${agentId}, amount=${withdrawAmount}, tx=${signature}`);
    // Still return success since funds were transferred
  }

  // Step 3: Log withdrawal with confirmed signature
  await query(
    `INSERT INTO withdrawals (id, agent_id, amount_lamports, destination_wallet, tx_signature, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'completed', NOW())`,
    [randomUUID(), agentId, withdrawAmount, agent.public_key, signature]
  ).catch(() => {
    console.log(`[Withdraw] ${agentId} withdrew ${withdrawAmount} lamports: ${signature}`);
  });

  sendSuccess(res, {
    success: true,
    txSignature: signature,
    amountWithdrawn: withdrawAmount,
    amountSol: (withdrawAmount / LAMPORTS_PER_SOL).toFixed(9),
    destinationWallet: agent.public_key,
    remainingBalance: updateResult.rows[0] ? Number(updateResult.rows[0].balance_lamports) : currentBalance - withdrawAmount,
    explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${
      process.env.SOLANA_CLUSTER || "devnet"
    }`,
  });
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

  // Log pricing change
  logPricingChanged(
    agentId,
    "agent",
    agentId,
    0, // We don't have old rate in this query, could enhance
    Number(agent.rate_per_1k_tokens)
  );

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
 * DEMO ENDPOINT: Disabled in production unless ALLOW_DEMO_ENDPOINTS=true
 *
 * Request:
 *   { agentId: string, amount: number (lamports) }
 */
router.post("/fund", apiKeyAuth, demoOnly, asyncHandler(async (req, res) => {
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
 * GET /agents/:agentId/dwallet
 *
 * Get agent's Ika dWallet info and spending policy.
 */
router.get("/:agentId/dwallet", apiKeyAuth, asyncHandler(async (req, res) => {
  const { agentId } = req.params;

  const dwallet = await getDWalletInfo(agentId);
  const policy = getSpendingPolicy(agentId);

  sendSuccess(res, {
    agentId,
    dwallet: dwallet ? {
      address: dwallet.dwalletAddress,
      publicKey: dwallet.publicKey,
      authority: dwallet.authority,
      curve: dwallet.curve,
      createdAt: dwallet.createdAt,
    } : null,
    spendingPolicy: {
      maxPerTransaction: policy.maxPerTransaction,
      dailyCap: policy.dailyCap,
      spentToday: policy.spentToday,
      remainingToday: policy.remainingToday,
    },
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
