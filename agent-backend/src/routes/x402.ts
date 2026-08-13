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
  setPaymentRequiredHeaders,
  verifyPaymentProof,
  parsePaymentProof,
  PaymentRequirement,
  X402Request,
} from "../middleware/x402";
import { calculateCost, PRICING_CONSTANTS } from "../services/pricingService";
import { query } from "../db/client";
import { demoOnly } from "../middleware/demoOnly";

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
 * Returns 402 with payment requirements AND issues a pricing quote.
 * The quote locks in pricing for the validity period.
 * 
 * Body: { agentId: string, toolName: string, estimatedTokens: number, callerAgentId?: string }
 */
router.post("/quote", async (req: Request, res: Response) => {
  const { agentId, toolName, estimatedTokens, callerAgentId } = req.body;

  if (!agentId || !toolName || !estimatedTokens) {
    return res.status(400).json({
      error: "Missing required fields: agentId, toolName, estimatedTokens",
    });
  }

  // The agent's rate AND its payout wallet. Both must come from the database:
  // this quote decides where money lands, so a failure here cannot fall back to a
  // default the way an unknown price could.
  //
  // The previous version swallowed database errors and continued with a default
  // rate. That was survivable when every payment went to the platform wallet
  // regardless. It is not survivable now — continuing without knowing the payee
  // would quote a payment to nobody.
  let ratePer1kTokens = PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS;
  let recipientWallet: string;
  try {
    const result = await query(
      "SELECT default_rate_per_1k_tokens, public_key FROM agents WHERE id = $1",
      [agentId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Agent not found",
        code: "AGENT_NOT_FOUND",
        details: { agentId },
      });
    }
    ratePer1kTokens = result.rows[0].default_rate_per_1k_tokens || ratePer1kTokens;
    recipientWallet = result.rows[0].public_key;
  } catch (err) {
    console.error("[x402] quote lookup failed:", (err as Error)?.message ?? err);
    return res.status(503).json({
      error: "Cannot price this call right now",
      code: "QUOTE_UNAVAILABLE",
    });
  }

  // No wallet, no quote. Quoting a payment to an agent that cannot receive it
  // would take the payer's money and strand it — previously invisible, because
  // the platform wallet was always the recipient no matter who served the call.
  if (!recipientWallet) {
    return res.status(409).json({
      error: "This agent cannot accept payments yet — it has no payout wallet configured.",
      code: "AGENT_NO_PAYOUT_WALLET",
      details: { agentId },
    });
  }

  const cost = calculateCost(estimatedTokens, ratePer1kTokens);
  const nonce = generatePaymentNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + x402Config.priceQuoteValidityMs);

  // If caller is provided, create a database quote for auditability
  let quoteId: string | undefined;
  if (callerAgentId) {
    try {
      const { issueQuote } = await import("../services/quoteService");
      const quote = await issueQuote({
        callerAgentId,
        calleeAgentId: agentId,
        toolName,
        estimatedTokens,
        validityMs: x402Config.priceQuoteValidityMs,
      });
      quoteId = quote.quoteId;
    } catch (err) {
      console.warn("Failed to create quote record:", (err as Error).message);
    }
  }

  // Record what was quoted, keyed by the nonce the payer will present. This is
  // what lets verification check the payment against the agent that served the
  // call rather than against a wallet chosen at verify time by the payer.
  try {
    await query(
      `insert into x402_quotes
         (nonce, callee_agent_id, recipient_wallet, amount_lamports, tool_name, caller_agent_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [nonce, agentId, recipientWallet, cost, toolName, callerAgentId ?? null, expiresAt]
    );
  } catch (err) {
    // Without the record, verification has nothing to check the payment against
    // and would have to trust the payer. Refuse to quote instead.
    console.error("[x402] failed to record quote binding:", (err as Error)?.message ?? err);
    return res.status(503).json({
      error: "Cannot issue a payment quote right now",
      code: "QUOTE_UNAVAILABLE",
    });
  }

  const requirement: PaymentRequirement = {
    amountLamports: cost,
    // The agent being paid, not the platform.
    recipientWallet,
    network: x402Config.network,
    expiresAt,
    nonce,
    description: `Tool execution: ${toolName} (~${estimatedTokens} tokens)`,
    resourceId: `agent:${agentId}:tool:${toolName}`,
  };

  // Return quote information with frozen pricing
  // This includes both x402 payment requirements AND the pricing quote
  setPaymentRequiredHeaders(res, requirement);
  return res.status(402).json({
    error: "Payment Required",
    code: "PAYMENT_REQUIRED",
    // Pricing quote with timestamp
    quote: {
      quoteId: quoteId || null,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      validityMs: x402Config.priceQuoteValidityMs,
      // Frozen pricing
      estimatedTokens,
      ratePer1kTokens,
      quotedCostLamports: cost,
    },
    payment: {
      amount: cost,
      currency: "lamports",
      // The agent's payout wallet. This is the field payers actually transfer
      // to — the headers and `requirement` above agreeing was not enough.
      recipient: requirement.recipientWallet,
      network: x402Config.network,
      expires: expiresAt.toISOString(),
      nonce,
      description: requirement.description,
    },
    instructions: {
      step1: "Make a Solana transfer of the specified amount to the recipient wallet",
      step2: "Retry /x402/execute with payment proof headers",
      step3: quoteId ? `Include quoteId '${quoteId}' in the execute request body` : "Request a new quote with callerAgentId to get a quoteId",
      headers: {
        "X-Payment-Signature": "The transaction signature (base58)",
        "X-Payment-Payer": "Your wallet address",
        "X-Payment-Amount": "Amount paid in lamports",
        "X-Payment-Nonce": nonce,
      },
    },
  });
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

    // The callee's rate and payout wallet.
    //
    // This queried `rate_per_1k_tokens`, which is not a column on agents — the
    // column is `default_rate_per_1k_tokens`. Postgres raised, the bare catch
    // swallowed it, and every call here was billed at the default rate no matter
    // what the agent charged. A silent fallback around a query that could never
    // succeed hid the bug completely.
    let ratePer1kTokens = PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS;
    let calleeWallet: string | null = null;
    try {
      const result = await query(
        "SELECT default_rate_per_1k_tokens, public_key FROM agents WHERE id = $1",
        [calleeId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Callee agent not found", details: { calleeId } });
      }
      ratePer1kTokens = result.rows[0].default_rate_per_1k_tokens || ratePer1kTokens;
      calleeWallet = result.rows[0].public_key;
    } catch (err) {
      // Pricing and payee both come from here, so a failure cannot fall through
      // to a default — that would quote a price nobody set, payable to nobody.
      console.error("[x402] execute lookup failed:", (err as Error)?.message ?? err);
      return res.status(503).json({ error: "Cannot price this call right now" });
    }

    if (!calleeWallet) {
      return res.status(409).json({
        error: "This agent cannot accept payments yet — it has no payout wallet configured.",
        code: "AGENT_NO_PAYOUT_WALLET",
        details: { calleeId },
      });
    }

    const requiredCost = calculateCost(tokensUsed, ratePer1kTokens);

    // Check for x402 payment proof
    const proof = parsePaymentProof(req);
    
    if (!proof) {
      // No payment - return 402
      const nonce = generatePaymentNonce();
      const requirement: PaymentRequirement = {
        amountLamports: requiredCost,
        // The callee, not the platform.
        recipientWallet: calleeWallet,
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
 * Body: { signature, payer, amount, nonce }
 *
 * expectedAmount is no longer accepted: the price is whatever the quote fixed,
 * not what the payer says it should be.
 */
router.post("/verify", async (req: Request, res: Response) => {
  const { signature, payer, amount, nonce } = req.body;

  if (!signature || !payer || !amount || !nonce) {
    return res.status(400).json({
      error: "Missing required fields: signature, payer, amount, nonce",
    });
  }

  // Resolve who this nonce was quoted to pay. The payer does not get to nominate
  // the recipient here: if they could, they could pay a wallet they control and
  // present it as payment for somebody else's service.
  let quoted: { recipient_wallet: string; amount_lamports: string; expires_at: Date } | null = null;
  try {
    const q = await query(
      `select recipient_wallet, amount_lamports, expires_at from x402_quotes where nonce = $1`,
      [nonce]
    );
    quoted = q.rows[0] ?? null;
  } catch (err) {
    console.error("[x402] quote lookup failed during verify:", (err as Error)?.message ?? err);
    return res.status(503).json({ valid: false, error: "Cannot verify payments right now" });
  }

  if (!quoted) {
    return res.status(400).json({
      valid: false,
      error: "Unknown payment nonce — request a quote first",
    });
  }

  if (new Date(quoted.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ valid: false, error: "Quote expired — request a new one" });
  }

  const verification = await verifyPaymentProof(
    // Verify against the wallet that was quoted, not the platform's.
    { ...x402Config, recipientWallet: quoted.recipient_wallet },
    { signature, payer, amount, nonce },
    // The quoted amount is authoritative. Honouring a caller-supplied
    // expectedAmount would let the payer declare their own price.
    Number(quoted.amount_lamports)
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
 * DEMO ENDPOINT: Disabled in production unless ALLOW_DEMO_ENDPOINTS=true
 */
router.get(
  "/demo-resource",
  demoOnly,
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
 * DEMO ENDPOINT: Disabled in production unless ALLOW_DEMO_ENDPOINTS=true
 * 
 * Body: { agentId, toolName, tokens }
 */
router.post("/simulate", demoOnly, async (req: Request, res: Response) => {
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
