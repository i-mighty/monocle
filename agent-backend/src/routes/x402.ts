/**
 * x402 Protocol Routes
 * 
 * HTTP 402 Payment Required endpoints for AI agent micropayments.
 * Implements the x402 standard for machine-to-machine payments on Solana.
 */

import { Router, Request, Response } from "express";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import {
  X402Config,
  x402Middleware,
  x402OptionalMiddleware,
  generatePaymentNonce,
  sendPaymentRequired,
  verifyPaymentProof,
  parsePaymentProof,
  PaymentRequirement,
  X402Request,
} from "../middleware/x402";
import { calculateCost, PRICING_CONSTANTS } from "../services/pricingService";
import { query } from "../db/client";

const router = Router();

// x402 Configuration
const x402Config: X402Config = {
  recipientWallet: process.env.PLATFORM_WALLET || "11111111111111111111111111111111",
  network: (process.env.SOLANA_NETWORK as "solana-mainnet" | "solana-devnet") || "solana-devnet",
  priceQuoteValidityMs: 5 * 60 * 1000, // 5 minutes
  connection: new Connection(
    process.env.SOLANA_RPC_URL || clusterApiUrl("devnet"),
    "confirmed"
  ),
};

/**
 * GET /x402/info
 * 
 * Returns x402 protocol information and capabilities.
 */
router.get("/info", (_req: Request, res: Response) => {
  res.json({
    protocol: "x402",
    version: "1.0.0",
    name: "AgentPay x402",
    description: "HTTP 402 micropayments for AI agents on Solana",
    network: x402Config.network,
    recipient: x402Config.recipientWallet,
    pricing: {
      model: "per_1k_tokens",
      defaultRate: PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS,
      minimumCost: PRICING_CONSTANTS.MIN_COST_LAMPORTS,
      currency: "lamports",
    },
    capabilities: [
      "token_metering",
      "agent_identity",
      "on_chain_settlement",
      "platform_fee",
    ],
    endpoints: {
      quote: "POST /x402/quote",
      execute: "POST /x402/execute",
      verify: "POST /x402/verify",
      demo: "GET /x402/demo-resource",
    },
    headers: {
      request: {
        "X-Payment-Signature": "Solana transaction signature (base58)",
        "X-Payment-Payer": "Payer wallet address",
        "X-Payment-Amount": "Amount in lamports",
        "X-Payment-Nonce": "Server-provided nonce",
      },
      response: {
        "X-Payment-Required": "true when 402 response",
        "X-Payment-Amount": "Required payment amount",
        "X-Payment-Recipient": "Recipient wallet address",
        "X-Payment-Network": "Solana network",
        "X-Payment-Expires": "Quote expiration timestamp",
        "X-Payment-Nonce": "Unique nonce for this request",
      },
    },
  });
});

/**
 * POST /x402/quote
 * 
 * Get a payment quote for a tool execution.
 * Returns 402 with payment requirements.
 * 
 * Body: { agentId: string, toolName: string, estimatedTokens: number }
 */
router.post("/quote", async (req: Request, res: Response) => {
  const { agentId, toolName, estimatedTokens } = req.body;

  if (!agentId || !toolName || !estimatedTokens) {
    return res.status(400).json({
      error: "Missing required fields: agentId, toolName, estimatedTokens",
    });
  }

  // Get agent's pricing rate
  let ratePer1kTokens = PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS;
  try {
    const result = await query(
      "SELECT rate_per_1k_tokens FROM agents WHERE id = $1",
      [agentId]
    );
    if (result.rows.length > 0) {
      ratePer1kTokens = result.rows[0].rate_per_1k_tokens;
    }
  } catch {
    // Use default rate if DB unavailable
  }

  const cost = calculateCost(estimatedTokens, ratePer1kTokens);
  const nonce = generatePaymentNonce();

  const requirement: PaymentRequirement = {
    amountLamports: cost,
    recipientWallet: x402Config.recipientWallet,
    network: x402Config.network,
    expiresAt: new Date(Date.now() + x402Config.priceQuoteValidityMs),
    nonce,
    description: `Tool execution: ${toolName} (~${estimatedTokens} tokens)`,
    resourceId: `agent:${agentId}:tool:${toolName}`,
  };

  return sendPaymentRequired(res, requirement);
});

/**
 * POST /x402/execute
 * 
 * Execute a tool call with x402 payment.
 * Requires X-Payment-* headers with valid payment proof.
 * 
 * Body: { callerId, calleeId, toolName, tokensUsed, payload? }
 */
router.post(
  "/execute",
  x402OptionalMiddleware(),
  async (req: X402Request, res: Response) => {
    const { callerId, calleeId, toolName, tokensUsed, payload } = req.body;

    if (!callerId || !calleeId || !toolName || !tokensUsed) {
      return res.status(400).json({
        error: "Missing required fields: callerId, calleeId, toolName, tokensUsed",
      });
    }

    // Get agent's pricing rate
    let ratePer1kTokens = PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS;
    try {
      const result = await query(
        "SELECT rate_per_1k_tokens FROM agents WHERE id = $1",
        [calleeId]
      );
      if (result.rows.length > 0) {
        ratePer1kTokens = result.rows[0].rate_per_1k_tokens;
      }
    } catch {
      // Use default rate
    }

    const requiredCost = calculateCost(tokensUsed, ratePer1kTokens);

    // Check for x402 payment proof
    const proof = parsePaymentProof(req);
    
    if (!proof) {
      // No payment - return 402
      const nonce = generatePaymentNonce();
      const requirement: PaymentRequirement = {
        amountLamports: requiredCost,
        recipientWallet: x402Config.recipientWallet,
        network: x402Config.network,
        expiresAt: new Date(Date.now() + x402Config.priceQuoteValidityMs),
        nonce,
        description: `Execute ${toolName}: ${tokensUsed} tokens @ ${ratePer1kTokens}/1k`,
        resourceId: `exec:${callerId}:${calleeId}:${toolName}`,
      };
      return sendPaymentRequired(res, requirement);
    }

    // Verify payment
    const verification = await verifyPaymentProof(x402Config, proof, requiredCost);
    
    if (!verification.valid) {
      return res.status(402).json({
        error: "Payment verification failed",
        code: "PAYMENT_INVALID",
        details: verification.error,
        required: requiredCost,
        provided: proof.amount,
      });
    }

    // Payment verified - record execution
    try {
      await query(
        `INSERT INTO tool_usage 
         (caller_agent_id, callee_agent_id, tool_name, tokens_used, rate_per_1k_tokens, cost_lamports)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [callerId, calleeId, toolName, tokensUsed, ratePer1kTokens, requiredCost]
      );

      // Credit the callee (agent who provided the tool)
      await query(
        `UPDATE agents 
         SET pending_lamports = pending_lamports + $1
         WHERE id = $2`,
        [requiredCost, calleeId]
      );
    } catch (dbErr) {
      console.error("DB error recording x402 execution:", dbErr);
    }

    res.json({
      success: true,
      execution: {
        callerId,
        calleeId,
        toolName,
        tokensUsed,
        cost: requiredCost,
        ratePer1kTokens,
      },
      payment: {
        verified: true,
        signature: proof.signature,
        payer: verification.payer,
        amount: verification.amount,
        protocol: "x402",
      },
    });
  }
);

/**
 * POST /x402/verify
 * 
 * Verify a payment signature without executing.
 * Useful for checking if a payment is valid before use.
 * 
 * Body: { signature, payer, amount, nonce, expectedAmount }
 */
router.post("/verify", async (req: Request, res: Response) => {
  const { signature, payer, amount, nonce, expectedAmount } = req.body;

  if (!signature || !payer || !amount || !nonce) {
    return res.status(400).json({
      error: "Missing required fields: signature, payer, amount, nonce",
    });
  }

  const verification = await verifyPaymentProof(
    x402Config,
    { signature, payer, amount, nonce },
    expectedAmount || amount
  );

  res.json({
    valid: verification.valid,
    error: verification.error,
    details: verification.valid
      ? {
          payer: verification.payer,
          amount: verification.amount,
          signature,
        }
      : undefined,
  });
});

/**
 * GET /x402/demo-resource
 * 
 * Demo endpoint that requires x402 payment to access.
 * Returns a protected resource after payment verification.
 */
router.get(
  "/demo-resource",
  x402Middleware(x402Config, (_req) => ({
    amount: 1000, // 1000 lamports (~$0.0001)
    description: "Access to demo protected resource",
  })),
  (req: X402Request, res: Response) => {
    res.json({
      message: "Access granted! You paid to see this resource.",
      payment: req.x402Payment,
      resource: {
        id: "demo-001",
        content: "This is the protected content that required payment.",
        timestamp: new Date().toISOString(),
      },
    });
  }
);

/**
 * GET /x402/pricing
 * 
 * Get current x402 pricing information.
 */
router.get("/pricing", (_req: Request, res: Response) => {
  res.json({
    protocol: "x402",
    pricing: {
      model: "token_based",
      formula: "ceil(tokens / 1000) × rate_per_1k_tokens",
      constants: {
        defaultRatePer1kTokens: PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS,
        minimumCostLamports: PRICING_CONSTANTS.MIN_COST_LAMPORTS,
        maxTokensPerCall: PRICING_CONSTANTS.MAX_TOKENS_PER_CALL,
        platformFeePercent: PRICING_CONSTANTS.PLATFORM_FEE_PERCENT * 100,
      },
      currency: {
        name: "lamports",
        symbol: "◎",
        decimals: 9,
        network: x402Config.network,
      },
    },
    examples: [
      { tokens: 500, rate: 1000, cost: 1000, note: "ceil(500/1000) = 1 block" },
      { tokens: 1500, rate: 1000, cost: 2000, note: "ceil(1500/1000) = 2 blocks" },
      { tokens: 100, rate: 1000, cost: 1000, note: "ceil(100/1000) = 1 block" },
    ],
  });
});

/**
 * POST /x402/simulate
 * 
 * Simulate an x402 payment flow without actual payment.
 * Useful for testing and integration development.
 * 
 * Body: { agentId, toolName, tokens }
 */
router.post("/simulate", async (req: Request, res: Response) => {
  const { agentId, toolName, tokens } = req.body;

  if (!tokens) {
    return res.status(400).json({ error: "Missing required field: tokens" });
  }

  const cost = calculateCost(tokens, PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS);
  const nonce = generatePaymentNonce();

  res.json({
    simulation: true,
    flow: [
      {
        step: 1,
        action: "Client requests resource",
        request: {
          method: "POST",
          path: "/x402/execute",
          headers: { "Content-Type": "application/json" },
          body: { callerId: "caller-agent", calleeId: agentId || "callee-agent", toolName: toolName || "example_tool", tokensUsed: tokens },
        },
      },
      {
        step: 2,
        action: "Server responds with 402 Payment Required",
        response: {
          status: 402,
          headers: {
            "X-Payment-Required": "true",
            "X-Payment-Amount": cost.toString(),
            "X-Payment-Recipient": x402Config.recipientWallet,
            "X-Payment-Network": x402Config.network,
            "X-Payment-Nonce": nonce,
          },
          body: {
            error: "Payment Required",
            payment: { amount: cost, currency: "lamports" },
          },
        },
      },
      {
        step: 3,
        action: "Client makes Solana payment",
        transaction: {
          from: "<client_wallet>",
          to: x402Config.recipientWallet,
          amount: cost,
          network: x402Config.network,
        },
      },
      {
        step: 4,
        action: "Client retries with payment proof",
        request: {
          method: "POST",
          path: "/x402/execute",
          headers: {
            "Content-Type": "application/json",
            "X-Payment-Signature": "<transaction_signature>",
            "X-Payment-Payer": "<client_wallet>",
            "X-Payment-Amount": cost.toString(),
            "X-Payment-Nonce": nonce,
          },
          body: { callerId: "caller-agent", calleeId: agentId || "callee-agent", toolName: toolName || "example_tool", tokensUsed: tokens },
        },
      },
      {
        step: 5,
        action: "Server verifies payment and serves response",
        response: {
          status: 200,
          body: {
            success: true,
            payment: { verified: true, protocol: "x402" },
          },
        },
      },
    ],
    pricing: {
      tokens,
      cost,
      formula: `ceil(${tokens} / 1000) × ${PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS} = ${cost}`,
    },
  });
});

export default router;
