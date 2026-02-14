/**
 * Rate Limiting Middleware
 *
 * Provides multi-tier rate limiting:
 * - Per API key limits (from key configuration)
 * - Per IP limits (fallback)
 * - Per endpoint limits (for sensitive operations)
 * - Sliding window algorithm with burst support
 */

import { Request, Response, NextFunction } from "express";
import { ApiKeyRecord } from "../services/securityService";

// =============================================================================
// CONFIGURATION
// =============================================================================

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  burstAllowance: number; // Extra burst capacity
  message?: string;
}

// Default limits by tier
export const RATE_LIMIT_TIERS: Record<string, RateLimitConfig> = {
  // For authenticated requests (per API key)
  standard: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60,
    burstAllowance: 10,
    message: "Rate limit exceeded. Please slow down.",
  },
  premium: {
    windowMs: 60 * 1000,
    maxRequests: 300,
    burstAllowance: 50,
    message: "Rate limit exceeded.",
  },
  // For unauthenticated requests (per IP)
  unauthenticated: {
    windowMs: 60 * 1000,
    maxRequests: 30,
    burstAllowance: 5,
    message: "Too many requests from this IP. Please authenticate or slow down.",
  },
  // For sensitive endpoints
  sensitive: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    burstAllowance: 2,
    message: "Rate limit exceeded for sensitive operation.",
  },
};

// Endpoint-specific overrides (path pattern -> tier)
const ENDPOINT_LIMITS: Record<string, string> = {
  "/v1/payments": "sensitive",
  "/v1/agents/fund": "sensitive",
  "/v1/x402/pay": "sensitive",
  "/v1/reputation/report": "sensitive",
  "/v1/messaging": "standard",
};

// =============================================================================
// IN-MEMORY STORE (Replace with Redis in production)
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
  burstUsed: number;
}

class RateLimitStore {
  private store: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }

  get(key: string): RateLimitEntry | undefined {
    const entry = this.store.get(key);
    if (entry && entry.resetAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, entry: RateLimitEntry): void {
    this.store.set(key, entry);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt < now) {
        this.store.delete(key);
      }
    }
  }

  // For testing
  clear(): void {
    this.store.clear();
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

// Singleton store instance
let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (!store) {
    store = new RateLimitStore();
  }
  return store;
}

// =============================================================================
// RATE LIMIT MIDDLEWARE
// =============================================================================

/**
 * Get client identifier for rate limiting
 */
function getClientIdentifier(req: Request): string {
  // Prefer API key ID if authenticated
  const keyRecord = (req as any).apiKeyRecord as ApiKeyRecord | undefined;
  if (keyRecord?.id) {
    return `key:${keyRecord.id}`;
  }

  // Fall back to IP address
  const ip =
    req.ip ||
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";

  return `ip:${ip}`;
}

/**
 * Get rate limit config for a request
 */
function getRateLimitConfig(req: Request): RateLimitConfig {
  const keyRecord = (req as any).apiKeyRecord as ApiKeyRecord | undefined;

  // Check endpoint-specific limits first
  const path = req.path;
  for (const [pattern, tier] of Object.entries(ENDPOINT_LIMITS)) {
    if (path.startsWith(pattern)) {
      return RATE_LIMIT_TIERS[tier];
    }
  }

  // If authenticated, use API key's rate limit
  if (keyRecord) {
    return {
      windowMs: 60 * 1000,
      maxRequests: keyRecord.rateLimit,
      burstAllowance: keyRecord.rateLimitBurst,
      message: "Rate limit exceeded.",
    };
  }

  // Unauthenticated
  return RATE_LIMIT_TIERS.unauthenticated;
}

/**
 * Main rate limiting middleware
 */
export function rateLimit(
  customConfig?: Partial<RateLimitConfig>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientId = getClientIdentifier(req);
    const config = { ...getRateLimitConfig(req), ...customConfig };
    const rateLimitStore = getStore();

    const now = Date.now();
    let entry = rateLimitStore.get(clientId);

    // Initialize or reset entry if window expired
    if (!entry || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + config.windowMs,
        burstUsed: 0,
      };
    }

    // Calculate remaining capacity
    const effectiveLimit = config.maxRequests + config.burstAllowance;
    const remaining = Math.max(0, effectiveLimit - entry.count);
    const resetSec = Math.ceil((entry.resetAt - now) / 1000);

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", config.maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, config.maxRequests - entry.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
    res.setHeader("X-RateLimit-Burst-Remaining", Math.max(0, config.burstAllowance - entry.burstUsed));

    // Check if rate limited
    if (entry.count >= effectiveLimit) {
      res.setHeader("Retry-After", resetSec);
      return res.status(429).json({
        error: "rate_limit_exceeded",
        message: config.message,
        retryAfter: resetSec,
        limit: config.maxRequests,
        remaining: 0,
        resetAt: new Date(entry.resetAt).toISOString(),
      });
    }

    // Increment counter
    entry.count++;
    if (entry.count > config.maxRequests) {
      entry.burstUsed++;
    }

    rateLimitStore.set(clientId, entry);
    next();
  };
}

/**
 * Stricter rate limit for sensitive operations
 */
export function sensitiveRateLimit(): (req: Request, res: Response, next: NextFunction) => void {
  return rateLimit(RATE_LIMIT_TIERS.sensitive);
}

/**
 * IP-based rate limit (ignores API key)
 */
export function ipRateLimit(
  config?: Partial<RateLimitConfig>
): (req: Request, res: Response, next: NextFunction) => void {
  const defaultConfig = { ...RATE_LIMIT_TIERS.unauthenticated, ...config };

  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      req.ip ||
      req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const clientId = `ip-only:${ip}`;
    const rateLimitStore = getStore();

    const now = Date.now();
    let entry = rateLimitStore.get(clientId);

    if (!entry || entry.resetAt < now) {
      entry = {
        count: 0,
        resetAt: now + defaultConfig.windowMs,
        burstUsed: 0,
      };
    }

    const effectiveLimit = defaultConfig.maxRequests + defaultConfig.burstAllowance;
    const resetSec = Math.ceil((entry.resetAt - now) / 1000);

    res.setHeader("X-RateLimit-Limit", defaultConfig.maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, defaultConfig.maxRequests - entry.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count >= effectiveLimit) {
      res.setHeader("Retry-After", resetSec);
      return res.status(429).json({
        error: "rate_limit_exceeded",
        message: defaultConfig.message,
        retryAfter: resetSec,
      });
    }

    entry.count++;
    if (entry.count > defaultConfig.maxRequests) {
      entry.burstUsed++;
    }

    rateLimitStore.set(clientId, entry);
    next();
  };
}

/**
 * Slow down responses instead of blocking (for DoS mitigation)
 */
export function slowDown(
  delayAfter: number = 30,
  delayMs: number = 500
): (req: Request, res: Response, next: NextFunction) => void {
  const rateLimitStore = getStore();

  return (req: Request, res: Response, next: NextFunction) => {
    const clientId = `slowdown:${getClientIdentifier(req)}`;
    const now = Date.now();

    let entry = rateLimitStore.get(clientId);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + 60 * 1000, burstUsed: 0 };
    }

    entry.count++;
    rateLimitStore.set(clientId, entry);

    if (entry.count > delayAfter) {
      const delay = (entry.count - delayAfter) * delayMs;
      const maxDelay = 10000; // Cap at 10 seconds
      const actualDelay = Math.min(delay, maxDelay);

      res.setHeader("X-SlowDown-Delay", actualDelay);
      setTimeout(() => next(), actualDelay);
    } else {
      next();
    }
  };
}

// =============================================================================
// EXPORTS FOR TESTING
// =============================================================================

export const __testing = {
  getStore,
  clearStore: () => getStore().clear(),
  destroyStore: () => {
    if (store) {
      store.destroy();
      store = null;
    }
  },
};
