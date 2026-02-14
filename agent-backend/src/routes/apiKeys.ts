/**
 * API Keys Management Routes
 *
 * Provides endpoints for:
 * - Creating new API keys
 * - Listing API keys
 * - Rotating keys safely
 * - Revoking keys
 */

import { Router, Request, Response } from "express";
import {
  createApiKey,
  listApiKeys,
  rotateApiKey,
  revokeApiKey,
  ApiKeyScope,
} from "../services/securityService";
import { apiKeyAuth, apiKeyAuthHardened } from "../middleware/apiKeyAuthHardened";
import { requireScope } from "../middleware/apiKeyAuthHardened";
import { logActivityAsync } from "../services/activityService";

const router = Router();

// All routes require authentication
router.use(apiKeyAuth);

// =============================================================================
// API KEY MANAGEMENT ENDPOINTS
// =============================================================================

/**
 * POST /api-keys
 * Create a new API key
 */
router.post("/", requireScope("admin"), async (req: Request, res: Response) => {
  try {
    const {
      developerId,
      name,
      scopes,
      rateLimit,
      rateLimitBurst,
      expiresInDays,
    } = req.body;

    if (!developerId || !name) {
      return res.status(400).json({
        error: "validation_error",
        message: "developerId and name are required",
      });
    }

    // Validate scopes
    const validScopes: ApiKeyScope[] = [
      "read:agents",
      "write:agents",
      "read:payments",
      "write:payments",
      "read:analytics",
      "read:activity",
      "write:tools",
      "execute:tools",
      "admin",
      "*",
    ];

    if (scopes) {
      const invalidScopes = scopes.filter((s: string) => !validScopes.includes(s as ApiKeyScope));
      if (invalidScopes.length > 0) {
        return res.status(400).json({
          error: "validation_error",
          message: `Invalid scopes: ${invalidScopes.join(", ")}`,
          validScopes,
        });
      }
    }

    // Calculate expiration
    let expiresAt: Date | null = null;
    if (expiresInDays) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    }

    const { keyRecord, plainKey } = await createApiKey({
      developerId,
      name,
      scopes,
      rateLimit,
      rateLimitBurst,
      expiresAt,
    });

    // Log key creation
    logActivityAsync({
      eventType: "api_key_used",
      severity: "info",
      actorId: req.developerId,
      actorType: "admin",
      resourceType: "api_key",
      resourceId: keyRecord.id,
      action: "api_key.created",
      description: `API key created: ${name} for developer ${developerId}`,
      requestId: (req as any).requestId,
      metadata: {
        keyName: name,
        scopes: keyRecord.scopes,
        expiresAt: expiresAt?.toISOString(),
      },
    });

    res.status(201).json({
      message: "API key created successfully",
      key: plainKey, // Only returned once, at creation time
      keyRecord: {
        id: keyRecord.id,
        developerId: keyRecord.developerId,
        name: keyRecord.name,
        keyPrefix: keyRecord.keyPrefix,
        scopes: keyRecord.scopes,
        rateLimit: keyRecord.rateLimit,
        rateLimitBurst: keyRecord.rateLimitBurst,
        expiresAt: keyRecord.expiresAt?.toISOString() || null,
        createdAt: keyRecord.createdAt.toISOString(),
      },
      warning:
        "Store this key securely. It will not be shown again. The key prefix can be used to identify it later.",
    });
  } catch (error: any) {
    console.error("[ApiKeys] Create error:", error);
    res.status(500).json({
      error: "server_error",
      message: "Failed to create API key",
    });
  }
});

/**
 * GET /api-keys
 * List API keys for a developer
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const developerId = req.query.developerId as string || req.developerId;

    if (!developerId) {
      return res.status(400).json({
        error: "validation_error",
        message: "developerId is required",
      });
    }

    // Check authorization - admin can see all, others only their own
    if (developerId !== req.developerId && !req.apiKeyRecord?.scopes.includes("admin")) {
      return res.status(403).json({
        error: "forbidden",
        message: "You can only view your own API keys",
      });
    }

    const keys = await listApiKeys(developerId);

    // Don't expose hashes
    const sanitizedKeys = keys.map((k) => ({
      id: k.id,
      developerId: k.developerId,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: k.scopes,
      rateLimit: k.rateLimit,
      rateLimitBurst: k.rateLimitBurst,
      expiresAt: k.expiresAt?.toISOString() || null,
      lastUsedAt: k.lastUsedAt?.toISOString() || null,
      lastUsedIp: k.lastUsedIp,
      isActive: k.isActive,
      version: k.version,
      rotatedAt: k.rotatedAt?.toISOString() || null,
      createdAt: k.createdAt.toISOString(),
    }));

    res.json({
      developerId,
      keys: sanitizedKeys,
      count: sanitizedKeys.length,
    });
  } catch (error: any) {
    console.error("[ApiKeys] List error:", error);
    res.status(500).json({
      error: "server_error",
      message: "Failed to list API keys",
    });
  }
});

/**
 * POST /api-keys/:keyId/rotate
 * Rotate an API key (generate new key, keep old one valid for 24h)
 */
router.post("/:keyId/rotate", async (req: Request, res: Response) => {
  try {
    const { keyId } = req.params;

    const result = await rotateApiKey(keyId);

    if (!result) {
      return res.status(404).json({
        error: "not_found",
        message: "API key not found or already inactive",
      });
    }

    // Log rotation
    logActivityAsync({
      eventType: "api_key_used",
      severity: "info",
      actorId: req.developerId,
      actorType: "admin",
      resourceType: "api_key",
      resourceId: keyId,
      action: "api_key.rotated",
      description: `API key rotated: ${keyId}`,
      requestId: (req as any).requestId,
      metadata: {
        oldKeyValidUntil: result.oldKeyValidUntil.toISOString(),
      },
    });

    res.json({
      message: "API key rotated successfully",
      newKey: result.newKey,
      oldKeyValidUntil: result.oldKeyValidUntil.toISOString(),
      warning:
        "Your old key will continue to work for 24 hours. Update your systems to use the new key.",
    });
  } catch (error: any) {
    console.error("[ApiKeys] Rotate error:", error);
    res.status(500).json({
      error: "server_error",
      message: "Failed to rotate API key",
    });
  }
});

/**
 * DELETE /api-keys/:keyId
 * Revoke an API key immediately
 */
router.delete("/:keyId", async (req: Request, res: Response) => {
  try {
    const { keyId } = req.params;

    const success = await revokeApiKey(keyId);

    if (!success) {
      return res.status(404).json({
        error: "not_found",
        message: "API key not found",
      });
    }

    // Log revocation
    logActivityAsync({
      eventType: "api_key_used",
      severity: "warning",
      actorId: req.developerId,
      actorType: "admin",
      resourceType: "api_key",
      resourceId: keyId,
      action: "api_key.revoked",
      description: `API key revoked: ${keyId}`,
      requestId: (req as any).requestId,
    });

    res.json({
      message: "API key revoked successfully",
      keyId,
      warning: "This action is immediate and irreversible.",
    });
  } catch (error: any) {
    console.error("[ApiKeys] Revoke error:", error);
    res.status(500).json({
      error: "server_error",
      message: "Failed to revoke API key",
    });
  }
});

/**
 * GET /api-keys/scopes
 * List available scopes
 */
router.get("/scopes", (req: Request, res: Response) => {
  res.json({
    scopes: [
      {
        name: "read:agents",
        description: "Read agent information and profiles",
      },
      {
        name: "write:agents",
        description: "Create, update, and delete agents",
      },
      {
        name: "read:payments",
        description: "View payment history and balances",
      },
      {
        name: "write:payments",
        description: "Initiate payments and settlements",
      },
      {
        name: "read:analytics",
        description: "Access dashboard and analytics data",
      },
      {
        name: "read:activity",
        description: "View activity logs and audit trail",
      },
      {
        name: "write:tools",
        description: "Register and configure tools",
      },
      {
        name: "execute:tools",
        description: "Execute tool calls (metering)",
      },
      {
        name: "admin",
        description: "Full administrative access",
      },
      {
        name: "*",
        description: "All permissions (use with caution)",
      },
    ],
    scopeHierarchy: {
      "write:*": "Includes corresponding read:* scope",
      admin: "Includes all scopes",
      "*": "Wildcard - includes everything",
    },
  });
});

export default router;
