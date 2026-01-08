import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { verifyIdentity } from "../services/identityService.js";
import { query } from "../db/client.js";

const router = Router();

// Register/verify identity and initialize agent with pricing
router.post("/verify-identity", apiKeyAuth, async (req, res) => {
  try {
    const { agentId, firstName, lastName, dob, idNumber, ratePer1kTokens } = req.body;

    // Validate required fields
    if (!agentId || !firstName || !lastName || !dob || !idNumber) {
      return res.status(400).json({ error: "Missing required fields: agentId, firstName, lastName, dob, idNumber" });
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

    // Register agent with pricing (default rate if not provided)
    const rate = ratePer1kTokens || 1000; // Default: 1000 lamports per 1k tokens
    const initialBalance = 1_000_000; // 1M lamports initial balance for testing

    try {
      // Upsert agent with pricing
      await query(
        `insert into agents (id, name, rate_per_1k_tokens, balance_lamports, pending_lamports, created_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (id) do update set
           rate_per_1k_tokens = $3,
           name = $2`,
        [agentId, `${firstName} ${lastName}`, rate, initialBalance, 0]
      );

      res.json({
        status: "verified",
        agent: {
          id: agentId,
          name: `${firstName} ${lastName}`,
          ratePer1kTokens: rate,
          balanceLamports: initialBalance,
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