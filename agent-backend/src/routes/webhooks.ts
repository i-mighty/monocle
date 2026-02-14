/**
 * Webhook Routes
 *
 * Real-time event subscriptions for developers.
 * Makes AgentPay programmable and reactive.
 *
 * Events:
 * - payment_settled
 * - spend_limit_reached
 * - verification_approved
 * - anomaly_detected
 * - balance_low
 * - tool_executed
 */

import { Router } from "express";
import { apiKeyAuth } from "../middleware/apiKeyAuthHardened";
import { demoOnly } from "../middleware/demoOnly";
import {
  registerWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhooks,
  getWebhook,
  rotateSecret,
  getDeliveryHistory,
  retryDelivery,
  verifySignature,
  WebhookEventType,
} from "../services/webhookService";
import { validateWebhookUrl, validateWebhookUrlSync } from "../utils/urlValidator";

const router = Router();

// Valid event types
const VALID_EVENTS: WebhookEventType[] = [
  "payment_settled",
  "spend_limit_reached",
  "verification_approved",
  "anomaly_detected",
  "balance_low",
  "tool_executed",
  "execution_failed",
  "incident_created",
  "incident_resolved",
];

// =============================================================================
// EVENT TYPES INFO (must be before parameterized routes)
// =============================================================================

/**
 * GET /webhooks/events
 *
 * Get list of available event types and their descriptions.
 */
router.get("/events", async (req, res) => {
  res.json({
    success: true,
    data: {
      events: [
        {
          type: "payment_settled",
          description: "On-chain settlement completed successfully",
          payload: {
            settlementId: "uuid",
            fromAgentId: "string",
            toAgentId: "string",
            grossLamports: "number",
            netLamports: "number",
            txSignature: "string",
          },
        },
        {
          type: "spend_limit_reached",
          description: "Budget guardrail triggered (daily cap, per-call limit, or insufficient balance)",
          payload: {
            limitType: "daily_cap | per_call | balance",
            limitValue: "number",
            attemptedAmount: "number",
            calleeId: "string?",
            toolName: "string?",
          },
        },
        {
          type: "verification_approved",
          description: "Identity verification passed",
          payload: {
            verificationType: "string",
            verifiedAt: "ISO datetime",
          },
        },
        {
          type: "anomaly_detected",
          description: "Unusual spending pattern detected",
          payload: {
            anomalyType: "string",
            description: "string",
            severity: "low | medium | high",
            affectedCalls: "number?",
          },
        },
        {
          type: "balance_low",
          description: "Balance below configured threshold",
          payload: {
            currentBalance: "number (lamports)",
            threshold: "number (lamports)",
            projectedRunway: "number (hours)",
          },
        },
        {
          type: "tool_executed",
          description: "Tool call completed",
          payload: {
            callerId: "string",
            calleeId: "string",
            toolName: "string",
            tokensUsed: "number",
            costLamports: "number",
            success: "boolean",
          },
        },
        {
          type: "execution_failed",
          description: "Tool execution failed",
          payload: {
            callerId: "string",
            calleeId: "string",
            toolName: "string",
            errorType: "string",
            errorMessage: "string",
          },
        },
        {
          type: "incident_created",
          description: "New incident reported",
          payload: {
            incidentId: "uuid",
            severity: "low | medium | high | critical",
            title: "string",
          },
        },
        {
          type: "incident_resolved",
          description: "Incident marked as resolved",
          payload: {
            incidentId: "uuid",
            resolvedAt: "ISO datetime",
            resolutionNotes: "string?",
          },
        },
      ],
    },
  });
});

// =============================================================================
// WEBHOOK MANAGEMENT
// =============================================================================

/**
 * POST /webhooks
 *
 * Register a new webhook.
 *
 * Body:
 * {
 *   "agentId": "my-agent",
 *   "url": "https://my-server.com/webhook",
 *   "events": ["payment_settled", "spend_limit_reached"]
 * }
 */
router.post("/", apiKeyAuth, async (req, res) => {
  try {
    const { agentId, url, events, secret } = req.body;

    if (!agentId || !url || !events) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: agentId, url, events",
      });
    }

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        success: false,
        error: "events must be a non-empty array",
      });
    }

    // Validate event types
    const invalidEvents = events.filter((e: string) => !VALID_EVENTS.includes(e as WebhookEventType));
    if (invalidEvents.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid event types: ${invalidEvents.join(", ")}. Valid events: ${VALID_EVENTS.join(", ")}`,
      });
    }

    // Validate URL format first (sync check)
    const syncValidation = validateWebhookUrlSync(url);
    if (!syncValidation.valid) {
      return res.status(400).json({
        success: false,
        error: syncValidation.error || "Invalid webhook URL",
      });
    }

    // Full SSRF validation with DNS resolution
    const fullValidation = await validateWebhookUrl(url);
    if (!fullValidation.valid) {
      return res.status(400).json({
        success: false,
        error: fullValidation.error || "Webhook URL failed security validation",
      });
    }

    const webhook = await registerWebhook({
      agentId,
      url,
      events: events as WebhookEventType[],
      secret,
    });

    res.status(201).json({
      success: true,
      data: {
        id: webhook.id,
        agentId: webhook.agentId,
        url: webhook.url,
        events: JSON.parse(webhook.events),
        secret: webhook.secret, // Only returned on creation
        isActive: webhook.isActive === "true",
        createdAt: webhook.createdAt,
      },
      message: "Webhook registered. Keep your secret safe - it won't be shown again!",
    });
  } catch (error: any) {
    console.error("Error registering webhook:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to register webhook",
    });
  }
});

/**
 * GET /webhooks/:agentId
 *
 * List all webhooks for an agent.
 */
router.get("/:agentId", apiKeyAuth, async (req, res) => {
  try {
    const { agentId } = req.params;

    const webhookList = await listWebhooks(agentId);

    res.json({
      success: true,
      data: webhookList.map((wh) => ({
        id: wh.id,
        url: wh.url,
        events: JSON.parse(wh.events),
        isActive: wh.isActive === "true",
        failureCount: wh.failureCount,
        lastSuccess: wh.lastSuccess,
        lastFailure: wh.lastFailure,
        createdAt: wh.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("Error listing webhooks:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to list webhooks",
    });
  }
});

/**
 * PATCH /webhooks/:webhookId
 *
 * Update a webhook.
 */
router.patch("/:webhookId", apiKeyAuth, async (req, res) => {
  try {
    const { webhookId } = req.params;
    const { url, events, isActive } = req.body;

    // Validate URL if provided (SSRF protection)
    if (url) {
      const syncValidation = validateWebhookUrlSync(url);
      if (!syncValidation.valid) {
        return res.status(400).json({
          success: false,
          error: syncValidation.error || "Invalid webhook URL",
        });
      }
      
      const fullValidation = await validateWebhookUrl(url);
      if (!fullValidation.valid) {
        return res.status(400).json({
          success: false,
          error: fullValidation.error || "Webhook URL failed security validation",
        });
      }
    }

    // Validate events if provided
    if (events) {
      if (!Array.isArray(events)) {
        return res.status(400).json({
          success: false,
          error: "events must be an array",
        });
      }
      const invalidEvents = events.filter((e: string) => !VALID_EVENTS.includes(e as WebhookEventType));
      if (invalidEvents.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Invalid event types: ${invalidEvents.join(", ")}`,
        });
      }
    }

    const webhook = await updateWebhook(webhookId, { url, events, isActive });

    res.json({
      success: true,
      data: {
        id: webhook.id,
        url: webhook.url,
        events: JSON.parse(webhook.events),
        isActive: webhook.isActive === "true",
        failureCount: webhook.failureCount,
        updatedAt: webhook.updatedAt,
      },
    });
  } catch (error: any) {
    console.error("Error updating webhook:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update webhook",
    });
  }
});

/**
 * DELETE /webhooks/:webhookId
 *
 * Delete a webhook.
 */
router.delete("/:webhookId", apiKeyAuth, async (req, res) => {
  try {
    const { webhookId } = req.params;

    await deleteWebhook(webhookId);

    res.json({
      success: true,
      message: "Webhook deleted",
    });
  } catch (error: any) {
    console.error("Error deleting webhook:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete webhook",
    });
  }
});

// =============================================================================
// SECRET MANAGEMENT
// =============================================================================

/**
 * POST /webhooks/:webhookId/rotate-secret
 *
 * Rotate the webhook secret.
 * Returns the new secret (only shown once).
 */
router.post("/:webhookId/rotate-secret", apiKeyAuth, async (req, res) => {
  try {
    const { webhookId } = req.params;

    const newSecret = await rotateSecret(webhookId);

    res.json({
      success: true,
      data: {
        secret: newSecret,
      },
      message: "Secret rotated. Keep your new secret safe - it won't be shown again!",
    });
  } catch (error: any) {
    console.error("Error rotating secret:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to rotate secret",
    });
  }
});

// =============================================================================
// DELIVERY HISTORY
// =============================================================================

/**
 * GET /webhooks/:webhookId/deliveries
 *
 * Get delivery history for a webhook.
 */
router.get("/:webhookId/deliveries", apiKeyAuth, async (req, res) => {
  try {
    const { webhookId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;

    const deliveries = await getDeliveryHistory(webhookId, limit);

    res.json({
      success: true,
      data: deliveries.map((d) => ({
        id: d.id,
        eventType: d.eventType,
        status: d.status,
        httpStatus: d.httpStatus,
        errorMessage: d.errorMessage,
        attemptCount: d.attemptCount,
        deliveredAt: d.deliveredAt,
        createdAt: d.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("Error fetching delivery history:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch delivery history",
    });
  }
});

/**
 * POST /webhooks/deliveries/:deliveryId/retry
 *
 * Retry a failed delivery.
 */
router.post("/deliveries/:deliveryId/retry", apiKeyAuth, async (req, res) => {
  try {
    const { deliveryId } = req.params;

    const result = await retryDelivery(deliveryId);

    res.json({
      success: true,
      data: {
        deliveryId: result.deliveryId,
        success: result.success,
        httpStatus: result.httpStatus,
        error: result.error,
      },
    });
  } catch (error: any) {
    console.error("Error retrying delivery:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to retry delivery",
    });
  }
});

// =============================================================================
// SIGNATURE VERIFICATION HELPER
// =============================================================================

/**
 * POST /webhooks/verify-signature
 *
 * Helper endpoint for developers to verify webhook signatures.
 * DEMO ENDPOINT: Disabled in production unless ALLOW_DEMO_ENDPOINTS=true
 */
router.post("/verify-signature", demoOnly, async (req, res) => {
  try {
    const { payload, signature, secret } = req.body;

    if (!payload || !signature || !secret) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: payload, signature, secret",
      });
    }

    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    const isValid = verifySignature(payloadStr, signature, secret);

    res.json({
      success: true,
      data: {
        valid: isValid,
      },
    });
  } catch (error: any) {
    console.error("Error verifying signature:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to verify signature",
    });
  }
});

export default router;
