/**
 * Simulation Service
 *
 * Run workflows without actual payments to predict costs.
 * Developers LOVE this - they can test pricing before going live.
 *
 * Features:
 * - Simulate single tool calls
 * - Simulate multi-step workflows (call graphs)
 * - Predict total costs with breakdowns
 * - Check budget feasibility
 * - No actual balance changes
 */

import { eq, and } from "drizzle-orm";
import { db, agents, tools } from "../db/client";
import { calculateCost, PRICING_CONSTANTS, getAgent, getToolPricing } from "./pricingService";

// =============================================================================
// TYPES
// =============================================================================

export interface CallNode {
  callerId: string;
  calleeId: string;
  toolName: string;
  tokensEstimate: number;
}

export interface SimulatedCall extends CallNode {
  ratePer1kTokens: number;
  estimatedCostLamports: number;
  platformFeeLamports: number;
  netToProviderLamports: number;
}

export interface WorkflowSimulation {
  totalCostLamports: number;
  totalPlatformFeeLamports: number;
  totalNetToProvidersLamports: number;
  callCount: number;
  calls: SimulatedCall[];
  breakdown: {
    byProvider: Record<string, number>;
    byCaller: Record<string, number>;
    byTool: Record<string, number>;
  };
  feasibility: {
    feasible: boolean;
    insufficientFunds: string[];
    exceedsDailyLimits: string[];
    exceedsPerCallLimits: string[];
    blockedCallees: string[];
  };
  warnings: string[];
}

// =============================================================================
// SIMULATION FUNCTIONS
// =============================================================================

/**
 * Simulate a single tool call
 *
 * Returns predicted cost without executing payment.
 */
export async function simulateCall(call: CallNode): Promise<SimulatedCall> {
  if (!db) throw new Error("Database not connected");

  const { callerId, calleeId, toolName, tokensEstimate } = call;

  // Get tool pricing (same logic as real execution)
  const { ratePer1kTokens } = await getToolPricing(calleeId, toolName);

  // Calculate cost using same formula as production
  const estimatedCostLamports = calculateCost(tokensEstimate, ratePer1kTokens);
  const platformFeeLamports = Math.floor(
    estimatedCostLamports * PRICING_CONSTANTS.PLATFORM_FEE_PERCENT
  );
  const netToProviderLamports = estimatedCostLamports - platformFeeLamports;

  return {
    callerId,
    calleeId,
    toolName,
    tokensEstimate,
    ratePer1kTokens,
    estimatedCostLamports,
    platformFeeLamports,
    netToProviderLamports,
  };
}

/**
 * Simulate an entire workflow (call graph)
 *
 * Accepts an array of calls representing a multi-agent workflow.
 * Returns total predicted cost with detailed breakdown.
 *
 * Example call graph:
 * [
 *   { callerId: "orchestrator", calleeId: "code-agent", toolName: "write-code", tokensEstimate: 5000 },
 *   { callerId: "code-agent", calleeId: "review-agent", toolName: "code-review", tokensEstimate: 3000 },
 *   { callerId: "orchestrator", calleeId: "deploy-agent", toolName: "deploy", tokensEstimate: 1000 },
 * ]
 */
export async function simulateWorkflow(
  callGraph: CallNode[]
): Promise<WorkflowSimulation> {
  if (!db) throw new Error("Database not connected");

  if (callGraph.length === 0) {
    return {
      totalCostLamports: 0,
      totalPlatformFeeLamports: 0,
      totalNetToProvidersLamports: 0,
      callCount: 0,
      calls: [],
      breakdown: {
        byProvider: {},
        byCaller: {},
        byTool: {},
      },
      feasibility: {
        feasible: true,
        insufficientFunds: [],
        exceedsDailyLimits: [],
        exceedsPerCallLimits: [],
        blockedCallees: [],
      },
      warnings: [],
    };
  }

  // Simulate all calls
  const simulatedCalls: SimulatedCall[] = [];
  for (const call of callGraph) {
    const simulated = await simulateCall(call);
    simulatedCalls.push(simulated);
  }

  // Calculate totals
  const totalCostLamports = simulatedCalls.reduce(
    (sum, c) => sum + c.estimatedCostLamports,
    0
  );
  const totalPlatformFeeLamports = simulatedCalls.reduce(
    (sum, c) => sum + c.platformFeeLamports,
    0
  );
  const totalNetToProvidersLamports = simulatedCalls.reduce(
    (sum, c) => sum + c.netToProviderLamports,
    0
  );

  // Build breakdown by provider
  const byProvider: Record<string, number> = {};
  const byCaller: Record<string, number> = {};
  const byTool: Record<string, number> = {};

  for (const call of simulatedCalls) {
    byProvider[call.calleeId] = (byProvider[call.calleeId] || 0) + call.netToProviderLamports;
    byCaller[call.callerId] = (byCaller[call.callerId] || 0) + call.estimatedCostLamports;
    
    const toolKey = `${call.calleeId}/${call.toolName}`;
    byTool[toolKey] = (byTool[toolKey] || 0) + call.estimatedCostLamports;
  }

  // Check feasibility against budgets
  const feasibility = await checkWorkflowFeasibility(simulatedCalls);

  // Generate warnings
  const warnings: string[] = [];
  
  if (totalCostLamports > 1_000_000_000) {
    warnings.push("Total cost exceeds 1 SOL - consider optimizing workflow");
  }
  
  const uniqueProviders = Object.keys(byProvider);
  if (uniqueProviders.length > 10) {
    warnings.push("Workflow touches many providers - may have high latency");
  }
  
  const maxSingleCallCost = Math.max(...simulatedCalls.map(c => c.estimatedCostLamports));
  if (maxSingleCallCost > totalCostLamports * 0.5) {
    warnings.push("One call dominates total cost - consider alternatives");
  }

  return {
    totalCostLamports,
    totalPlatformFeeLamports,
    totalNetToProvidersLamports,
    callCount: callGraph.length,
    calls: simulatedCalls,
    breakdown: {
      byProvider,
      byCaller,
      byTool,
    },
    feasibility,
    warnings,
  };
}

/**
 * Check if workflow is feasible against current budgets
 */
async function checkWorkflowFeasibility(
  calls: SimulatedCall[]
): Promise<WorkflowSimulation["feasibility"]> {
  if (!db) throw new Error("Database not connected");

  const insufficientFunds: string[] = [];
  const exceedsDailyLimits: string[] = [];
  const exceedsPerCallLimits: string[] = [];
  const blockedCallees: string[] = [];

  // Aggregate costs by caller
  const costsByCaller: Record<string, number> = {};
  for (const call of calls) {
    costsByCaller[call.callerId] = (costsByCaller[call.callerId] || 0) + call.estimatedCostLamports;
  }

  // Check each caller's budget
  for (const callerId of Object.keys(costsByCaller)) {
    try {
      const caller = await getAgent(callerId);
      const totalNeeded = costsByCaller[callerId];

      // Check balance
      if (caller.balanceLamports < totalNeeded) {
        insufficientFunds.push(
          `${callerId}: needs ${totalNeeded} lamports, has ${caller.balanceLamports}`
        );
      }

      // Check daily cap
      if (caller.dailySpendCap && totalNeeded > caller.dailySpendCap) {
        exceedsDailyLimits.push(
          `${callerId}: workflow needs ${totalNeeded}, daily cap is ${caller.dailySpendCap}`
        );
      }

      // Check per-call limits
      if (caller.maxCostPerCall) {
        const exceeding = calls.filter(
          c => c.callerId === callerId && c.estimatedCostLamports > caller.maxCostPerCall!
        );
        for (const c of exceeding) {
          exceedsPerCallLimits.push(
            `${callerId}->${c.calleeId}/${c.toolName}: cost ${c.estimatedCostLamports} exceeds max ${caller.maxCostPerCall}`
          );
        }
      }

      // Check allowlist
      if (caller.allowedCallees) {
        try {
          const allowed = JSON.parse(caller.allowedCallees) as string[];
          const blocked = calls.filter(
            c => c.callerId === callerId && !allowed.includes(c.calleeId)
          );
          for (const c of blocked) {
            blockedCallees.push(`${callerId} cannot call ${c.calleeId} (not in allowlist)`);
          }
        } catch (e) {
          // Invalid JSON, skip allowlist check
        }
      }

      // Check kill switch
      if (caller.isPaused === "true") {
        insufficientFunds.push(`${callerId}: agent is paused (kill switch active)`);
      }
    } catch (e) {
      // Agent doesn't exist - will be created on first real call
      // For simulation, assume they'll need to fund it
      const totalNeeded = costsByCaller[callerId];
      insufficientFunds.push(
        `${callerId}: agent not registered, will need ${totalNeeded} lamports`
      );
    }
  }

  const feasible =
    insufficientFunds.length === 0 &&
    exceedsDailyLimits.length === 0 &&
    exceedsPerCallLimits.length === 0 &&
    blockedCallees.length === 0;

  return {
    feasible,
    insufficientFunds,
    exceedsDailyLimits,
    exceedsPerCallLimits,
    blockedCallees,
  };
}

/**
 * Quick cost estimate without database lookups
 *
 * Uses default rates for approximate cost.
 * Useful for UI previews before workflow is fully defined.
 */
export function quickEstimate(
  tokensTotal: number,
  ratePer1kTokens: number = PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS
): {
  estimatedCostLamports: number;
  estimatedCostSol: number;
  platformFeeLamports: number;
  netToProviderLamports: number;
} {
  const estimatedCostLamports = calculateCost(tokensTotal, ratePer1kTokens);
  const platformFeeLamports = Math.floor(
    estimatedCostLamports * PRICING_CONSTANTS.PLATFORM_FEE_PERCENT
  );
  const netToProviderLamports = estimatedCostLamports - platformFeeLamports;
  const estimatedCostSol = estimatedCostLamports / 1_000_000_000;

  return {
    estimatedCostLamports,
    estimatedCostSol,
    platformFeeLamports,
    netToProviderLamports,
  };
}

/**
 * Compare multiple workflows
 *
 * Helps developers choose the most cost-effective approach.
 */
export async function compareWorkflows(
  workflows: { name: string; callGraph: CallNode[] }[]
): Promise<{
  comparisons: {
    name: string;
    totalCostLamports: number;
    callCount: number;
    feasible: boolean;
    warnings: number;
  }[];
  cheapest: string;
  recommendation: string;
}> {
  const comparisons = [];

  for (const workflow of workflows) {
    const sim = await simulateWorkflow(workflow.callGraph);
    comparisons.push({
      name: workflow.name,
      totalCostLamports: sim.totalCostLamports,
      callCount: sim.callCount,
      feasible: sim.feasibility.feasible,
      warnings: sim.warnings.length,
    });
  }

  // Sort by cost
  comparisons.sort((a, b) => a.totalCostLamports - b.totalCostLamports);

  const feasibleOptions = comparisons.filter(c => c.feasible);
  const cheapest = feasibleOptions[0]?.name || comparisons[0].name;

  let recommendation = "";
  if (feasibleOptions.length === 0) {
    recommendation = "No workflows are feasible with current budgets. Consider topping up balances or adjusting limits.";
  } else if (feasibleOptions.length === 1) {
    recommendation = `Only "${feasibleOptions[0].name}" is feasible with current budgets.`;
  } else {
    const cheapestFeasible = feasibleOptions[0];
    const savings = comparisons[comparisons.length - 1].totalCostLamports - cheapestFeasible.totalCostLamports;
    recommendation = `"${cheapestFeasible.name}" is the most cost-effective option (saves ${savings} lamports vs most expensive).`;
  }

  return {
    comparisons,
    cheapest,
    recommendation,
  };
}
