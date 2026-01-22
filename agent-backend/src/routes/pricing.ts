import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { calculateCost, PRICING_CONSTANTS } from "../services/pricingService";
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

export default router;
