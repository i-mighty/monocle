/**
 * Delegation Guardian - Agent Delegation Safety
 *
 * Implements guardrails for agent-to-agent delegation:
 * 1. Cycle Detection - Prevents A → B → A delegation loops
 * 2. Budget Limits - Prevents runaway spending
 * 3. Depth Limits - Prevents excessive delegation chains
 * 4. Rate Limits - Prevents abuse
 */

// =============================================================================
// CONSTANTS
// =============================================================================

export const DELEGATION_LIMITS = {
  /** Maximum delegation chain depth */
  MAX_DEPTH: 5,
  
  /** Maximum total cost for a delegation chain (lamports) */
  MAX_CHAIN_COST_LAMPORTS: 10_000_000, // 0.01 SOL
  
  /** Maximum delegations per user per minute */
  MAX_DELEGATIONS_PER_MINUTE: 20,
  
  /** Delegation timeout (ms) */
  DELEGATION_TIMEOUT_MS: 60_000, // 1 minute per step
} as const;

// =============================================================================
// TYPES
// =============================================================================

export interface DelegationContext {
  chainId: string;           // Unique ID for this delegation chain
  originUserId: string;      // Original user who started the chain
  currentAgentId: string;    // Agent currently executing
  visitedAgents: string[];   // Agents already visited (for cycle detection)
  depth: number;             // Current chain depth
  totalCostLamports: number; // Accumulated cost
  budgetLamports: number;    // Remaining budget
  startTime: Date;
  timeoutMs: number;
}

export interface DelegationRequest {
  fromAgentId: string;
  toAgentId: string;
  taskDescription: string;
  estimatedCostLamports: number;
  context: DelegationContext;
}

export interface DelegationValidation {
  allowed: boolean;
  reason?: string;
  warnings?: string[];
  updatedContext?: DelegationContext;
}

// =============================================================================
// IN-MEMORY TRACKING (for rate limiting)
// =============================================================================

interface RateLimitEntry {
  count: number;
  windowStart: Date;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart.getTime() > 60_000) {
      rateLimitMap.delete(key);
    }
  }
}, 60_000);

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Create a new delegation context for a fresh chain
 */
export function createDelegationContext(
  userId: string,
  initialAgentId: string,
  budgetLamports: number = DELEGATION_LIMITS.MAX_CHAIN_COST_LAMPORTS
): DelegationContext {
  return {
    chainId: `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    originUserId: userId,
    currentAgentId: initialAgentId,
    visitedAgents: [initialAgentId],
    depth: 0,
    totalCostLamports: 0,
    budgetLamports,
    startTime: new Date(),
    timeoutMs: DELEGATION_LIMITS.DELEGATION_TIMEOUT_MS * DELEGATION_LIMITS.MAX_DEPTH
  };
}

/**
 * Validate a delegation request against all guardrails
 */
export function validateDelegation(request: DelegationRequest): DelegationValidation {
  const { fromAgentId, toAgentId, estimatedCostLamports, context } = request;
  const warnings: string[] = [];

  // 1. Cycle Detection - Check if we've already visited this agent
  if (context.visitedAgents.includes(toAgentId)) {
    return {
      allowed: false,
      reason: `Delegation cycle detected: ${context.visitedAgents.join(" → ")} → ${toAgentId}`
    };
  }

  // 2. Depth Limit - Check chain depth
  if (context.depth >= DELEGATION_LIMITS.MAX_DEPTH) {
    return {
      allowed: false,
      reason: `Maximum delegation depth exceeded (${DELEGATION_LIMITS.MAX_DEPTH})`
    };
  }

  // 3. Budget Limit - Check if estimated cost exceeds remaining budget
  const newTotalCost = context.totalCostLamports + estimatedCostLamports;
  if (newTotalCost > context.budgetLamports) {
    return {
      allowed: false,
      reason: `Budget exceeded. Estimated: ${estimatedCostLamports}, Remaining: ${context.budgetLamports - context.totalCostLamports}`
    };
  }

  // 4. Timeout Check
  const elapsed = Date.now() - context.startTime.getTime();
  if (elapsed > context.timeoutMs) {
    return {
      allowed: false,
      reason: `Delegation chain timeout exceeded (${Math.round(elapsed / 1000)}s)`
    };
  }

  // 5. Rate Limit - Check user's delegation rate
  const rateLimitKey = `rate:${context.originUserId}`;
  const now = new Date();
  let rateEntry = rateLimitMap.get(rateLimitKey);
  
  if (!rateEntry || now.getTime() - rateEntry.windowStart.getTime() > 60_000) {
    rateEntry = { count: 0, windowStart: now };
  }
  
  rateEntry.count++;
  rateLimitMap.set(rateLimitKey, rateEntry);
  
  if (rateEntry.count > DELEGATION_LIMITS.MAX_DELEGATIONS_PER_MINUTE) {
    return {
      allowed: false,
      reason: `Rate limit exceeded. Max ${DELEGATION_LIMITS.MAX_DELEGATIONS_PER_MINUTE} delegations per minute.`
    };
  }

  // Add warnings for approaching limits
  if (context.depth >= DELEGATION_LIMITS.MAX_DEPTH - 1) {
    warnings.push(`Warning: Approaching maximum delegation depth (${context.depth + 1}/${DELEGATION_LIMITS.MAX_DEPTH})`);
  }
  
  const budgetUsage = (newTotalCost / context.budgetLamports) * 100;
  if (budgetUsage > 80) {
    warnings.push(`Warning: ${Math.round(budgetUsage)}% of budget used`);
  }

  // Create updated context for the delegation
  const updatedContext: DelegationContext = {
    ...context,
    currentAgentId: toAgentId,
    visitedAgents: [...context.visitedAgents, toAgentId],
    depth: context.depth + 1,
    totalCostLamports: newTotalCost
  };

  return {
    allowed: true,
    warnings: warnings.length > 0 ? warnings : undefined,
    updatedContext
  };
}

/**
 * Record completed delegation (for analytics/debugging)
 */
export function recordDelegationComplete(
  context: DelegationContext,
  success: boolean,
  actualCostLamports: number
): void {
  const elapsed = Date.now() - context.startTime.getTime();
  
  console.log(`[Delegation] Chain ${context.chainId} completed:`, {
    success,
    depth: context.depth,
    agents: context.visitedAgents.join(" → "),
    estimatedCost: context.totalCostLamports,
    actualCost: actualCostLamports,
    durationMs: elapsed
  });
}

/**
 * Get human-readable delegation chain summary
 */
export function getDelegationSummary(context: DelegationContext): string {
  const elapsed = Math.round((Date.now() - context.startTime.getTime()) / 1000);
  const budgetRemaining = context.budgetLamports - context.totalCostLamports;
  
  return [
    `Chain: ${context.chainId}`,
    `Path: ${context.visitedAgents.join(" → ")}`,
    `Depth: ${context.depth}/${DELEGATION_LIMITS.MAX_DEPTH}`,
    `Cost: ${context.totalCostLamports}/${context.budgetLamports} lamports`,
    `Time: ${elapsed}s`
  ].join(" | ");
}

/**
 * Wrap an execution function with delegation guardrails
 */
export async function executeWithGuardrails<T>(
  context: DelegationContext,
  agentId: string,
  estimatedCost: number,
  executor: (ctx: DelegationContext) => Promise<T>
): Promise<{ result: T; context: DelegationContext } | { error: string }> {
  
  // Validate before execution
  const validation = validateDelegation({
    fromAgentId: context.currentAgentId,
    toAgentId: agentId,
    taskDescription: "task execution",
    estimatedCostLamports: estimatedCost,
    context
  });

  if (!validation.allowed) {
    return { error: validation.reason || "Delegation not allowed" };
  }

  // Log warnings if any
  if (validation.warnings) {
    validation.warnings.forEach(w => console.warn(`[Delegation] ${w}`));
  }

  try {
    // Execute with updated context
    const result = await executor(validation.updatedContext!);
    return { result, context: validation.updatedContext! };
  } catch (error: any) {
    return { error: `Execution failed: ${error.message}` };
  }
}
