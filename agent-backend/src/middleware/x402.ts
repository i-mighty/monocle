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
import { query } from "../db/client";

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

/**
 * Replay protection lives in Postgres, in x402_payments.
 *
 * It used to be a Map in this module, with a 5-minute expiry sweep. Two problems,
 * both of which cost money rather than requests:
 *
 *   1. It died with the process. Restarting the backend — a deploy, a crash —
 *      made every recently spent proof replayable, so one payment could buy
 *      service repeatedly.
 *   2. It keyed on the caller-chosen nonce alone. The unforgeable identifier of a
 *      payment is its transaction signature; the same signature submitted under a
 *      fresh nonce was a different key and passed.
 *
 * x402_payments already existed with `tx_signature text unique not null` and
 * `nonce text unique not null` — the right constraints, simply never used. The
 * insert below is the claim: whoever inserts first owns the payment, and the
 * database rejects the second attempt. That is atomic, so two concurrent
 * submissions of one proof cannot both succeed, which a check-then-set never
 * guaranteed however short the window.
 */

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
  // Cheap early rejection for an obviously-spent proof. This is a courtesy, not
  // the guard — the atomic claim below is what actually prevents a replay, and it
  // has to be, because anything read here can be spent by another request before
  // the on-chain check finishes.
  try {
    const seen = await query(
      `select 1 from x402_payments where tx_signature = $1 or nonce = $2 limit 1`,
      [proof.signature, proof.nonce]
    );
    if (seen.rows.length > 0) {
      return { valid: false, error: "Payment already used (replay prevented)" };
    }
  } catch (err) {
    // A failed lookup must not wave the payment through: the claim below still
    // has to succeed, so a database outage rejects rather than double-spends.
    console.error("[x402] replay pre-check failed:", (err as Error)?.message ?? err);
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

    // Claim the payment. This INSERT is the replay guard: tx_signature and nonce
    // are both unique, so a second submission of either loses the race and gets
    // zero rows back. Deliberately after the on-chain check — claiming first
    // would burn a legitimate payer's proof whenever an RPC lookup failed.
    const claim = await query(
      `insert into x402_payments
         (tx_signature, nonce, payer_wallet, recipient_wallet, amount_lamports, network, verified_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict do nothing
       returning id`,
      [
        proof.signature,
        proof.nonce,
        proof.payer,
        config.recipientWallet,
        received,
        config.network,
      ]
    );

    if (claim.rows.length === 0) {
      // Someone else claimed this signature or nonce between our pre-check and
      // here. That is precisely the race the in-memory store could not see.
      return { valid: false, error: "Payment already used (replay prevented)" };
    }

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
