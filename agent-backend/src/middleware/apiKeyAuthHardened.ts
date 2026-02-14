/**
 * Hardened API Key Authentication Middleware
 *
 * Features:
 * - Timing-safe key comparison
 * - Scope-based authorization
 * - Key rotation grace period support
 * - Usage tracking
 * - Legacy key backward compatibility
 */

import { Request, Response, NextFunction } from "express";
import {
  validateApiKey,
  ApiKeyRecord,
  ApiKeyScope,
  hasScope,
  timingSafeCompare,
} from "../services/securityService";
import { logActivityAsync } from "../services/activityService";
import { AppError, ErrorCodes } from "../errors";

// Extend Request type to include API key info
declare global {
  namespace Express {
    interface Request {
      apiKeyRecord?: ApiKeyRecord;
      developerId?: string;
    }
  }
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// Endpoints that don't require authentication
const PUBLIC_ENDPOINTS: string[] = [
  "/",
  "/openapi.yaml",
  "/demo-status",
  "/health",
  "/v1/agents", // GET /agents is public (discovery)
];

// Endpoints that only need read scope
const READ_ONLY_METHODS = ["GET", "HEAD", "OPTIONS"];

// =============================================================================
// MIDDLEWARE FUNCTIONS
// =============================================================================

/**
 * Main API key authentication middleware
 * Validates the API key and attaches the record to the request
 */
export async function apiKeyAuthHardened(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip auth for public endpoints
  if (isPublicEndpoint(req)) {
    return next();
  }

  const providedKey = req.header("x-api-key") || req.header("authorization")?.replace("Bearer ", "");

  if (!providedKey) {
    const error = new AppError(ErrorCodes.AUTH_INVALID_API_KEY, {
      message: "API key required. Provide x-api-key header.",
    });
    res.status(error.httpStatus).json(error.toResponse((req as any).requestId));
    return;
  }

  try {
    const result = await validateApiKey(providedKey);

    if (!result.valid || !result.keyRecord) {
      // Log failed authentication attempt
      logActivityAsync({
        eventType: "api_key_used",
        severity: "warning",
        actorType: "api",
        action: "auth.failed",
        description: `Failed authentication attempt: ${result.error}`,
        ipAddress: getClientIp(req),
        userAgent: req.header("user-agent"),
        requestId: (req as any).requestId,
        metadata: {
          reason: result.error,
          endpoint: req.path,
          method: req.method,
        },
      });

      const error = new AppError(ErrorCodes.AUTH_INVALID_API_KEY, {
        message: result.error || "Invalid API key",
      });
      res.status(error.httpStatus).json(error.toResponse((req as any).requestId));
      return;
    }

    // Attach key record to request
    req.apiKeyRecord = result.keyRecord;
    req.developerId = result.keyRecord.developerId;

    // Add warning header if using rotated key
    if (result.usedRotatedKey) {
      res.setHeader(
        "X-API-Key-Warning",
        "You are using a rotated API key that will expire soon. Please update to the new key."
      );
    }

    // Log successful authentication (async, don't wait)
    logActivityAsync({
      eventType: "api_key_used",
      severity: "info",
      actorId: result.keyRecord.developerId,
      actorType: "api",
      action: "auth.success",
      description: `API key authenticated: ${result.keyRecord.name}`,
      ipAddress: getClientIp(req),
      userAgent: req.header("user-agent"),
      requestId: (req as any).requestId,
      metadata: {
        keyId: result.keyRecord.id,
        keyName: result.keyRecord.name,
        keyPrefix: result.keyRecord.keyPrefix,
        usedRotatedKey: result.usedRotatedKey,
        endpoint: req.path,
        method: req.method,
      },
    });

    next();
  } catch (error: any) {
    console.error("[ApiKeyAuth] Validation error:", error.message);
    const appError = new AppError(ErrorCodes.AUTH_INVALID_API_KEY, {
      message: "Authentication failed",
    });
    res.status(appError.httpStatus).json(appError.toResponse((req as any).requestId));
  }
}

/**
 * Scope authorization middleware factory
 * Checks if the authenticated key has the required scope
 */
export function requireScope(
  scope: ApiKeyScope
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const keyRecord = req.apiKeyRecord;

    if (!keyRecord) {
      const error = new AppError(ErrorCodes.AUTH_INVALID_API_KEY, {
        message: "Authentication required",
      });
      return res.status(error.httpStatus).json(error.toResponse((req as any).requestId));
    }

    if (!hasScope(keyRecord, scope)) {
      logActivityAsync({
        eventType: "api_key_used",
        severity: "warning",
        actorId: keyRecord.developerId,
        actorType: "api",
        action: "auth.scope_denied",
        description: `Scope denied: ${scope} for key ${keyRecord.name}`,
        ipAddress: getClientIp(req),
        requestId: (req as any).requestId,
        metadata: {
          requiredScope: scope,
          keyScopes: keyRecord.scopes,
          endpoint: req.path,
          method: req.method,
        },
      });

      return res.status(403).json({
        error: "insufficient_scope",
        message: `This operation requires the '${scope}' scope`,
        requiredScope: scope,
        yourScopes: keyRecord.scopes,
      });
    }

    next();
  };
}

/**
 * Require any of the specified scopes
 */
export function requireAnyScope(
  scopes: ApiKeyScope[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const keyRecord = req.apiKeyRecord;

    if (!keyRecord) {
      const error = new AppError(ErrorCodes.AUTH_INVALID_API_KEY, {
        message: "Authentication required",
      });
      return res.status(error.httpStatus).json(error.toResponse((req as any).requestId));
    }

    const hasAnyScope = scopes.some((scope) => hasScope(keyRecord, scope));

    if (!hasAnyScope) {
      return res.status(403).json({
        error: "insufficient_scope",
        message: `This operation requires one of: ${scopes.join(", ")}`,
        requiredScopes: scopes,
        yourScopes: keyRecord.scopes,
      });
    }

    next();
  };
}

/**
 * Require all specified scopes
 */
export function requireAllScopes(
  scopes: ApiKeyScope[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const keyRecord = req.apiKeyRecord;

    if (!keyRecord) {
      const error = new AppError(ErrorCodes.AUTH_INVALID_API_KEY, {
        message: "Authentication required",
      });
      return res.status(error.httpStatus).json(error.toResponse((req as any).requestId));
    }

    const missingScopes = scopes.filter((scope) => !hasScope(keyRecord, scope));

    if (missingScopes.length > 0) {
      return res.status(403).json({
        error: "insufficient_scope",
        message: `Missing required scopes: ${missingScopes.join(", ")}`,
        requiredScopes: scopes,
        missingScopes,
        yourScopes: keyRecord.scopes,
      });
    }

    next();
  };
}

/**
 * Auto-determine required scope based on HTTP method and path
 */
export function autoScope(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const keyRecord = req.apiKeyRecord;

    if (!keyRecord) {
      return next(); // Let apiKeyAuthHardened handle this
    }

    // Determine scope based on method and path
    const scope = inferRequiredScope(req);

    if (scope && !hasScope(keyRecord, scope)) {
      return res.status(403).json({
        error: "insufficient_scope",
        message: `This operation requires the '${scope}' scope`,
        requiredScope: scope,
        yourScopes: keyRecord.scopes,
      });
    }

    next();
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if endpoint is public (no auth required)
 */
function isPublicEndpoint(req: Request): boolean {
  // Exact matches
  if (PUBLIC_ENDPOINTS.includes(req.path)) {
    return true;
  }

  // GET /v1/agents is public for discovery
  if (req.path === "/v1/agents" && req.method === "GET") {
    return true;
  }

  // OPTIONS requests for CORS
  if (req.method === "OPTIONS") {
    return true;
  }

  return false;
}

/**
 * Infer required scope from request method and path
 */
function inferRequiredScope(req: Request): ApiKeyScope | null {
  const path = req.path;
  const method = req.method;

  // Admin operations
  if (path.includes("/admin")) {
    return "admin";
  }

  // Determine resource type from path
  let resource: string | null = null;
  if (path.includes("/agents")) resource = "agents";
  else if (path.includes("/payments") || path.includes("/x402")) resource = "payments";
  else if (path.includes("/dashboard") || path.includes("/analytics")) resource = "analytics";
  else if (path.includes("/activity")) resource = "activity";
  else if (path.includes("/tools") || path.includes("/meter")) resource = "tools";

  if (!resource) return null;

  // Determine action based on method
  if (READ_ONLY_METHODS.includes(method)) {
    return `read:${resource}` as ApiKeyScope;
  } else {
    return `write:${resource}` as ApiKeyScope;
  }
}

/**
 * Get client IP address
 */
function getClientIp(req: Request): string {
  return (
    req.ip ||
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

// =============================================================================
// BACKWARD COMPATIBILITY
// =============================================================================

/**
 * Simple API key auth for backward compatibility
 * Uses hardened comparison but doesn't require v2 keys
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header("x-api-key");
  const expected = process.env.AGENTPAY_API_KEY;

  if (!expected) {
    const error = new AppError(ErrorCodes.AUTH_API_KEY_NOT_CONFIGURED, {
      header: "x-api-key",
    });
    return res.status(error.httpStatus).json(error.toResponse((req as any).requestId)) as any;
  }

  if (!provided || !timingSafeCompare(provided, expected)) {
    const error = new AppError(ErrorCodes.AUTH_INVALID_API_KEY, {
      header: "x-api-key",
      provided: provided ? "[redacted]" : undefined,
    });
    return res.status(error.httpStatus).json(error.toResponse((req as any).requestId)) as any;
  }

  // Create a synthetic record for backward compatibility
  req.apiKeyRecord = {
    id: "legacy",
    developerId: "system",
    name: "Legacy API Key",
    keyPrefix: "legacy",
    keyHash: "",
    scopes: ["*"],
    rateLimit: 1000,
    rateLimitBurst: 100,
    expiresAt: null,
    lastUsedAt: new Date(),
    lastUsedIp: null,
    isActive: true,
    version: 1,
    previousKeyHash: null,
    rotatedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return next();
}
