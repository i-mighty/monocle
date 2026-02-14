import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import { 
  calculateCost, 
  PRICING_CONSTANTS, 
  getToolPricing, 
  getAgent,
  previewToolCall,
  getAgentBudgetStatus
} from "../services/pricingService";
import { query } from "../db/client";

const router = Router();

/**
 * GET /pricing/constants
 *
 * Return platform pricing constants.
 * Agents can use this to understand the system constraints.
 */
router.get("/constants", async (_req, res) => {
  res.json({
    minCostLamports: PRICING_CONSTANTS.MIN_COST_LAMPORTS,
    maxTokensPerCall: PRICING_CONSTANTS.MAX_TOKENS_PER_CALL,
    platformFeePercent: PRICING_CONSTANTS.PLATFORM_FEE_PERCENT,
    minPayoutLamports: PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS,
  });
});

/**
 * POST /pricing/preview
 *
 * DETERMINISTIC COST PREVIEW API
 * 
 * Returns exact cost before execution - enables simulation, budgeting,
 * and prevents surprises. Critical for composability.
 *
 * Request:
 *   {
 *     callerId: string,      // Agent making the call
 *     calleeId: string,      // Agent being called (tool provider)
 *     toolName: string,      // Tool to be executed
 *     tokensEstimate: number // Estimated tokens (usually prompt + expected output)
 *   }
 *
 * Response:
 *   {
 *     canExecute: boolean,
 *     costLamports: number,
 *     breakdown: { ... },
 *     budgetStatus: { ... },
 *     warnings: string[]
 *   }
 */
router.post("/preview", apiKeyAuth, async (req, res) => {
  try {
    const { callerId, calleeId, toolName, tokensEstimate } = req.body;

    // Validate required fields
    if (!callerId || !calleeId || !toolName || tokensEstimate === undefined) {
      return res.status(400).json({
        error: "Missing required fields: callerId, calleeId, toolName, tokensEstimate",
      });
    }

    const tokens = Number(tokensEstimate);
    if (tokens < 0) {
      return res.status(400).json({ error: "tokensEstimate must be non-negative" });
    }

    if (tokens > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
      return res.status(400).json({
        error: `tokensEstimate exceeds maximum (${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL})`,
      });
    }

    // Get full preview with budget checks
    const preview = await previewToolCall(callerId, calleeId, toolName, tokens);

    res.json(preview);
  } catch (error: any) {
    console.error("Error generating preview:", error);
    
    // Return structured error for agent-friendly consumption
    res.status(error.message?.includes("not found") ? 404 : 500).json({
      canExecute: false,
      error: error.message || "Preview failed",
      costLamports: null,
    });
  }
});

/**
 * GET /pricing/budget/:agentId
 *
 * Get budget status for an agent including limits, daily spend, and kill switch status.
 */
router.get("/budget/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const budgetStatus = await getAgentBudgetStatus(agentId);
    res.json(budgetStatus);
  } catch (error: any) {
    console.error("Error fetching budget status:", error);
    res.status(error.message?.includes("not found") ? 404 : 500).json({
      error: error.message || "Failed to fetch budget status",
    });
  }
});

/**
 * POST /pricing/calculate
 *
 * Calculate cost for given tokens and rate.
 * Does NOT require agent lookup - pure calculation.
 *
 * Request:
 *   { tokensUsed: number, ratePer1kTokens: number }
 *
 * Response:
 *   { tokensUsed, ratePer1kTokens, costLamports, breakdown }
 */
router.post("/calculate", async (req, res) => {
  try {
    const { tokensUsed, ratePer1kTokens } = req.body;

    if (tokensUsed === undefined || ratePer1kTokens === undefined) {
      return res.status(400).json({
        error: "tokensUsed and ratePer1kTokens are required",
      });
    }

    const tokens = Number(tokensUsed);
    const rate = Number(ratePer1kTokens);

    if (tokens < 0 || rate < 0) {
      return res.status(400).json({
        error: "tokensUsed and ratePer1kTokens must be non-negative",
      });
    }

    if (tokens > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
      return res.status(400).json({
        error: `tokensUsed exceeds maximum (${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL})`,
      });
    }

    const costLamports = calculateCost(tokens, rate);
    const tokenBlocks = Math.ceil(tokens / 1000);
    const rawCost = tokenBlocks * rate;

    res.json({
      tokensUsed: tokens,
      ratePer1kTokens: rate,
      costLamports,
      breakdown: {
        tokenBlocks,
        rawCostBeforeMinimum: rawCost,
        minimumApplied: rawCost < PRICING_CONSTANTS.MIN_COST_LAMPORTS,
      },
    });
  } catch (error) {
    console.error("Error calculating cost:", error);
    res.status(500).json({ error: "Calculation failed" });
  }
});

/**
 * POST /pricing/estimate-settlement
 *
 * Estimate settlement amounts for a given gross value.
 *
 * Request:
 *   { grossLamports: number }
 *
 * Response:
 *   { gross, platformFee, netPayout, feePercent }
 */
router.post("/estimate-settlement", async (req, res) => {
  try {
    const { grossLamports } = req.body;

    if (!grossLamports || grossLamports <= 0) {
      return res.status(400).json({
        error: "grossLamports must be a positive number",
      });
    }

    const gross = Math.floor(Number(grossLamports));
    const platformFee = Math.floor(gross * PRICING_CONSTANTS.PLATFORM_FEE_PERCENT);
    const netPayout = gross - platformFee;

    res.json({
      grossLamports: gross,
      platformFeeLamports: platformFee,
      netPayoutLamports: netPayout,
      feePercent: PRICING_CONSTANTS.PLATFORM_FEE_PERCENT * 100,
      meetsMinimumPayout: gross >= PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS,
      minimumPayoutRequired: PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS,
    });
  } catch (error) {
    console.error("Error estimating settlement:", error);
    res.status(500).json({ error: "Estimation failed" });
  }
});

/**
 * GET /pricing/platform-revenue
 *
 * Fetch platform revenue summary (admin endpoint).
 */
router.get("/platform-revenue", apiKeyAuth, async (_req, res) => {
  try {
    const totalResult = await query(
      `select coalesce(sum(fee_lamports), 0) as total_fees,
              count(*) as settlement_count
       from platform_revenue`
    );

    const recentResult = await query(
      `select pr.id, pr.fee_lamports, pr.created_at,
              s.from_agent_id, s.gross_lamports, s.net_lamports, s.tx_signature
       from platform_revenue pr
       join settlements s on pr.settlement_id = s.id
       order by pr.created_at desc
       limit 50`
    );

    res.json({
      totalFeesLamports: Number(totalResult.rows[0]?.total_fees || 0),
      totalFeesSOL: Number(totalResult.rows[0]?.total_fees || 0) / 1e9,
      settlementCount: Number(totalResult.rows[0]?.settlement_count || 0),
      recentFees: recentResult.rows.map((row: any) => ({
        id: row.id,
        feeLamports: Number(row.fee_lamports),
        agentId: row.from_agent_id,
        grossLamports: Number(row.gross_lamports),
        netLamports: Number(row.net_lamports),
        txSignature: row.tx_signature,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("Error fetching platform revenue:", error);
    res.status(500).json({ error: "Failed to fetch platform revenue" });
  }
});

/**
 * GET /pricing/leaderboard
 *
 * Top agents by earnings (callee_agent_id in tool_usage).
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const result = await query(
      `select callee_agent_id as agent_id,
              count(*) as call_count,
              sum(cost_lamports) as total_earned_lamports
       from tool_usage
       group by callee_agent_id
       order by total_earned_lamports desc
       limit $1`,
      [limit]
    );

    res.json(
      result.rows.map((row: any) => ({
        agentId: row.agent_id,
        callCount: Number(row.call_count),
        totalEarnedLamports: Number(row.total_earned_lamports),
        totalEarnedSOL: Number(row.total_earned_lamports) / 1e9,
      }))
    );
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

/**
 * PUT /pricing/budget/:agentId
 *
 * Configure budget guardrails for an agent.
 * 
 * Request:
 *   {
 *     maxCostPerCall?: number,    // Max lamports per single call (null = no limit)
 *     dailySpendCap?: number,     // Max lamports per 24h (null = no limit)
 *     isPaused?: boolean,         // Emergency kill switch
 *     allowedCallees?: string[]   // Allowlist of agent IDs this agent can call (null = all)
 *   }
 */
router.put("/budget/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { maxCostPerCall, dailySpendCap, isPaused, allowedCallees } = req.body;

    // Validate inputs
    if (maxCostPerCall !== undefined && maxCostPerCall !== null) {
      if (typeof maxCostPerCall !== "number" || maxCostPerCall < 0) {
        return res.status(400).json({ error: "maxCostPerCall must be a non-negative number or null" });
      }
    }

    if (dailySpendCap !== undefined && dailySpendCap !== null) {
      if (typeof dailySpendCap !== "number" || dailySpendCap < 0) {
        return res.status(400).json({ error: "dailySpendCap must be a non-negative number or null" });
      }
    }

    if (allowedCallees !== undefined && allowedCallees !== null) {
      if (!Array.isArray(allowedCallees)) {
        return res.status(400).json({ error: "allowedCallees must be an array of agent IDs or null" });
      }
    }

    // Import the update function
    const { updateAgentBudget } = await import("../services/pricingService");
    
    const updatedAgent = await updateAgentBudget(agentId, {
      maxCostPerCall: maxCostPerCall ?? undefined,
      dailySpendCap: dailySpendCap ?? undefined,
      isPaused: isPaused ?? undefined,
      allowedCallees: allowedCallees ?? undefined,
    });

    res.json({
      agentId: updatedAgent.id,
      budgetConfig: {
        maxCostPerCall: updatedAgent.maxCostPerCall,
        dailySpendCap: updatedAgent.dailySpendCap,
        isPaused: updatedAgent.isPaused,
        allowedCallees: updatedAgent.allowedCallees,
      },
      message: "Budget guardrails updated successfully",
    });
  } catch (error: any) {
    console.error("Error updating budget:", error);
    res.status(error.message?.includes("not found") ? 404 : 500).json({
      error: error.message || "Failed to update budget guardrails",
    });
  }
});

/**
 * POST /pricing/budget/:agentId/pause
 *
 * Emergency kill switch - immediately pause all spending for an agent.
 */
router.post("/budget/:agentId/pause", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { updateAgentBudget } = await import("../services/pricingService");
    
    await updateAgentBudget(agentId, { isPaused: true });
    
    res.json({
      agentId,
      isPaused: true,
      message: "Agent spending paused immediately. No outgoing payments will be processed.",
    });
  } catch (error: any) {
    console.error("Error pausing agent:", error);
    res.status(error.message?.includes("not found") ? 404 : 500).json({
      error: error.message || "Failed to pause agent",
    });
  }
});

/**
 * POST /pricing/budget/:agentId/resume
 *
 * Resume spending for a paused agent.
 */
router.post("/budget/:agentId/resume", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { updateAgentBudget } = await import("../services/pricingService");
    
    await updateAgentBudget(agentId, { isPaused: false });
    
    res.json({
      agentId,
      isPaused: false,
      message: "Agent spending resumed.",
    });
  } catch (error: any) {
    console.error("Error resuming agent:", error);
    res.status(error.message?.includes("not found") ? 404 : 500).json({
      error: error.message || "Failed to resume agent",
    });
  }
});

// =============================================================================
// PRICING QUOTES - Time-bound pricing guarantees
// =============================================================================

/**
 * POST /pricing/quote
 *
 * Issue a new pricing quote with frozen pricing and expiry.
 * The quote locks in the current price for a specified validity period.
 *
 * Request:
 *   {
 *     callerAgentId: string,
 *     calleeAgentId: string,
 *     toolName: string,
 *     estimatedTokens: number,
 *     validityMs?: number  // Optional: 1-30 minutes, default 5 minutes
 *   }
 *
 * Response:
 *   {
 *     quoteId: string,
 *     quotedCostLamports: number,
 *     ratePer1kTokens: number,
 *     issuedAt: string,
 *     expiresAt: string,
 *     ...
 *   }
 */
router.post("/quote", apiKeyAuth, async (req, res) => {
  try {
    const { callerAgentId, calleeAgentId, toolName, estimatedTokens, validityMs } = req.body;

    if (!callerAgentId || !calleeAgentId || !toolName || estimatedTokens === undefined) {
      return res.status(400).json({
        error: "Missing required fields: callerAgentId, calleeAgentId, toolName, estimatedTokens",
      });
    }

    const { issueQuote } = await import("../services/quoteService");
    
    const quote = await issueQuote({
      callerAgentId,
      calleeAgentId,
      toolName,
      estimatedTokens: Number(estimatedTokens),
      validityMs: validityMs ? Number(validityMs) : undefined,
    });

    res.json({
      success: true,
      quote: {
        quoteId: quote.quoteId,
        callerAgentId: quote.callerAgentId,
        calleeAgentId: quote.calleeAgentId,
        toolName: quote.toolName,
        estimatedTokens: quote.estimatedTokens,
        // Frozen pricing
        ratePer1kTokens: quote.ratePer1kTokens,
        quotedCostLamports: quote.quotedCostLamports,
        platformFeeLamports: quote.platformFeeLamports,
        netToCallee: quote.netToCallee,
        // Validity window
        issuedAt: quote.issuedAt.toISOString(),
        expiresAt: quote.expiresAt.toISOString(),
        validityMs: quote.validityMs,
        expiresIn: quote.expiresIn,
        // Breakdown
        priceSnapshot: quote.priceSnapshot,
      },
      usage: {
        description: "Use this quoteId when executing the tool call to lock in this price",
        executeEndpoint: "POST /meter/execute",
        requiredParams: { quoteId: quote.quoteId },
      },
    });
  } catch (error: any) {
    console.error("Error issuing quote:", error);
    res.status(error.message?.includes("not found") ? 404 : 500).json({
      error: error.message || "Failed to issue quote",
    });
  }
});

/**
 * GET /pricing/quote/:quoteId
 *
 * Get details of an existing quote.
 */
router.get("/quote/:quoteId", apiKeyAuth, async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { getQuote } = await import("../services/quoteService");
    
    const quote = await getQuote(quoteId);
    
    if (!quote) {
      return res.status(404).json({ error: "Quote not found" });
    }

    const now = new Date();
    const isExpired = now > quote.expiresAt;
    const remainingMs = Math.max(0, quote.expiresAt.getTime() - now.getTime());

    res.json({
      quoteId: quote.id,
      callerAgentId: quote.callerAgentId,
      calleeAgentId: quote.calleeAgentId,
      toolName: quote.toolName,
      estimatedTokens: quote.estimatedTokens,
      ratePer1kTokens: quote.ratePer1kTokens,
      quotedCostLamports: quote.quotedCostLamports,
      platformFeeLamports: quote.platformFeeLamports,
      issuedAt: quote.issuedAt.toISOString(),
      expiresAt: quote.expiresAt.toISOString(),
      status: quote.status,
      isExpired,
      remainingMs,
      usedAt: quote.usedAt?.toISOString() || null,
    });
  } catch (error: any) {
    console.error("Error fetching quote:", error);
    res.status(500).json({ error: error.message || "Failed to fetch quote" });
  }
});

/**
 * POST /pricing/quote/:quoteId/validate
 *
 * Validate a quote before execution (pre-flight check).
 */
router.post("/quote/:quoteId/validate", apiKeyAuth, async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { callerAgentId, calleeAgentId, toolName, actualTokens } = req.body;

    if (!callerAgentId || !calleeAgentId || !toolName || actualTokens === undefined) {
      return res.status(400).json({
        error: "Missing required fields: callerAgentId, calleeAgentId, toolName, actualTokens",
      });
    }

    const { validateQuote } = await import("../services/quoteService");
    
    const validation = await validateQuote(
      quoteId,
      callerAgentId,
      calleeAgentId,
      toolName,
      Number(actualTokens)
    );

    res.json({
      valid: validation.valid,
      error: validation.error,
      details: validation.details,
      quote: validation.quote ? {
        quotedCostLamports: validation.quote.quotedCostLamports,
        ratePer1kTokens: validation.quote.ratePer1kTokens,
        expiresAt: validation.quote.expiresAt.toISOString(),
        status: validation.quote.status,
      } : null,
    });
  } catch (error: any) {
    console.error("Error validating quote:", error);
    res.status(500).json({ error: error.message || "Failed to validate quote" });
  }
});

/**
 * DELETE /pricing/quote/:quoteId
 *
 * Cancel an active quote.
 */
router.delete("/quote/:quoteId", apiKeyAuth, async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { cancelQuote } = await import("../services/quoteService");
    
    const cancelled = await cancelQuote(quoteId);
    
    if (!cancelled) {
      return res.status(400).json({
        error: "Quote cannot be cancelled (not found or not active)",
      });
    }

    res.json({ success: true, message: "Quote cancelled" });
  } catch (error: any) {
    console.error("Error cancelling quote:", error);
    res.status(500).json({ error: error.message || "Failed to cancel quote" });
  }
});

/**
 * GET /pricing/quotes/:agentId
 *
 * List active quotes for an agent.
 */
router.get("/quotes/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { listActiveQuotes } = await import("../services/quoteService");
    
    const quotes = await listActiveQuotes(agentId);

    res.json({
      agentId,
      activeQuotes: quotes.map((q) => ({
        quoteId: q.id,
        calleeAgentId: q.calleeAgentId,
        toolName: q.toolName,
        quotedCostLamports: q.quotedCostLamports,
        issuedAt: q.issuedAt.toISOString(),
        expiresAt: q.expiresAt.toISOString(),
        remainingMs: Math.max(0, q.expiresAt.getTime() - Date.now()),
      })),
      count: quotes.length,
    });
  } catch (error: any) {
    console.error("Error listing quotes:", error);
    res.status(500).json({ error: error.message || "Failed to list quotes" });
  }
});

/**
 * GET /pricing/quotes/:agentId/stats
 *
 * Get quote statistics for an agent.
 */
router.get("/quotes/:agentId/stats", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { getQuoteStats } = await import("../services/quoteService");
    
    const stats = await getQuoteStats(agentId);

    res.json({
      agentId,
      ...stats,
    });
  } catch (error: any) {
    console.error("Error fetching quote stats:", error);
    res.status(500).json({ error: error.message || "Failed to fetch quote stats" });
  }
});

export default router;
