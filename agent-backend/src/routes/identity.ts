import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import { verifyIdentity } from "../services/identityService";
import { upsertAgent, registerTool, PRICING_CONSTANTS } from "../services/pricingService";
import { logIdentityCreated } from "../services/activityService";

const router = Router();

/**
 * POST /identity/verify-identity
 *
 * Register/verify identity and initialize agent with pricing.
 * Now supports per-tool pricing - can register tools at the same time.
 *
 * Request:
 *   {
 *     agentId: string,
 *     firstName: string,
 *     lastName: string,
 *     dob: string,
 *     idNumber: string,
 *     defaultRatePer1kTokens?: number,  // Agent's default rate
 *     tools?: [{ name: string, ratePer1kTokens: number, description?: string }]
 *   }
 */
router.post("/verify-identity", apiKeyAuth, async (req, res) => {
  try {
    const { 
      agentId, 
      firstName, 
      lastName, 
      dob, 
      idNumber, 
      defaultRatePer1kTokens,
      tools: toolsToRegister 
    } = req.body;

    // Validate required fields
    if (!agentId || !firstName || !lastName || !dob || !idNumber) {
      return res.status(400).json({ 
        error: "Missing required fields: agentId, firstName, lastName, dob, idNumber" 
      });
    }

    // Verify identity
    const verificationResult = await verifyIdentity({
      firstName,
      lastName,
      dob,
      idNumber,
    });

    if (verificationResult.status !== "verified") {
      return res.status(400).json({ error: "Identity verification failed" });
    }

    // Register agent with pricing
    const rate = defaultRatePer1kTokens || PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS;
    const initialBalance = 1_000_000; // 1M lamports initial balance for testing

    try {
      // Upsert agent using Drizzle
      const agent = await upsertAgent({
        id: agentId,
        name: `${firstName} ${lastName}`,
        defaultRatePer1kTokens: rate,
        balanceLamports: initialBalance,
      });

      // Register tools if provided
      const registeredTools = [];
      if (Array.isArray(toolsToRegister)) {
        for (const tool of toolsToRegister) {
          if (tool.name && tool.ratePer1kTokens !== undefined) {
            const registered = await registerTool({
              agentId,
              name: tool.name,
              description: tool.description,
              ratePer1kTokens: tool.ratePer1kTokens,
            });
            registeredTools.push({
              name: registered.name,
              ratePer1kTokens: registered.ratePer1kTokens,
            });
          }
        }
      }

      // Log identity creation
      logIdentityCreated(agentId, agent.name || agentId, "verified", {
        ratePer1kTokens: rate,
        initialBalance,
        toolsRegistered: registeredTools.length,
      });

      res.json({
        status: "verified",
        agent: {
          id: agent.id,
          name: agent.name,
          defaultRatePer1kTokens: agent.defaultRatePer1kTokens,
          balanceLamports: agent.balanceLamports,
          tools: registeredTools,
        },
        details: verificationResult.details,
      });
    } catch (dbError) {
      console.error("Agent registration error:", dbError);
      res.status(500).json({ error: "Failed to register agent" });
    }
  } catch (error) {
    console.error("Identity verification error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

export default router;
