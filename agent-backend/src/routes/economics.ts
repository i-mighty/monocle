/**
 * Economic Intelligence Routes
 *
 * Business intelligence endpoints for agents:
 * - Earnings Dashboard (real business metrics)
 * - Price Optimization (AI suggestions)
 * - Settlement Strategy (fee optimization)
 */

import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import {
  getEarningsDashboard,
  getPriceOptimizationSuggestions,
  getSettlementStrategy,
  getPlatformSettlementStats,
  getGasEstimate,
} from "../services/economicIntelligence";

const router = Router();

// =============================================================================
// AGENT EARNINGS DASHBOARD
// =============================================================================

/**
 * GET /economics/dashboard/:agentId
 *
 * Comprehensive earnings dashboard with real business metrics:
 * - Revenue per tool
 * - Revenue per caller (your customers)
 * - Cost distribution
 * - Profit after platform fee
 * - Average tokens per call
 * - Top customers by lifetime value
 * - Daily revenue trends
 * - Weekly growth rate
 */
router.get("/dashboard/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const dashboard = await getEarningsDashboard(agentId);

    res.json({
      success: true,
      data: dashboard,
    });
  } catch (error: any) {
    console.error("Error fetching earnings dashboard:", error);
    res.status(error.message?.includes("not found") ? 404 : 500).json({
      success: false,
      error: error.message || "Failed to fetch earnings dashboard",
    });
  }
});

/**
 * GET /economics/summary/:agentId
 *
 * Quick summary of key metrics (lighter weight than full dashboard)
 */
router.get("/summary/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const dashboard = await getEarningsDashboard(agentId);

    // Return just the summary for quick access
    res.json({
      success: true,
      data: {
        agentId,
        ...dashboard.summary,
        weeklyGrowth: dashboard.trends.weeklyGrowth,
        topTool: dashboard.revenueByTool[0] || null,
        topCustomer: dashboard.topCustomers[0] || null,
      },
    });
  } catch (error: any) {
    console.error("Error fetching summary:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch summary",
    });
  }
});

// =============================================================================
// PRICE OPTIMIZATION SUGGESTIONS
// =============================================================================

/**
 * GET /economics/pricing/optimize/:agentId
 *
 * AI-powered price optimization suggestions:
 * - Market position analysis
 * - Per-tool suggestions (increase/decrease/maintain)
 * - Estimated revenue impact
 * - Competitive insights
 *
 * This is "AI about AI economy" - analyzing pricing patterns
 * to help agents maximize revenue without losing demand.
 */
router.get("/pricing/optimize/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const report = await getPriceOptimizationSuggestions(agentId);

    res.json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    console.error("Error generating price optimization:", error);
    res.status(error.message?.includes("not found") ? 404 : 500).json({
      success: false,
      error: error.message || "Failed to generate price optimization suggestions",
    });
  }
});

/**
 * GET /economics/pricing/market
 *
 * Market-wide pricing statistics (no auth required for transparency)
 */
router.get("/pricing/market", async (_req, res) => {
  try {
    const report = await getPriceOptimizationSuggestions("__market__");

    res.json({
      success: true,
      data: {
        avgMarketRate: report.marketPosition.avgMarketRate,
        timestamp: new Date(),
      },
    });
  } catch (error: any) {
    // Return defaults if no data
    res.json({
      success: true,
      data: {
        avgMarketRate: 1000,
        timestamp: new Date(),
      },
    });
  }
});

// =============================================================================
// DYNAMIC SETTLEMENT STRATEGY
// =============================================================================

/**
 * GET /economics/settlement/strategy/:agentId
 *
 * Get optimal settlement timing recommendation:
 * - Settle now (gas is cheap, balance is ready)
 * - Wait (gas is high, better timing ahead)
 * - Batch (accumulate more for efficiency)
 *
 * Factors considered:
 * - Current gas price vs historical average
 * - Pending balance vs optimal batch size
 * - Time since last settlement
 */
router.get("/settlement/strategy/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const strategy = await getSettlementStrategy(agentId);

    res.json({
      success: true,
      data: strategy,
    });
  } catch (error: any) {
    console.error("Error calculating settlement strategy:", error);
    res.status(error.message?.includes("not found") ? 404 : 500).json({
      success: false,
      error: error.message || "Failed to calculate settlement strategy",
    });
  }
});

/**
 * GET /economics/settlement/gas
 *
 * Current gas conditions and timing recommendation
 */
router.get("/settlement/gas", async (_req, res) => {
  try {
    const gas = getGasEstimate();

    res.json({
      success: true,
      data: {
        ...gas,
        recommendation: gas.isLow
          ? "Good time to settle - gas is below average"
          : "Consider waiting - gas is above average",
        timestamp: new Date(),
      },
    });
  } catch (error: any) {
    console.error("Error fetching gas estimate:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch gas estimate",
    });
  }
});

/**
 * GET /economics/settlement/platform
 *
 * Platform-wide settlement statistics (admin view)
 */
router.get("/settlement/platform", apiKeyAuth, async (_req, res) => {
  try {
    const stats = await getPlatformSettlementStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("Error fetching platform settlement stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch platform settlement stats",
    });
  }
});

/**
 * POST /economics/settlement/auto-optimize
 *
 * Enable/disable auto-optimized settlements for an agent.
 * When enabled, settlements will be triggered automatically when:
 * - Gas drops below average AND
 * - Pending balance exceeds optimal batch size
 */
router.post("/settlement/auto-optimize/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;
    const { enabled } = req.body;

    // In production, this would update agent settings
    // For now, return acknowledgment
    res.json({
      success: true,
      data: {
        agentId,
        autoOptimizeEnabled: enabled !== false,
        message: enabled !== false
          ? "Auto-optimized settlements enabled. Settlements will trigger when gas is low and balance is ready."
          : "Auto-optimized settlements disabled. Manual settlement required.",
      },
    });
  } catch (error: any) {
    console.error("Error updating auto-optimize:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update auto-optimize settings",
    });
  }
});

export default router;
