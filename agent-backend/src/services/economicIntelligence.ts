/**
 * Economic Intelligence Service
 *
 * Transforms raw data into actionable business insights:
 * - Agent Earnings Dashboard (real business metrics)
 * - Price Optimization Suggestions (AI about AI economy)
 * - Dynamic Settlement Strategy (fee optimization)
 */

import { eq, and, desc, sql, sum, count, avg, gte, lte } from "drizzle-orm";
import { db, pool, agents, tools, toolUsage, settlements, platformRevenue } from "../db/client";
import { PRICING_CONSTANTS, calculatePlatformFee } from "./pricingService";

// =============================================================================
// AGENT EARNINGS DASHBOARD
// =============================================================================

export interface EarningsDashboard {
  agentId: string;
  summary: {
    totalRevenue: number;
    totalCost: number;
    netProfit: number;
    platformFeesPaid: number;
    profitMargin: number;
    totalCalls: number;
    avgRevenuePerCall: number;
    avgTokensPerCall: number;
  };
  revenueByTool: Array<{
    toolName: string;
    revenue: number;
    calls: number;
    avgTokens: number;
    percentOfTotal: number;
  }>;
  revenueByCaller: Array<{
    callerId: string;
    revenue: number;
    calls: number;
    avgCostPerCall: number;
    percentOfTotal: number;
  }>;
  costDistribution: {
    toolCalls: number;
    platformFees: number;
    netReceived: number;
  };
  topCustomers: Array<{
    customerId: string;
    lifetimeValue: number;
    callCount: number;
    lastActivity: Date | null;
  }>;
  trends: {
    dailyRevenue: Array<{ date: string; revenue: number; calls: number }>;
    weeklyGrowth: number | null;
  };
}

/**
 * Get comprehensive earnings dashboard for an agent
 */
export async function getEarningsDashboard(agentId: string): Promise<EarningsDashboard> {
  if (!db) throw new Error("Database not connected");

  // =========================================================================
  // SUMMARY METRICS
  // =========================================================================

  // Total revenue (as callee)
  const revenueResult = await db
    .select({
      totalRevenue: sum(toolUsage.costLamports),
      callCount: count(),
      avgTokens: sql<number>`avg(${toolUsage.tokensUsed})::int`,
    })
    .from(toolUsage)
    .where(eq(toolUsage.calleeAgentId, agentId));

  const totalRevenue = Number(revenueResult[0]?.totalRevenue || 0);
  const totalCalls = Number(revenueResult[0]?.callCount || 0);
  const avgTokensPerCall = Number(revenueResult[0]?.avgTokens || 0);

  // Total cost (as caller)
  const costResult = await db
    .select({
      totalCost: sum(toolUsage.costLamports),
    })
    .from(toolUsage)
    .where(eq(toolUsage.callerAgentId, agentId));

  const totalCost = Number(costResult[0]?.totalCost || 0);

  // Platform fees paid (from settlements)
  const feeResult = await db
    .select({
      totalFees: sum(settlements.platformFeeLamports),
    })
    .from(settlements)
    .where(eq(settlements.fromAgentId, agentId));

  const platformFeesPaid = Number(feeResult[0]?.totalFees || 0);

  // Net profit calculation
  const netProfit = totalRevenue - platformFeesPaid;
  const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const avgRevenuePerCall = totalCalls > 0 ? totalRevenue / totalCalls : 0;

  // =========================================================================
  // REVENUE BY TOOL
  // =========================================================================

  const toolRevenueResult = await db
    .select({
      toolName: toolUsage.toolName,
      revenue: sum(toolUsage.costLamports),
      calls: count(),
      avgTokens: sql<number>`avg(${toolUsage.tokensUsed})::int`,
    })
    .from(toolUsage)
    .where(eq(toolUsage.calleeAgentId, agentId))
    .groupBy(toolUsage.toolName)
    .orderBy(desc(sql`sum(${toolUsage.costLamports})`));

  const revenueByTool = toolRevenueResult.map((t) => ({
    toolName: t.toolName,
    revenue: Number(t.revenue || 0),
    calls: Number(t.calls),
    avgTokens: Number(t.avgTokens || 0),
    percentOfTotal: totalRevenue > 0 ? (Number(t.revenue || 0) / totalRevenue) * 100 : 0,
  }));

  // =========================================================================
  // REVENUE BY CALLER (Your Customers)
  // =========================================================================

  const callerRevenueResult = await db
    .select({
      callerId: toolUsage.callerAgentId,
      revenue: sum(toolUsage.costLamports),
      calls: count(),
    })
    .from(toolUsage)
    .where(eq(toolUsage.calleeAgentId, agentId))
    .groupBy(toolUsage.callerAgentId)
    .orderBy(desc(sql`sum(${toolUsage.costLamports})`))
    .limit(20);

  const revenueByCaller = callerRevenueResult.map((c) => ({
    callerId: c.callerId,
    revenue: Number(c.revenue || 0),
    calls: Number(c.calls),
    avgCostPerCall: Number(c.calls) > 0 ? Number(c.revenue || 0) / Number(c.calls) : 0,
    percentOfTotal: totalRevenue > 0 ? (Number(c.revenue || 0) / totalRevenue) * 100 : 0,
  }));

  // =========================================================================
  // TOP CUSTOMERS (Lifetime Value)
  // =========================================================================

  const topCustomersResult = await db
    .select({
      customerId: toolUsage.callerAgentId,
      lifetimeValue: sum(toolUsage.costLamports),
      callCount: count(),
      lastActivity: sql<Date>`max(${toolUsage.createdAt})`,
    })
    .from(toolUsage)
    .where(eq(toolUsage.calleeAgentId, agentId))
    .groupBy(toolUsage.callerAgentId)
    .orderBy(desc(sql`sum(${toolUsage.costLamports})`))
    .limit(10);

  const topCustomers = topCustomersResult.map((c) => ({
    customerId: c.customerId,
    lifetimeValue: Number(c.lifetimeValue || 0),
    callCount: Number(c.callCount),
    lastActivity: c.lastActivity,
  }));

  // =========================================================================
  // DAILY REVENUE TRENDS (Last 30 days)
  // =========================================================================

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const dailyRevenueResult = await db
    .select({
      date: sql<string>`date(${toolUsage.createdAt})`,
      revenue: sum(toolUsage.costLamports),
      calls: count(),
    })
    .from(toolUsage)
    .where(
      and(
        eq(toolUsage.calleeAgentId, agentId),
        gte(toolUsage.createdAt, thirtyDaysAgo)
      )
    )
    .groupBy(sql`date(${toolUsage.createdAt})`)
    .orderBy(sql`date(${toolUsage.createdAt})`);

  const dailyRevenue = dailyRevenueResult.map((d) => ({
    date: d.date,
    revenue: Number(d.revenue || 0),
    calls: Number(d.calls),
  }));

  // Calculate weekly growth
  let weeklyGrowth: number | null = null;
  if (dailyRevenue.length >= 14) {
    const lastWeek = dailyRevenue.slice(-7).reduce((sum, d) => sum + d.revenue, 0);
    const previousWeek = dailyRevenue.slice(-14, -7).reduce((sum, d) => sum + d.revenue, 0);
    if (previousWeek > 0) {
      weeklyGrowth = ((lastWeek - previousWeek) / previousWeek) * 100;
    }
  }

  // =========================================================================
  // COST DISTRIBUTION
  // =========================================================================

  const estimatedFees = calculatePlatformFee(totalRevenue);

  return {
    agentId,
    summary: {
      totalRevenue,
      totalCost,
      netProfit,
      platformFeesPaid,
      profitMargin: Math.round(profitMargin * 100) / 100,
      totalCalls,
      avgRevenuePerCall: Math.round(avgRevenuePerCall),
      avgTokensPerCall,
    },
    revenueByTool,
    revenueByCaller,
    costDistribution: {
      toolCalls: totalRevenue,
      platformFees: estimatedFees,
      netReceived: totalRevenue - estimatedFees,
    },
    topCustomers,
    trends: {
      dailyRevenue,
      weeklyGrowth: weeklyGrowth !== null ? Math.round(weeklyGrowth * 100) / 100 : null,
    },
  };
}

// =============================================================================
// PRICE OPTIMIZATION SUGGESTIONS
// =============================================================================

export interface PriceSuggestion {
  type: "increase" | "decrease" | "maintain";
  toolName: string;
  currentRate: number;
  suggestedRate: number;
  changePercent: number;
  reason: string;
  confidence: "high" | "medium" | "low";
  estimatedImpact: {
    revenueChange: number;
    demandChange: string;
  };
}

export interface PriceOptimizationReport {
  agentId: string;
  analyzedAt: Date;
  marketPosition: {
    avgMarketRate: number;
    yourAvgRate: number;
    percentile: number;
    competitiveGap: number;
  };
  suggestions: PriceSuggestion[];
  insights: string[];
}

/**
 * Generate price optimization suggestions based on market data
 */
export async function getPriceOptimizationSuggestions(
  agentId: string
): Promise<PriceOptimizationReport> {
  if (!db) throw new Error("Database not connected");

  // Get agent's tools and their rates
  const agentTools = await db
    .select()
    .from(tools)
    .where(eq(tools.agentId, agentId));

  // Get market-wide pricing data
  const marketRatesResult = await db
    .select({
      avgRate: sql<number>`avg(${tools.ratePer1kTokens})::int`,
      minRate: sql<number>`min(${tools.ratePer1kTokens})::int`,
      maxRate: sql<number>`max(${tools.ratePer1kTokens})::int`,
      toolCount: count(),
    })
    .from(tools);

  const marketAvgRate = Number(marketRatesResult[0]?.avgRate || PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS);
  const marketMinRate = Number(marketRatesResult[0]?.minRate || 100);
  const marketMaxRate = Number(marketRatesResult[0]?.maxRate || 10000);

  // Calculate agent's average rate
  const agentAvgRate = agentTools.length > 0
    ? agentTools.reduce((sum, t) => sum + t.ratePer1kTokens, 0) / agentTools.length
    : PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS;

  // Calculate percentile position
  const percentile = ((agentAvgRate - marketMinRate) / (marketMaxRate - marketMinRate || 1)) * 100;

  // Get usage patterns for demand analysis
  const usagePatternResult = await db
    .select({
      toolName: toolUsage.toolName,
      callCount: count(),
      totalRevenue: sum(toolUsage.costLamports),
      avgRate: sql<number>`avg(${toolUsage.ratePer1kTokens})::int`,
    })
    .from(toolUsage)
    .where(eq(toolUsage.calleeAgentId, agentId))
    .groupBy(toolUsage.toolName);

  const usageByTool = new Map(
    usagePatternResult.map((u) => [u.toolName, {
      calls: Number(u.callCount),
      revenue: Number(u.totalRevenue || 0),
      avgRate: Number(u.avgRate || 0),
    }])
  );

  // Generate suggestions for each tool
  const suggestions: PriceSuggestion[] = [];
  const insights: string[] = [];

  for (const tool of agentTools) {
    const usage = usageByTool.get(tool.name);
    const toolRate = tool.ratePer1kTokens;
    const rateVsMarket = ((toolRate - marketAvgRate) / marketAvgRate) * 100;

    // High demand + below market = can increase
    if (usage && usage.calls > 10 && rateVsMarket < -10) {
      const suggestedIncrease = Math.min(20, Math.abs(rateVsMarket) * 0.6);
      const suggestedRate = Math.round(toolRate * (1 + suggestedIncrease / 100));

      suggestions.push({
        type: "increase",
        toolName: tool.name,
        currentRate: toolRate,
        suggestedRate,
        changePercent: suggestedIncrease,
        reason: `High demand (${usage.calls} calls) with rate ${Math.abs(Math.round(rateVsMarket))}% below market average`,
        confidence: usage.calls > 50 ? "high" : "medium",
        estimatedImpact: {
          revenueChange: Math.round(usage.revenue * (suggestedIncrease / 100)),
          demandChange: "minimal impact expected",
        },
      });
    }

    // Low demand + above market = consider decrease
    if (usage && usage.calls < 5 && rateVsMarket > 15) {
      const suggestedDecrease = Math.min(15, rateVsMarket * 0.5);
      const suggestedRate = Math.round(toolRate * (1 - suggestedDecrease / 100));

      suggestions.push({
        type: "decrease",
        toolName: tool.name,
        currentRate: toolRate,
        suggestedRate,
        changePercent: -suggestedDecrease,
        reason: `Low demand (${usage?.calls || 0} calls) with rate ${Math.round(rateVsMarket)}% above market average`,
        confidence: "medium",
        estimatedImpact: {
          revenueChange: 0, // Hard to estimate gain from new demand
          demandChange: "expect 20-40% more calls",
        },
      });
    }

    // No usage at all
    if (!usage || usage.calls === 0) {
      insights.push(`Tool "${tool.name}" has no usage - consider marketing or price adjustment`);
    }
  }

  // Market position insights
  if (percentile > 80) {
    insights.push("Your pricing is in the top 20% of the market - ensure quality justifies premium");
  } else if (percentile < 20) {
    insights.push("Your pricing is in the bottom 20% - you may be leaving money on the table");
  }

  if (agentAvgRate < marketAvgRate * 0.8) {
    insights.push(
      `Your average rate (${agentAvgRate} lamports/1k tokens) is 20%+ below market average (${marketAvgRate})`
    );
  }

  return {
    agentId,
    analyzedAt: new Date(),
    marketPosition: {
      avgMarketRate: marketAvgRate,
      yourAvgRate: Math.round(agentAvgRate),
      percentile: Math.round(percentile),
      competitiveGap: Math.round(agentAvgRate - marketAvgRate),
    },
    suggestions,
    insights,
  };
}

// =============================================================================
// DYNAMIC SETTLEMENT STRATEGY
// =============================================================================

export interface SettlementStrategy {
  agentId: string;
  pendingLamports: number;
  recommendation: "settle_now" | "wait" | "batch";
  reason: string;
  estimatedSavings: number;
  factors: {
    gasCostEstimate: number;
    pendingAmount: number;
    timeSinceLastSettlement: number | null;
    optimalBatchSize: number;
  };
  scheduledSettlement?: {
    when: string;
    trigger: string;
  };
}

export interface GasEstimate {
  currentLamports: number;
  avgLamports: number;
  isLow: boolean;
  percentile: number;
}

// Simulated gas price tracking (in production, would use Solana RPC)
let gasHistory: number[] = [];
const GAS_BASELINE = 5000; // 0.000005 SOL base fee

/**
 * Get current gas estimate (simulated - in production use Solana RPC)
 */
export function getGasEstimate(): GasEstimate {
  // Simulate gas price fluctuation
  const fluctuation = 0.8 + Math.random() * 0.4; // 80% to 120% of baseline
  const currentGas = Math.round(GAS_BASELINE * fluctuation);

  gasHistory.push(currentGas);
  if (gasHistory.length > 100) gasHistory = gasHistory.slice(-100);

  const avgGas = gasHistory.reduce((a, b) => a + b, 0) / gasHistory.length;
  const sortedGas = [...gasHistory].sort((a, b) => a - b);
  const percentileIndex = sortedGas.findIndex((g) => g >= currentGas);
  const percentile = (percentileIndex / sortedGas.length) * 100;

  return {
    currentLamports: currentGas,
    avgLamports: Math.round(avgGas),
    isLow: currentGas < avgGas * 0.9,
    percentile: Math.round(percentile),
  };
}

/**
 * Get optimal settlement strategy for an agent
 */
export async function getSettlementStrategy(agentId: string): Promise<SettlementStrategy> {
  if (!db) throw new Error("Database not connected");

  // Get agent's pending balance
  const agent = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (agent.length === 0) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const pendingLamports = agent[0].pendingLamports;

  // Get last settlement time
  const lastSettlementResult = await db
    .select({ createdAt: settlements.createdAt })
    .from(settlements)
    .where(eq(settlements.fromAgentId, agentId))
    .orderBy(desc(settlements.createdAt))
    .limit(1);

  const lastSettlement = lastSettlementResult[0]?.createdAt;
  const timeSinceLastSettlement = lastSettlement
    ? Date.now() - new Date(lastSettlement).getTime()
    : null;

  // Get gas estimate
  const gas = getGasEstimate();

  // Calculate optimal batch size (minimize fees as % of payout)
  // At 5% platform fee, gas should be < 1% of payout for efficiency
  const optimalBatchSize = Math.max(
    PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS,
    gas.currentLamports * 100 // Gas should be ~1% of settlement
  );

  // Decision logic
  let recommendation: "settle_now" | "wait" | "batch";
  let reason: string;
  let estimatedSavings = 0;

  if (pendingLamports < PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS) {
    recommendation = "wait";
    reason = `Pending balance (${pendingLamports}) below minimum payout threshold (${PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS})`;
  } else if (pendingLamports >= optimalBatchSize && gas.isLow) {
    recommendation = "settle_now";
    reason = `Good conditions: pending ${pendingLamports} lamports, gas is ${gas.percentile}th percentile (below average)`;
    estimatedSavings = Math.round((gas.avgLamports - gas.currentLamports) * 0.8);
  } else if (pendingLamports >= optimalBatchSize * 2) {
    recommendation = "settle_now";
    reason = `Large pending balance (${pendingLamports}) - settle to reduce counterparty risk`;
  } else if (gas.percentile > 70) {
    recommendation = "wait";
    reason = `Gas is ${gas.percentile}th percentile (above average) - wait for lower fees`;
    estimatedSavings = Math.round((gas.currentLamports - gas.avgLamports) * 0.5);
  } else {
    recommendation = "batch";
    reason = `Accumulate to ${optimalBatchSize} lamports for optimal fee efficiency`;
  }

  return {
    agentId,
    pendingLamports,
    recommendation,
    reason,
    estimatedSavings,
    factors: {
      gasCostEstimate: gas.currentLamports,
      pendingAmount: pendingLamports,
      timeSinceLastSettlement: timeSinceLastSettlement
        ? Math.round(timeSinceLastSettlement / (1000 * 60 * 60)) // hours
        : null,
      optimalBatchSize,
    },
    ...(recommendation === "wait" || recommendation === "batch"
      ? {
          scheduledSettlement: {
            when: recommendation === "wait" ? "When gas drops below average" : `When pending reaches ${optimalBatchSize} lamports`,
            trigger: recommendation === "wait" ? "gas_low" : "balance_threshold",
          },
        }
      : {}),
  };
}

/**
 * Get platform-wide settlement optimization stats
 */
export async function getPlatformSettlementStats() {
  if (!db) throw new Error("Database not connected");

  // Agents with pending balances
  const pendingResult = await db
    .select({
      agentCount: count(),
      totalPending: sum(agents.pendingLamports),
      avgPending: sql<number>`avg(${agents.pendingLamports})::int`,
    })
    .from(agents)
    .where(gte(agents.pendingLamports, PRICING_CONSTANTS.MIN_PAYOUT_LAMPORTS));

  // Recent settlements
  const recentSettlements = await db
    .select({
      avgGross: sql<number>`avg(${settlements.grossLamports})::int`,
      avgFee: sql<number>`avg(${settlements.platformFeeLamports})::int`,
      count: count(),
    })
    .from(settlements)
    .where(gte(settlements.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));

  const gas = getGasEstimate();

  return {
    pendingSettlements: {
      agentCount: Number(pendingResult[0]?.agentCount || 0),
      totalPendingLamports: Number(pendingResult[0]?.totalPending || 0),
      avgPendingLamports: Number(pendingResult[0]?.avgPending || 0),
    },
    recentActivity: {
      settlementsLast7Days: Number(recentSettlements[0]?.count || 0),
      avgGrossLamports: Number(recentSettlements[0]?.avgGross || 0),
      avgFeeLamports: Number(recentSettlements[0]?.avgFee || 0),
    },
    gasConditions: gas,
    recommendation: gas.isLow
      ? "Good time for batch settlements"
      : "Consider waiting for lower gas",
  };
}
