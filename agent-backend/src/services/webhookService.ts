/**
 * Webhook Service
 *
 * Real-time event notifications for developers.
 * Makes AgentPay programmable and reactive.
 *
 * Event Types:
 * - payment_settled: On-chain settlement completed
 * - spend_limit_reached: Budget guardrail triggered
 * - verification_approved: Identity verification passed
 * - anomaly_detected: Unusual spending pattern detected
 * - balance_low: Balance below threshold
 * - tool_executed: Tool call completed
 *
 * Features:
 * - HMAC signature verification for security
 * - Exponential backoff retry on failures
 * - Delivery logging for debugging
 * - Automatic disabling after repeated failures
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { db, webhooks, webhookDeliveries } from "../db/client";
import type { Webhook, WebhookDelivery } from "../db/client";
import crypto from "crypto";

// =============================================================================
// TYPES
// =============================================================================

export type WebhookEventType =
  | "payment_settled"
  | "spend_limit_reached"
  | "verification_approved"
  | "anomaly_detected"
  | "balance_low"
  | "tool_executed"
  | "execution_failed"
  | "incident_created"
  | "incident_resolved";

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  timestamp: string;
  agentId: string;
  data: Record<string, unknown>;
}

export interface WebhookConfig {
  agentId: string;
  url: string;
  events: WebhookEventType[];
  secret?: string;
}

export interface DeliveryResult {
  webhookId: string;
  success: boolean;
  httpStatus?: number;
  response?: string;
  error?: string;
  deliveryId: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_RETRIES = 3;
const MAX_FAILURES_BEFORE_DISABLE = 10;
const DELIVERY_TIMEOUT_MS = 10_000;

// =============================================================================
// WEBHOOK MANAGEMENT
// =============================================================================

/**
 * Register a new webhook
 */
export async function registerWebhook(config: WebhookConfig): Promise<Webhook> {
  if (!db) throw new Error("Database not connected");

  // Generate secret if not provided
  const secret = config.secret || crypto.randomBytes(32).toString("hex");

  const result = await db
    .insert(webhooks)
    .values({
      agentId: config.agentId,
      url: config.url,
      events: JSON.stringify(config.events),
      secret,
      isActive: "true",
    })
    .returning();

  return result[0];
}

/**
 * Update webhook configuration
 */
export async function updateWebhook(
  webhookId: string,
  updates: Partial<Pick<WebhookConfig, "url" | "events">> & { isActive?: boolean }
): Promise<Webhook> {
  if (!db) throw new Error("Database not connected");

  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.url) updateData.url = updates.url;
  if (updates.events) updateData.events = JSON.stringify(updates.events);
  if (typeof updates.isActive === "boolean") {
    updateData.isActive = updates.isActive ? "true" : "false";
    // Reset failure count when re-enabling
    if (updates.isActive) {
      updateData.failureCount = 0;
    }
  }

  const result = await db
    .update(webhooks)
    .set(updateData)
    .where(eq(webhooks.id, webhookId))
    .returning();

  if (result.length === 0) {
    throw new Error(`Webhook not found: ${webhookId}`);
  }

  return result[0];
}

/**
 * Delete a webhook
 */
export async function deleteWebhook(webhookId: string): Promise<void> {
  if (!db) throw new Error("Database not connected");

  await db.delete(webhooks).where(eq(webhooks.id, webhookId));
}

/**
 * List webhooks for an agent
 */
export async function listWebhooks(agentId: string): Promise<Webhook[]> {
  if (!db) throw new Error("Database not connected");

  return db
    .select()
    .from(webhooks)
    .where(eq(webhooks.agentId, agentId))
    .orderBy(desc(webhooks.createdAt));
}

/**
 * Get webhook by ID
 */
export async function getWebhook(webhookId: string): Promise<Webhook | null> {
  if (!db) throw new Error("Database not connected");

  const result = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, webhookId))
    .limit(1);

  return result[0] || null;
}

/**
 * Rotate webhook secret
 */
export async function rotateSecret(webhookId: string): Promise<string> {
  if (!db) throw new Error("Database not connected");

  const newSecret = crypto.randomBytes(32).toString("hex");

  await db
    .update(webhooks)
    .set({ secret: newSecret, updatedAt: new Date() })
    .where(eq(webhooks.id, webhookId));

  return newSecret;
}

// =============================================================================
// EVENT DISPATCH
// =============================================================================

/**
 * Dispatch an event to all subscribed webhooks
 *
 * This is the main entry point for sending events.
 * It finds all active webhooks subscribed to this event type
 * and delivers the payload to each.
 */
export async function dispatchEvent(
  agentId: string,
  eventType: WebhookEventType,
  data: Record<string, unknown>
): Promise<DeliveryResult[]> {
  if (!db) throw new Error("Database not connected");

  // Create event object
  const event: WebhookEvent = {
    id: crypto.randomUUID(),
    type: eventType,
    timestamp: new Date().toISOString(),
    agentId,
    data,
  };

  // Find all active webhooks for this agent that subscribe to this event
  const activeWebhooks = await db
    .select()
    .from(webhooks)
    .where(
      and(
        eq(webhooks.agentId, agentId),
        eq(webhooks.isActive, "true")
      )
    );

  // Filter to webhooks subscribed to this event type
  const subscribedWebhooks = activeWebhooks.filter((wh) => {
    try {
      const events = JSON.parse(wh.events) as WebhookEventType[];
      return events.includes(eventType) || events.includes("*" as WebhookEventType);
    } catch {
      return false;
    }
  });

  // Deliver to each webhook
  const results: DeliveryResult[] = [];
  for (const webhook of subscribedWebhooks) {
    const result = await deliverToWebhook(webhook, event);
    results.push(result);
  }

  return results;
}

/**
 * Deliver event to a single webhook with retry
 */
async function deliverToWebhook(
  webhook: Webhook,
  event: WebhookEvent
): Promise<DeliveryResult> {
  if (!db) throw new Error("Database not connected");

  const payload = JSON.stringify(event);

  // Create HMAC signature
  const signature = createSignature(payload, webhook.secret);

  // Create delivery record
  const deliveryRecord = await db
    .insert(webhookDeliveries)
    .values({
      webhookId: webhook.id,
      eventType: event.type,
      payload,
      status: "pending",
    })
    .returning();

  const deliveryId = deliveryRecord[0].id;

  // Attempt delivery with retries
  let lastError: string | undefined;
  let httpStatus: number | undefined;
  let response: string | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      const res = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentPay-Signature": signature,
          "X-AgentPay-Event": event.type,
          "X-AgentPay-Delivery": deliveryId,
          "X-AgentPay-Timestamp": event.timestamp,
        },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      httpStatus = res.status;
      response = await res.text().catch(() => "");

      if (res.ok) {
        // Success - update delivery and webhook
        await db
          .update(webhookDeliveries)
          .set({
            status: "success",
            httpStatus,
            response: response.substring(0, 1000),
            attemptCount: attempt,
            deliveredAt: new Date(),
          })
          .where(eq(webhookDeliveries.id, deliveryId));

        await db
          .update(webhooks)
          .set({
            lastSuccess: new Date(),
            failureCount: 0,
          })
          .where(eq(webhooks.id, webhook.id));

        return {
          webhookId: webhook.id,
          success: true,
          httpStatus,
          response: response.substring(0, 500),
          deliveryId,
        };
      }

      lastError = `HTTP ${res.status}: ${response.substring(0, 200)}`;
    } catch (err: any) {
      lastError = err.message || "Unknown error";
    }

    // Exponential backoff before retry (don't sleep on last attempt)
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }

  // All retries failed
  await db
    .update(webhookDeliveries)
    .set({
      status: "failed",
      httpStatus,
      errorMessage: lastError,
      attemptCount: MAX_RETRIES,
    })
    .where(eq(webhookDeliveries.id, deliveryId));

  // Increment failure count and potentially disable
  const newFailureCount = (webhook.failureCount || 0) + 1;
  const shouldDisable = newFailureCount >= MAX_FAILURES_BEFORE_DISABLE;

  await db
    .update(webhooks)
    .set({
      failureCount: newFailureCount,
      lastFailure: new Date(),
      isActive: shouldDisable ? "false" : webhook.isActive,
    })
    .where(eq(webhooks.id, webhook.id));

  return {
    webhookId: webhook.id,
    success: false,
    httpStatus,
    error: lastError,
    deliveryId,
  };
}

/**
 * Create HMAC-SHA256 signature for payload
 */
function createSignature(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

/**
 * Verify webhook signature (for developers to use on their end)
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = createSignature(payload, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// =============================================================================
// DELIVERY HISTORY
// =============================================================================

/**
 * Get delivery history for a webhook
 */
export async function getDeliveryHistory(
  webhookId: string,
  limit: number = 100
): Promise<WebhookDelivery[]> {
  if (!db) throw new Error("Database not connected");

  return db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
}

/**
 * Get failed deliveries for retry
 */
export async function getFailedDeliveries(
  agentId: string
): Promise<WebhookDelivery[]> {
  if (!db) throw new Error("Database not connected");

  // Get webhook IDs for this agent
  const agentWebhooks = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(eq(webhooks.agentId, agentId));

  if (agentWebhooks.length === 0) return [];

  const webhookIds = agentWebhooks.map((w) => w.id);

  // Get failed deliveries for these webhooks
  return db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        sql`${webhookDeliveries.webhookId} = ANY(ARRAY[${sql.join(webhookIds.map(id => sql`${id}::uuid`), sql`, `)}])`,
        eq(webhookDeliveries.status, "failed")
      )
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(100);
}

/**
 * Retry a failed delivery
 */
export async function retryDelivery(deliveryId: string): Promise<DeliveryResult> {
  if (!db) throw new Error("Database not connected");

  // Get the original delivery
  const deliveries = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);

  if (deliveries.length === 0) {
    throw new Error(`Delivery not found: ${deliveryId}`);
  }

  const delivery = deliveries[0];

  // Get the webhook
  const webhook = await getWebhook(delivery.webhookId);
  if (!webhook) {
    throw new Error(`Webhook not found: ${delivery.webhookId}`);
  }

  // Parse the original event
  const event: WebhookEvent = JSON.parse(delivery.payload);

  // Deliver again
  return deliverToWebhook(webhook, event);
}

// =============================================================================
// CONVENIENCE METHODS: Pre-built event dispatchers
// =============================================================================

export async function notifyPaymentSettled(
  agentId: string,
  data: {
    settlementId: string;
    fromAgentId: string;
    toAgentId: string;
    grossLamports: number;
    netLamports: number;
    txSignature: string;
  }
): Promise<DeliveryResult[]> {
  return dispatchEvent(agentId, "payment_settled", data);
}

export async function notifySpendLimitReached(
  agentId: string,
  data: {
    limitType: "daily_cap" | "per_call" | "balance";
    limitValue: number;
    attemptedAmount: number;
    calleeId?: string;
    toolName?: string;
  }
): Promise<DeliveryResult[]> {
  return dispatchEvent(agentId, "spend_limit_reached", data);
}

export async function notifyVerificationApproved(
  agentId: string,
  data: {
    verificationType: string;
    verifiedAt: string;
  }
): Promise<DeliveryResult[]> {
  return dispatchEvent(agentId, "verification_approved", data);
}

export async function notifyAnomalyDetected(
  agentId: string,
  data: {
    anomalyType: string;
    description: string;
    severity: "low" | "medium" | "high";
    affectedCalls?: number;
  }
): Promise<DeliveryResult[]> {
  return dispatchEvent(agentId, "anomaly_detected", data);
}

export async function notifyBalanceLow(
  agentId: string,
  data: {
    currentBalance: number;
    threshold: number;
    projectedRunway: number; // hours at current spend rate
  }
): Promise<DeliveryResult[]> {
  return dispatchEvent(agentId, "balance_low", data);
}

export async function notifyToolExecuted(
  agentId: string,
  data: {
    callerId: string;
    calleeId: string;
    toolName: string;
    tokensUsed: number;
    costLamports: number;
    success: boolean;
  }
): Promise<DeliveryResult[]> {
  return dispatchEvent(agentId, "tool_executed", data);
}
