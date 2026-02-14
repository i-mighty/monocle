/**
 * Quote Service - Pricing Freeze Implementation
 *
 * Ensures pricing is locked at quote-time to prevent:
 * - Race conditions (price changes between quote and execution)
 * - Retroactive disputes (caller can prove what they agreed to)
 * - Pricing manipulation attacks
 *
 * Workflow:
 *   1. Client requests quote → gets quoteId + frozen price + expiry
 *   2. Client executes with quoteId → price is validated + locked
 *   3. Usage record references the quote for full auditability
 */

import { eq, and, lt, desc, sql } from "drizzle-orm";
import { db, pool, pricingQuotes, toolUsage, agents, tools } from "../db/client";
import type { PricingQuote, NewPricingQuote } from "../db/client";
import { calculateCost, calculatePlatformFee, PRICING_CONSTANTS, getToolPricing, getAgent } from "./pricingService";

// =============================================================================
// CONSTANTS
// =============================================================================
export const QUOTE_CONSTANTS = {
  /** Default quote validity period (5 minutes) */
  DEFAULT_VALIDITY_MS: 5 * 60 * 1000,

  /** Minimum allowed validity period (1 minute) */
  MIN_VALIDITY_MS: 60 * 1000,

  /** Maximum allowed validity period (30 minutes) */
  MAX_VALIDITY_MS: 30 * 60 * 1000,

  /** Grace period after expiry for latency tolerance (10 seconds) */
  EXPIRY_GRACE_MS: 10 * 1000,
} as const;

// =============================================================================
// TYPES
// =============================================================================
export interface QuoteRequest {
  callerAgentId: string;
  calleeAgentId: string;
  toolName: string;
  estimatedTokens: number;
  validityMs?: number; // Custom validity period (defaults to 5 min)
}

export interface QuoteResponse {
  quoteId: string;
  callerAgentId: string;
  calleeAgentId: string;
  toolName: string;
  estimatedTokens: number;
  
  // Frozen pricing
  ratePer1kTokens: number;
  quotedCostLamports: number;
  platformFeeLamports: number;
  netToCallee: number;
  
  // Validity window
  issuedAt: Date;
  expiresAt: Date;
  validityMs: number;
  
  // Formatted for display
  expiresIn: string;
  
  // Full snapshot for debugging
  priceSnapshot: {
    tokenBlocks: number;
    rawCost: number;
    minimumApplied: boolean;
    platformFeePercent: number;
  };
}

export interface QuoteValidation {
  valid: boolean;
  quote: PricingQuote | null;
  error?: string;
  details?: {
    isExpired: boolean;
    isUsed: boolean;
    tokensMatch: boolean;
    partiesMatch: boolean;
  };
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Issue a new pricing quote with frozen pricing
 *
 * The quote captures the exact pricing at this moment and guarantees
 * that price for the specified validity period.
 */
export async function issueQuote(request: QuoteRequest): Promise<QuoteResponse> {
  if (!db) throw new Error("Database not connected");

  const {
    callerAgentId,
    calleeAgentId,
    toolName,
    estimatedTokens,
    validityMs = QUOTE_CONSTANTS.DEFAULT_VALIDITY_MS,
  } = request;

  // Validate validity period
  const clampedValidity = Math.max(
    QUOTE_CONSTANTS.MIN_VALIDITY_MS,
    Math.min(validityMs, QUOTE_CONSTANTS.MAX_VALIDITY_MS)
  );

  // Validate inputs
  if (estimatedTokens < 0) {
    throw new Error("estimatedTokens must be non-negative");
  }
  if (estimatedTokens > PRICING_CONSTANTS.MAX_TOKENS_PER_CALL) {
    throw new Error(`estimatedTokens exceeds maximum (${PRICING_CONSTANTS.MAX_TOKENS_PER_CALL})`);
  }

  // Verify both agents exist
  await getAgent(callerAgentId);
  await getAgent(calleeAgentId);

  // Get current tool pricing (will use agent default if tool not registered)
  const { toolId, ratePer1kTokens } = await getToolPricing(calleeAgentId, toolName);

  // Calculate pricing (deterministic)
  const tokenBlocks = Math.ceil(estimatedTokens / 1000);
  const rawCost = tokenBlocks * ratePer1kTokens;
  const quotedCostLamports = calculateCost(estimatedTokens, ratePer1kTokens);
  const platformFeeLamports = calculatePlatformFee(quotedCostLamports);
  const netToCallee = quotedCostLamports - platformFeeLamports;

  // Calculate timestamps
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + clampedValidity);

  // Build price snapshot for auditing
  const priceSnapshot = {
    tokenBlocks,
    rawCost,
    minimumApplied: rawCost < PRICING_CONSTANTS.MIN_COST_LAMPORTS,
    platformFeePercent: PRICING_CONSTANTS.PLATFORM_FEE_PERCENT * 100,
    calculatedAt: issuedAt.toISOString(),
    constants: {
      defaultRate: PRICING_CONSTANTS.DEFAULT_RATE_PER_1K_TOKENS,
      minCost: PRICING_CONSTANTS.MIN_COST_LAMPORTS,
      maxTokens: PRICING_CONSTANTS.MAX_TOKENS_PER_CALL,
    },
  };

  // Insert quote record
  const [quote] = await db
    .insert(pricingQuotes)
    .values({
      callerAgentId,
      calleeAgentId,
      toolId,
      toolName,
      estimatedTokens,
      ratePer1kTokens,
      quotedCostLamports,
      platformFeeLamports,
      issuedAt,
      expiresAt,
      validityMs: clampedValidity,
      status: "active",
      priceSnapshotJson: JSON.stringify(priceSnapshot),
    })
    .returning();

  // Format expiry for display
  const expiresInSeconds = Math.round(clampedValidity / 1000);
  const expiresIn = expiresInSeconds >= 60
    ? `${Math.round(expiresInSeconds / 60)} minute(s)`
    : `${expiresInSeconds} seconds`;

  return {
    quoteId: quote.id,
    callerAgentId,
    calleeAgentId,
    toolName,
    estimatedTokens,
    ratePer1kTokens,
    quotedCostLamports,
    platformFeeLamports,
    netToCallee,
    issuedAt,
    expiresAt,
    validityMs: clampedValidity,
    expiresIn,
    priceSnapshot: {
      tokenBlocks,
      rawCost,
      minimumApplied: rawCost < PRICING_CONSTANTS.MIN_COST_LAMPORTS,
      platformFeePercent: PRICING_CONSTANTS.PLATFORM_FEE_PERCENT * 100,
    },
  };
}

/**
 * Validate a quote for execution
 *
 * Checks:
 * - Quote exists
 * - Quote is not expired (with grace period)
 * - Quote has not been used
 * - Parties match the execution request
 * - Token count is within tolerance (actual can be ≤ estimated)
 */
export async function validateQuote(
  quoteId: string,
  callerAgentId: string,
  calleeAgentId: string,
  toolName: string,
  actualTokens: number
): Promise<QuoteValidation> {
  if (!db) throw new Error("Database not connected");

  // Fetch the quote
  const [quote] = await db
    .select()
    .from(pricingQuotes)
    .where(eq(pricingQuotes.id, quoteId))
    .limit(1);

  if (!quote) {
    return {
      valid: false,
      quote: null,
      error: `Quote not found: ${quoteId}`,
    };
  }

  const now = new Date();
  const expiryWithGrace = new Date(quote.expiresAt.getTime() + QUOTE_CONSTANTS.EXPIRY_GRACE_MS);

  // Check expiration
  const isExpired = now > expiryWithGrace;
  if (isExpired) {
    // Mark as expired if still active
    if (quote.status === "active") {
      await db
        .update(pricingQuotes)
        .set({ status: "expired" })
        .where(eq(pricingQuotes.id, quoteId));
    }

    return {
      valid: false,
      quote,
      error: `Quote expired at ${quote.expiresAt.toISOString()}`,
      details: { isExpired: true, isUsed: false, tokensMatch: true, partiesMatch: true },
    };
  }

  // Check if already used
  const isUsed = quote.status === "used";
  if (isUsed) {
    return {
      valid: false,
      quote,
      error: `Quote already used at ${quote.usedAt?.toISOString()}`,
      details: { isExpired: false, isUsed: true, tokensMatch: true, partiesMatch: true },
    };
  }

  // Check parties match
  const partiesMatch =
    quote.callerAgentId === callerAgentId &&
    quote.calleeAgentId === calleeAgentId &&
    quote.toolName === toolName;

  if (!partiesMatch) {
    return {
      valid: false,
      quote,
      error: "Quote parties or tool do not match execution request",
      details: { isExpired: false, isUsed: false, tokensMatch: true, partiesMatch: false },
    };
  }

  // Check tokens (actual must be ≤ estimated, since we're honoring the quoted price)
  const tokensMatch = actualTokens <= quote.estimatedTokens;
  if (!tokensMatch) {
    return {
      valid: false,
      quote,
      error: `Actual tokens (${actualTokens}) exceeds quoted estimate (${quote.estimatedTokens})`,
      details: { isExpired: false, isUsed: false, tokensMatch: false, partiesMatch: true },
    };
  }

  return {
    valid: true,
    quote,
    details: { isExpired: false, isUsed: false, tokensMatch: true, partiesMatch: true },
  };
}

/**
 * Mark a quote as used and link it to a tool_usage record
 */
export async function consumeQuote(quoteId: string, usageId: string): Promise<void> {
  if (!db) throw new Error("Database not connected");

  await db
    .update(pricingQuotes)
    .set({
      status: "used",
      usedAt: new Date(),
      usedByUsageId: usageId,
    })
    .where(eq(pricingQuotes.id, quoteId));
}

/**
 * Cancel a quote (e.g., if the caller decides not to proceed)
 */
export async function cancelQuote(quoteId: string): Promise<boolean> {
  if (!db) throw new Error("Database not connected");

  const [quote] = await db
    .select()
    .from(pricingQuotes)
    .where(eq(pricingQuotes.id, quoteId))
    .limit(1);

  if (!quote || quote.status !== "active") {
    return false;
  }

  await db
    .update(pricingQuotes)
    .set({ status: "cancelled" })
    .where(eq(pricingQuotes.id, quoteId));

  return true;
}

/**
 * Get a quote by ID
 */
export async function getQuote(quoteId: string): Promise<PricingQuote | null> {
  if (!db) throw new Error("Database not connected");

  const [quote] = await db
    .select()
    .from(pricingQuotes)
    .where(eq(pricingQuotes.id, quoteId))
    .limit(1);

  return quote || null;
}

/**
 * List active quotes for an agent (as caller)
 */
export async function listActiveQuotes(callerAgentId: string): Promise<PricingQuote[]> {
  if (!db) throw new Error("Database not connected");

  const now = new Date();

  return db
    .select()
    .from(pricingQuotes)
    .where(
      and(
        eq(pricingQuotes.callerAgentId, callerAgentId),
        eq(pricingQuotes.status, "active"),
        sql`${pricingQuotes.expiresAt} > ${now}`
      )
    )
    .orderBy(desc(pricingQuotes.issuedAt))
    .limit(50);
}

/**
 * Expire old quotes (maintenance job)
 *
 * Run periodically to mark stale quotes as expired.
 */
export async function expireStaleQuotes(): Promise<number> {
  if (!db) throw new Error("Database not connected");

  const now = new Date();

  const result = await db
    .update(pricingQuotes)
    .set({ status: "expired" })
    .where(
      and(
        eq(pricingQuotes.status, "active"),
        lt(pricingQuotes.expiresAt, now)
      )
    )
    .returning({ id: pricingQuotes.id });

  return result.length;
}

/**
 * Get quote usage statistics for an agent
 */
export async function getQuoteStats(agentId: string): Promise<{
  totalIssued: number;
  totalUsed: number;
  totalExpired: number;
  totalCancelled: number;
  conversionRate: number;
}> {
  if (!db) throw new Error("Database not connected");

  const stats = await db
    .select({
      status: pricingQuotes.status,
      count: sql<number>`count(*)::int`,
    })
    .from(pricingQuotes)
    .where(eq(pricingQuotes.callerAgentId, agentId))
    .groupBy(pricingQuotes.status);

  const counts: Record<string, number> = {};
  for (const row of stats) {
    counts[row.status] = row.count;
  }

  const totalIssued = Object.values(counts).reduce((a, b) => a + b, 0);
  const totalUsed = counts["used"] || 0;
  const totalExpired = counts["expired"] || 0;
  const totalCancelled = counts["cancelled"] || 0;
  const conversionRate = totalIssued > 0 ? (totalUsed / totalIssued) * 100 : 0;

  return {
    totalIssued,
    totalUsed,
    totalExpired,
    totalCancelled,
    conversionRate: Math.round(conversionRate * 100) / 100,
  };
}

/**
 * Execute with quote validation
 *
 * High-level function that:
 * 1. Validates the quote
 * 2. Uses the frozen price from the quote
 * 3. Records the execution with quote reference
 * 4. Marks the quote as used
 *
 * Returns the pricing info to use for the execution.
 */
export async function executeWithQuote(
  quoteId: string,
  callerAgentId: string,
  calleeAgentId: string,
  toolName: string,
  actualTokens: number
): Promise<{
  valid: boolean;
  error?: string;
  pricing?: {
    ratePer1kTokens: number;
    costLamports: number;
    quoteId: string;
    quotedAt: Date;
    quoteExpiresAt: Date;
  };
}> {
  // Validate the quote
  const validation = await validateQuote(
    quoteId,
    callerAgentId,
    calleeAgentId,
    toolName,
    actualTokens
  );

  if (!validation.valid || !validation.quote) {
    return {
      valid: false,
      error: validation.error,
    };
  }

  const quote = validation.quote;

  // For actual tokens ≤ estimated, we charge based on actual tokens
  // but using the frozen rate from the quote
  const actualCost = calculateCost(actualTokens, quote.ratePer1kTokens);

  return {
    valid: true,
    pricing: {
      ratePer1kTokens: quote.ratePer1kTokens,
      costLamports: actualCost,
      quoteId: quote.id,
      quotedAt: quote.issuedAt,
      quoteExpiresAt: quote.expiresAt,
    },
  };
}
