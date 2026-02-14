/**
 * Simulation Routes
 *
 * Run workflows without payment to predict costs.
 * Developers LOVE this for testing and planning.
 */

import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import {
  simulateCall,
  simulateWorkflow,
  compareWorkflows,
  quickEstimate,
} from "../services/simulationService";

const router = Router();

// =============================================================================
// SINGLE CALL SIMULATION
// =============================================================================

/**
 * POST /simulation/call
 *
 * Simulate a single tool call and get predicted cost.
 */
router.post("/call", apiKeyAuth, async (req, res) => {
  try {
    const { callerId, calleeId, toolName, tokensEstimate } = req.body;

    if (!callerId || !calleeId || !toolName || !tokensEstimate) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: callerId, calleeId, toolName, tokensEstimate",
      });
    }

    const result = await simulateCall({
      callerId,
      calleeId,
      toolName,
      tokensEstimate,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Error simulating call:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to simulate call",
    });
  }
});

// =============================================================================
// WORKFLOW SIMULATION
// =============================================================================

/**
 * POST /simulation/workflow
 *
 * Simulate an entire workflow (call graph) and get total predicted cost.
 *
 * Body:
 * {
 *   "callGraph": [
 *     { "callerId": "orchestrator", "calleeId": "code-agent", "toolName": "write-code", "tokensEstimate": 5000 },
 *     { "callerId": "code-agent", "calleeId": "review-agent", "toolName": "code-review", "tokensEstimate": 3000 }
 *   ]
 * }
 */
router.post("/workflow", apiKeyAuth, async (req, res) => {
  try {
    const { callGraph } = req.body;

    if (!callGraph || !Array.isArray(callGraph)) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid callGraph array",
      });
    }

    // Validate each call in the graph
    for (const call of callGraph) {
      if (!call.callerId || !call.calleeId || !call.toolName || !call.tokensEstimate) {
        return res.status(400).json({
          success: false,
          error: "Each call must have: callerId, calleeId, toolName, tokensEstimate",
        });
      }
    }

    const result = await simulateWorkflow(callGraph);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Error simulating workflow:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to simulate workflow",
    });
  }
});

// =============================================================================
// WORKFLOW COMPARISON
// =============================================================================

/**
 * POST /simulation/compare
 *
 * Compare multiple workflow options to find the most cost-effective.
 *
 * Body:
 * {
 *   "workflows": [
 *     {
 *       "name": "Option A - Single Agent",
 *       "callGraph": [...]
 *     },
 *     {
 *       "name": "Option B - Pipeline",
 *       "callGraph": [...]
 *     }
 *   ]
 * }
 */
router.post("/compare", apiKeyAuth, async (req, res) => {
  try {
    const { workflows } = req.body;

    if (!workflows || !Array.isArray(workflows) || workflows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid workflows array",
      });
    }

    for (const workflow of workflows) {
      if (!workflow.name || !Array.isArray(workflow.callGraph)) {
        return res.status(400).json({
          success: false,
          error: "Each workflow must have: name, callGraph",
        });
      }
    }

    const result = await compareWorkflows(workflows);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Error comparing workflows:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to compare workflows",
    });
  }
});

// =============================================================================
// QUICK ESTIMATE
// =============================================================================

/**
 * POST /simulation/estimate
 *
 * Quick cost estimate without database lookups.
 * Uses default rates for approximate cost.
 *
 * Body:
 * {
 *   "tokensTotal": 10000,
 *   "ratePer1kTokens": 1000  // optional, defaults to platform default
 * }
 */
router.post("/estimate", async (req, res) => {
  try {
    const { tokensTotal, ratePer1kTokens } = req.body;

    if (!tokensTotal || typeof tokensTotal !== "number") {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid tokensTotal (must be a number)",
      });
    }

    const result = quickEstimate(tokensTotal, ratePer1kTokens);

    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error("Error calculating estimate:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to calculate estimate",
    });
  }
});

export default router;
