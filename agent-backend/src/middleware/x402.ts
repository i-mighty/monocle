/**
 * x402 Protocol Middleware
 * 
 * Implements HTTP 402 Payment Required for machine-to-machine payments.
 * This enables AI agents to pay for API calls using the x402 standard.
 * 
 * Flow:
 * 1. Client requests protected resource
 * 2. Server responds with 402 + payment requirements in headers
 * 3. Client makes payment (Solana transfer)
 * 4. Client retries request with X-Payment-* headers containing proof
 * 5. Server verifies payment and serves content
 * 
 * Headers (Request - Payment Proof):
 *   X-Payment-Signature: Base58 Solana transaction signature
 *   X-Payment-Payer: Payer's Solana wallet address
 *   X-Payment-Amount: Amount paid in lamports
 *   X-Payment-Nonce: Unique request nonce to prevent replay
 * 
 * Headers (Response - Payment Required):
 *   X-Payment-Required: true
 *   X-Payment-Amount: Required amount in lamports
 *   X-Payment-Recipient: Recipient Solana wallet address
 *   X-Payment-Network: solana-mainnet | solana-devnet
 *   X-Payment-Token: SPL token mint (optional, native SOL if omitted)
 *   X-Payment-Expires: ISO timestamp when price quote expires
 *   X-Payment-Nonce: Server-generated nonce for this request
 */

import { Request, Response, NextFunction } from "express";
import { Connection, PublicKey } from "@solana/web3.js";
import crypto from "crypto";

// x402 Configuration
export interface X402Config {
  recipientWallet: string;
  network: "solana-mainnet" | "solana-devnet";
  priceQuoteValidityMs: number;
  connection: Connection;
}

// Payment requirement details
export interface PaymentRequirement {
  amountLamports: number;
  recipientWallet: string;
  network: string;
  expiresAt: Date;
  nonce: string;
  description?: string;
  resourceId?: string;
}

// Payment proof from client
export interface PaymentProof {
  signature: string;
  payer: string;
  amount: number;
  nonce: string;
}

// Verification result
export interface PaymentVerification {
  valid: boolean;
  error?: string;
  payer?: string;
  amount?: number;
}

// In-memory nonce store (use Redis in production)
const usedNonces = new Map<string, { timestamp: number; amount: number }>();
const NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// Clean expired nonces periodically
setInterval(() => {
  const now = Date.now();
  for (const [nonce, data] of usedNonces.entries()) {
    if (now - data.timestamp > NONCE_EXPIRY_MS) {
      usedNonces.delete(nonce);
    }
  }
}, 60_000);

/**
 * Generate a unique payment nonce
 */
export function generatePaymentNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Parse x402 payment proof headers from request
 */
export function parsePaymentProof(req: Request): PaymentProof | null {
  const signature = req.header("X-Payment-Signature");
  const payer = req.header("X-Payment-Payer");
  const amountStr = req.header("X-Payment-Amount");
  const nonce = req.header("X-Payment-Nonce");

  if (!signature || !payer || !amountStr || !nonce) {
    return null;
  }

  const amount = parseInt(amountStr, 10);
  if (isNaN(amount) || amount <= 0) {
    return null;
  }

  return { signature, payer, amount, nonce };
}

/**
 * Set x402 payment required response headers
 */
export function setPaymentRequiredHeaders(
  res: Response,
  requirement: PaymentRequirement
): void {
  res.setHeader("X-Payment-Required", "true");
  res.setHeader("X-Payment-Amount", requirement.amountLamports.toString());
  res.setHeader("X-Payment-Recipient", requirement.recipientWallet);
  res.setHeader("X-Payment-Network", requirement.network);
  res.setHeader("X-Payment-Expires", requirement.expiresAt.toISOString());
  res.setHeader("X-Payment-Nonce", requirement.nonce);
  if (requirement.description) {
    res.setHeader("X-Payment-Description", requirement.description);
  }
  if (requirement.resourceId) {
    res.setHeader("X-Payment-Resource-Id", requirement.resourceId);
  }
}

/**
 * Send 402 Payment Required response
 */
export function sendPaymentRequired(
  res: Response,
  requirement: PaymentRequirement
): void {
  setPaymentRequiredHeaders(res, requirement);
  res.status(402).json({
    error: "Payment Required",
    code: "PAYMENT_REQUIRED",
    payment: {
      amount: requirement.amountLamports,
      currency: "lamports",
      recipient: requirement.recipientWallet,
      network: requirement.network,
      expires: requirement.expiresAt.toISOString(),
      nonce: requirement.nonce,
      description: requirement.description,
    },
    instructions: {
      step1: "Make a Solana transfer of the specified amount to the recipient wallet",
      step2: "Retry this request with payment proof headers",
      headers: {
        "X-Payment-Signature": "The transaction signature (base58)",
        "X-Payment-Payer": "Your wallet address",
        "X-Payment-Amount": "Amount paid in lamports",
        "X-Payment-Nonce": requirement.nonce,
      },
    },
  });
}

/**
 * Verify payment proof against Solana blockchain
 */
export async function verifyPaymentProof(
  config: X402Config,
  proof: PaymentProof,
  expectedAmount: number
): Promise<PaymentVerification> {
  // Check nonce hasn't been used (replay protection)
  if (usedNonces.has(proof.nonce)) {
    return { valid: false, error: "Nonce already used (replay attack prevented)" };
  }

  // Validate amount
  if (proof.amount < expectedAmount) {
    return {
      valid: false,
      error: `Insufficient payment: expected ${expectedAmount}, got ${proof.amount}`,
    };
  }

  try {
    // Verify transaction on-chain
    const signature = proof.signature;
    const txInfo = await config.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      return { valid: false, error: "Transaction not found on-chain" };
    }

    if (txInfo.meta?.err) {
      return { valid: false, error: "Transaction failed on-chain" };
    }

    // Verify recipient received the payment
    const recipientPubkey = new PublicKey(config.recipientWallet);
    const accountKeys = txInfo.transaction.message.getAccountKeys();
    
    // Check pre/post balances for recipient
    const recipientIndex = accountKeys.staticAccountKeys.findIndex(
      (key) => key.equals(recipientPubkey)
    );

    if (recipientIndex === -1) {
      return { valid: false, error: "Recipient not found in transaction" };
    }

    const preBalance = txInfo.meta?.preBalances[recipientIndex] ?? 0;
    const postBalance = txInfo.meta?.postBalances[recipientIndex] ?? 0;
    const received = postBalance - preBalance;

    if (received < expectedAmount) {
      return {
        valid: false,
        error: `Recipient received ${received} lamports, expected ${expectedAmount}`,
      };
    }

    // Mark nonce as used
    usedNonces.set(proof.nonce, { timestamp: Date.now(), amount: proof.amount });

    return {
      valid: true,
      payer: proof.payer,
      amount: received,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Verification failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * x402 middleware factory
 * 
 * Creates middleware that enforces payment for protected routes.
 * Pricing is dynamic based on the pricing function.
 */
export function x402Middleware(
  config: X402Config,
  getPricing: (req: Request) => { amount: number; description?: string }
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const pricing = getPricing(req);
    
    // Check for payment proof
    const proof = parsePaymentProof(req);
    
    if (!proof) {
      // No payment - return 402 with requirements
      const nonce = generatePaymentNonce();
      const requirement: PaymentRequirement = {
        amountLamports: pricing.amount,
        recipientWallet: config.recipientWallet,
        network: config.network,
        expiresAt: new Date(Date.now() + config.priceQuoteValidityMs),
        nonce,
        description: pricing.description,
        resourceId: req.path,
      };
      return sendPaymentRequired(res, requirement);
    }

    // Verify payment
    const verification = await verifyPaymentProof(config, proof, pricing.amount);
    
    if (!verification.valid) {
      return res.status(402).json({
        error: "Payment verification failed",
        code: "PAYMENT_INVALID",
        details: verification.error,
      });
    }

    // Payment verified - attach to request and continue
    (req as any).x402Payment = {
      payer: verification.payer,
      amount: verification.amount,
      signature: proof.signature,
      nonce: proof.nonce,
    };

    next();
  };
}

/**
 * Optional payment middleware
 * 
 * Like x402Middleware but doesn't require payment - just parses it if present.
 * Useful for routes where payment is optional or handled differently.
 */
export function x402OptionalMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const proof = parsePaymentProof(req);
    if (proof) {
      (req as any).x402Payment = {
        payer: proof.payer,
        amount: proof.amount,
        signature: proof.signature,
        nonce: proof.nonce,
        verified: false, // Not verified, just parsed
      };
    }
    next();
  };
}

// Export types for use in routes
export type X402Request = Request & {
  x402Payment?: {
    payer: string;
    amount: number;
    signature: string;
    nonce: string;
    verified?: boolean;
  };
};
